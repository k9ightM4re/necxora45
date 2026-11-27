import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  CALL_RATING_LABELS,
  CALL_RATING_TAGS,
  buildCallChatMessagePayload,
  formatCallDuration,
  sanitizeCallRatingPayload,
} from '../js/call_tab.js';

test('formatCallDuration renders mm:ss and hh:mm:ss cleanly', () => {
  assert.equal(formatCallDuration(0), '00:00');
  assert.equal(formatCallDuration(9), '00:09');
  assert.equal(formatCallDuration(65), '01:05');
  assert.equal(formatCallDuration(3661), '01:01:01');
  assert.equal(formatCallDuration(-10), '00:00');
});

test('buildCallChatMessagePayload validates required fields and bounds content cleanly', () => {
  assert.equal(buildCallChatMessagePayload({ callId: '', senderId: 'u1', content: 'hi' }), null);
  assert.equal(buildCallChatMessagePayload({ callId: 'c1', senderId: '', content: 'hi' }), null);
  assert.equal(buildCallChatMessagePayload({ callId: 'c1', senderId: 'u1', content: '   ' }), null);

  const msg = buildCallChatMessagePayload({
    callId: 'dm-thread-1',
    sessionId: 'cs-12345',
    senderId: 'user-a',
    senderName: 'Aarav',
    content: 'Can you hear me clearly?',
  });

  assert.ok(msg);
  assert.ok(msg.id.startsWith('cmsg-'));
  assert.equal(msg.callId, 'dm-thread-1');
  assert.equal(msg.sessionId, 'cs-12345');
  assert.equal(msg.senderId, 'user-a');
  assert.equal(msg.senderName, 'Aarav');
  assert.equal(msg.senderInitials, 'AA');
  assert.equal(msg.content, 'Can you hear me clearly?');
});

test('sanitizeCallRatingPayload validates 1..5 stars, tags cap, and comment bounds', () => {
  assert.equal(CALL_RATING_TAGS.length, 8);
  assert.equal(CALL_RATING_LABELS[5], 'Excellent');

  assert.equal(sanitizeCallRatingPayload({ callId: 'c1', reviewerId: 'u1', rating: 0 }), null);
  assert.equal(sanitizeCallRatingPayload({ callId: 'c1', reviewerId: 'u1', rating: 6 }), null);
  assert.equal(sanitizeCallRatingPayload({ callId: '', reviewerId: 'u1', rating: 4 }), null);

  const rating = sanitizeCallRatingPayload({
    callId: 'dm-thread-1',
    sessionId: 'cs-999',
    callKind: 'dm',
    mode: 'video',
    peerUserId: 'user-b',
    peerName: 'Priya',
    reviewerId: 'user-a',
    reviewerName: 'Aarav',
    rating: 5,
    tags: ['Clear Audio', 'Smooth Video', 'Clear Audio'],
    comment: 'Super crisp video and audio!',
    durationSec: 142,
  });

  assert.ok(rating);
  assert.ok(rating.id.startsWith('crate-'));
  assert.equal(rating.rating, 5);
  assert.equal(rating.callKind, 'dm');
  assert.equal(rating.mode, 'video');
  assert.deepEqual(rating.tags, ['Clear Audio', 'Smooth Video']);
  assert.equal(rating.durationSec, 142);
  assert.equal(rating.comment, 'Super crisp video and audio!');
});

test('firestore.rules and app.html include Call Tab, call messages, and call_ratings', () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.ok(rules.includes('match /messages/{messageId}'));
  assert.ok(rules.includes('isValidCallMessage(incoming(), callId, messageId)'));
  assert.ok(rules.includes('match /call_ratings/{ratingId}'));
  assert.ok(rules.includes('isValidCallRating(incoming(), ratingId)'));

  const html = fs.readFileSync(path.resolve(process.cwd(), 'app.html'), 'utf8');
  assert.ok(html.includes('id="nx-call-tab-workspace"'));
  assert.ok(html.includes('id="nx-call-mini-pill"'));
});
