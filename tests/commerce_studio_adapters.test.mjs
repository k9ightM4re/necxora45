import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichProductFreshness,
  matchCatalogProductsByTokens,
} from '../server/v1/commerce_studio_moderation_router.ts';
import { getAdapterConfigStatus } from '../server/v1/context.ts';

test('enrichProductFreshness flags stale (>24h) and missing timestamps accurately', () => {
  const now = 1_780_000_000_000;
  const fresh = enrichProductFreshness(
    { id: 'p1', priceLastCheckedAtMs: now - 2 * 3600_000 },
    now
  );
  assert.equal(fresh.priceStale, false);

  const stale = enrichProductFreshness(
    { id: 'p2', priceLastCheckedAtMs: now - 30 * 3600_000 },
    now
  );
  assert.equal(stale.priceStale, true);

  const missing = enrichProductFreshness({ id: 'p3' }, now);
  assert.equal(missing.priceStale, true);
});

test('matchCatalogProductsByTokens ranks real active catalog products and excludes archived items', () => {
  const catalog = [
    {
      id: 'p-1',
      status: 'active',
      title: 'Charcoal Wool Overshirt',
      category: 'Apparel',
      merchantName: 'Atelier',
      tags: ['wool', 'charcoal'],
      priceLastCheckedAtMs: Date.now(),
    },
    {
      id: 'p-2',
      status: 'active',
      title: 'Canvas Tote Bag',
      category: 'Accessories',
      merchantName: 'Atelier',
      tags: ['canvas'],
      priceLastCheckedAtMs: Date.now(),
    },
    {
      id: 'p-archived',
      status: 'archived',
      title: 'Charcoal Wool Coat',
      category: 'Apparel',
      merchantName: 'Atelier',
      tags: ['wool', 'charcoal'],
      priceLastCheckedAtMs: Date.now(),
    },
  ];

  const matches = matchCatalogProductsByTokens(catalog, ['charcoal', 'wool'], 'Apparel');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].product.id, 'p-1');
  assert.ok(matches[0].similarityScore >= 7);
});

test('getAdapterConfigStatus accurately reports unconfigured vs configured external adapters', () => {
  const saved = {
    MERCHANT_FEED_URL: process.env.MERCHANT_FEED_URL,
    MERCHANT_FEED_API_KEY: process.env.MERCHANT_FEED_API_KEY,
    VTON_PROVIDER_URL: process.env.VTON_PROVIDER_URL,
    VTON_API_KEY: process.env.VTON_API_KEY,
    VISUAL_SEARCH_ENDPOINT: process.env.VISUAL_SEARCH_ENDPOINT,
    VISUAL_SEARCH_API_KEY: process.env.VISUAL_SEARCH_API_KEY,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    FFMPEG_PATH: process.env.FFMPEG_PATH,
  };

  delete process.env.MERCHANT_FEED_URL;
  delete process.env.MERCHANT_FEED_API_KEY;
  delete process.env.VTON_PROVIDER_URL;
  delete process.env.VTON_API_KEY;
  delete process.env.VISUAL_SEARCH_ENDPOINT;
  delete process.env.VISUAL_SEARCH_API_KEY;
  delete process.env.S3_ENDPOINT;
  delete process.env.FFMPEG_PATH;

  try {
    const unconfigured = getAdapterConfigStatus();
    assert.equal(unconfigured.merchantFeedSync.configured, false);
    assert.equal(unconfigured.virtualTryOn.configured, false);
    assert.equal(unconfigured.externalVisualSearch.configured, false);
    assert.equal(unconfigured.s3Storage.configured, false);
    assert.equal(unconfigured.ffmpegTranscoding.configured, false);

    process.env.VTON_PROVIDER_URL = 'https://vton.example/api';
    process.env.VTON_API_KEY = 'test-key';
    const configured = getAdapterConfigStatus();
    assert.equal(configured.virtualTryOn.configured, true);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
