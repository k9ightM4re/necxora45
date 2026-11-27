/**
 * Pure helper utilities for NEXORA user discovery, request-gated direct messages,
 * community invites & join requests, and WebRTC call room management.
 */

export function sanitizeDocId(raw, maxLen = 128) {
  const cleaned = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLen);
  return cleaned || 'default';
}

export function getDmThreadId(uidA, uidB) {
  const a = String(uidA || '').trim();
  const b = String(uidB || '').trim();
  if (!a || !b || a === b) return '';
  const sorted = [a, b].sort();
  return sanitizeDocId(`${sorted[0]}__${sorted[1]}`, 128);
}

export function getConnectionRequestId(uidA, uidB) {
  return getDmThreadId(uidA, uidB);
}

export function getRoomCallId(kind, targetId) {
  const safeKind = kind === 'dm' ? 'dm' : 'room';
  const cleanTarget = sanitizeDocId(targetId, 110);
  return `${safeKind}_${cleanTarget}`;
}

export function sanitizeInviteCode(raw) {
  let code = String(raw || '').trim();
  if (!code) return '';
  try {
    if (code.includes('invite=')) {
      const url = new URL(code, 'https://nexora.app');
      code = url.searchParams.get('invite') || code;
    }
  } catch {}
  return code.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
}

export function validateInviteRecord(invite, nowMs = Date.now()) {
  if (!invite || typeof invite !== 'object') {
    return { valid: false, reason: 'Invite not found.' };
  }
  if (invite.active === false) {
    return { valid: false, reason: 'This invite link has been revoked.' };
  }
  const expiresAtMs =
    typeof invite.expiresAtMs === 'number'
      ? invite.expiresAtMs
      : invite.expiresAt && typeof invite.expiresAt.toMillis === 'function'
        ? invite.expiresAt.toMillis()
        : Number(invite.expiresAt || 0);
  if (expiresAtMs > 0 && nowMs > expiresAtMs) {
    return { valid: false, reason: 'This invite link has expired.' };
  }
  const maxUses = Number(invite.maxUses || 0);
  const uses = Number(invite.uses || 0);
  if (maxUses > 0 && uses >= maxUses) {
    return { valid: false, reason: 'This invite link has reached its usage limit.' };
  }
  return { valid: true, reason: '' };
}

export function canOpenDmWithUser(uidA, uidB, acceptedPeerIds, blockedSet = new Set()) {
  const a = String(uidA || '').trim();
  const b = String(uidB || '').trim();
  if (!a || !b || a === b) return false;
  if (blockedSet instanceof Set && blockedSet.has(b)) return false;
  if (acceptedPeerIds instanceof Set) {
    return acceptedPeerIds.has(b);
  }
  if (Array.isArray(acceptedPeerIds)) {
    return acceptedPeerIds.includes(b);
  }
  return false;
}

export function getConnectionStatusForPeer(myUid, peerUid, requestsList = []) {
  const reqId = getConnectionRequestId(myUid, peerUid);
  if (!reqId) return { status: 'none', request: null };
  const match = (requestsList || []).find((r) => r.id === reqId);
  if (!match) return { status: 'none', request: null };
  return { status: match.status || 'pending', request: match };
}

export function formatMembershipStatus(server, currentUid, joinedServerIds = new Set(), joinRequestsMap = new Map()) {
  if (!server || !currentUid) return 'not_member';
  if (server.ownerId === currentUid) return 'owner';
  if (joinedServerIds instanceof Set && joinedServerIds.has(server.id)) return 'member';
  const req = joinRequestsMap instanceof Map ? joinRequestsMap.get(server.id) : joinRequestsMap?.[server.id];
  if (req?.status === 'approved') return 'approved';
  if (req?.status === 'pending') return 'pending';
  if (req?.status === 'declined') return 'declined';
  return 'not_member';
}

export function filterDirectoryUsers(
  users,
  queryText,
  { excludeUid = '', blockedSet = /** @type {Set<string> | null} */ (null), respectPrivacy = false, limit = 50 } = {}
) {
  const q = String(queryText || '').trim().toLowerCase();
  const seen = new Set();
  const deduped = [];

  for (const u of users || []) {
    if (!u || !u.id || seen.has(u.id)) continue;
    if (excludeUid && u.id === excludeUid) continue;
    if (blockedSet instanceof Set && blockedSet.has(u.id)) continue;
    if (respectPrivacy && u.accountPrivacy === 'private' && !q) continue;
    seen.add(u.id);
    deduped.push(u);
  }

  const filtered = q
    ? deduped.filter((u) => {
        const display = String(u.displayName || '').toLowerCase();
        const handle = String(u.username || '').toLowerCase();
        const bio = String(u.bio || '').toLowerCase();
        const statusText = String(u.customStatus || '').toLowerCase();
        return display.includes(q) || handle.includes(q) || bio.includes(q) || statusText.includes(q);
      })
    : deduped;

  const statusRank = (s) => {
    if (s === 'online') return 0;
    if (s === 'idle' || s === 'dnd') return 1;
    return 2;
  };

  filtered.sort((a, b) => {
    if (q) {
      const aStarts =
        String(a.displayName || '').toLowerCase().startsWith(q) ||
        String(a.username || '').toLowerCase().startsWith(q);
      const bStarts =
        String(b.displayName || '').toLowerCase().startsWith(q) ||
        String(b.username || '').toLowerCase().startsWith(q);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
    }
    const rDiff = statusRank(a.status) - statusRank(b.status);
    if (rDiff !== 0) return rDiff;
    return String(a.displayName || '').localeCompare(String(b.displayName || ''));
  });

  return filtered.slice(0, limit);
}

export function resolveOtherParticipant(thread, currentUid, directoryMap) {
  const participants = Array.isArray(thread?.participants) ? thread.participants : [];
  const otherId = participants.find((id) => id !== currentUid) || currentUid;
  const fromDir = directoryMap instanceof Map ? directoryMap.get(otherId) : directoryMap?.[otherId];
  const fromMeta = thread?.participantMeta?.[otherId];

  const displayName = fromDir?.displayName || fromMeta?.displayName || 'NEXORA Member';
  const username = fromDir?.username || fromMeta?.username || 'member';
  const initials = fromDir?.initials || fromMeta?.initials || displayName.slice(0, 2).toUpperCase();
  const status = fromDir?.status || 'online';

  return {
    id: otherId,
    displayName,
    username,
    initials,
    status,
    customStatus: fromDir?.customStatus || '',
  };
}

export function summarizeMediaState(peer) {
  if (!peer) return { label: 'Disconnected', badges: [] };
  const badges = [];
  if (peer.screenSharing) badges.push('Screen');
  if (peer.videoOn) badges.push('Video');
  if (peer.muted) badges.push('Muted');
  if (peer.handRaised) badges.push('Hand Raised');

  let label = 'Audio Live';
  if (peer.screenSharing) label = 'Sharing Screen';
  else if (peer.videoOn && !peer.muted) label = 'Video + Mic Live';
  else if (peer.videoOn && peer.muted) label = 'Video (Muted)';
  else if (peer.muted) label = 'Mic Muted';
  else if (peer.handRaised) label = 'Hand Raised';

  return { label, badges };
}

export function shouldInitiateOffer(localUid, remoteUid) {
  return String(localUid || '') < String(remoteUid || '');
}

export function matchServerByInviteCode(servers, rawInput) {
  const code = sanitizeInviteCode(rawInput);
  if (!code) return null;

  const lower = code.toLowerCase();
  return (
    (servers || []).find(
      (s) =>
        String(s.inviteCode || '').toLowerCase() === lower ||
        String(s.id || '').toLowerCase() === lower
    ) || null
  );
}

export function buildPeerConnectionConfig(customIceServers = null) {
  if (Array.isArray(customIceServers) && customIceServers.length > 0) {
    return { iceServers: customIceServers };
  }
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  };
}

/**
 * @param {Record<string, any> | null} [env]
 */
export function detectScreenShareSupport(env = null) {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const ua = env && typeof env.userAgent === 'string' ? env.userAgent : nav?.userAgent || '';
  const maxTouchPoints =
    env && typeof env.maxTouchPoints === 'number'
      ? env.maxTouchPoints
      : Number(nav?.maxTouchPoints || 0);

  const isIos = /iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isMobile = Boolean(isIos || isAndroid || /Mobile|Tablet/i.test(ua));
  const platform = isIos ? 'ios' : isAndroid ? 'android' : 'desktop';

  const hasDisplayMedia =
    env && typeof env.hasDisplayMedia === 'boolean'
      ? env.hasDisplayMedia
      : Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

  let defaultCanvasCapture = false;
  if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype) {
    defaultCanvasCapture =
      typeof HTMLCanvasElement.prototype.captureStream === 'function' ||
      typeof /** @type {any} */ (HTMLCanvasElement.prototype).mozCaptureStream === 'function';
  }
  const canCanvasShare =
    env && typeof env.hasCanvasCaptureStream === 'boolean' ? env.hasCanvasCaptureStream : defaultCanvasCapture;

  const canCameraShare =
    env && typeof env.hasUserMedia === 'boolean'
      ? env.hasUserMedia
      : Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

  const recommendedMode = hasDisplayMedia
    ? 'display'
    : canCanvasShare
      ? 'board'
      : canCameraShare
        ? 'camera'
        : 'none';

  let supportNote = 'Stream your device screen, browser tab, or app window live.';
  if (platform === 'ios' && !hasDisplayMedia) {
    supportNote =
      'iOS Safari & mobile WebKit browsers block OS-wide screen capture. Use Photo/Screenshot Share, Live Whiteboard Stream, or Rear Camera Share below — all stream live over WebRTC.';
  } else if (platform === 'android' && hasDisplayMedia) {
    supportNote =
      'Android supports mobile screen sharing (with automatic fallback constraints) plus Photo/Screenshot Slides, Live Whiteboard, and Rear Camera.';
  } else if (platform === 'android' && !hasDisplayMedia) {
    supportNote =
      'This Android WebView omits system screen capture. Use Photo/Screenshot Share, Live Whiteboard Stream, or Rear Camera Share below.';
  }

  return {
    isMobile,
    isIos,
    isAndroid,
    platform,
    nativeDisplayMedia: hasDisplayMedia,
    canCanvasShare,
    canCameraShare,
    recommendedMode,
    supportNote,
  };
}

export function buildDisplayMediaConstraintsList(isMobile = false) {
  if (isMobile) {
    return [
      {
        video: {
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];
  }

  return [
    {
      video: { cursor: 'always' },
      audio: true,
    },
    {
      video: { cursor: 'always' },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];
}

/**
 * @param {number} tsMs
 */
export function getMessageDayKey(tsMs) {
  const d = new Date(Number(tsMs || 0) || Date.now());
  if (Number.isNaN(d.getTime())) return 'today';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * @param {number} tsMs
 * @param {number} [nowMs]
 */
export function formatMessageDateLabel(tsMs, nowMs = Date.now()) {
  const ms = Number(tsMs || 0);
  if (!ms || Number.isNaN(ms)) return 'Today';
  const target = new Date(ms);
  const now = new Date(nowMs);
  if (Number.isNaN(target.getTime())) return 'Today';

  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((todayStart - targetDay) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  try {
    const sameYear = target.getFullYear() === now.getFullYear();
    return target.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  } catch {
    return getMessageDayKey(ms);
  }
}

/**
 * @param {Record<string, any> | null} prevMsg
 * @param {Record<string, any> | null} nextMsg
 * @param {number} [maxGapMs]
 */
export function shouldGroupMessages(prevMsg, nextMsg, maxGapMs = 300000) {
  if (!prevMsg || !nextMsg) return false;
  if (prevMsg.authorId !== nextMsg.authorId) return false;
  if (nextMsg.replyToId || nextMsg.poll) return false;
  const prevTs = Number(prevMsg.timestamp || 0);
  const nextTs = Number(nextMsg.timestamp || 0);
  if (prevTs && nextTs) {
    if (getMessageDayKey(prevTs) !== getMessageDayKey(nextTs)) return false;
    if (Math.abs(nextTs - prevTs) > maxGapMs) return false;
  }
  return true;
}

/**
 * @param {Record<string, any> | null} dm
 * @param {Array<Record<string, any>>} [cachedMessages]
 * @param {string} [selfUid]
 */
export function getDmUnreadCount(dm, cachedMessages = [], selfUid = '') {
  if (!dm || !selfUid) return 0;
  if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
    let unread = 0;
    for (const m of cachedMessages) {
      if (!m || m.authorId === selfUid) continue;
      const seenBy = Array.isArray(m.seenBy) ? m.seenBy : [];
      if (!seenBy.includes(selfUid)) unread += 1;
    }
    return unread;
  }
  const hasUnreadSummary =
    Boolean(dm.lastSenderId && dm.lastSenderId !== selfUid) &&
    !(Array.isArray(dm.seenBy) && dm.seenBy.includes(selfUid));
  return hasUnreadSummary ? 1 : 0;
}


