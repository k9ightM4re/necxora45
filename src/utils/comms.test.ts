import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDmThreadId,
  getConnectionRequestId,
  getRoomCallId,
  sanitizeInviteCode,
  validateInviteRecord,
  canOpenDmWithUser,
  getConnectionStatusForPeer,
  formatMembershipStatus,
  filterDirectoryUsers,
  resolveOtherParticipant,
  summarizeMediaState,
  shouldInitiateOffer,
  matchServerByInviteCode,
  buildPeerConnectionConfig,
  detectScreenShareSupport,
  buildDisplayMediaConstraintsList,
} from '../../js/comms.js';

test('getDmThreadId and getConnectionRequestId produce deterministic sorted IDs', () => {
  assert.equal(getDmThreadId('userB', 'userA'), 'userA__userB');
  assert.equal(getConnectionRequestId('userB', 'userA'), 'userA__userB');
  assert.equal(getDmThreadId('same', 'same'), '');
  assert.equal(getDmThreadId('', 'userB'), '');
});

test('getRoomCallId produces valid Firestore document IDs', () => {
  assert.equal(getRoomCallId('dm', 'u1__u2'), 'dm_u1__u2');
  assert.equal(getRoomCallId('voice', 'chn-123'), 'room_chn-123');
  assert.match(getRoomCallId('stage', 'room with spaces!'), /^[a-zA-Z0-9_-]+$/);
});

test('sanitizeInviteCode extracts codes from full URLs and strips unsafe characters', () => {
  assert.equal(sanitizeInviteCode('https://nexora.app/welcome.html?invite=team-alpha_01'), 'team-alpha_01');
  assert.equal(sanitizeInviteCode('  friend-code-99!@# '), 'friend-code-99');
  assert.equal(sanitizeInviteCode(''), '');
});

test('validateInviteRecord enforces active status, expiry timestamps, and usage caps', () => {
  const now = 1_700_000_000_000;
  assert.equal(validateInviteRecord({ active: true, expiresAtMs: now + 60_000, maxUses: 10, uses: 2 }, now).valid, true);
  assert.equal(validateInviteRecord({ active: false }, now).valid, false);
  assert.equal(validateInviteRecord({ active: true, expiresAtMs: now - 1000 }, now).valid, false);
  assert.equal(validateInviteRecord({ active: true, maxUses: 5, uses: 5 }, now).valid, false);
  assert.equal(validateInviteRecord({ active: true, maxUses: 0, uses: 50, expiresAtMs: 0 }, now).valid, true);
});

test('canOpenDmWithUser blocks unaccepted peers and blocked users', () => {
  const accepted = new Set(['peer-accepted']);
  const blocked = new Set(['peer-blocked']);
  assert.equal(canOpenDmWithUser('me', 'peer-accepted', accepted, blocked), true);
  assert.equal(canOpenDmWithUser('me', 'peer-stranger', accepted, blocked), false);
  assert.equal(canOpenDmWithUser('me', 'peer-blocked', new Set(['peer-blocked']), blocked), false);
  assert.equal(canOpenDmWithUser('me', 'me', accepted, blocked), false);
});

test('getConnectionStatusForPeer and formatMembershipStatus compute accurate gating states', () => {
  const requests = [{ id: 'me__peer1', status: 'pending', fromUid: 'me', toUid: 'peer1' }];
  assert.equal(getConnectionStatusForPeer('me', 'peer1', requests).status, 'pending');
  assert.equal(getConnectionStatusForPeer('me', 'peer2', requests).status, 'none');

  const srv = { id: 'srv-1', ownerId: 'owner-1' };
  const joined = new Set(['srv-joined']);
  const joinReqs = new Map([['srv-1', { status: 'pending' }]]);
  assert.equal(formatMembershipStatus(srv, 'owner-1', joined, joinReqs), 'owner');
  assert.equal(formatMembershipStatus({ id: 'srv-joined', ownerId: 'x' }, 'u1', joined, joinReqs), 'member');
  assert.equal(formatMembershipStatus(srv, 'u1', joined, joinReqs), 'pending');
  assert.equal(formatMembershipStatus({ id: 'srv-other', ownerId: 'x' }, 'u1', joined, joinReqs), 'not_member');
});

test('filterDirectoryUsers deduplicates, excludes self & blocked users, and respects privacy mode', () => {
  const users = [
    { id: 'u1', displayName: 'Zara Khan', username: 'zarak', status: 'offline', customStatus: '' },
    { id: 'u2', displayName: 'Sam Test', username: 'samt', status: 'online', customStatus: 'Building app' },
    { id: 'u2', displayName: 'Sam Test', username: 'samt', status: 'online', customStatus: 'Duplicate' },
    { id: 'u3', displayName: 'Hidden User', username: 'hiddenu', status: 'online', accountPrivacy: 'private' },
    { id: 'u4', displayName: 'Blocked User', username: 'blockedu', status: 'online' },
    { id: 'me', displayName: 'Alex Me', username: 'alexme', status: 'online', customStatus: '' },
  ];

  const allOthers = filterDirectoryUsers(users, '', {
    excludeUid: 'me',
    blockedSet: new Set(['u4']),
    respectPrivacy: true,
  });
  assert.equal(allOthers.length, 2);
  assert.equal(allOthers[0].id, 'u2');

  const exactHiddenMatch = filterDirectoryUsers(users, 'hiddenu', {
    excludeUid: 'me',
    blockedSet: new Set(['u4']),
    respectPrivacy: true,
  });
  assert.equal(exactHiddenMatch.length, 1);
  assert.equal(exactHiddenMatch[0].id, 'u3');
});

test('resolveOtherParticipant resolves live directory info or falls back to participantMeta', () => {
  const dir = new Map([
    ['u2', { id: 'u2', displayName: 'Priya Live', username: 'priya', initials: 'PL', status: 'online' }],
  ]);
  const thread = {
    participants: ['u1', 'u2'],
    participantMeta: {
      u2: { displayName: 'Priya Old', username: 'priya', initials: 'PO' },
    },
  };

  const resolved = resolveOtherParticipant(thread, 'u1', dir);
  assert.equal(resolved.id, 'u2');
  assert.equal(resolved.displayName, 'Priya Live');
  assert.equal(resolved.initials, 'PL');

  const resolvedFallback = resolveOtherParticipant(thread, 'u1', new Map());
  assert.equal(resolvedFallback.displayName, 'Priya Old');
});

test('summarizeMediaState returns crisp emoji-free status labels accurately', () => {
  assert.equal(summarizeMediaState({ screenSharing: true, videoOn: false, muted: false }).label, 'Sharing Screen');
  assert.equal(summarizeMediaState({ screenSharing: false, videoOn: true, muted: false }).label, 'Video + Mic Live');
  assert.equal(summarizeMediaState({ screenSharing: false, videoOn: false, muted: true }).label, 'Mic Muted');
});

test('shouldInitiateOffer breaks symmetry deterministically to prevent WebRTC glare', () => {
  assert.equal(shouldInitiateOffer('alice', 'bob'), true);
  assert.equal(shouldInitiateOffer('bob', 'alice'), false);
});

test('matchServerByInviteCode finds server from raw code or full invite URL', () => {
  const servers = [
    { id: 'srv-tech-guild', name: 'Tech Guild', inviteCode: 'tech-hq' },
    { id: 'srv-2', name: 'Design', inviteCode: 'design-01' },
  ];

  assert.equal(matchServerByInviteCode(servers, 'tech-hq')?.id, 'srv-tech-guild');
  assert.equal(matchServerByInviteCode(servers, 'https://nexora.app/welcome.html?invite=design-01')?.id, 'srv-2');
  assert.equal(matchServerByInviteCode(servers, 'missing'), null);
});

test('buildPeerConnectionConfig provides STUN servers for NAT traversal', () => {
  const cfg = buildPeerConnectionConfig();
  assert.ok(Array.isArray(cfg.iceServers));
  assert.ok(cfg.iceServers.length >= 2);
});

test('detectScreenShareSupport identifies iOS Safari fallback, Android Chrome, and Desktop', () => {
  const ios = detectScreenShareSupport({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    hasDisplayMedia: false,
    hasCanvasCaptureStream: true,
    hasUserMedia: true,
  });
  assert.equal(ios.isMobile, true);
  assert.equal(ios.isIos, true);
  assert.equal(ios.platform, 'ios');
  assert.equal(ios.nativeDisplayMedia, false);
  assert.equal(ios.recommendedMode, 'board');

  const android = detectScreenShareSupport({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
    hasDisplayMedia: true,
    hasCanvasCaptureStream: true,
    hasUserMedia: true,
  });
  assert.equal(android.isMobile, true);
  assert.equal(android.isAndroid, true);
  assert.equal(android.platform, 'android');
  assert.equal(android.nativeDisplayMedia, true);
  assert.equal(android.recommendedMode, 'display');

  const ipadDesktopUa = detectScreenShareSupport({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    maxTouchPoints: 5,
    hasDisplayMedia: false,
    hasCanvasCaptureStream: true,
    hasUserMedia: true,
  });
  assert.equal(ipadDesktopUa.isIos, true);
  assert.equal(ipadDesktopUa.isMobile, true);
});

test('buildDisplayMediaConstraintsList avoids unsupported cursor/audio constraints on mobile', () => {
  const mobileList = buildDisplayMediaConstraintsList(true);
  assert.equal(mobileList.length, 2);
  assert.equal(mobileList[0].audio, false);
  assert.equal((mobileList[0].video as Record<string, unknown>).cursor, undefined);
  assert.deepEqual(mobileList[1], { video: true, audio: false });

  const desktopList = buildDisplayMediaConstraintsList(false);
  assert.equal(desktopList.length, 3);
  assert.equal(desktopList[0].audio, true);
  assert.deepEqual(desktopList[2], { video: true, audio: false });
});

