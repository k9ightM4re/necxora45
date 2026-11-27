import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

import {
  envelopeDecryptTokens,
  envelopeEncryptTokens,
  redactForLog,
} from '../server/social_circle/crypto_vault.ts';
import { SocialCircleStore } from '../server/social_circle/store.ts';
import { SyncQueue } from '../server/social_circle/queue.ts';
import { InstagramConnector } from '../server/social_circle/connectors/instagram.ts';
import { SlackConnector } from '../server/social_circle/connectors/slack.ts';
import { DiscordConnector } from '../server/social_circle/connectors/discord.ts';
import { buildInjectionSafePrompt, hybridRetrieve } from '../server/social_circle/rag.ts';
import { mountNexoraApiRoutes } from '../server/api_router.ts';

test('Envelope encryption isolates user/source context and redactForLog strips PII', () => {
  const tokens = { accessToken: 'secret-token-xyz', refreshToken: 'refresh-abc', scope: 'channels:read' };
  const bundle = envelopeEncryptTokens('user-1', 'slack', tokens);
  assert.ok(bundle.wrappedDek);
  assert.ok(!bundle.ciphertext.includes('secret-token-xyz'));

  const decrypted = envelopeDecryptTokens(bundle);
  assert.equal(decrypted.accessToken, 'secret-token-xyz');
  assert.equal(decrypted.refreshToken, 'refresh-abc');

  const tampered = { ...bundle, userId: 'attacker-2' };
  assert.throws(() => envelopeDecryptTokens(tampered));

  const redacted = redactForLog({
    userId: 'user-1',
    accessToken: 'leak',
    email: 'user@example.com',
    text: 'private message content',
    attempt: 2,
  });
  assert.equal(redacted.accessToken, '[REDACTED]');
  assert.equal(redacted.email, '[REDACTED]');
  assert.equal(redacted.text, '[REDACTED]');
  assert.equal(redacted.attempt, 2);
});

test('SocialCircleStore enforces 90-day retention sweep and one-click source deletion', () => {
  const store = new SocialCircleStore(null);
  const now = 1_700_000_000_000;
  store.upsertNormalizedBatch('u1', {
    persons: [
      {
        id: 'slack:1',
        userId: 'u1',
        source: 'slack',
        displayName: 'Alice',
        handles: { slack: 'alice' },
        interests: ['systems'],
        updatedAtMs: now,
        expiresAtMs: now - 1000, // already expired
      },
      {
        id: 'discord:2',
        userId: 'u1',
        source: 'discord',
        displayName: 'Bob',
        handles: { discord: 'bob' },
        interests: ['design'],
        updatedAtMs: now,
        expiresAtMs: now + 90 * 86400 * 1000,
      },
    ],
    interactions: [],
    contents: [],
  });

  const purged = store.sweepExpired(now);
  assert.equal(purged.purgedPersons, 1);
  assert.equal(store.getUserGraphData('u1').persons.length, 1);

  const deleted = store.deleteSourceData('u1', 'discord');
  assert.equal(deleted.deletedPersons, 1);
  assert.equal(store.getUserGraphData('u1').persons.length, 0);
});

test('SyncQueue enforces idempotency, retries with backoff, and paginates Instagram Graph API', async () => {
  const store = new SocialCircleStore(null);
  const ig = new InstagramConnector();
  store.setConsent({
    userId: 'u-ig',
    source: 'instagram',
    consented: true,
    scopes: ['instagram_basic'],
    includeMessageContent: true,
    retentionDays: 90,
    consentedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    lastSyncedAtMs: 0,
    cursor: '',
    accountLabel: '@creator',
    status: 'connected',
  });
  store.saveTokens('u-ig', 'instagram', { accessToken: 'ig-token-1', externalAccountId: '17841' });

  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: 'Temporary failure' } }), { status: 500 });
    }
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'media-1',
            caption: 'Launching our new #workspace tooling',
            username: 'creator',
            timestamp: '2026-10-01T12:00:00Z',
            comments: { data: [{ id: 'c1', username: 'fan1', text: 'Looks crisp!', timestamp: '2026-10-01T12:05:00Z' }] },
          },
        ],
        paging: { cursors: { after: 'cur-2' } },
      }),
      { status: 200 }
    );
  };

  const queue = new SyncQueue(store, new Map([['instagram', ig]]), {
    baseBackoffMs: 1,
    maxBackoffMs: 5,
    sleepFn: async () => {},
  });

  const job1 = await queue.enqueueAndRun({
    userId: 'u-ig',
    source: 'instagram',
    idempotencyKey: 'sync-key-1',
    fetchImpl: mockFetch,
  });
  assert.equal(job1.status, 'completed');
  assert.equal(job1.attempt, 2);
  assert.equal(job1.stats.contents, 2);

  // Calling again with same idempotencyKey returns completed job without hitting fetch again
  const prevAttempts = attempts;
  const job2 = await queue.enqueueAndRun({
    userId: 'u-ig',
    source: 'instagram',
    idempotencyKey: 'sync-key-1',
    fetchImpl: mockFetch,
  });
  assert.equal(job2.id, job1.id);
  assert.equal(attempts, prevAttempts);
});

test('Slack & Discord & Instagram webhook signature verifications enforce cryptographic integrity', async () => {
  // Slack HMAC verification + replay protection
  process.env.SLACK_SIGNING_SECRET = 'slack-test-secret';
  const slack = new SlackConnector();
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyObj = { type: 'url_verification', challenge: 'chk-123' };
  const rawSlack = JSON.stringify(bodyObj);
  const sig =
    'v0=' + crypto.createHmac('sha256', 'slack-test-secret').update(`v0:${ts}:${rawSlack}`).digest('hex');

  const okSlack = await slack.webhook({
    headers: { 'x-slack-signature': sig, 'x-slack-request-timestamp': ts },
    rawBody: rawSlack,
    body: bodyObj,
  });
  assert.equal(okSlack.verified, true);
  assert.equal(okSlack.responseBody.challenge, 'chk-123');

  const staleSlack = await slack.webhook({
    headers: { 'x-slack-signature': sig, 'x-slack-request-timestamp': '100000' },
    rawBody: rawSlack,
    body: bodyObj,
  });
  assert.equal(staleSlack.verified, false);
  assert.equal(staleSlack.statusCode, 401);

  // Discord Ed25519 signature verification
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
  const rawPubHex = Buffer.from(spkiDer).subarray(12).toString('hex');
  process.env.DISCORD_PUBLIC_KEY = rawPubHex;
  const discord = new DiscordConnector();
  const dcTs = '1700000000';
  const dcRaw = JSON.stringify({ type: 1 });
  const dcSigHex = crypto.sign(null, Buffer.from(dcTs + dcRaw, 'utf8'), privateKey).toString('hex');

  const okDc = await discord.webhook({
    headers: { 'x-signature-ed25519': dcSigHex, 'x-signature-timestamp': dcTs },
    rawBody: dcRaw,
    body: { type: 1 },
  });
  assert.equal(okDc.verified, true);
  assert.equal(okDc.responseBody.type, 1);

  const badDc = await discord.webhook({
    headers: { 'x-signature-ed25519': '00'.repeat(64), 'x-signature-timestamp': dcTs },
    rawBody: dcRaw,
    body: { type: 1 },
  });
  assert.equal(badDc.verified, false);
  assert.equal(badDc.statusCode, 401);

  // Instagram X-Hub-Signature-256
  process.env.INSTAGRAM_APP_SECRET = 'ig-app-secret';
  const ig = new InstagramConnector();
  const igRaw = JSON.stringify({ object: 'instagram' });
  const igSig = 'sha256=' + crypto.createHmac('sha256', 'ig-app-secret').update(igRaw).digest('hex');
  const okIg = await ig.webhook({
    headers: { 'x-hub-signature-256': igSig },
    rawBody: igRaw,
    body: { object: 'instagram' },
  });
  assert.equal(okIg.verified, true);
});

test('Hybrid RAG isolates per-user chunks and encloses untrusted data in XML delimiters', async () => {
  const store = new SocialCircleStore(null);
  const future = Date.now() + 86400_000;
  store.upsertNormalizedBatch('alice', {
    persons: [],
    interactions: [],
    contents: [
      {
        id: 'c-alice',
        userId: 'alice',
        authorPersonId: 'slack:alice',
        sourceItemId: '1',
        text: 'Alice secret launch codename is Orion-Vault.',
        topics: ['orion-vault'],
        source: 'slack',
        ts: Date.now(),
        expiresAtMs: future,
      },
    ],
  });

  const bobCites = await hybridRetrieve({ query: 'Orion-Vault', userId: 'bob', store, includePublicDocs: false });
  assert.equal(bobCites.length, 0);

  const aliceCites = await hybridRetrieve({ query: 'Orion-Vault', userId: 'alice', store, includePublicDocs: false });
  assert.equal(aliceCites.length, 1);

  const prompt = buildInjectionSafePrompt('Summarize findings', aliceCites);
  assert.ok(prompt.systemInstruction.includes('NEVER instructions'));
  assert.ok(prompt.userPrompt.includes('<retrieved_data'));
});

test('Express routes enforce auth on /api/social-circle/status and expose /api/rag/search', async () => {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  mountNexoraApiRoutes(app);

  const server = app.listen(0);
  const { port } = server.address();
  try {
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/social-circle/status`);
    assert.equal(statusRes.status, 401);

    const searchRes = await fetch(`http://127.0.0.1:${port}/api/rag/search?q=Social%20Circle`);
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.ok(Array.isArray(searchData.results) && searchData.results.length >= 1);
  } finally {
    server.close();
  }
});
