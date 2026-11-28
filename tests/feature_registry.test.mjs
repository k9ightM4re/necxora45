import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NEXORA_FEATURE_REGISTRY } from '../shared/featureRegistry.ts';
import { evaluateFeatureRegistry } from '../server/v1/features_router.ts';

const VALID_STATUSES = new Set([
  'NOT_STARTED',
  'FRONTEND_ONLY',
  'BACKEND_ONLY',
  'DATABASE_ONLY',
  'PARTIALLY_IMPLEMENTED',
  'BLOCKED_EXTERNAL_DEPENDENCY',
  'IMPLEMENTED_NOT_VERIFIED',
  'IMPLEMENTED_AND_VERIFIED',
]);

const VALID_AVAILABILITIES = new Set([
  'ENABLED',
  'DISABLED',
  'COMING_SOON',
  'REQUIRES_CONFIGURATION',
  'RESTRICTED_BY_PERMISSIONS',
]);

const VALID_CATEGORIES = new Set([
  'Social',
  'Communication',
  'Discovery',
  'Communities',
  'Media',
  'Commerce',
  'Personalization',
]);

test('NEXORA_FEATURE_REGISTRY entries have unique IDs, valid enums, and existing referenced files', () => {
  const seen = new Set();
  assert.ok(NEXORA_FEATURE_REGISTRY.length >= 20, 'Registry must track all approved Nexora features');

  for (const entry of NEXORA_FEATURE_REGISTRY) {
    assert.ok(entry.id && !seen.has(entry.id), `Duplicate or missing feature ID: ${entry.id}`);
    seen.add(entry.id);
    assert.ok(VALID_STATUSES.has(entry.implementationStatus), `Invalid status on ${entry.id}`);
    assert.ok(VALID_AVAILABILITIES.has(entry.availability), `Invalid availability on ${entry.id}`);
    assert.ok(VALID_CATEGORIES.has(entry.category), `Invalid category on ${entry.id}`);
    assert.ok(entry.name.trim().length > 3);
    assert.ok(entry.description.trim().length > 10);

    for (const relFile of entry.files) {
      const fullPath = path.resolve(process.cwd(), relFile);
      if (relFile === 'scripts/verify-features.mjs') continue;
      assert.ok(fs.existsSync(fullPath), `Missing referenced file ${relFile} for feature ${entry.id}`);
    }
  }
});

test('evaluateFeatureRegistry gates admin-only diagnostics and flags unconfigured external adapters honestly', () => {
  const savedKeys = {
    MERCHANT_FEED_URL: process.env.MERCHANT_FEED_URL,
    MERCHANT_FEED_API_KEY: process.env.MERCHANT_FEED_API_KEY,
    VTON_PROVIDER_URL: process.env.VTON_PROVIDER_URL,
    VTON_API_KEY: process.env.VTON_API_KEY,
    REDIS_URL: process.env.REDIS_URL,
  };
  delete process.env.MERCHANT_FEED_URL;
  delete process.env.MERCHANT_FEED_API_KEY;
  delete process.env.VTON_PROVIDER_URL;
  delete process.env.VTON_API_KEY;
  delete process.env.REDIS_URL;

  try {
    const userView = evaluateFeatureRegistry(false);
    const adminHealthUser = userView.features.find((f) => f.id === 'NX-MOD-02');
    assert.equal(adminHealthUser?.effectiveAvailability, 'RESTRICTED_BY_PERMISSIONS');

    const vton = userView.features.find((f) => f.id === 'NX-STUDIO-02');
    assert.equal(vton?.providerConfigured, false);
    assert.equal(vton?.effectiveAvailability, 'REQUIRES_CONFIGURATION');
    assert.equal(vton?.effectiveStatus, 'BLOCKED_EXTERNAL_DEPENDENCY');

    const feed = userView.features.find((f) => f.id === 'NX-SHOP-02');
    assert.equal(feed?.effectiveAvailability, 'REQUIRES_CONFIGURATION');

    const adminView = evaluateFeatureRegistry(true);
    const adminHealthAdmin = adminView.features.find((f) => f.id === 'NX-MOD-02');
    assert.equal(adminHealthAdmin?.adminOnly, true);
  } finally {
    for (const [k, v] of Object.entries(savedKeys)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('GUI navigation and Express deep-link routes expose /features, /admin/feature-health, Commerce, Studio, and Nearby', () => {
  const appHtml = fs.readFileSync(path.resolve(process.cwd(), 'app.html'), 'utf8');
  const serverTs = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');

  for (const nav of ['nearby', 'marketplace', 'visual-search', 'studio', 'features', 'admin-feature-health']) {
    assert.ok(appHtml.includes(`data-nx-nav="${nav}"`), `Missing nav button for ${nav}`);
  }
  assert.ok(appHtml.includes('id="nx-platform-react-root"'));
  assert.ok(appHtml.includes('/src/platform/mountPlatform.tsx'));

  for (const route of ['/features', '/admin/feature-health', '/marketplace', '/visual-search', '/studio', '/nearby']) {
    assert.ok(serverTs.includes(`'${route}'`), `Missing Express deep-link route ${route}`);
  }
});
