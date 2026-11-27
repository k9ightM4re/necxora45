export const ABUSE_ALERT_PRESETS = [
  {
    id: 'abuse',
    label: 'Abusive Language',
    severity: 'urgent',
    reason: 'Warning: Abusive or disrespectful language is strictly prohibited in this community.',
  },
  {
    id: 'harassment',
    label: 'Harassment',
    severity: 'urgent',
    reason: 'Urgent Alert: Harassment, bullying, or targeted attacks violate community guidelines.',
  },
  {
    id: 'spam',
    label: 'Spam / Flooding',
    severity: 'warning',
    reason: 'Warning: Please stop posting repetitive spam or unsolicited links.',
  },
  {
    id: 'disruption',
    label: 'Disruptive Conduct',
    severity: 'warning',
    reason: 'Warning: Please keep conversations respectful and follow community rules.',
  },
];

export function sanitizeAlertReason(raw) {
  const cleaned = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return cleaned.length >= 3 ? cleaned : '';
}

export function normalizeAlertSeverity(severity) {
  return severity === 'urgent' ? 'urgent' : 'warning';
}

export function buildCommunityAlertPayload({
  alertId,
  server,
  actor,
  targetUser,
  severity = 'warning',
  reason,
  timestamp,
}) {
  if (!server?.id || !server?.ownerId) {
    throw new Error('Select a valid community first.');
  }
  if (!actor?.id || actor.id !== server.ownerId) {
    throw new Error('Only the community leader can send abuse alerts.');
  }
  if (!targetUser?.id) {
    throw new Error('Select a member to alert.');
  }
  if (targetUser.id === server.ownerId || targetUser.id === actor.id) {
    throw new Error('You cannot send an abuse alert to yourself.');
  }

  const cleanReason = sanitizeAlertReason(reason);
  if (!cleanReason) {
    throw new Error('Alert reason must be at least 3 characters.');
  }

  const cleanSeverity = normalizeAlertSeverity(severity);
  const safeAlertId = String(alertId || `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`).slice(0, 128);
  const safeServerName = String(server.name || 'Community').trim().slice(0, 120) || 'Community';
  const safeActorName = String(actor.displayName || 'Community Leader').trim().slice(0, 80) || 'Community Leader';
  const safeTargetName = String(targetUser.displayName || 'Member').trim().slice(0, 80) || 'Member';
  const ts = timestamp ?? Date.now();

  const alertPayload = {
    id: safeAlertId,
    serverId: String(server.id).slice(0, 128),
    serverName: safeServerName,
    ownerId: String(server.ownerId).slice(0, 128),
    actorId: String(actor.id).slice(0, 128),
    actorName: safeActorName,
    targetUserId: String(targetUser.id).slice(0, 128),
    targetName: safeTargetName,
    severity: cleanSeverity,
    reason: cleanReason,
    acknowledged: false,
    createdAt: ts,
    updatedAt: ts,
  };

  const notifId = `notif-alert-${safeAlertId}`.slice(0, 128);
  const notificationPayload = {
    id: notifId,
    senderId: String(actor.id).slice(0, 128),
    category: 'community_alert',
    targetId: String(server.id).slice(0, 128),
    title: `${cleanSeverity === 'urgent' ? 'Urgent Warning' : 'Community Warning'} · ${safeServerName}`.slice(0, 120),
    body: `${safeActorName}: ${cleanReason}`.slice(0, 300),
    unread: true,
    createdAt: ts,
  };

  return {
    alertId: safeAlertId,
    notifId,
    alertPayload,
    notificationPayload,
    auditText: `Sent ${cleanSeverity} alert to ${safeTargetName}: ${cleanReason.slice(0, 120)}`.slice(0, 240),
  };
}

export function buildLeaderAddMemberPayloads({
  server,
  actor,
  targetUser,
  role = 'member',
  timestamp,
}) {
  if (!server?.id || !server?.ownerId) {
    throw new Error('Select a valid community first.');
  }
  if (!actor?.id || actor.id !== server.ownerId) {
    throw new Error('Only the community leader can add members directly.');
  }
  if (!targetUser?.id) {
    throw new Error('Select a valid user to add.');
  }
  if (targetUser.id === server.ownerId) {
    throw new Error('Community leader is already in this community.');
  }

  const safeRole = role === 'moderator' ? 'moderator' : 'member';
  const safeDisplayName = String(targetUser.displayName || 'Member').trim().slice(0, 50) || 'Member';
  const safeServerName = String(server.name || 'Community').trim().slice(0, 80) || 'Community';
  const safeActorName = String(actor.displayName || 'Community Leader').trim().slice(0, 80) || 'Community Leader';
  const ts = timestamp ?? Date.now();
  const notifId = `notif-added-${server.id}-${Date.now()}`.slice(0, 128);

  return {
    notifId,
    memberPayload: {
      userId: String(targetUser.id).slice(0, 128),
      displayName: safeDisplayName,
      role: safeRole,
      joinedAt: ts,
    },
    joinedServerPayload: {
      serverId: String(server.id).slice(0, 128),
      joinedAt: ts,
    },
    notificationPayload: {
      id: notifId,
      senderId: String(actor.id).slice(0, 128),
      category: 'community_invite',
      targetId: String(server.id).slice(0, 128),
      title: `Added to ${safeServerName}`.slice(0, 120),
      body: `${safeActorName} added you to ${safeServerName} as ${safeRole}.`.slice(0, 300),
      unread: true,
      createdAt: ts,
    },
    auditText: `Added ${safeDisplayName} directly to community (${safeRole})`.slice(0, 240),
  };
}

export function filterAddableUsers(directoryUsers = [], memberIdSet = new Set(), ownerId = '', queryText = '', limit = 12) {
  const q = String(queryText || '').trim().toLowerCase();
  const members = memberIdSet instanceof Set ? memberIdSet : new Set(Array.isArray(memberIdSet) ? memberIdSet : []);
  const seen = new Set();
  const results = [];

  for (const user of directoryUsers) {
    if (!user?.id || seen.has(user.id)) continue;
    seen.add(user.id);
    if (user.id === ownerId || members.has(user.id) || user.suspended) continue;
    if (q) {
      const hay = `${user.displayName || ''} ${user.username || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    results.push(user);
    if (results.length >= limit) break;
  }

  return results;
}

export function summarizeUserAlerts(alerts = [], targetUserId = '', options = {}) {
  const { onlyUnacknowledged = false } = options;
  const filtered = (Array.isArray(alerts) ? alerts : [])
    .filter((a) => (!targetUserId || a.targetUserId === targetUserId) && (!onlyUnacknowledged || !a.acknowledged))
    .slice()
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

  return {
    totalCount: filtered.length,
    unackedCount: filtered.filter((a) => !a.acknowledged).length,
    urgentCount: filtered.filter((a) => a.severity === 'urgent').length,
    items: filtered,
  };
}
