import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ABUSE_ALERT_PRESETS,
  buildCommunityAlertPayload,
  buildLeaderAddMemberPayloads,
  filterAddableUsers,
  sanitizeAlertReason,
  summarizeUserAlerts,
} from '../js/community_moderation.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('sanitizeAlertReason cleans whitespace and enforces min/max bounds', () => {
  assert.equal(sanitizeAlertReason('  hi '), '');
  assert.equal(sanitizeAlertReason('  Stop   abusing   members  '), 'Stop abusing members');
  assert.equal(sanitizeAlertReason('a'.repeat(350)).length, 300);
});

test('buildCommunityAlertPayload validates leader ownership and builds rule-compliant payloads', () => {
  const srv = { id: 'srv-1', name: 'Creators Hub', ownerId: 'leader-1' };
  const leader = { id: 'leader-1', displayName: 'Aarav' };
  const target = { id: 'user-2', displayName: 'Rohan' };

  assert.throws(
    () =>
      buildCommunityAlertPayload({
        server: srv,
        actor: { id: 'other-user', displayName: 'Imposter' },
        targetUser: target,
        severity: 'urgent',
        reason: 'Abusive language in chat',
      }),
    /Only the community leader/
  );

  assert.throws(
    () =>
      buildCommunityAlertPayload({
        server: srv,
        actor: leader,
        targetUser: leader,
        severity: 'warning',
        reason: 'Self test',
      }),
    /cannot send an abuse alert to yourself/i
  );

  assert.throws(
    () =>
      buildCommunityAlertPayload({
        server: srv,
        actor: leader,
        targetUser: target,
        severity: 'warning',
        reason: 'no',
      }),
    /at least 3 characters/
  );

  const built = buildCommunityAlertPayload({
    alertId: 'alert-test-1',
    server: srv,
    actor: leader,
    targetUser: target,
    severity: 'urgent',
    reason: ABUSE_ALERT_PRESETS[0].reason,
    timestamp: 1700000000,
  });

  assert.equal(built.alertId, 'alert-test-1');
  assert.equal(built.alertPayload.serverId, 'srv-1');
  assert.equal(built.alertPayload.ownerId, 'leader-1');
  assert.equal(built.alertPayload.actorId, 'leader-1');
  assert.equal(built.alertPayload.targetUserId, 'user-2');
  assert.equal(built.alertPayload.severity, 'urgent');
  assert.equal(built.alertPayload.acknowledged, false);
  assert.equal(built.notificationPayload.senderId, 'leader-1');
  assert.equal(built.notificationPayload.category, 'community_alert');
  assert.equal(built.notificationPayload.unread, true);
});

test('buildLeaderAddMemberPayloads produces valid membership, joined_servers, and notification docs', () => {
  const srv = { id: 'srv-2', name: 'Design Guild', ownerId: 'leader-1' };
  const leader = { id: 'leader-1', displayName: 'Aarav' };
  const target = { id: 'user-9', displayName: 'Maya Kapoor' };

  assert.throws(
    () =>
      buildLeaderAddMemberPayloads({
        server: srv,
        actor: { id: 'user-5', displayName: 'Nope' },
        targetUser: target,
      }),
    /Only the community leader/
  );

  const built = buildLeaderAddMemberPayloads({
    server: srv,
    actor: leader,
    targetUser: target,
    role: 'moderator',
    timestamp: 1700000000,
  });

  assert.deepEqual(built.memberPayload, {
    userId: 'user-9',
    displayName: 'Maya Kapoor',
    role: 'moderator',
    joinedAt: 1700000000,
  });
  assert.deepEqual(built.joinedServerPayload, {
    serverId: 'srv-2',
    joinedAt: 1700000000,
  });
  assert.equal(built.notificationPayload.senderId, 'leader-1');
  assert.equal(built.notificationPayload.targetId, 'srv-2');
});

test('filterAddableUsers excludes existing members, leader, and suspended users while filtering by query', () => {
  const users = [
    { id: 'leader-1', displayName: 'Leader', username: 'leader' },
    { id: 'u2', displayName: 'Already In', username: 'inmember' },
    { id: 'u3', displayName: 'Banned User', username: 'banned', suspended: true },
    { id: 'u4', displayName: 'Kabir Sharma', username: 'kabir' },
    { id: 'u4', displayName: 'Kabir Duplicate', username: 'kabir' },
    { id: 'u5', displayName: 'Ananya Verma', username: 'ananya' },
  ];

  const allAddable = filterAddableUsers(users, new Set(['u2']), 'leader-1', '');
  assert.deepEqual(
    allAddable.map((u) => u.id),
    ['u4', 'u5']
  );

  const matched = filterAddableUsers(users, new Set(['u2']), 'leader-1', 'kabir');
  assert.deepEqual(
    matched.map((u) => u.id),
    ['u4']
  );
});

test('summarizeUserAlerts counts unacknowledged and urgent warnings accurately', () => {
  const alerts = [
    { id: 'a1', targetUserId: 'u2', severity: 'warning', acknowledged: false, timestamp: 10 },
    { id: 'a2', targetUserId: 'u2', severity: 'urgent', acknowledged: false, timestamp: 30 },
    { id: 'a3', targetUserId: 'u2', severity: 'urgent', acknowledged: true, timestamp: 20 },
    { id: 'a4', targetUserId: 'u9', severity: 'urgent', acknowledged: false, timestamp: 40 },
  ];

  const allU2 = summarizeUserAlerts(alerts, 'u2');
  assert.equal(allU2.totalCount, 3);
  assert.equal(allU2.unackedCount, 2);
  assert.equal(allU2.urgentCount, 2);
  assert.equal(allU2.items[0].id, 'a2');

  const unreadU2 = summarizeUserAlerts(alerts, 'u2', { onlyUnacknowledged: true });
  assert.equal(unreadU2.totalCount, 2);
  assert.deepEqual(
    unreadU2.items.map((x) => x.id),
    ['a2', 'a1']
  );
});

test('app.html, firestore.rules, and stylesheets include community leader moderation and mobile responsiveness', () => {
  const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const socialCss = fs.readFileSync(path.join(ROOT, 'css', 'social.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');

  assert.match(html, /id="leader-alert-modal"/);
  assert.match(html, /id="leader-alert-form"/);
  assert.match(html, /id="nx-mobile-bottom-nav"/);
  assert.match(html, /id="nx-mob-more-btn"/);

  assert.match(rules, /match \/alerts\/\{alertId\}/);
  assert.match(rules, /isValidCommunityAlert/);
  assert.match(rules, /isServerOwner\(serverId\)/);

  assert.match(socialCss, /\.nx-mobile-bottom-nav/);
  assert.match(socialCss, /100dvh/);
  assert.match(appCss, /\.nx-leader-alert-banner/);
  assert.match(appCss, /\.nx-table-scroll/);
});
