import { GoogleGenAI } from '@google/genai';

export type FashionSlot = 'Upperwear' | 'Lowerwear' | 'Footwear' | 'Accessories' | 'Outerwear';

export interface DetectedFashionItem {
  slot: FashionSlot;
  label: string;
  color: string;
  pattern: string;
  material: string;
  silhouette: string;
  style: string;
  keywords: string[];
}

export interface VisualCatalogMatch {
  product: Record<string, any>;
  similarityScore: number;
  confidenceLabel: 'Exact Match' | 'Visually Similar';
  matchedSlot?: FashionSlot | 'General';
  matchReasons: string[];
}

const VALID_SLOTS = new Set<FashionSlot>(['Upperwear', 'Lowerwear', 'Footwear', 'Accessories', 'Outerwear']);

function normalizeSlot(raw: unknown): FashionSlot {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('outer') || s.includes('jacket') || s.includes('coat') || s.includes('blazer')) return 'Outerwear';
  if (s.includes('lower') || s.includes('pant') || s.includes('jean') || s.includes('skirt') || s.includes('trouser')) {
    return 'Lowerwear';
  }
  if (s.includes('foot') || s.includes('shoe') || s.includes('sneaker') || s.includes('boot') || s.includes('heel')) {
    return 'Footwear';
  }
  if (s.includes('access') || s.includes('bag') || s.includes('watch') || s.includes('glass') || s.includes('hat')) {
    return 'Accessories';
  }
  return 'Upperwear';
}

export async function analyzeFashionImageWithGemini(args: {
  imageDataUrl: string;
  apiKey?: string;
}): Promise<{ usedGemini: boolean; detectedItems: DetectedFashionItem[]; keywords: string[] }> {
  const apiKey = (args.apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || !args.imageDataUrl) {
    return { usedGemini: false, detectedItems: [], keywords: [] };
  }

  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(args.imageDataUrl.trim());
  if (!m) {
    return { usedGemini: false, detectedItems: [], keywords: [] };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const resp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: m[1], data: m[2] } },
            {
              text: [
                'Inspect the fashion garments or accessories visible in this image.',
                'Return strict JSON with keys:',
                '"items": array of up to 5 objects, each with { "slot": "Upperwear"|"Lowerwear"|"Footwear"|"Accessories"|"Outerwear", "label": string, "color": string, "pattern": string, "material": string, "silhouette": string, "style": string, "keywords": string[] }',
                '"keywords": array of up to 12 concise lowercase fashion search keywords.',
                'Only report attributes directly visible. Use "unknown" if unclear.',
              ].join(' '),
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(String(resp.text || '{}')) as {
      items?: Array<Record<string, unknown>>;
      keywords?: unknown[];
    };

    const detectedItems: DetectedFashionItem[] = Array.isArray(parsed.items)
      ? parsed.items.slice(0, 5).map((item) => {
          const slotCandidate = String(item.slot || '').trim() as FashionSlot;
          const slot = VALID_SLOTS.has(slotCandidate) ? slotCandidate : normalizeSlot(item.slot || item.label);
          const kws = Array.isArray(item.keywords)
            ? item.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 8)
            : [];
          return {
            slot,
            label: String(item.label || slot).slice(0, 80),
            color: String(item.color || 'neutral').slice(0, 40),
            pattern: String(item.pattern || 'solid').slice(0, 40),
            material: String(item.material || 'unknown').slice(0, 40),
            silhouette: String(item.silhouette || 'regular').slice(0, 40),
            style: String(item.style || 'casual').slice(0, 40),
            keywords: kws,
          };
        })
      : [];

    const kwSet = new Set<string>();
    if (Array.isArray(parsed.keywords)) {
      for (const k of parsed.keywords) {
        for (const tok of String(k).toLowerCase().split(/[^a-z0-9]+/)) {
          if (tok.length >= 2) kwSet.add(tok);
        }
      }
    }
    for (const item of detectedItems) {
      for (const field of [item.label, item.color, item.material, item.style, ...item.keywords]) {
        for (const tok of String(field).toLowerCase().split(/[^a-z0-9]+/)) {
          if (tok.length >= 2 && tok !== 'unknown') kwSet.add(tok);
        }
      }
    }

    return {
      usedGemini: true,
      detectedItems,
      keywords: Array.from(kwSet).slice(0, 16),
    };
  } catch {
    return { usedGemini: false, detectedItems: [], keywords: [] };
  }
}

export function matchStructuredFashionCatalog(args: {
  products: Array<Record<string, any>>;
  tokens: string[];
  detectedItems?: DetectedFashionItem[];
  category?: string;
  enrichFn: (p: Record<string, any>) => Record<string, any>;
}): {
  exactMatches: VisualCatalogMatch[];
  visuallySimilar: VisualCatalogMatch[];
  allMatches: VisualCatalogMatch[];
} {
  const cleanTokens = Array.from(
    new Set(args.tokens.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 2))
  );
  const catLower = String(args.category || '').trim().toLowerCase();
  const detectedSlots = new Set((args.detectedItems || []).map((d) => d.slot.toLowerCase()));

  const scored: VisualCatalogMatch[] = [];

  for (const rawProduct of args.products) {
    if (!rawProduct || rawProduct.status !== 'active') continue;
    const product = args.enrichFn(rawProduct);
    const prodCategory = String(product.category || '').toLowerCase();
    const prodColors = Array.isArray(product.colors) ? product.colors.join(' ') : '';
    const prodTags = Array.isArray(product.tags) ? product.tags.join(' ') : '';
    const haystack = [
      product.title,
      product.description,
      product.category,
      product.brand,
      product.merchantName,
      product.material,
      product.fit,
      product.occasion,
      prodColors,
      prodTags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let score = 0;
    const reasons: string[] = [];
    let categoryAligned = false;

    if (catLower && prodCategory === catLower) {
      score += 4;
      categoryAligned = true;
      reasons.push(`Category match: ${product.category}`);
    } else if (detectedSlots.has(prodCategory)) {
      score += 3;
      categoryAligned = true;
      reasons.push(`Detected garment slot: ${product.category}`);
    }

    const tokenHits: string[] = [];
    for (const tok of cleanTokens) {
      if (haystack.includes(tok)) {
        score += 2;
        tokenHits.push(tok);
      }
    }
    if (tokenHits.length > 0) {
      reasons.push(`Attributes matched: ${tokenHits.slice(0, 4).join(', ')}`);
    }

    if (cleanTokens.length === 0 && !catLower && detectedSlots.size === 0) {
      score = 1;
      reasons.push('Active Exchange catalog listing');
    }

    if (score <= 0) continue;

    const isExact = (categoryAligned && tokenHits.length >= 2) || tokenHits.length >= 3;
    const matchedSlot =
      (args.detectedItems || []).find((d) => d.slot.toLowerCase() === prodCategory)?.slot || 'General';

    scored.push({
      product,
      similarityScore: score,
      confidenceLabel: isExact ? 'Exact Match' : 'Visually Similar',
      matchedSlot,
      matchReasons: reasons,
    });
  }

  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  const exactMatches = scored.filter((m) => m.confidenceLabel === 'Exact Match').slice(0, 12);
  const visuallySimilar = scored.filter((m) => m.confidenceLabel === 'Visually Similar').slice(0, 16);

  return {
    exactMatches,
    visuallySimilar,
    allMatches: scored.slice(0, 20),
  };
}
