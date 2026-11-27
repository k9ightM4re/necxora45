import { GoogleGenAI } from '@google/genai';
import type { AiProviderKind } from './ai_vault.ts';
import {
  decryptSecret,
  detectProviderCapabilities,
  getPlatformGeminiConfigured,
  getUserProviderInternal,
  updateUserProviderTestStatus,
  validateSafeEndpointUrl,
} from './ai_vault.ts';

export const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '3:2': { width: 1500, height: 1000 },
};

export interface AiTemplateGenerateInput {
  uid: string;
  providerConfigId?: string; // 'platform' or saved provider id
  prompt: string;
  templateName?: string;
  category?: string;
  style?: string;
  aspectRatio?: string;
  customWidth?: number;
  customHeight?: number;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundType?: string;
  fontPreference?: string;
  variationCount?: number;
  referenceImageDataUrl?: string;
  generateImageAsset?: boolean;
}

export class AiServiceError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;
  constructor(message: string, statusCode = 500, code = 'AI_ERROR', retryable = false) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

function classifyProviderError(err: any, providerLabel = 'AI Provider'): AiServiceError {
  if (err instanceof AiServiceError) return err;
  const status = Number(err?.status || err?.statusCode || err?.response?.status || 0);
  const rawMsg = String(err?.message || err || 'Unknown AI error').slice(0, 320);
  const lower = rawMsg.toLowerCase();

  if (err?.name === 'AbortError' || lower.includes('timeout') || lower.includes('timed out')) {
    return new AiServiceError(`${providerLabel} timed out before responding. Please retry.`, 504, 'TIMEOUT', true);
  }
  if (status === 401 || status === 403 || lower.includes('api key not valid') || lower.includes('invalid api key') || lower.includes('incorrect api key') || lower.includes('unauthorized')) {
    return new AiServiceError(`${providerLabel} rejected the API key. Check your key permissions and try again.`, 401, 'INVALID_KEY', false);
  }
  if (status === 429 || lower.includes('rate limit') || lower.includes('quota') || lower.includes('resource_exhausted')) {
    return new AiServiceError(`${providerLabel} rate limit or quota reached. Wait a moment and retry.`, 429, 'RATE_LIMIT', true);
  }
  if (status === 404 || lower.includes('model not found') || lower.includes('does not exist')) {
    return new AiServiceError(`Configured model was not found on ${providerLabel}: ${rawMsg}`, 400, 'MODEL_NOT_FOUND', false);
  }
  if (status >= 500 || lower.includes('unavailable') || lower.includes('fetch failed') || lower.includes('econnrefused')) {
    return new AiServiceError(`${providerLabel} is temporarily unreachable (${rawMsg}).`, 502, 'PROVIDER_OUTAGE', true);
  }
  return new AiServiceError(`${providerLabel} request failed: ${rawMsg}`, status >= 400 ? status : 500, 'PROVIDER_ERROR', false);
}

function resolveCanvasDims(aspectRatio: string, customW?: number, customH?: number): { width: number; height: number; ratioLabel: string } {
  if (aspectRatio === 'Custom') {
    const w = Math.min(2400, Math.max(320, Math.round(Number(customW) || 1080)));
    const h = Math.min(2400, Math.max(320, Math.round(Number(customH) || 1080)));
    return { width: w, height: h, ratioLabel: 'Custom' };
  }
  const preset = ASPECT_RATIO_DIMENSIONS[aspectRatio] || ASPECT_RATIO_DIMENSIONS['1:1'];
  return { width: preset.width, height: preset.height, ratioLabel: ASPECT_RATIO_DIMENSIONS[aspectRatio] ? aspectRatio : '1:1' };
}

function clampNum(val: any, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeColor(raw: any, fallback: string): string {
  const s = String(raw || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^rgba?\([\d.,\s%]+\)$/.test(s)) return s;
  return fallback;
}

export function normalizeGeneratedTemplateCandidate(
  rawCandidate: any,
  opts: {
    index: number;
    width: number;
    height: number;
    ratioLabel: string;
    category: string;
    style: string;
    fontPreference: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundType: string;
    templateName: string;
    generatedBgImageUrl?: string;
    referenceImageDataUrl?: string;
  }
) {
  const { width, height } = opts;
  const bg = rawCandidate?.templateData?.background || rawCandidate?.background || {};
  const palette = rawCandidate?.templateData?.palette || rawCandidate?.palette || {};
  const rawLayers = Array.isArray(rawCandidate?.templateData?.layers)
    ? rawCandidate.templateData.layers
    : Array.isArray(rawCandidate?.layers)
      ? rawCandidate.layers
      : [];

  const primary = sanitizeColor(palette.primary, opts.primaryColor || '#701CFF');
  const secondary = sanitizeColor(palette.secondary, opts.secondaryColor || '#286BFF');
  const accent = sanitizeColor(palette.accent, opts.accentColor || '#F43F5E');
  const textCol = sanitizeColor(palette.text, opts.style === 'Light' || opts.style === 'Minimalist' ? '#101124' : '#FFFFFF');

  const resolvedBgImage = opts.generatedBgImageUrl || '';
  const bgType = resolvedBgImage
    ? 'image'
    : ['solid', 'gradient', 'pattern', 'image'].includes(bg.type)
      ? bg.type
      : ['solid', 'gradient', 'pattern'].includes(opts.backgroundType)
        ? opts.backgroundType
        : 'gradient';

  const normalizedBg = {
    type: bgType,
    color: sanitizeColor(bg.color, opts.style === 'Light' ? '#F8FAFC' : '#0F1024'),
    gradientFrom: sanitizeColor(bg.gradientFrom, primary),
    gradientTo: sanitizeColor(bg.gradientTo, secondary),
    gradientAngle: clampNum(bg.gradientAngle, 0, 360, 140),
    pattern: ['none', 'grid', 'dots', 'diagonal', 'glow'].includes(bg.pattern) ? bg.pattern : 'glow',
    patternOpacity: clampNum(bg.patternOpacity, 0, 0.7, 0.18),
    imageUrl: resolvedBgImage,
    overlayColor: sanitizeColor(bg.overlayColor, '#0B0B1B'),
    overlayOpacity: clampNum(bg.overlayOpacity, 0, 0.85, resolvedBgImage ? 0.32 : 0.15),
  };

  const normalizedLayers = rawLayers.slice(0, 24).map((l: any, i: number) => {
    const type = ['text', 'image', 'shape', 'sticker'].includes(l?.type) ? l.type : 'text';
    const base = {
      id: `lyr-${i + 1}`,
      type,
      name: String(l?.name || `${type[0].toUpperCase() + type.slice(1)} ${i + 1}`).slice(0, 48),
      x: Math.round(clampNum(l?.x, -width * 0.4, width * 0.95, Math.round(width * 0.08))),
      y: Math.round(clampNum(l?.y, -height * 0.4, height * 0.95, Math.round(height * (0.12 + i * 0.15)))),
      width: Math.round(clampNum(l?.width, 24, width * 1.4, Math.round(width * 0.84))),
      height: Math.round(clampNum(l?.height, 24, height * 1.4, type === 'text' ? 140 : 320)),
      rotation: Math.round(clampNum(l?.rotation, -180, 180, 0)),
      opacity: clampNum(l?.opacity, 0.05, 1, 1),
      zIndex: i + 1,
      visible: l?.visible !== false,
      locked: false,
    };

    if (type === 'text') {
      return {
        ...base,
        text: String(l?.text || 'NEXORA Creator Template').slice(0, 360),
        fontFamily: String(l?.fontFamily || opts.fontPreference || 'Plus Jakarta Sans').slice(0, 60),
        fontSize: Math.round(clampNum(l?.fontSize, 14, 180, 56)),
        fontWeight: ['400', '500', '600', '700', '800', '900'].includes(String(l?.fontWeight)) ? String(l.fontWeight) : '700',
        color: sanitizeColor(l?.color, textCol),
        align: ['left', 'center', 'right'].includes(l?.align) ? l.align : 'left',
        lineHeight: clampNum(l?.lineHeight, 0.85, 2.2, 1.15),
        letterSpacing: clampNum(l?.letterSpacing, -4, 16, 0),
        bgColor: l?.bgColor ? sanitizeColor(l.bgColor, '') : '',
        bgPadding: Math.round(clampNum(l?.bgPadding, 0, 48, 0)),
        borderRadius: Math.round(clampNum(l?.borderRadius, 0, 999, 12)),
        shadow: Boolean(l?.shadow),
      };
    }

    if (type === 'image') {
      return {
        ...base,
        src: opts.referenceImageDataUrl || '',
        placeholderLabel: String(l?.placeholderLabel || 'Upload or Drop Media').slice(0, 60),
        objectFit: l?.objectFit === 'contain' ? 'contain' : 'cover',
        cropX: 0,
        cropY: 0,
        cropZoom: 1,
        borderRadius: Math.round(clampNum(l?.borderRadius, 0, 500, 24)),
        borderColor: sanitizeColor(l?.borderColor, primary),
        borderWidth: Math.round(clampNum(l?.borderWidth, 0, 24, 2)),
        frameStyle: ['none', 'polaroid', 'glass', 'neon'].includes(l?.frameStyle) ? l.frameStyle : 'glass',
        shadow: l?.shadow !== false,
      };
    }

    if (type === 'sticker') {
      return {
        ...base,
        emoji: String(l?.emoji || '✨').slice(0, 8),
        text: String(l?.text || 'FEATURED').slice(0, 40),
        fontSize: Math.round(clampNum(l?.fontSize, 14, 72, 22)),
        color: sanitizeColor(l?.color, '#FFFFFF'),
        bgColor: sanitizeColor(l?.bgColor, accent),
        borderRadius: Math.round(clampNum(l?.borderRadius, 0, 999, 999)),
      };
    }

    return {
      ...base,
      shapeKind: ['rect', 'rounded', 'circle', 'pill', 'line', 'ring'].includes(l?.shapeKind) ? l.shapeKind : 'rounded',
      fill: sanitizeColor(l?.fill, 'rgba(255,255,255,0.08)'),
      borderColor: sanitizeColor(l?.borderColor, primary),
      borderWidth: Math.round(clampNum(l?.borderWidth, 0, 24, 2)),
      borderRadius: Math.round(clampNum(l?.borderRadius, 0, 999, 28)),
      shadow: Boolean(l?.shadow),
    };
  });

  if (normalizedLayers.length === 0) {
    normalizedLayers.push({
      id: 'lyr-1',
      type: 'text',
      name: 'Main Headline',
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.36),
      width: Math.round(width * 0.8),
      height: Math.round(height * 0.24),
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      visible: true,
      locked: false,
      text: String(rawCandidate?.title || opts.templateName || 'Generated Design').slice(0, 120),
      fontFamily: opts.fontPreference || 'Plus Jakarta Sans',
      fontSize: 64,
      fontWeight: '800',
      color: textCol,
      align: 'center',
      lineHeight: 1.15,
      letterSpacing: -1,
      bgColor: '',
      bgPadding: 0,
      borderRadius: 12,
      shadow: true,
    });
  }

  return {
    title: String(rawCandidate?.title || (opts.templateName ? `${opts.templateName} #${opts.index + 1}` : `AI Concept ${opts.index + 1}`)).slice(0, 110),
    description: String(rawCandidate?.description || `${opts.style} ${opts.category} template generated from prompt.`).slice(0, 500),
    category: opts.category,
    style: String(rawCandidate?.style || opts.style).slice(0, 40),
    aspectRatio: opts.ratioLabel,
    tags: Array.isArray(rawCandidate?.tags)
      ? rawCandidate.tags.slice(0, 8).map((t: any) => String(t).replace(/^#/, '').slice(0, 30)).filter(Boolean)
      : [opts.category.toLowerCase().replace(/\s+/g, '-'), opts.style.toLowerCase()],
    templateData: {
      version: 1,
      width,
      height,
      aspectRatio: opts.ratioLabel,
      background: normalizedBg,
      palette: { primary, secondary, accent, text: textCol },
      layers: normalizedLayers,
    },
  };
}

function extractJsonObject(rawText: string): any {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) throw new AiServiceError('AI model returned an empty response.', 502, 'EMPTY_RESPONSE', true);
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {}
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new AiServiceError('AI response was not valid structured JSON. Retry generation.', 502, 'INVALID_JSON', true);
  }
}

function buildTemplateSystemPrompt(input: AiTemplateGenerateInput, dims: { width: number; height: number; ratioLabel: string }, count: number): string {
  return `You are NEXORA's Senior Creative Director & Layout Engine.
Design ${count} DISTINCT, visually balanced, editable graphic design template variation(s) for a ${dims.width}x${dims.height} canvas (${dims.ratioLabel}).

Requirements:
- Category: ${input.category || 'Social Media Posts'}
- Visual Style: ${input.style || 'Modern'}
- Preferred Font: ${input.fontPreference || 'Plus Jakarta Sans'}
- Background Type Preference: ${input.backgroundType || 'gradient'}
- Brand Colors (harmonize with style): Primary ${input.primaryColor || '#701CFF'}, Secondary ${input.secondaryColor || '#286BFF'}, Accent ${input.accentColor || '#F43F5E'}
- User Prompt: "${input.prompt}"
${input.templateName ? `- Requested Title Theme: "${input.templateName}"` : ''}
${input.referenceImageDataUrl ? '- A reference image is attached; inspect its mood, layout proportions, and color harmony and include an editable "image" placeholder layer sized cleanly inside the canvas.' : ''}

Make each of the ${count} variations genuinely different in composition, typography hierarchy, decorative shapes, and color harmony!
Keep all layer coordinates well within 0..${dims.width} width and 0..${dims.height} height with generous margins (at least 5% padding), readable font sizes (42-110 for headlines, 24-38 for subtitles, 18-26 for badges/CTA), crisp contrast, and 5-9 layers per template.

Return STRICT JSON matching this exact root schema:
{
  "variations": [
    {
      "title": "Short descriptive title",
      "description": "1-sentence design summary",
      "style": "${input.style || 'Modern'}",
      "tags": ["tag1", "tag2", "tag3"],
      "background": {
        "type": "gradient | solid | pattern",
        "color": "#hex",
        "gradientFrom": "#hex",
        "gradientTo": "#hex",
        "gradientAngle": 135,
        "pattern": "none | grid | dots | diagonal | glow",
        "patternOpacity": 0.18
      },
      "palette": {
        "primary": "#hex",
        "secondary": "#hex",
        "accent": "#hex",
        "text": "#hex"
      },
      "layers": [
        {
          "type": "shape | image | text | sticker",
          "name": "Layer Name",
          "x": 80,
          "y": 80,
          "width": 920,
          "height": 140,
          "rotation": 0,
          "opacity": 1,
          "shapeKind": "rect | rounded | circle | pill | line | ring",
          "fill": "#hex or rgba(...)",
          "borderColor": "#hex",
          "borderWidth": 2,
          "borderRadius": 24,
          "shadow": true,
          "placeholderLabel": "Hero Photo",
          "frameStyle": "none | polaroid | glass | neon",
          "text": "Headline or badge copy",
          "fontFamily": "${input.fontPreference || 'Plus Jakarta Sans'}",
          "fontSize": 64,
          "fontWeight": "800",
          "color": "#hex",
          "align": "left | center | right",
          "lineHeight": 1.12,
          "letterSpacing": -1,
          "bgColor": "",
          "bgPadding": 0,
          "emoji": "⚡"
        }
      ]
    }
  ]
}`;
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

async function resolveProviderCredentials(uid: string, providerConfigId?: string) {
  if (!providerConfigId || providerConfigId === 'platform') {
    const platformKey = process.env.GEMINI_API_KEY?.trim() || '';
    if (!platformKey) {
      throw new AiServiceError(
        'Platform GEMINI_API_KEY is not configured yet. Add your own Gemini, OpenAI, or OpenAI-Compatible API key in AI Provider Setup.',
        400,
        'NO_PROVIDER_CONFIGURED',
        false
      );
    }
    return {
      provider: 'gemini' as AiProviderKind,
      label: 'NEXORA Gemini AI',
      apiKey: platformKey,
      baseUrl: '',
      textModel: 'gemini-4-hydrogen',
      imageModel: 'gemini-3.1-flash-lite-image',
      configId: 'platform',
      capabilities: detectProviderCapabilities('gemini', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite-image', true),
    };
  }

  const stored = getUserProviderInternal(uid, providerConfigId);
  if (!stored) {
    throw new AiServiceError('Selected AI provider configuration was not found.', 404, 'PROVIDER_NOT_FOUND', false);
  }
  const apiKey = decryptSecret(stored.encryptedKey);
  if (!apiKey) {
    throw new AiServiceError('Saved AI API key could not be decrypted. Please re-enter your API key.', 400, 'KEY_MISSING', false);
  }
  return {
    provider: stored.provider,
    label: stored.label,
    apiKey,
    baseUrl: stored.baseUrl,
    textModel: stored.textModel,
    imageModel: stored.imageModel,
    configId: stored.id,
    capabilities: stored.capabilities,
  };
}

async function callOpenAiCompatibleJson(
  opts: { apiKey: string; baseUrl: string; model: string; promptText: string; referenceImageDataUrl?: string; providerLabel: string }
): Promise<any> {
  const endpointCheck = validateSafeEndpointUrl(opts.baseUrl || 'https://api.openai.com/v1');
  if (!endpointCheck.ok || !endpointCheck.url) {
    throw new AiServiceError(endpointCheck.error || 'Unsafe endpoint URL.', 400, 'UNSAFE_URL', false);
  }
  const url = `${endpointCheck.url}/chat/completions`;
  const userContent: any = opts.referenceImageDataUrl
    ? [
        { type: 'text', text: opts.promptText },
        { type: 'image_url', image_url: { url: opts.referenceImageDataUrl } },
      ]
    : opts.promptText;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: 'You output valid JSON only. Never wrap in markdown or prose.' },
          { role: 'user', content: userContent },
        ],
        temperature: 0.75,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = j?.error?.message || text;
      } catch {}
      throw classifyProviderError({ status: res.status, message: msg }, opts.providerLabel);
    }
    const parsed = JSON.parse(text);
    const content = parsed?.choices?.[0]?.message?.content || '';
    return extractJsonObject(content);
  } catch (err) {
    throw classifyProviderError(err, opts.providerLabel);
  } finally {
    clearTimeout(timer);
  }
}

async function maybeGenerateAiBackground(
  creds: { provider: AiProviderKind; apiKey: string; baseUrl: string; imageModel: string; label: string },
  prompt: string,
  aspectRatio: string
): Promise<{ imageUrl: string; warning?: string }> {
  if (!creds.imageModel) {
    return { imageUrl: '', warning: `${creds.label} has no image generation model configured; generated structured vector/canvas composition.` };
  }
  if (creds.provider === 'gemini') {
    try {
      const ai = new GoogleGenAI({
        apiKey: creds.apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const ratio = ['1:1', '3:4', '4:3', '9:16', '16:9'].includes(aspectRatio) ? aspectRatio : '1:1';
      const response = await ai.models.generateContent({
        model: creds.imageModel,
        contents: {
          parts: [
            {
              text: `Abstract atmospheric background artwork for graphic design template, NO text, NO words, NO letters, high contrast aesthetic matching: ${prompt}`,
            },
          ],
        },
        config: {
          imageConfig: { aspectRatio: ratio },
        },
      });
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType || 'image/png';
          return { imageUrl: `data:${mime};base64,${part.inlineData.data}` };
        }
      }
      return { imageUrl: '', warning: 'Image model returned no visual asset; used structured canvas layout instead.' };
    } catch (err: any) {
      const classified = classifyProviderError(err, `${creds.label} Image Model`);
      return { imageUrl: '', warning: classified.message };
    }
  }
  if (creds.provider === 'openai') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify({
          model: creds.imageModel,
          prompt: `Atmospheric background graphic design texture, NO text or letters: ${prompt}`,
          size: aspectRatio === '9:16' ? '1024x1792' : aspectRatio === '16:9' ? '1792x1024' : '1024x1024',
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      });
      const json: any = await res.json();
      if (!res.ok) {
        return { imageUrl: '', warning: json?.error?.message || 'OpenAI image generation unavailable.' };
      }
      const b64 = json?.data?.[0]?.b64_json;
      if (b64) return { imageUrl: `data:image/png;base64,${b64}` };
      return { imageUrl: '', warning: 'No image data returned.' };
    } catch (err: any) {
      return { imageUrl: '', warning: classifyProviderError(err, 'OpenAI Image').message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { imageUrl: '', warning: 'Custom OpenAI-Compatible endpoint image generation skipped (not natively enabled).' };
}

export async function generateTemplatesWithAi(input: AiTemplateGenerateInput) {
  const prompt = String(input.prompt || '').trim();
  if (prompt.length < 3 || prompt.length > 2000) {
    throw new AiServiceError('Please enter a prompt between 3 and 2000 characters.', 400, 'INVALID_PROMPT', false);
  }

  const creds = await resolveProviderCredentials(input.uid, input.providerConfigId);
  const variationCount = Math.min(4, Math.max(1, Math.round(Number(input.variationCount) || 2)));
  const category = String(input.category || 'Social Media Posts').slice(0, 60);
  const style = String(input.style || 'Modern').slice(0, 40);
  const fontPreference = String(input.fontPreference || 'Plus Jakarta Sans').slice(0, 60);
  const dims = resolveCanvasDims(input.aspectRatio || '1:1', input.customWidth, input.customHeight);
  const fullPrompt = buildTemplateSystemPrompt(input, dims, variationCount);

  let rawJson: any;
  if (creds.provider === 'gemini') {
    const ai = new GoogleGenAI({
      apiKey: creds.apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const parts: any[] = [{ text: fullPrompt }];
    if (input.referenceImageDataUrl) {
      const parsedImg = parseDataUrl(input.referenceImageDataUrl);
      if (parsedImg) {
        parts.unshift({ inlineData: { data: parsedImg.base64, mimeType: parsedImg.mimeType } });
      }
    }
    try {
      const response = await ai.models.generateContent({
        model: creds.textModel || 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          temperature: 0.75,
        },
      });
      rawJson = extractJsonObject(response.text || '');
    } catch (err) {
      throw classifyProviderError(err, creds.label);
    }
  } else {
    rawJson = await callOpenAiCompatibleJson({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl || 'https://api.openai.com/v1',
      model: creds.textModel,
      promptText: fullPrompt,
      referenceImageDataUrl: creds.capabilities.visionInput ? input.referenceImageDataUrl : undefined,
      providerLabel: creds.label,
    });
  }

  let generatedBgImageUrl = '';
  const warnings: string[] = [];
  if (input.generateImageAsset) {
    const imgRes = await maybeGenerateAiBackground(creds, prompt, dims.ratioLabel);
    generatedBgImageUrl = imgRes.imageUrl;
    if (imgRes.warning) warnings.push(imgRes.warning);
  }

  const rawVariations = Array.isArray(rawJson?.variations)
    ? rawJson.variations
    : Array.isArray(rawJson)
      ? rawJson
      : [rawJson];

  const templates = rawVariations.slice(0, variationCount).map((cand: any, idx: number) =>
    normalizeGeneratedTemplateCandidate(cand, {
      index: idx,
      width: dims.width,
      height: dims.height,
      ratioLabel: dims.ratioLabel,
      category,
      style,
      fontPreference,
      primaryColor: input.primaryColor || '#701CFF',
      secondaryColor: input.secondaryColor || '#286BFF',
      accentColor: input.accentColor || '#F43F5E',
      backgroundType: input.backgroundType || 'gradient',
      templateName: input.templateName || '',
      generatedBgImageUrl: idx === 0 ? generatedBgImageUrl : '',
      referenceImageDataUrl: input.referenceImageDataUrl || '',
    })
  );

  return {
    provider: creds.provider,
    providerLabel: creds.label,
    model: creds.textModel,
    capabilities: creds.capabilities,
    warnings,
    templates,
  };
}

export async function testAiProviderConnection(
  uid: string,
  opts: {
    configId?: string;
    provider?: AiProviderKind;
    apiKey?: string;
    baseUrl?: string;
    textModel?: string;
    imageModel?: string;
  }
) {
  let provider: AiProviderKind = 'gemini';
  let apiKey = '';
  let baseUrl = '';
  let textModel = 'gemini-4-hydrogen';
  let imageModel = '';
  let label = 'AI Provider';

  if (opts.configId === 'platform') {
    provider = 'gemini';
    apiKey = process.env.GEMINI_API_KEY?.trim() || '';
    textModel = 'gemini-4-hydrogen';
    imageModel = 'gemini-3.1-flash-lite-image';
    label = 'NEXORA Gemini AI';
    if (!apiKey) {
      throw new AiServiceError('Server GEMINI_API_KEY is not configured.', 400, 'NO_PLATFORM_KEY', false);
    }
  } else if (opts.configId) {
    const rec = getUserProviderInternal(uid, opts.configId);
    if (!rec) throw new AiServiceError('Provider config not found.', 404, 'PROVIDER_NOT_FOUND', false);
    provider = rec.provider;
    apiKey = opts.apiKey?.trim() || decryptSecret(rec.encryptedKey);
    baseUrl = opts.baseUrl ?? rec.baseUrl;
    textModel = opts.textModel || rec.textModel;
    imageModel = opts.imageModel ?? rec.imageModel;
    label = rec.label;
  } else {
    provider = opts.provider === 'openai' || opts.provider === 'openai_compatible' ? opts.provider : 'gemini';
    apiKey = String(opts.apiKey || '').trim();
    baseUrl = String(opts.baseUrl || '').trim();
    textModel = String(opts.textModel || (provider === 'gemini' ? 'gemini-4-hydrogen' : 'gpt-4o-mini')).trim();
    imageModel = String(opts.imageModel || '').trim();
    label = provider;
  }

  if (!apiKey) {
    throw new AiServiceError('API key is required to test connection.', 400, 'KEY_MISSING', false);
  }

  const started = Date.now();
  try {
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const res = await ai.models.generateContent({
        model: textModel || 'gemini-4-hydrogen',
        contents: 'Reply with exact word: OK',
        config: { maxOutputTokens: 8 },
      });
      if (!res.text && !res.candidates?.length) {
        throw new Error('Empty response from Gemini.');
      }
    } else {
      const endpointCheck = validateSafeEndpointUrl(baseUrl || 'https://api.openai.com/v1');
      if (!endpointCheck.ok || !endpointCheck.url) {
        throw new AiServiceError(endpointCheck.error || 'Unsafe endpoint URL.', 400, 'UNSAFE_URL', false);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(`${endpointCheck.url}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: textModel,
            messages: [{ role: 'user', content: 'Reply OK' }],
            max_tokens: 6,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text();
          throw classifyProviderError({ status: res.status, message: errText }, label);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    const latencyMs = Date.now() - started;
    const capabilities = detectProviderCapabilities(provider, textModel, imageModel, true);
    const updated = opts.configId && opts.configId !== 'platform'
      ? updateUserProviderTestStatus(uid, opts.configId, 'connected', '')
      : null;

    return {
      ok: true,
      status: 'connected',
      latencyMs,
      capabilities,
      provider: updated,
      platformConfigured: getPlatformGeminiConfigured(),
    };
  } catch (err) {
    const classified = classifyProviderError(err, label);
    if (opts.configId && opts.configId !== 'platform') {
      updateUserProviderTestStatus(uid, opts.configId, 'error', classified.message);
    }
    throw classified;
  }
}
