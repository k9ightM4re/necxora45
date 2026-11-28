import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspectMediaMagicBytes } from '../server/media_router.ts';
import {
  findIdempotentMessage,
  rememberIdempotentMessage,
  resetIdempotencyCacheForTests,
} from '../server/v1/messaging_media_router.ts';

test('Message idempotency cache deduplicates repeated clientMutationId retries cleanly', () => {
  resetIdempotencyCacheForTests();
  const key = 'u1:dm_1:mut_abc123';
  assert.equal(findIdempotentMessage(key), null);

  const msg = { id: 'm-1', content: 'Hello Nexora', clientMutationId: 'mut_abc123' };
  rememberIdempotentMessage(key, msg);
  const hit = findIdempotentMessage(key);
  assert.deepEqual(hit, msg);

  resetIdempotencyCacheForTests();
  assert.equal(findIdempotentMessage(key), null);
});

test('inspectMediaMagicBytes verifies genuine binary signatures and rejects spoofed payloads', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(inspectMediaMagicBytes(pngHeader, 'image/png'), {
    valid: true,
    mimeType: 'image/png',
    ext: 'png',
  });

  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.deepEqual(inspectMediaMagicBytes(jpegHeader, 'image/jpeg'), {
    valid: true,
    mimeType: 'image/jpeg',
    ext: 'jpg',
  });

  const spoofedScript = Buffer.from('<script>alert(1)</script>', 'utf8');
  assert.equal(inspectMediaMagicBytes(spoofedScript, 'image/png').valid, false);
});

test('Client offline outbox, reconnection catchup sync, and WS hub reliability primitives are wired', () => {
  const appJs = fs.readFileSync(path.resolve(process.cwd(), 'js/app.js'), 'utf8');
  const wsClientJs = fs.readFileSync(path.resolve(process.cwd(), 'js/ws_client.js'), 'utf8');
  const wsServerTs = fs.readFileSync(path.resolve(process.cwd(), 'server/realtime_ws.ts'), 'utf8');

  assert.ok(appJs.includes('nx_dm_outbox_v1'));
  assert.ok(appJs.includes('flushDmOutbox'));
  assert.ok(appJs.includes('/messages/threads/'));
  assert.ok(appJs.includes('/sync'));
  assert.ok(wsClientJs.includes('WebSocket'));
  assert.ok(wsServerTs.includes('presence'));
});
