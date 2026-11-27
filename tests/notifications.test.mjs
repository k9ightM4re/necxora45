import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFriendlyError } from '../js/notifications.js';

function assertNoTechnicalLeak(message) {
  assert.ok(message.length > 10, 'message should be meaningful');
  assert.doesNotMatch(message, /Firebase:|auth\/|PERMISSION_DENIED|stack|{"error":|Firestore \(/i);
}

test('maps invalid login credentials to friendly copy', () => {
  const msg = formatFriendlyError({ code: 'auth/invalid-credential', message: 'Firebase: Error (auth/invalid-credential).' });
  assert.equal(msg, 'Incorrect email or password. Please check your details and try again.');
  assertNoTechnicalLeak(msg);
});

test('maps unauthorized domain or disabled sign-in method without developer instructions', () => {
  const msg = formatFriendlyError({
    code: 'auth/unauthorized-domain',
    message: 'Firebase: Error (auth/unauthorized-domain).',
  });
  assert.match(msg, /You cannot enter with this sign-in option right now/i);
  assertNoTechnicalLeak(msg);
});

test('maps rate limit / quota errors to site busy notification', () => {
  const msg1 = formatFriendlyError({ code: 'auth/too-many-requests' });
  const msg2 = formatFriendlyError({ code: 'resource-exhausted', message: 'Quota exceeded.' });
  assert.match(msg1, /Site is busy/i);
  assert.match(msg2, /Site is busy/i);
  assertNoTechnicalLeak(msg1);
  assertNoTechnicalLeak(msg2);
});

test('maps permission-denied and serialized Firestore JSON errors without leaking JSON', () => {
  const jsonErr = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'write',
      path: 'servers/srv-1/members/u1',
    })
  );
  const msg = formatFriendlyError(jsonErr);
  assert.match(msg, /You cannot enter or perform this action right now/i);
  assertNoTechnicalLeak(msg);
});

test('maps offline / unavailable / network errors to site busy / unstable connection message', () => {
  const msg = formatFriendlyError(new Error('Could not reach Cloud Firestore backend. The client is offline.'));
  assert.match(msg, /Site is busy or your connection is unstable/i);
  assertNoTechnicalLeak(msg);
});

test('maps WebRTC media device errors cleanly', () => {
  const msg = formatFriendlyError(new Error('NotAllowedError: Permission dismissed'));
  assert.match(msg, /Microphone or camera is unavailable/i);
  assertNoTechnicalLeak(msg);
});

test('falls back cleanly for unknown runtime errors without leaking raw text', () => {
  const msg = formatFriendlyError(new Error('TypeError: Cannot read properties of undefined (reading foo)'));
  assert.match(msg, /Site is busy right now/i);
  assertNoTechnicalLeak(msg);
});
