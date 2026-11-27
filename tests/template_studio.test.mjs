import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import {
  TEMPLATE_ASPECT_RATIOS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_FONT_FAMILIES,
  TEMPLATE_STICKERS,
  TEMPLATE_STYLES,
  cloneTemplateForUser,
  createBlankTemplateData,
  createHistoryStack,
  createNewLayer,
  filterAndSortTemplates,
  normalizeTemplateData,
  resolveDimensionsForRatio,
} from '../js/template_schema.js';
import { STARTER_TEMPLATES } from '../js/template_library.js';
import { buildPdfFromJpegDataUrl } from '../js/template_renderer.js';
import {
  decryptSecret,
  deleteUserProvider,
  detectProviderCapabilities,
  encryptSecret,
  listUserProviders,
  maskApiKey,
  upsertUserProvider,
  validateSafeEndpointUrl,
} from '../server/ai_vault.ts';
import { normalizeGeneratedTemplateCandidate } from '../server/ai_template_engine.ts';
import { mountNexoraApiRoutes } from '../server/api_router.ts';

test('Template categories (24), styles (17), aspect ratios, and font families are complete', () => {
  assert.equal(TEMPLATE_CATEGORIES.length, 24);
  for (const requiredCat of [
    'Social Media Posts',
    'Instagram-style Posts',
    'Stories',
    'Reels Covers',
    'YouTube Thumbnails',
    'Posters',
    'Event Posters',
    'Announcements',
    'Quotes',
    'Education',
    'Business',
    'Marketing',
    'Product Promotion',
    'Personal Branding',
    'Gaming',
    'Technology',
    'News',
    'Festivals',
    'Birthday',
    'Travel',
    'Photography',
    'Minimalist',
    'AI Art',
    'Custom',
  ]) {
    assert.ok(TEMPLATE_CATEGORIES.includes(requiredCat), `Missing category: ${requiredCat}`);
  }

  assert.equal(TEMPLATE_STYLES.length, 17);
  for (const requiredStyle of [
    'Modern',
    'Minimalist',
    'Premium',
    'Neon',
    'Dark',
    'Light',
    'Futuristic',
    'Professional',
    'Cinematic',
    'Artistic',
    'Editorial',
    'Gaming',
    'Corporate',
    'Education',
    'Luxury',
    'Retro',
    'Custom',
  ]) {
    assert.ok(TEMPLATE_STYLES.includes(requiredStyle), `Missing style: ${requiredStyle}`);
  }

  assert.deepEqual(Object.keys(TEMPLATE_ASPECT_RATIOS), ['1:1', '4:5', '9:16', '16:9', '3:2', 'Custom']);
  assert.ok(TEMPLATE_FONT_FAMILIES.length >= 8);
  assert.ok(TEMPLATE_STICKERS.length >= 8);
});

test('resolveDimensionsForRatio and normalizeTemplateData sanitize bounds cleanly', () => {
  assert.deepEqual(resolveDimensionsForRatio('16:9'), { width: 1920, height: 1080, aspectRatio: '16:9' });
  assert.deepEqual(resolveDimensionsForRatio('Custom', 5000, 120), { width: 2400, height: 320, aspectRatio: 'Custom' });

  const normalized = normalizeTemplateData({
    width: 1080,
    height: 1350,
    aspectRatio: '4:5',
    background: { type: 'gradient', gradientFrom: 'javascript:alert(1)', gradientTo: '#286BFF' },
    layers: [
      { id: 't1', type: 'text', text: 'Launch', fontSize: 9999, x: 50, y: 60, width: 500, height: 120, zIndex: 2 },
      { id: 's1', type: 'shape', shapeKind: 'rounded', zIndex: 1 },
    ],
  });

  assert.equal(normalized.aspectRatio, '4:5');
  assert.equal(normalized.background.gradientFrom, '#12102C');
  assert.equal(normalized.layers.length, 2);
  assert.equal(normalized.layers[0].id, 's1'); // sorted by zIndex ascending
  assert.equal(normalized.layers[1].fontSize, 240); // clamped safely
});

test('createHistoryStack supports multi-step undo/redo and cloneTemplateForUser creates editable copy', () => {
  const initial = createBlankTemplateData();
  const stack = createHistoryStack(initial, 50);
  assert.equal(stack.canUndo(), false);

  const step1 = normalizeTemplateData(initial);
  step1.layers.push(createNewLayer('text', step1, { text: 'Added Text' }));
  stack.push(step1);
  assert.equal(stack.canUndo(), true);

  const step2 = normalizeTemplateData(step1);
  step2.background.color = '#112233';
  stack.push(step2);

  const undone = stack.undo();
  assert.ok(undone);
  assert.equal(undone.background.color, initial.background.color);
  assert.equal(stack.canRedo(), true);

  const redone = stack.redo();
  assert.ok(redone);
  assert.equal(redone.background.color, '#112233');

  const source = STARTER_TEMPLATES[0];
  const cloned = cloneTemplateForUser(source, {
    id: 'user-123',
    displayName: 'Aarav Dev',
    username: 'aarav',
    verified: true,
  });
  assert.equal(cloned.creatorId, 'user-123');
  assert.equal(cloned.visibility, 'private');
  assert.equal(cloned.likesCount, 0);
  assert.notEqual(cloned.templateData, source.templateData);
});

test('filterAndSortTemplates filters by query, category, style, aspectRatio and ranks trending', () => {
  const items = filterAndSortTemplates(STARTER_TEMPLATES, {
    category: 'YouTube Thumbnails',
    onlyPublic: true,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].aspectRatio, '16:9');

  const allPublic = filterAndSortTemplates(STARTER_TEMPLATES, { onlyPublic: true, sortBy: 'most_used' });
  assert.ok(allPublic.length >= 6);
  assert.ok(Number(allPublic[0].usesCount) >= Number(allPublic[allPublic.length - 1].usesCount));
});

test('buildPdfFromJpegDataUrl generates structurally valid PDF-1.4 document', () => {
  const fakeJpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const jpgUrl = `data:image/jpeg;base64,${fakeJpgBytes.toString('base64')}`;
  const pdfBytes = buildPdfFromJpegDataUrl(jpgUrl, 1080, 1080);
  const text = Buffer.from(pdfBytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('/Subtype /Image'));
  assert.ok(text.includes('/Filter /DCTDecode'));
  assert.ok(text.includes('xref'));
  assert.ok(text.trim().endsWith('%%EOF'));
});

test('AI Vault AES-256-GCM encryption, masking, SSRF blocking, and zero raw key leakage', () => {
  const secret = 'sk-proj-TestSecretKey9876543210';
  const enc = encryptSecret(secret);
  assert.ok(enc.includes(':'));
  assert.ok(!enc.includes(secret));
  assert.equal(decryptSecret(enc), secret);
  assert.equal(maskApiKey(secret), 'sk-p••••3210');

  assert.equal(validateSafeEndpointUrl('https://api.openai.com/v1').ok, true);
  assert.equal(validateSafeEndpointUrl('http://127.0.0.1:8080/v1').ok, false);
  assert.equal(validateSafeEndpointUrl('https://169.254.169.254/latest/meta-data').ok, false);
  assert.equal(validateSafeEndpointUrl('https://192.168.1.10/v1').ok, false);
  assert.equal(validateSafeEndpointUrl('https://localhost:3000/api').ok, false);
  assert.equal(validateSafeEndpointUrl('file:///etc/passwd').ok, false);

  const testUid = `test-uid-${Date.now()}`;
  const saved = upsertUserProvider(testUid, {
    provider: 'openai_compatible',
    label: 'OpenRouter Test',
    apiKey: secret,
    baseUrl: 'https://openrouter.ai/api/v1',
    textModel: 'openai/gpt-4o-mini',
    isDefault: true,
  });
  assert.equal(saved.ok, true);
  assert.ok(saved.record);
  assert.equal(saved.record.keyMasked, 'sk-p••••3210');
  assert.equal('apiKey' in saved.record, false);
  assert.equal('apiKeyEncrypted' in saved.record, false);

  const listed = listUserProviders(testUid);
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes(secret), false);

  const caps = detectProviderCapabilities('gemini', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite-image', true);
  assert.equal(caps.imageGeneration, true);
  assert.equal(caps.visionInput, true);

  assert.equal(deleteUserProvider(testUid, saved.record.id), true);
});

test('normalizeGeneratedTemplateCandidate enforces safe bounded template structure', () => {
  const out = normalizeGeneratedTemplateCandidate(
    {
      title: 'AI Promo Poster',
      layers: [{ type: 'text', text: 'Big Launch', x: 50, y: 100, width: 600, height: 120 }],
    },
    {
      index: 0,
      width: 1920,
      height: 1080,
      ratioLabel: '16:9',
      category: 'Marketing',
      style: 'Neon',
      fontPreference: 'Outfit',
      primaryColor: '#701CFF',
      secondaryColor: '#286BFF',
      accentColor: '#F43F5E',
      backgroundType: 'gradient',
      templateName: 'AI Promo Poster',
    }
  );
  assert.equal(out.title, 'AI Promo Poster');
  assert.equal(out.templateData.width, 1920);
  assert.equal(out.templateData.height, 1080);
  assert.equal(out.templateData.layers.length, 1);
  assert.equal(out.templateData.layers[0].text, 'Big Launch');
});

test('Express API security: health check works, /.data blocked, and AI endpoints require auth', async () => {
  const app = express();
  app.use(express.json());
  mountNexoraApiRoutes(app);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;

    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);

    const vaultRes = await fetch(`${base}/.data/ai_vault.enc.json`);
    assert.equal(vaultRes.status, 403);

    const provRes = await fetch(`${base}/api/ai-providers`);
    assert.equal(provRes.status, 401);

    const genRes = await fetch(`${base}/api/templates/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Test poster' }),
    });
    assert.equal(genRes.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('firestore.rules covers all Template Studio collections cleanly', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  for (const col of [
    'match /templates/{templateId}',
    'match /template_likes/{likeId}',
    'match /template_saves/{saveId}',
    'match /template_usage/{usageId}',
    'match /template_reports/{reportId}',
    'match /template_categories/{categoryId}',
    'match /ai_provider_settings/{configId}',
  ]) {
    assert.ok(rulesText.includes(col), `Missing Firestore rule block: ${col}`);
  }
});
