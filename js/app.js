import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase.js';
import { formatFriendlyError, notifyUser } from './notifications.js';
import {
  requireAuth,
  signOutSession,
  changeAccountEmail,
  changeAccountPassword,
  deleteCurrentAccount,
} from './session.js';
import { updateUserProfile, getInitials, sanitizeHandle, renderUserAvatarHtml } from './profile.js';
import {
  canOpenDmWithUser,
  detectScreenShareSupport,
  filterDirectoryUsers,
  formatMembershipStatus,
  formatMessageDateLabel,
  getConnectionRequestId,
  getConnectionStatusForPeer,
  getDmThreadId,
  getDmUnreadCount,
  getMessageDayKey,
  getRoomCallId,
  matchServerByInviteCode,
  resolveOtherParticipant,
  sanitizeInviteCode,
  shouldGroupMessages,
  summarizeMediaState,
  validateInviteRecord,
} from './comms.js';
import { createRtcManager } from './rtc.js';
import { getChannelIconSvg, svgIcon } from './icons.js';
import { createSocialModule } from './social.js';
import { applyTheme, getStoredTheme, initThemeSync } from './theme.js';
import {
  compressImageFile,
  formatFileSize,
  formatRelativeTime,
  normalizeThemePreference,
  readMediaFileBounded,
  uploadMediaFileToServer,
} from './social_utils.js';
import { createNexoraWsClient } from './ws_client.js';
import { buildCommunityInviteMessage, extractCommunityInviteCodeFromText } from './reel_studio.js';
import { createCallTabManager } from './call_tab.js';
import {
  ABUSE_ALERT_PRESETS,
  buildCommunityAlertPayload,
  buildLeaderAddMemberPayloads,
  filterAddableUsers,
  summarizeUserAlerts,
} from './community_moderation.js';

const KEYS = {
  PREFS: 'nexora_lite_prefs_v2',
  UI: 'nexora_lite_ui_v2',
};

const ACCENTS = [
  { name: 'Signal Blue', hex: '#3868CE', hover: '#2D58B8', soft: 'rgba(71, 119, 223, 0.14)', border: 'rgba(71, 119, 223, 0.36)' },
  { name: 'Soft Amber', hex: '#C49A52', hover: '#B08843', soft: 'rgba(196, 154, 82, 0.14)', border: 'rgba(196, 154, 82, 0.38)' },
  { name: 'Emerald', hex: '#34D399', hover: '#2BB885', soft: 'rgba(52, 211, 153, 0.14)', border: 'rgba(52, 211, 153, 0.38)' },
  { name: 'Slate', hex: '#64748B', hover: '#475569', soft: 'rgba(100, 116, 139, 0.14)', border: 'rgba(100, 116, 139, 0.38)' },
  { name: 'Graphite', hex: '#242B35', hover: '#1D232C', soft: 'rgba(36, 43, 53, 0.14)', border: 'rgba(36, 43, 53, 0.35)' },
];

const EMOJI_BANK = [
  { char: '👍', name: 'thumbs up like', cat: 'gestures' },
  { char: '👏', name: 'clap applause', cat: 'gestures' },
  { char: '🙌', name: 'raised hands celebrate', cat: 'gestures' },
  { char: '🤝', name: 'handshake deal', cat: 'gestures' },
  { char: '👋', name: 'wave hello', cat: 'gestures' },
  { char: '✌️', name: 'peace victory', cat: 'gestures' },
  { char: '🔥', name: 'fire hot lit', cat: 'objects' },
  { char: '⚡', name: 'lightning fast zap', cat: 'objects' },
  { char: '🚀', name: 'rocket launch ship', cat: 'objects' },
  { char: '✨', name: 'sparkles magic', cat: 'objects' },
  { char: '💡', name: 'idea lightbulb', cat: 'objects' },
  { char: '🎯', name: 'target bullseye', cat: 'objects' },
  { char: '😀', name: 'grin smile happy', cat: 'smileys' },
  { char: '😄', name: 'laugh smile joy', cat: 'smileys' },
  { char: '😎', name: 'cool sunglasses', cat: 'smileys' },
  { char: '🤔', name: 'thinking hmm', cat: 'smileys' },
  { char: '🥳', name: 'party celebrate', cat: 'smileys' },
  { char: '🤩', name: 'star eyes amazed', cat: 'smileys' },
  { char: '😌', name: 'calm relieved', cat: 'smileys' },
  { char: '🧡', name: 'orange heart', cat: 'objects' },
  { char: '✅', name: 'check done verified', cat: 'objects' },
];

const DEFAULT_PREFS = {
  theme: 'dark',
  accent: '#3868CE',
  density: 'cozy',
  sidebarCollapsed: false,
  inspectorCollapsed: true,
  muted: false,
  deafened: false,
  notifyMentions: true,
  notifyDms: true,
  notifyGuard: true,
  notifyLikes: true,
  notifyComments: true,
  notifyFollows: true,
  notifyLive: true,
  quietMode: false,
  defaultVisibility: 'public',
  feedDefaultTab: 'for-you',
  whoCanMessage: 'everyone',
  whoCanTag: 'everyone',
  showActivityStatus: true,
  readReceipts: true,
  autoplayReels: true,
  dataSaver: false,
  loginAlerts: true,
};

const DEFAULT_ROLES = [
  {
    id: 'role-owner',
    name: 'Owner',
    color: '#F07827',
    permissions: { manageRoles: true, manageMembers: true, moderateContent: true, banMembers: true, manageChannels: true, pinMessages: true, voiceSpeak: true },
  },
  {
    id: 'role-mod',
    name: 'Moderator',
    color: '#16A34A',
    permissions: { manageRoles: false, manageMembers: true, moderateContent: true, banMembers: false, manageChannels: true, pinMessages: true, voiceSpeak: true },
  },
  {
    id: 'role-member',
    name: 'Member',
    color: '#64748B',
    permissions: { manageRoles: false, manageMembers: false, moderateContent: false, banMembers: false, manageChannels: false, pinMessages: false, voiceSpeak: true },
  },
];

let currentFirebaseUser = null;
let unsubOwnProfile = null;
let unsubJoinedRefs = null;
let unsubServersOwned = null;
let unsubPublicCatalog = null;
let unsubChannels = null;
let unsubMessages = null;
let unsubServerMembers = null;
let unsubJoinRequests = null;
let unsubServerEvents = null;
let unsubDirectoryUsers = null;
let unsubDmThreads = null;
let unsubDmMessages = null;
let unsubConnectionRequests = null;
let unsubBlocks = null;
let unsubBookmarks = null;
let unsubMyInvites = null;
let unsubReportsReporter = null;
let unsubReportsOwner = null;
let unsubNotifs = null;
let unsubModLogs = null;
let unsubServerAlerts = null;

const joinedServersMap = new Map();
const ownedServersMap = new Map();
const directoryMap = new Map();
const pendingDirectoryFetches = new Map();
const reportsReporterMap = new Map();
const reportsOwnerMap = new Map();

let prefs = loadPrefs();
let profile = {
  id: '',
  displayName: 'Member',
  username: 'member',
  initials: 'MB',
  avatar: '',
  coverPhoto: '',
  email: '',
  phoneNumber: '',
  emailVerified: false,
  status: 'online',
  customStatus: '',
  bio: '',
  accountPrivacy: 'everyone',
  verified: false,
  suspended: false,
  followersCount: 0,
  followingCount: 0,
  postsCount: 0,
  roleId: 'role-owner',
};

const state = {
  activeView: 'home',
  activeServerId: '',
  activeChannelId: '',
  activeDmId: '',
  pendingPeerId: '',
  inspectorTab: 'members',
  activeThreadMsgId: null,
  replyToMsgId: null,
  voiceChannelId: null,
  searchQuery: '',
  userSearchQuery: '',
  dmSearchQuery: '',
  dmInboxTab: 'all',
  dmThreadActiveMobile: false,
  dmMessagesLoadingThreadId: '',
  dmError: '',
  isSendingMessage: false,
  onlineUids: new Set(),
  wsTypingMap: {},
  wsConnected: false,
  threadSearchOpen: false,
  showArchivedDms: false,
  collapsedCategories: {},
  servers: [],
  joinedServerIds: new Set(),
  publicServers: [],
  myJoinRequests: new Map(),
  serverJoinRequests: [],
  serverEvents: [],
  channels: {},
  messages: {},
  dmMessages: {},
  dms: [],
  connectionRequests: [],
  acceptedPeerIds: new Set(),
  blockedUsers: [],
  blockedSet: new Set(),
  bookmarks: [],
  myInvites: [],
  reports: [],
  directoryUsers: [],
  serverMemberIds: new Set(),
  serverMembersMeta: new Map(),
  serverAlerts: [],
  leaderAddSearch: '',
  leaderInspectorAddSearch: '',
  members: [],
  notifications: [],
};

let rtcState = {
  activeCall: null,
  incomingCall: null,
  lastEndedCall: null,
  localStream: null,
  screenStream: null,
  remoteStreams: new Map(),
  peers: [],
  muted: false,
  deafened: false,
  videoOn: false,
  screenSharing: false,
  screenShareKind: '',
  cameraFacing: 'user',
  handRaised: false,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  audioInputId: '',
  audioOutputId: '',
  videoInputId: '',
  devices: { mics: [], speakers: [], cams: [] },
  mediaNotice: '',
};

let callTab = null;

const rtc = createRtcManager({
  db,
  auth,
  onStateChange: (next) => {
    rtcState = next;
    if (next.activeCall?.kind === 'voice' || next.activeCall?.kind === 'stage') {
      state.voiceChannelId = next.activeCall.targetId;
    } else if (!next.activeCall) {
      state.voiceChannelId = null;
    }
    if (!next.screenSharing) {
      stopShareBoardKeepAlive();
    }
    renderMobileShareStatusButtons();
    renderIncomingCallBanner();
    renderSidebar();
    renderMainWorkspace();
    ensureCallTab().syncWithRtcState(next);
    const curSocial = socialModule?.getSection?.();
    if (curSocial === 'calls' || curSocial === 'live') {
      socialModule.render();
    }
  },
  onToast: (msg) => showToast(msg),
  onScreenShareFallback: ({ reason, support }) => {
    openMobileShareModal(support || detectScreenShareSupport(), reason);
  },
});

function ensureCallTab() {
  if (callTab) return callTab;
  callTab = createCallTabManager({
    db,
    rtc,
    getProfile: () => profile,
    getRtcState: () => rtcState,
    getMember: (uid) => getMember(uid),
    showToast,
    escapeHtml,
    svgIcon,
    renderDeviceControlsBar,
    summarizeMediaState,
    onToggleMute: async () => {
      prefs.muted = !prefs.muted;
      savePrefs();
      applyPrefsToDom();
      await rtc.setMuted(prefs.muted, profile);
    },
    onToggleCamera: async () => {
      await rtc.toggleCamera(profile);
    },
    onFlipCamera: async () => {
      await rtc.switchCameraFacing(profile);
    },
    onToggleScreenShare: async () => {
      if (rtcState.screenSharing) {
        await rtc.stopScreenShare(profile);
        stopShareBoardKeepAlive();
      } else {
        const support = detectScreenShareSupport();
        if (!support.nativeDisplayMedia) {
          openMobileShareModal(support, 'unsupported');
        } else {
          await rtc.startScreenShare(profile);
        }
      }
    },
    onOpenShareOptions: () => {
      openMobileShareModal(detectScreenShareSupport());
    },
    onLeaveCall: async () => {
      await rtc.leaveCall();
    },
    onVisibilityChange: () => {
      renderDmCallStage();
    },
  });
  callTab.bindEvents();
  return callTab;
}

let socialModule = null;
let pendingMessageAttachment = null;
let voiceRecorder = null;
let voiceRecordingChunks = [];
let lastTypingSentMs = 0;
const markedSeenIds = new Set();

let activeSettingsTab = 'account';
let activeAdminTab = 'overview';
let selectedRoleId = 'role-owner';
let emojiCategory = 'all';
let emojiQuery = '';
let editingMessageId = null;
let confirmDeleteOpen = false;
let eventsBound = false;
let shareBoardReady = false;
let shareInkColor = '#FF7A2F';
let shareDrawing = false;
let shareLastPoint = null;
let shareNoteSlot = 0;
let shareKeepAliveTimer = null;
let sharePulseOn = true;

function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEYS.PREFS);
    const parsed = raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
    parsed.theme = normalizeThemePreference(localStorage.getItem('nexora_theme') || parsed.theme);
    return parsed;
  } catch {}
  return { ...DEFAULT_PREFS, theme: getStoredTheme() };
}

function savePrefs() {
  prefs.theme = normalizeThemePreference(prefs.theme);
  localStorage.setItem(KEYS.PREFS, JSON.stringify(prefs));
  try {
    localStorage.setItem('nexora_theme', prefs.theme);
  } catch {}
}

function saveUiNav() {
  try {
    localStorage.setItem(
      KEYS.UI,
      JSON.stringify({
        activeView: state.activeView,
        activeServerId: state.activeServerId,
        activeChannelId: state.activeChannelId,
        activeDmId: state.activeDmId,
        collapsedCategories: state.collapsedCategories,
      })
    );
  } catch {}
}

function loadUiNav() {
  try {
    const raw = localStorage.getItem(KEYS.UI);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMessageMarkdown(raw) {
  let html = escapeHtml(raw);
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;">$1</a>'
  );
  html = html.replace(/\n/g, '<br />');
  return html;
}

function formatTimeFromData(createdAt, fallbackTime) {
  if (createdAt && typeof createdAt.toDate === 'function') {
    return createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (typeof fallbackTime === 'string') return fallbackTime;
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timestampMillis(createdAt, fallbackMs = Date.now()) {
  if (createdAt && typeof createdAt.toMillis === 'function') return createdAt.toMillis();
  if (typeof fallbackMs === 'number') return fallbackMs;
  return Date.now();
}

function showToast(msg, variant = 'info') {
  const text = String(msg || '').trim();
  if (!text) return;
  const inferredVariant =
    variant === 'info' &&
    /(could not|failed|unable|blocked|busy|cannot|must|only the|expired|invalid|denied|before)/i.test(text)
      ? 'error'
      : variant;
  notifyUser(text, inferredVariant);
}

function syncUnifiedHeaderBadges() {
  const topAvatarEl = document.getElementById('nx-top-avatar');
  if (topAvatarEl) {
    topAvatarEl.innerHTML = `
      ${renderUserAvatarHtml(profile, 34)}
      <span class="nx-online-dot ${escapeHtml(profile.status || 'online')}" id="nx-top-status-dot"></span>
    `;
  }

  const railAvatarEl = document.getElementById('nx-rail-avatar');
  if (railAvatarEl) {
    railAvatarEl.innerHTML = `
      ${renderUserAvatarHtml(profile, 36)}
      <span class="nx-online-dot ${escapeHtml(profile.status || 'online')}" id="nx-rail-status-dot"></span>
    `;
  }

  const pendingReqs = state.connectionRequests.filter(
    (r) => r.status === 'pending' && r.toUid === profile.id && !state.blockedSet.has(r.fromUid)
  ).length;
  const unreadDmTotal = state.dms.reduce((acc, dm) => {
    if (dm.userId && state.blockedSet.has(dm.userId)) return acc;
    if (Array.isArray(dm.archivedBy) && dm.archivedBy.includes(profile.id)) return acc;
    return acc + getDmUnreadCount(dm, state.dmMessages[dm.id] || [], profile.id);
  }, 0);
  const totalMsgBadge = unreadDmTotal + pendingReqs;
  const unreadNotifs = state.notifications.filter((n) => n.unread).length;

  const setBadge = (id, count) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  };

  setBadge('nx-top-notif-badge', unreadNotifs);
  setBadge('nx-nav-notif-badge', unreadNotifs);
  setBadge('nx-top-msg-badge', totalMsgBadge);
  setBadge('nx-nav-msg-badge', totalMsgBadge);
  setBadge('nx-mob-msg-badge', totalMsgBadge);
}

function applyPrefsToDom() {
  const root = document.documentElement;
  const theme = applyTheme(normalizeThemePreference(prefs.theme));
  prefs.theme = theme;
  root.setAttribute('data-density', prefs.density === 'compact' ? 'compact' : 'cozy');

  const accentObj = ACCENTS.find((a) => a.hex === prefs.accent) || ACCENTS[0];
  root.style.setProperty('--accent', accentObj.hex);
  root.style.setProperty('--accent-hover', accentObj.hover);
  root.style.setProperty('--accent-soft', accentObj.soft);
  root.style.setProperty('--accent-border', accentObj.border);

  const legacyWs = document.getElementById('nx-legacy-workspace');
  if (legacyWs) {
    legacyWs.classList.toggle('sidebar-collapsed', Boolean(prefs.sidebarCollapsed));
    legacyWs.classList.toggle('inspector-collapsed', Boolean(prefs.inspectorCollapsed));
  }

  const inspBtn = document.getElementById('inspector-toggle-btn');
  if (inspBtn) inspBtn.classList.toggle('active', !prefs.inspectorCollapsed);

  const muteBtn = document.getElementById('mute-btn');
  const deafBtn = document.getElementById('deafen-btn');
  if (muteBtn) {
    muteBtn.setAttribute('aria-pressed', String(prefs.muted));
    muteBtn.classList.toggle('danger-active', prefs.muted);
  }
  if (deafBtn) {
    deafBtn.setAttribute('aria-pressed', String(prefs.deafened));
    deafBtn.classList.toggle('danger-active', prefs.deafened);
  }

  syncUnifiedHeaderBadges();
}

function getActiveServer() {
  return state.servers.find((s) => s.id === state.activeServerId) || state.servers[0] || null;
}

function getActiveChannel() {
  const srv = getActiveServer();
  if (state.activeChannelId && state.channels[state.activeChannelId]) {
    return state.channels[state.activeChannelId];
  }
  if (srv && srv.defaultChannelId && state.channels[srv.defaultChannelId]) {
    return state.channels[srv.defaultChannelId];
  }
  return Object.values(state.channels).find((c) => !srv || c.serverId === srv.id) || null;
}

function getMember(userId) {
  if (userId === profile.id || userId === 'self') return profile;
  return (
    directoryMap.get(userId) ||
    state.members.find((m) => m.id === userId) || {
      id: userId,
      displayName: 'Member',
      username: 'member',
      initials: 'MB',
      status: 'offline',
      customStatus: '',
      accountPrivacy: 'everyone',
      roleId: 'role-member',
    }
  );
}

/* ---------- FIRESTORE SYNC ---------- */

function safeServerDoc(srvId, data) {
  return {
    id: srvId,
    name: data.name || 'Community',
    glyph: data.glyph || getInitials(data.name || 'CM'),
    category: data.category || 'Technology',
    description: data.description || '',
    rules: data.rules || '',
    welcomeMessage: data.welcomeMessage || '',
    inviteCode: data.inviteCode || '',
    visibility: data.visibility || 'private',
    ownerId: data.ownerId || '',
    defaultChannelId: data.defaultChannelId || '',
    categories: Array.isArray(data.categories) ? data.categories : [],
    guard: data.guard || { active: true, purgeUnverified: false, purgeDays: 7, antiSpamLinks: true, blockedWords: [] },
    roles: DEFAULT_ROLES.map((r) => ({ ...r, permissions: { ...r.permissions } })),
    auditLog: data.auditLog || [],
    unread: 0,
  };
}

function mergeServersFromSnapshots() {
  const combined = new Map([...joinedServersMap, ...ownedServersMap]);
  state.servers = Array.from(combined.values());

  if (state.servers.length === 0) {
    state.activeServerId = '';
    state.activeChannelId = '';
    if (state.activeView === 'server') {
      renderAll();
    } else {
      renderRail();
    }
    return;
  }

  if (!state.servers.some((s) => s.id === state.activeServerId)) {
    const saved = loadUiNav();
    const matchSaved = saved && state.servers.find((s) => s.id === saved.activeServerId);
    const chosen = matchSaved || state.servers[0];
    state.activeServerId = chosen.id;
    state.activeChannelId = chosen.defaultChannelId || '';
    subscribeServerResources(chosen);
  } else {
    renderRail();
    renderSidebar();
  }
}

function subscribeServerResources(srv) {
  if (!srv) return;
  subscribeChannels(srv.id);
  subscribeServerMembers(srv.id);
  subscribeServerEvents(srv.id);
  subscribeServerAlerts(srv);
  if (srv.ownerId === currentFirebaseUser?.uid) {
    subscribeJoinRequests(srv.id);
    subscribeModLogs(srv.id);
  } else {
    if (unsubJoinRequests) {
      unsubJoinRequests();
      unsubJoinRequests = null;
    }
    state.serverJoinRequests = [];
    if (unsubModLogs) {
      unsubModLogs();
      unsubModLogs = null;
    }
  }
}

function subscribeServerAlerts(srv) {
  if (unsubServerAlerts) {
    unsubServerAlerts();
    unsubServerAlerts = null;
  }
  state.serverAlerts = [];
  if (!srv?.id || !currentFirebaseUser) return;

  const isLeader = srv.ownerId === currentFirebaseUser.uid;
  const q = query(
    collection(db, 'servers', srv.id, 'alerts'),
    where(isLeader ? 'ownerId' : 'targetUserId', '==', currentFirebaseUser.uid)
  );
  unsubServerAlerts = onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          ...data,
          time: formatTimeFromData(data.createdAt, 'Just now'),
          timestamp: timestampMillis(data.createdAt, 0),
        });
      });
      list.sort((a, b) => b.timestamp - a.timestamp);
      state.serverAlerts = list;
      renderMainWorkspace();
      if (state.inspectorTab === 'members') renderInspector();
      if (document.getElementById('server-admin-modal')?.classList.contains('open')) {
        renderAdminContent();
      }
    },
    () => {}
  );
}

function subscribeJoinedServers(uid) {
  if (unsubJoinedRefs) unsubJoinedRefs();
  if (!uid) return;

  unsubJoinedRefs = onSnapshot(
    collection(db, 'users', uid, 'joined_servers'),
    async (snap) => {
      const ids = new Set();
      snap.forEach((docSnap) => ids.add(docSnap.id));
      state.joinedServerIds = ids;

      for (const existingId of Array.from(joinedServersMap.keys())) {
        if (!ids.has(existingId)) joinedServersMap.delete(existingId);
      }

      await Promise.all(
        Array.from(ids).map(async (srvId) => {
          try {
            const srvSnap = await getDoc(doc(db, 'servers', srvId));
            if (srvSnap.exists()) {
              joinedServersMap.set(srvId, safeServerDoc(srvSnap.id, srvSnap.data()));
            } else {
              joinedServersMap.delete(srvId);
            }
          } catch {}
        })
      );

      mergeServersFromSnapshots();
    },
    () => {}
  );
}

function subscribePublicCatalog(uid) {
  if (unsubPublicCatalog) unsubPublicCatalog();
  if (!uid) return;

  unsubPublicCatalog = onSnapshot(
    query(collection(db, 'servers'), where('visibility', '==', 'public')),
    async (snap) => {
      const list = [];
      snap.forEach((docSnap) => list.push(safeServerDoc(docSnap.id, docSnap.data())));
      state.publicServers = list;

      // Refresh user's join request status for discovered public servers
      await Promise.all(
        list.slice(0, 30).map(async (srv) => {
          try {
            const reqSnap = await getDoc(doc(db, 'servers', srv.id, 'join_requests', uid));
            if (reqSnap.exists()) {
              state.myJoinRequests.set(srv.id, reqSnap.data());
            } else {
              state.myJoinRequests.delete(srv.id);
            }
          } catch {}
        })
      );

      if (state.activeView === 'discover') {
        renderMainWorkspace();
      }
    },
    () => {}
  );
}

function subscribeServerMembers(serverId) {
  if (unsubServerMembers) {
    unsubServerMembers();
    unsubServerMembers = null;
  }
  state.serverMemberIds = new Set();
  state.serverMembersMeta = new Map();
  if (!serverId) return;

  unsubServerMembers = onSnapshot(
    query(collection(db, 'servers', serverId, 'members'), where('role', 'in', ['owner', 'moderator', 'member'])),
    (snap) => {
      const nextIds = new Set();
      const meta = new Map();
      snap.forEach((docSnap) => {
        nextIds.add(docSnap.id);
        meta.set(docSnap.id, docSnap.data());
      });
      state.serverMemberIds = nextIds;
      state.serverMembersMeta = meta;
      rebuildMembersList();
      if (state.inspectorTab === 'members') renderInspector();
      if (document.getElementById('server-admin-modal')?.classList.contains('open')) {
        renderAdminContent();
      }
    },
    () => {}
  );
}

function subscribeJoinRequests(serverId) {
  if (unsubJoinRequests) {
    unsubJoinRequests();
    unsubJoinRequests = null;
  }
  state.serverJoinRequests = [];
  if (!serverId || !currentFirebaseUser) return;

  const q = query(collection(db, 'servers', serverId, 'join_requests'), where('ownerId', '==', currentFirebaseUser.uid));
  unsubJoinRequests = onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => timestampMillis(b.updatedAt, 0) - timestampMillis(a.updatedAt, 0));
      state.serverJoinRequests = list;
      if (document.getElementById('server-admin-modal')?.classList.contains('open')) {
        renderAdminContent();
      }
    },
    () => {}
  );
}

function subscribeServerEvents(serverId) {
  if (unsubServerEvents) {
    unsubServerEvents();
    unsubServerEvents = null;
  }
  state.serverEvents = [];
  if (!serverId) return;

  const q = query(collection(db, 'servers', serverId, 'events'), where('serverId', '==', serverId));
  unsubServerEvents = onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      state.serverEvents = list;
      if (state.inspectorTab === 'saved') renderInspector();
      if (document.getElementById('server-admin-modal')?.classList.contains('open')) {
        renderAdminContent();
      }
    },
    () => {}
  );
}

function rebuildMembersList() {
  const list = [profile];
  for (const u of state.directoryUsers) {
    if (u.id && u.id !== profile.id) {
      list.push(u);
    }
  }
  state.members = list;
}

function subscribeDirectoryUsers() {
  if (unsubDirectoryUsers) {
    unsubDirectoryUsers();
    unsubDirectoryUsers = null;
  }
  const q = query(
    collection(db, 'users'),
    where('status', 'in', ['online', 'idle', 'dnd', 'offline', 'invisible']),
    limit(250)
  );
  unsubDirectoryUsers = onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const userObj = {
          id: docSnap.id,
          displayName: d.displayName || 'Member',
          username: d.username || 'member',
          initials: d.initials || getInitials(d.displayName || 'MB'),
          avatar: d.avatar || '',
          coverPhoto: d.coverPhoto || '',
          bio: d.bio || '',
          status: d.status || 'online',
          customStatus: d.customStatus || '',
          accountPrivacy: d.accountPrivacy || 'everyone',
          verified: Boolean(d.verified),
          suspended: Boolean(d.suspended),
          followersCount: Number(d.followersCount || 0),
          followingCount: Number(d.followingCount || 0),
          postsCount: Number(d.postsCount || 0),
          roleId: docSnap.id === profile.id ? 'role-owner' : 'role-member',
        };
        directoryMap.set(docSnap.id, userObj);
        list.push(userObj);
      });
      state.directoryUsers = list;
      rebuildMembersList();

      state.dms = state.dms.map((dm) => {
        if (dm.type === 'group') {
          return {
            ...dm,
            name: dm.groupName || 'Group Chat',
            initials: getInitials(dm.groupName || 'GC'),
            topic: `Group chat · ${(dm.participants || []).length} members${dm.lastMessage ? ` · ${dm.lastMessage.slice(0, 45)}` : ''}`,
          };
        }
        if (!dm.participants) return dm;
        const other = resolveOtherParticipant(dm, profile.id, directoryMap);
        return {
          ...dm,
          userId: other.id,
          name: other.displayName,
          initials: other.initials,
          status: other.status,
          topic: dm.lastMessage ? `Direct chat · ${dm.lastMessage.slice(0, 60)}` : `Direct conversation with @${other.username}`,
        };
      });

      if (state.inspectorTab === 'members') renderInspector();
      if (state.activeView === 'home') renderSidebar();
      if (socialModule) socialModule.render();
      notifyInboxBridge();
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'users', { silent: true });
    }
  );
}

async function ensureUsersInDirectory(uids = []) {
  const missing = Array.from(new Set(uids)).filter(
    (uid) => uid && uid !== profile.id && !directoryMap.has(uid) && !pendingDirectoryFetches.has(uid)
  );
  if (missing.length === 0) return false;

  let updated = false;
  await Promise.all(
    missing.slice(0, 25).map((uid) => {
      const fetchPromise = getDoc(doc(db, 'users', uid))
        .then((snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          directoryMap.set(snap.id, {
            id: snap.id,
            displayName: d.displayName || 'Member',
            username: d.username || 'member',
            initials: d.initials || getInitials(d.displayName || 'MB'),
            avatar: d.avatar || '',
            coverPhoto: d.coverPhoto || '',
            bio: d.bio || '',
            status: d.status || 'offline',
            customStatus: d.customStatus || '',
            accountPrivacy: d.accountPrivacy || 'everyone',
            verified: Boolean(d.verified),
            suspended: Boolean(d.suspended),
            followersCount: Number(d.followersCount || 0),
            followingCount: Number(d.followingCount || 0),
            postsCount: Number(d.postsCount || 0),
            roleId: 'role-member',
          });
          updated = true;
        })
        .catch(() => {})
        .finally(() => {
          pendingDirectoryFetches.delete(uid);
        });
      pendingDirectoryFetches.set(uid, fetchPromise);
      return fetchPromise;
    })
  );

  if (updated) {
    rebuildMembersList();
    if (state.inspectorTab === 'members') renderInspector();
  }
  return updated;
}

function subscribeOwnProfile(uid) {
  if (unsubOwnProfile) {
    unsubOwnProfile();
    unsubOwnProfile = null;
  }
  if (!uid) return;

  unsubOwnProfile = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      Object.assign(profile, {
        id: snap.id,
        displayName: d.displayName || profile.displayName || 'Member',
        username: d.username || profile.username || 'member',
        initials: d.initials || getInitials(d.displayName || profile.displayName || 'MB'),
        avatar: typeof d.avatar === 'string' ? d.avatar : profile.avatar || '',
        coverPhoto: typeof d.coverPhoto === 'string' ? d.coverPhoto : profile.coverPhoto || '',
        bio: typeof d.bio === 'string' ? d.bio : profile.bio || '',
        status: d.status || profile.status || 'online',
        customStatus: typeof d.customStatus === 'string' ? d.customStatus : profile.customStatus || '',
        accountPrivacy: d.accountPrivacy || profile.accountPrivacy || 'everyone',
        verified: Boolean(d.verified),
        suspended: Boolean(d.suspended),
        followersCount: Math.max(0, Number(d.followersCount ?? profile.followersCount ?? 0)),
        followingCount: Math.max(0, Number(d.followingCount ?? profile.followingCount ?? 0)),
        postsCount: Math.max(0, Number(d.postsCount ?? profile.postsCount ?? 0)),
      });
      directoryMap.set(snap.id, { ...profile, roleId: 'role-owner' });
      rebuildMembersList();
      syncUnifiedHeaderBadges();
      renderRail();
      renderSidebar();
      if (state.inspectorTab === 'members') renderInspector();
      if (document.getElementById('settings-modal')?.classList.contains('open')) {
        renderUserSettingsContent();
      }
      if (socialModule) socialModule.render();
      notifyInboxBridge();
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${uid}`, { silent: true });
    }
  );
}

function subscribeConnectionRequests(uid) {
  if (unsubConnectionRequests) {
    unsubConnectionRequests();
    unsubConnectionRequests = null;
  }
  if (!uid) return;

  const q = query(collection(db, 'connection_requests'), where('participantIds', 'array-contains', uid));
  unsubConnectionRequests = onSnapshot(
    q,
    (snap) => {
      const list = [];
      const accepted = new Set();
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const item = { id: docSnap.id, ...d };
        list.push(item);
        if (d.status === 'accepted') {
          const otherId = d.fromUid === uid ? d.toUid : d.fromUid;
          if (otherId) accepted.add(otherId);
        }
      });
      state.connectionRequests = list;
      state.acceptedPeerIds = accepted;

      renderRail();
      if (state.activeView === 'home') {
        renderSidebar();
        renderMainWorkspace();
      }
      if (state.inspectorTab === 'members') renderInspector();
      notifyInboxBridge();
    },
    () => {}
  );
}

function subscribeBlocks(uid) {
  if (unsubBlocks) unsubBlocks();
  if (!uid) return;

  unsubBlocks = onSnapshot(
    collection(db, 'users', uid, 'blocks'),
    (snap) => {
      const list = [];
      const set = new Set();
      snap.forEach((docSnap) => {
        set.add(docSnap.id);
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      state.blockedUsers = list;
      state.blockedSet = set;
      if (state.inspectorTab === 'members') renderInspector();
      if (state.activeView === 'home') {
        renderSidebar();
        renderMainWorkspace();
      }
      if (document.getElementById('settings-modal')?.classList.contains('open')) {
        renderUserSettingsContent();
      }
      notifyInboxBridge();
    },
    () => {}
  );
}

function subscribeBookmarks(uid) {
  if (unsubBookmarks) unsubBookmarks();
  if (!uid) return;

  unsubBookmarks = onSnapshot(
    collection(db, 'users', uid, 'bookmarks'),
    (snap) => {
      const list = [];
      snap.forEach((docSnap) => list.push({ id: docSnap.id, ...docSnap.data() }));
      list.sort((a, b) => timestampMillis(b.createdAt, 0) - timestampMillis(a.createdAt, 0));
      state.bookmarks = list;
      if (state.inspectorTab === 'saved') renderInspector();
      if (socialModule) socialModule.render();
    },
    () => {}
  );
}

function subscribeMyInvites(uid) {
  if (unsubMyInvites) unsubMyInvites();
  if (!uid) return;

  const q = query(collection(db, 'invites'), where('ownerId', '==', uid));
  unsubMyInvites = onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach((docSnap) => list.push({ code: docSnap.id, ...docSnap.data() }));
      state.myInvites = list;
      if (document.getElementById('server-admin-modal')?.classList.contains('open')) {
        renderAdminContent();
      }
    },
    () => {}
  );
}

function mergeReports() {
  const merged = new Map([...reportsReporterMap, ...reportsOwnerMap]);
  state.reports = Array.from(merged.values()).sort(
    (a, b) => timestampMillis(b.createdAt, 0) - timestampMillis(a.createdAt, 0)
  );
  if (document.getElementById('server-admin-modal')?.classList.contains('open')) {
    renderAdminContent();
  }
}

function subscribeReports(uid) {
  if (unsubReportsReporter) unsubReportsReporter();
  if (unsubReportsOwner) unsubReportsOwner();
  if (!uid) return;

  unsubReportsReporter = onSnapshot(
    query(collection(db, 'reports'), where('reporterId', '==', uid)),
    (snap) => {
      reportsReporterMap.clear();
      snap.forEach((d) => reportsReporterMap.set(d.id, { id: d.id, ...d.data() }));
      mergeReports();
    },
    () => {}
  );

  unsubReportsOwner = onSnapshot(
    query(collection(db, 'reports'), where('serverOwnerId', '==', uid)),
    (snap) => {
      reportsOwnerMap.clear();
      snap.forEach((d) => reportsOwnerMap.set(d.id, { id: d.id, ...d.data() }));
      mergeReports();
    },
    () => {}
  );
}

function subscribeDmThreads(uid) {
  if (unsubDmThreads) {
    unsubDmThreads();
    unsubDmThreads = null;
  }
  if (!uid) return;

  const q = query(collection(db, 'dm_threads'), where('participants', 'array-contains', uid));
  unsubDmThreads = onSnapshot(
    q,
    (snap) => {
      state.dmError = '';
      const threads = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const isGroup = d.type === 'group';
        const other = isGroup ? null : resolveOtherParticipant(d, uid, directoryMap);
        threads.push({
          id: docSnap.id,
          type: isGroup ? 'group' : 'dm',
          groupName: d.groupName || '',
          participants: d.participants || [],
          participantMeta: d.participantMeta || {},
          archivedBy: Array.isArray(d.archivedBy) ? d.archivedBy : [],
          typing: d.typing && typeof d.typing === 'object' ? d.typing : {},
          createdBy: d.createdBy || '',
          userId: isGroup ? '' : other.id,
          username: isGroup ? '' : other.username,
          name: isGroup ? (d.groupName || 'Group Chat') : other.displayName,
          initials: isGroup ? getInitials(d.groupName || 'GC') : other.initials,
          status: isGroup ? 'group' : (other.status || 'offline'),
          lastMessage: d.lastMessage || '',
          lastSenderId: d.lastSenderId || '',
          seenBy: Array.isArray(d.seenBy) ? d.seenBy : [],
          updatedAtMs: timestampMillis(d.updatedAt, 0),
          topic: isGroup
            ? `Group chat · ${(d.participants || []).length} members${d.lastMessage ? ` · ${d.lastMessage.slice(0, 45)}` : ''}`
            : (d.lastMessage ? `Direct chat · @${other.username}` : `Direct conversation with @${other.username}`),
        });
      });
      threads.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      state.dms = threads;

      if (state.activeDmId && !state.dms.some((d) => d.id === state.activeDmId)) {
        state.activeDmId = state.dms[0]?.id || '';
      } else if (!state.activeDmId && state.dms.length > 0 && !state.pendingPeerId) {
        state.activeDmId = state.dms[0].id;
        subscribeDmMessages(state.activeDmId);
      }

      syncUnifiedHeaderBadges();
      if (state.activeView === 'home') {
        renderSidebar();
        renderMainWorkspace();
        renderDmTypingIndicator();
      }
      notifyInboxBridge();
    },
    (err) => {
      console.warn('DM threads subscription warning:', err?.message);
      state.dmError = 'Unable to sync conversations right now.';
      if (state.activeView === 'home') {
        renderSidebar();
        renderMainWorkspace();
      }
      notifyInboxBridge();
    }
  );
}

function subscribeDmMessages(threadId) {
  if (unsubDmMessages) {
    unsubDmMessages();
    unsubDmMessages = null;
  }
  if (!threadId || !currentFirebaseUser) {
    state.dmMessagesLoadingThreadId = '';
    notifyInboxBridge();
    return;
  }

  state.dmMessagesLoadingThreadId = threadId;
  state.dmError = '';

  const q = query(
    collection(db, 'dm_threads', threadId, 'messages'),
    where('threadId', '==', threadId),
    where('participantIds', 'array-contains', currentFirebaseUser.uid)
  );
  unsubDmMessages = onSnapshot(
    q,
    (snapshot) => {
      if (state.dmMessagesLoadingThreadId === threadId) {
        state.dmMessagesLoadingThreadId = '';
      }
      state.dmError = '';
      const rawMsgs = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const seenBy = Array.isArray(d.seenBy) ? d.seenBy : [];
        rawMsgs.push({
          id: docSnap.id,
          authorId: d.senderId || 'member',
          senderName: d.senderName || 'Member',
          senderInitials: d.senderInitials || getInitials(d.senderName || 'MB'),
          time: formatTimeFromData(d.createdAt, 'Just now'),
          timestamp: timestampMillis(d.createdAt, Date.now()),
          pinned: Boolean(d.pinned),
          edited: Boolean(d.edited),
          replyToId: d.replyToId || undefined,
          content: d.content || '',
          attachment: d.attachment || null,
          seenBy,
          reactions: Array.isArray(d.reactions) ? d.reactions : [],
          replies: [],
        });

        // Mark incoming DM messages seen when viewing Messages
        if (
          (socialModule?.getSection?.() === 'messages' || state.activeView === 'home') &&
          state.activeDmId === threadId &&
          d.senderId &&
          d.senderId !== currentFirebaseUser.uid &&
          !seenBy.includes(currentFirebaseUser.uid) &&
          !markedSeenIds.has(docSnap.id) &&
          seenBy.length < 30
        ) {
          markedSeenIds.add(docSnap.id);
          updateDoc(doc(db, 'dm_threads', threadId, 'messages', docSnap.id), {
            seenBy: [...seenBy, currentFirebaseUser.uid],
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      });
      rawMsgs.sort((a, b) => a.timestamp - b.timestamp);
      const byId = new Map(rawMsgs.map((m) => [m.id, m]));
      for (const m of rawMsgs) {
        if (m.replyToId && byId.has(m.replyToId)) {
          byId.get(m.replyToId).replies.push(m);
        }
      }
      state.dmMessages[threadId] = rawMsgs;
      syncUnifiedHeaderBadges();
      if (state.activeView === 'home') {
        renderDmSidebarList();
        if (state.activeDmId === threadId) {
          renderMainWorkspace();
          if (state.inspectorTab === 'thread') renderInspector();
        }
      }
      notifyInboxBridge();
    },
    (err) => {
      if (state.dmMessagesLoadingThreadId === threadId) {
        state.dmMessagesLoadingThreadId = '';
      }
      state.dmError = 'Could not load messages for this conversation.';
      console.warn('DM messages subscription warning:', err?.message);
      if (state.activeView === 'home' && state.activeDmId === threadId) {
        renderMainWorkspace();
      }
      notifyInboxBridge();
    }
  );
}

/* ---------- REQUEST-GATED DM & CALL FLOWS ---------- */

async function sendConnectionRequest(targetUserId, note = '') {
  if (!currentFirebaseUser || !targetUserId || targetUserId === currentFirebaseUser.uid) return false;
  if (state.blockedSet.has(targetUserId)) {
    showToast('Unblock this user in Settings before sending a request.');
    return false;
  }

  const target = getMember(targetUserId);
  const reqId = getConnectionRequestId(currentFirebaseUser.uid, targetUserId);
  const participants = [currentFirebaseUser.uid, targetUserId].sort();
  const reqRef = doc(db, 'connection_requests', reqId);

  try {
    const existingSnap = await getDoc(reqRef);
    const payload = {
      id: reqId,
      fromUid: currentFirebaseUser.uid,
      fromName: profile.displayName.slice(0, 80),
      fromInitials: profile.initials.slice(0, 16),
      toUid: targetUserId,
      toName: String(target.displayName || 'Member').slice(0, 80),
      toInitials: String(target.initials || 'MB').slice(0, 16),
      participantIds: participants,
      status: 'pending',
      note: String(note || 'Would like to chat and connect on NEXORA.').slice(0, 240),
      updatedAt: serverTimestamp(),
    };

    if (!existingSnap.exists()) {
      await setDoc(reqRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      const prev = existingSnap.data();
      if (prev.status === 'accepted') {
        await openDirectMessageWithUser(targetUserId);
        return true;
      }
      if (prev.status === 'pending') {
        showToast(prev.toUid === currentFirebaseUser.uid ? 'This user sent you a request — accept it to chat.' : 'Chat request is already pending.');
        return true;
      }
      await updateDoc(reqRef, {
        fromUid: payload.fromUid,
        fromName: payload.fromName,
        fromInitials: payload.fromInitials,
        toUid: payload.toUid,
        toName: payload.toName,
        toInitials: payload.toInitials,
        status: 'pending',
        note: payload.note,
        updatedAt: serverTimestamp(),
      });
    }
    showToast(`Chat request sent to ${target.displayName}`);
    return true;
  } catch (err) {
    showToast('Could not send chat request. The user may have restricted requests.');
    console.warn('Connection request error:', err?.message);
    return false;
  }
}

async function respondConnectionRequest(reqId, accept, fromUid) {
  if (!currentFirebaseUser || !reqId) return;
  try {
    await updateDoc(doc(db, 'connection_requests', reqId), {
      status: accept ? 'accepted' : 'declined',
      updatedAt: serverTimestamp(),
    });
    if (accept && fromUid) {
      state.acceptedPeerIds.add(fromUid);
      await openDirectMessageWithUser(fromUid);
      showToast('Chat request accepted — 1-on-1 chat and live calls unlocked');
    } else {
      showToast('Chat request declined');
      renderAll();
    }
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `connection_requests/${reqId}`,
      'Site is busy right now. Could not update request.'
    );
  }
}

async function ensureDmThreadWithUser(targetUserId) {
  if (!currentFirebaseUser || !targetUserId || targetUserId === currentFirebaseUser.uid) return null;
  if (!canOpenDmWithUser(currentFirebaseUser.uid, targetUserId, state.acceptedPeerIds, state.blockedSet)) {
    return null;
  }

  const threadId = getDmThreadId(currentFirebaseUser.uid, targetUserId);
  if (!threadId) return null;

  const other = getMember(targetUserId);
  const participants = [currentFirebaseUser.uid, targetUserId].sort();
  const threadRef = doc(db, 'dm_threads', threadId);

  try {
    const snap = await getDoc(threadRef);
    if (!snap.exists()) {
      await setDoc(threadRef, {
        id: threadId,
        participants,
        participantMeta: {
          [currentFirebaseUser.uid]: {
            displayName: profile.displayName.slice(0, 80),
            username: profile.username.slice(0, 50),
            initials: profile.initials.slice(0, 16),
          },
          [targetUserId]: {
            displayName: String(other.displayName || 'Member').slice(0, 80),
            username: String(other.username || 'member').slice(0, 50),
            initials: String(other.initials || 'MB').slice(0, 16),
          },
        },
        lastMessage: '',
        createdBy: currentFirebaseUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return { threadId, other, participants };
  } catch (err) {
    showToast('Could not open direct message thread.');
    console.error('DM thread open error:', err);
    return null;
  }
}

async function openDirectMessageWithUser(targetUserId) {
  if (!currentFirebaseUser || !targetUserId || targetUserId === currentFirebaseUser.uid) return;

  if (state.blockedSet.has(targetUserId)) {
    showToast('Unblock this user in Settings before starting a conversation.');
    return;
  }

  const isAccepted = canOpenDmWithUser(currentFirebaseUser.uid, targetUserId, state.acceptedPeerIds, state.blockedSet);
  if (!isAccepted) {
    state.activeView = 'home';
    state.pendingPeerId = targetUserId;
    state.activeDmId = '';
    state.dmThreadActiveMobile = true;
    saveUiNav();
    closePopover();
    closeAllModals();
    renderAll();
    return;
  }

  const res = await ensureDmThreadWithUser(targetUserId);
  if (!res) return;

  state.pendingPeerId = '';
  if (!state.dms.some((d) => d.id === res.threadId)) {
    state.dms.push({
      id: res.threadId,
      participants: res.participants,
      userId: res.other.id,
      name: res.other.displayName,
      initials: res.other.initials,
      status: res.other.status || 'online',
      lastMessage: '',
      updatedAtMs: Date.now(),
      topic: `Direct conversation with @${res.other.username}`,
    });
  }

  state.activeView = 'home';
  state.activeDmId = res.threadId;
  state.dmThreadActiveMobile = true;
  state.searchQuery = '';
  saveUiNav();
  subscribeDmMessages(res.threadId);
  closePopover();
  closeAllModals();
  if (socialModule && socialModule.getSection() !== 'messages') {
    socialModule.navigateTo('messages', { dmId: res.threadId });
  } else {
    renderAll();
  }
  document.getElementById('message-input')?.focus();
}

async function startDmCallWithUser(targetUserId, mode = 'audio') {
  if (!canOpenDmWithUser(currentFirebaseUser?.uid, targetUserId, state.acceptedPeerIds, state.blockedSet)) {
    await openDirectMessageWithUser(targetUserId);
    showToast('Send and accept a chat request before starting a live call.');
    return;
  }
  const res = await ensureDmThreadWithUser(targetUserId);
  if (!res) return;
  if (!state.dms.some((d) => d.id === res.threadId)) {
    state.dms.push({
      id: res.threadId,
      participants: res.participants,
      userId: res.other.id,
      name: res.other.displayName,
      initials: res.other.initials,
      status: res.other.status || 'online',
      topic: `Direct conversation with @${res.other.username}`,
    });
  }
  subscribeDmMessages(res.threadId);
  closePopover();
  closeAllModals();
  const callId = getRoomCallId('dm', res.threadId);
  const joined = await rtc.joinCall({
    callId,
    kind: 'dm',
    targetId: res.threadId,
    title: res.other.displayName,
    currentUserProfile: profile,
    targetPeerProfile: res.other,
    withVideo: mode === 'video',
    withScreen: mode === 'screen',
    muted: prefs.muted,
    deafened: prefs.deafened,
  });
  if (joined) {
    ensureCallTab().openCallTab();
  }
}

async function joinServerByInviteInput(rawInvite) {
  if (!currentFirebaseUser) return false;
  const code = sanitizeInviteCode(rawInvite);
  if (!code) return false;
  window.location.assign(`/welcome.html?invite=${encodeURIComponent(code)}`);
  return true;
}

function subscribeChannels(serverId) {
  if (unsubChannels) {
    unsubChannels();
    unsubChannels = null;
  }
  if (!serverId) return;

  const q = query(collection(db, 'servers', serverId, 'channels'), where('serverId', '==', serverId));
  unsubChannels = onSnapshot(
    q,
    (snapshot) => {
      const next = {};
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        next[docSnap.id] = { ...d, id: docSnap.id, unread: 0 };
      });
      state.channels = next;

      const srv = getActiveServer();
      if (!state.activeChannelId || !state.channels[state.activeChannelId]) {
        state.activeChannelId =
          (srv && srv.defaultChannelId && state.channels[srv.defaultChannelId]?.id) ||
          Object.keys(state.channels)[0] ||
          '';
      }

      if (state.activeChannelId) {
        subscribeMessages(serverId, state.activeChannelId);
      }
      renderAll();
    },
    (error) => {
      notifyUser(formatFriendlyError(error, 'Site is busy right now. Channels will sync shortly.'), 'busy');
    }
  );
}

function subscribeMessages(serverId, channelId) {
  if (unsubMessages) {
    unsubMessages();
    unsubMessages = null;
  }
  if (!serverId || !channelId) return;

  const q = query(
    collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
    where('channelId', '==', channelId)
  );
  unsubMessages = onSnapshot(
    q,
    (snapshot) => {
      const rawMsgs = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        rawMsgs.push({
          id: docSnap.id,
          authorId: d.senderId || 'member',
          senderName: d.senderName || 'Member',
          senderInitials: d.senderInitials || getInitials(d.senderName || 'MB'),
          time: formatTimeFromData(d.createdAt, 'Just now'),
          timestamp: timestampMillis(d.createdAt, Date.now()),
          pinned: Boolean(d.pinned),
          edited: Boolean(d.edited),
          replyToId: d.replyToId || undefined,
          content: d.content || '',
          attachment: d.attachment || null,
          reactions: Array.isArray(d.reactions) ? d.reactions : [],
          poll: d.poll || null,
          replies: [],
        });
      });

      rawMsgs.sort((a, b) => a.timestamp - b.timestamp);

      const byId = new Map(rawMsgs.map((m) => [m.id, m]));
      for (const m of rawMsgs) {
        if (m.replyToId && byId.has(m.replyToId)) {
          byId.get(m.replyToId).replies.push(m);
        }
      }

      state.messages[channelId] = rawMsgs;
      renderMainWorkspace();
      if (state.inspectorTab === 'thread') renderInspector();
    },
    (error) => {
      notifyUser(formatFriendlyError(error, 'Site is busy right now. Messages will sync shortly.'), 'busy');
    }
  );
}

function subscribeModLogs(serverId) {
  if (unsubModLogs) {
    unsubModLogs();
    unsubModLogs = null;
  }
  if (!serverId || !currentFirebaseUser) return;

  const q = query(collection(db, 'servers', serverId, 'moderation_logs'), where('ownerId', '==', currentFirebaseUser.uid));
  unsubModLogs = onSnapshot(
    q,
    (snapshot) => {
      const logs = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        logs.push({
          id: docSnap.id,
          actor: d.actorName || 'Moderator',
          action: d.action || '',
          time: formatTimeFromData(d.createdAt, 'Now'),
          timestamp: timestampMillis(d.createdAt, 0),
        });
      });
      logs.sort((a, b) => b.timestamp - a.timestamp);
      const target = state.servers.find((s) => s.id === serverId);
      if (target) target.auditLog = logs;
      if (document.getElementById('server-admin-modal')?.classList.contains('open')) {
        renderAdminContent();
      }
    },
    () => {}
  );
}

function subscribeUserNotifications(uid) {
  if (unsubNotifs) {
    unsubNotifs();
    unsubNotifs = null;
  }
  unsubNotifs = onSnapshot(
    collection(db, 'users', uid, 'notifications'),
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: docSnap.id,
          category: d.category || 'social',
          targetId: d.targetId || '',
          senderId: d.senderId || '',
          title: d.title || 'Notification',
          body: d.body || '',
          unread: Boolean(d.unread),
          time: formatTimeFromData(d.createdAt, 'Recent'),
          timestamp: timestampMillis(d.createdAt, 0),
        });
      });
      items.sort((a, b) => b.timestamp - a.timestamp);
      state.notifications = items;
      renderRail();
      syncUnifiedHeaderBadges();
      if (socialModule) socialModule.render();
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/notifications`, { silent: true });
    }
  );
}

function cleanupAllListeners() {
  const unsubs = [
    unsubOwnProfile,
    unsubJoinedRefs,
    unsubServersOwned,
    unsubPublicCatalog,
    unsubChannels,
    unsubMessages,
    unsubServerMembers,
    unsubJoinRequests,
    unsubServerEvents,
    unsubDirectoryUsers,
    unsubDmThreads,
    unsubDmMessages,
    unsubConnectionRequests,
    unsubBlocks,
    unsubBookmarks,
    unsubMyInvites,
    unsubReportsReporter,
    unsubReportsOwner,
    unsubNotifs,
    unsubModLogs,
    unsubServerAlerts,
  ];
  for (const fn of unsubs) {
    if (typeof fn === 'function') {
      try { fn(); } catch {}
    }
  }
  unsubOwnProfile = null;
  unsubJoinedRefs = null;
  unsubServersOwned = null;
  unsubPublicCatalog = null;
  unsubChannels = null;
  unsubMessages = null;
  unsubServerMembers = null;
  unsubJoinRequests = null;
  unsubServerEvents = null;
  unsubDirectoryUsers = null;
  unsubDmThreads = null;
  unsubDmMessages = null;
  unsubConnectionRequests = null;
  unsubBlocks = null;
  unsubBookmarks = null;
  unsubMyInvites = null;
  unsubReportsReporter = null;
  unsubReportsOwner = null;
  unsubNotifs = null;
  unsubModLogs = null;
  unsubServerAlerts = null;

  joinedServersMap.clear();
  ownedServersMap.clear();
  directoryMap.clear();
  pendingDirectoryFetches.clear();
  reportsReporterMap.clear();
  reportsOwnerMap.clear();
  state.servers = [];
  state.joinedServerIds = new Set();
  state.publicServers = [];
  state.myJoinRequests = new Map();
  state.serverJoinRequests = [];
  state.serverEvents = [];
  state.serverAlerts = [];
  state.channels = {};
  state.messages = {};
  state.dmMessages = {};
  state.dms = [];
  state.connectionRequests = [];
  state.acceptedPeerIds = new Set();
  state.blockedUsers = [];
  state.blockedSet = new Set();
  state.bookmarks = [];
  state.myInvites = [];
  state.reports = [];
  state.directoryUsers = [];
  state.notifications = [];
  state.onlineUids = new Set();
  state.wsTypingMap = {};
  state.wsConnected = false;
  if (nexoraWsClient) {
    nexoraWsClient.disconnect();
    nexoraWsClient = null;
  }
  if (callTab) callTab.destroy();
  if (socialModule) socialModule.cleanup();
  notifyInboxBridge();
}

function ensureSocialModule() {
  if (socialModule) return socialModule;
  socialModule = createSocialModule({
    state,
    profile,
    prefs,
    directoryMap,
    ensureUsersInDirectory,
    rtc,
    showToast,
    escapeHtml,
    openModal,
    closeAllModals,
    openPopoverNear,
    closePopover,
    navigateToLegacyMode: (section, opts = {}) => {
      const legacyEl = document.getElementById('nx-legacy-workspace');
      if (section === 'messages') {
        state.activeView = 'home';
        prefs.inspectorCollapsed = true;
        applyPrefsToDom();
        if (legacyEl) legacyEl.setAttribute('data-workspace-mode', 'messages');
        if (opts.dmId) {
          state.activeDmId = opts.dmId;
          state.pendingPeerId = '';
          state.dmThreadActiveMobile = true;
          subscribeDmMessages(opts.dmId);
        } else {
          state.dmThreadActiveMobile = false;
          if (state.activeDmId) {
            subscribeDmMessages(state.activeDmId);
          }
        }
      } else if (section === 'communities') {
        state.dmThreadActiveMobile = false;
        if (legacyEl) legacyEl.setAttribute('data-workspace-mode', 'communities');
        if (opts.discover) {
          state.activeView = 'discover';
        } else {
          state.activeView = state.servers.length > 0 ? 'server' : 'discover';
          const srv = getActiveServer();
          if (srv && !state.activeServerId) {
            state.activeServerId = srv.id;
            state.activeChannelId = srv.defaultChannelId || '';
            subscribeServerResources(srv);
          }
        }
      }
      saveUiNav();
      renderAll();
      notifyInboxBridge();
    },
    openDirectMessageWithUser,
    startDmCallWithUser,
    applyPrefsToDom,
    savePrefs,
    getRtcState: () => rtcState,
  });
  return socialModule;
}

async function initWorkspaceForUser(fbUser, loadedProfile) {
  cleanupAllListeners();
  currentFirebaseUser = fbUser;

  Object.assign(profile, {
    id: fbUser.uid,
    displayName: loadedProfile?.displayName || fbUser.displayName || 'Member',
    username: loadedProfile?.username || sanitizeHandle(fbUser.email?.split('@')[0] || fbUser.displayName || 'member', fbUser.uid),
    initials: loadedProfile?.initials || getInitials(loadedProfile?.displayName || fbUser.displayName || 'MB'),
    avatar: loadedProfile?.avatar || fbUser.photoURL || '',
    coverPhoto: loadedProfile?.coverPhoto || '',
    email: fbUser.email || '',
    phoneNumber: fbUser.phoneNumber || '',
    emailVerified: Boolean(fbUser.emailVerified),
    status: loadedProfile?.status || 'online',
    customStatus: loadedProfile?.customStatus || '',
    bio: loadedProfile?.bio || '',
    accountPrivacy: loadedProfile?.accountPrivacy || 'everyone',
    verified: Boolean(loadedProfile?.verified),
    suspended: Boolean(loadedProfile?.suspended),
    followersCount: Math.max(0, Number(loadedProfile?.followersCount || 0)),
    followingCount: Math.max(0, Number(loadedProfile?.followingCount || 0)),
    postsCount: Math.max(0, Number(loadedProfile?.postsCount || 0)),
    roleId: 'role-owner',
  });

  state.members = [profile];

  if (unsubServersOwned) unsubServersOwned();
  unsubServersOwned = onSnapshot(
    query(collection(db, 'servers'), where('ownerId', '==', fbUser.uid)),
    (snap) => {
      ownedServersMap.clear();
      snap.forEach((docSnap) => ownedServersMap.set(docSnap.id, safeServerDoc(docSnap.id, docSnap.data())));
      mergeServersFromSnapshots();
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'servers', { silent: true });
    }
  );

  subscribeOwnProfile(fbUser.uid);
  subscribeJoinedServers(fbUser.uid);
  subscribePublicCatalog(fbUser.uid);
  subscribeDirectoryUsers();
  subscribeConnectionRequests(fbUser.uid);
  subscribeBlocks(fbUser.uid);
  subscribeBookmarks(fbUser.uid);
  subscribeMyInvites(fbUser.uid);
  subscribeReports(fbUser.uid);
  subscribeDmThreads(fbUser.uid);
  subscribeUserNotifications(fbUser.uid);
  rtc.initGlobalCallListener(fbUser.uid);
  ensureCallTab().bindEvents();
  connectNexoraWs(fbUser);

  const social = ensureSocialModule();
  social.subscribeAll(fbUser);

  const savedNav = loadUiNav();
  if (savedNav?.collapsedCategories) {
    state.collapsedCategories = savedNav.collapsedCategories;
  }

  let requestedServerMode = false;

  // Handle ?invite=CODE -> route to welcome screen or ?server=ID -> select community
  try {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('invite');
    if (inviteCode) {
      window.location.replace(`/welcome.html?invite=${encodeURIComponent(inviteCode)}`);
      return;
    }
    const targetServerId = params.get('server');
    if (targetServerId) {
      requestedServerMode = true;
      state.activeView = 'server';
      state.activeServerId = targetServerId;
      const srvSnap = await getDoc(doc(db, 'servers', targetServerId));
      if (srvSnap.exists()) {
        const srv = safeServerDoc(srvSnap.id, srvSnap.data());
        if (srv.ownerId !== fbUser.uid) {
          joinedServersMap.set(srv.id, srv);
        }
        state.activeChannelId = srv.defaultChannelId || '';
        mergeServersFromSnapshots();
        subscribeServerResources(srv);
      }
    }
  } catch {}

  renderAll();
  const initialHash = typeof window !== 'undefined' ? window.location.hash || '' : '';
  const initialSection = requestedServerMode
    ? 'communities'
    : initialHash.startsWith('#template')
      ? 'templates'
      : 'home';
  if (initialSection === 'templates') {
    social.handleTemplateDeepLink(initialHash);
  }
  social.navigateTo(initialSection);
  const shell = document.getElementById('app-shell');
  if (shell) shell.hidden = false;
  const gate = document.getElementById('auth-loading-gate');
  if (gate) gate.hidden = true;
}

/* ---------- RENDER FUNCTIONS ---------- */

function renderIncomingCallBanner() {
  const banner = document.getElementById('incoming-call-banner');
  if (!banner) return;
  const inc = rtcState.incomingCall;
  if (!inc || (rtcState.activeCall && rtcState.activeCall.id === inc.id)) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  const callerLabel = escapeHtml(inc.callerName || 'Member');
  const modeLabel = inc.mode === 'screen' ? 'Screen Share Call' : inc.mode === 'video' ? 'Video Call' : 'Audio Call';
  banner.hidden = false;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <strong style="display:block;font-size:0.95rem;">Incoming ${modeLabel}</strong>
        <span class="member-sub" style="color:#b8c7e0;">${callerLabel} is calling you live</span>
      </div>
      <span class="call-pulse-ring" aria-hidden="true"></span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="btn btn-primary" data-action="answer-incoming-call" data-call-mode="audio" style="flex:1;">${svgIcon('phone', 14)} <span>Answer Audio</span></button>
      <button type="button" class="btn btn-secondary" data-action="answer-incoming-call" data-call-mode="video" style="flex:1;">${svgIcon('video', 14)} <span>Video</span></button>
      <button type="button" class="btn btn-danger" data-action="decline-incoming-call">${svgIcon('close', 14)} <span>Decline</span></button>
    </div>
  `;
}

function renderRail() {
  const listEl = document.getElementById('rail-servers-list');
  if (!listEl) return;

  listEl.innerHTML = state.servers
    .map((srv) => {
      const isActive = state.activeView === 'server' && state.activeServerId === srv.id;
      return `
        <div class="rail-item ${isActive ? 'active' : ''}">
          <button
            type="button"
            class="rail-btn"
            data-action="select-server"
            data-server-id="${escapeHtml(srv.id)}"
            aria-label="${escapeHtml(srv.name)}"
            title="${escapeHtml(srv.name)}"
          >${escapeHtml(srv.glyph || getInitials(srv.name))}</button>
        </div>
      `;
    })
    .join('');

  const homeItem = document.querySelector('[data-rail-view="home"]');
  const discItem = document.querySelector('[data-rail-view="discover"]');
  if (homeItem) homeItem.classList.toggle('active', state.activeView === 'home');
  if (discItem) discItem.classList.toggle('active', state.activeView === 'discover');

  const pendingIncomingCount = state.connectionRequests.filter(
    (r) => r.status === 'pending' && r.toUid === profile.id
  ).length;
  const homeBadge = document.getElementById('home-req-badge');
  if (homeBadge) {
    homeBadge.textContent = String(pendingIncomingCount);
    homeBadge.style.display = pendingIncomingCount > 0 ? 'grid' : 'none';
  }

  const unreadNotifs = state.notifications.filter((n) => n.unread).length;
  const badge = document.getElementById('notif-badge');
  if (badge) {
    badge.textContent = String(unreadNotifs);
    badge.style.display = unreadNotifs > 0 ? 'grid' : 'none';
  }
}

function renderDmTypingIndicator() {
  const el = document.getElementById('dm-typing-indicator');
  if (!el) return;
  if (state.activeView !== 'home' || state.pendingPeerId || !state.activeDmId) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  const activeDm = state.dms.find((d) => d.id === state.activeDmId);
  const now = Date.now();
  const fsTypers = activeDm?.typing
    ? Object.entries(activeDm.typing)
        .filter(([uid, ts]) => uid !== profile.id && now - Number(ts || 0) < 5500)
        .map(([uid]) => uid)
    : [];
  const wsTypersMap = state.wsTypingMap[state.activeDmId] || {};
  const wsTypers = Object.entries(wsTypersMap)
    .filter(([uid, exp]) => uid !== profile.id && Number(exp || 0) > now)
    .map(([uid]) => uid);
  const activeTypers = Array.from(new Set([...fsTypers, ...wsTypers])).map((uid) => getMember(uid).displayName);
  if (activeTypers.length === 0) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent =
    activeTypers.length === 1
      ? `${activeTypers[0]} is typing...`
      : `${activeTypers.slice(0, 2).join(', ')} are typing...`;
}

function updateComposerAttachmentBar() {
  const bar = document.getElementById('composer-attachment-bar');
  const label = document.getElementById('composer-attachment-label');
  if (!bar || !label) return;
  if (!pendingMessageAttachment) {
    bar.hidden = true;
    label.textContent = 'Attachment ready';
    return;
  }
  bar.hidden = false;
  label.textContent = `Attachment: ${pendingMessageAttachment.name} (${formatFileSize(pendingMessageAttachment.size || 0)})`;
}

function renderDmSidebarList() {
  const listEl = document.getElementById('dm-sidebar-list');
  if (!listEl) return;

  const dmClearBtn = document.getElementById('dm-search-clear-btn');
  if (dmClearBtn) {
    dmClearBtn.hidden = !state.dmSearchQuery.trim();
  }

  const q = state.dmSearchQuery.trim().toLowerCase();
  const isArchived = (dm) => Array.isArray(dm.archivedBy) && dm.archivedBy.includes(profile.id);
  const archivedCount = state.dms.filter((dm) => {
    if (dm.userId && state.blockedSet.has(dm.userId)) return false;
    return isArchived(dm);
  }).length;

  const unarchivedDms = state.dms.filter((dm) => {
    if (dm.userId && state.blockedSet.has(dm.userId)) return false;
    return state.showArchivedDms || !isArchived(dm);
  });

  const unreadCountMap = new Map();
  let totalUnreadThreads = 0;
  for (const dm of unarchivedDms) {
    const cnt = getDmUnreadCount(dm, state.dmMessages[dm.id] || [], profile.id);
    unreadCountMap.set(dm.id, cnt);
    if (cnt > 0) totalUnreadThreads += 1;
  }

  const visibleDms = unarchivedDms.filter((dm) => {
    if (!q) return true;
    const peer = dm.userId ? getMember(dm.userId) : null;
    return (
      String(dm.name || '').toLowerCase().includes(q) ||
      String(dm.topic || '').toLowerCase().includes(q) ||
      String(dm.lastMessage || '').toLowerCase().includes(q) ||
      String(peer?.username || '').toLowerCase().includes(q)
    );
  });

  const incomingPending = state.connectionRequests.filter(
    (r) => r.status === 'pending' && r.toUid === profile.id && !state.blockedSet.has(r.fromUid)
  );
  const outgoingPending = state.connectionRequests.filter(
    (r) => r.status === 'pending' && r.fromUid === profile.id && !state.blockedSet.has(r.toUid)
  );

  const existingPeerIds = new Set(state.dms.filter((d) => d.userId).map((d) => d.userId));
  const matchedUsers = filterDirectoryUsers(state.directoryUsers, q, {
    excludeUid: profile.id,
    blockedSet: state.blockedSet,
    respectPrivacy: true,
    limit: 25,
  }).filter((u) => !existingPeerIds.has(u.id));

  const renderDmRow = (dm) => {
    const active = state.activeDmId === dm.id && !state.pendingPeerId;
    const archived = isArchived(dm);
    const cachedMsgs = state.dmMessages[dm.id] || [];
    const latestMsg = cachedMsgs.length > 0 ? cachedMsgs[cachedMsgs.length - 1] : null;
    const peer = dm.userId ? getMember(dm.userId) : null;
    const unreadCount = unreadCountMap.get(dm.id) || 0;
    const isUnread = unreadCount > 0;
    const isOnline = dm.type !== 'group' && (state.onlineUids.has(dm.userId) || (peer?.status || dm.status) === 'online');

    let previewText = '';
    if (latestMsg) {
      const prefix = latestMsg.authorId === profile.id ? 'You: ' : '';
      previewText = `${prefix}${latestMsg.content || (latestMsg.attachment ? `Sent ${latestMsg.attachment.name || 'an attachment'}` : 'Message')}`;
    } else if (dm.lastMessage) {
      const prefix = dm.lastSenderId === profile.id ? 'You: ' : '';
      previewText = `${prefix}${dm.lastMessage}`;
    } else if (dm.type === 'group') {
      previewText = `${(dm.participants || []).length} members`;
    } else {
      previewText = peer?.username ? `@${peer.username}` : 'Tap to message';
    }

    const timeLabel = latestMsg?.timestamp
      ? formatRelativeTime(latestMsg.timestamp)
      : dm.updatedAtMs
        ? formatRelativeTime(dm.updatedAtMs)
        : '';

    const avatarHtml =
      dm.type === 'group'
        ? `<span class="nx-dm-group-avatar" aria-hidden="true">${svgIcon('users', 17)}</span>`
        : `<span class="nx-dm-avatar-wrap">${renderUserAvatarHtml(peer || { displayName: dm.name, initials: dm.initials }, 40)}${isOnline ? '<span class="nx-online-dot online" aria-label="Online"></span>' : ''}</span>`;

    const handleOrRole = dm.type === 'group' ? `${(dm.participants || []).length}` : peer?.username ? `@${peer.username}` : '';

    return `
      <div class="nx-dm-row-wrap ${active ? 'active' : ''} ${isUnread ? 'is-unread' : ''}">
        <button type="button" class="nx-dm-row ${active ? 'active' : ''}" data-action="select-dm" data-dm-id="${escapeHtml(dm.id)}">
          ${avatarHtml}
          <span class="nx-dm-row-body">
            <span class="nx-dm-row-top">
              <span class="nx-dm-row-name-wrap">
                <span class="nx-dm-row-name">${escapeHtml(dm.name)}</span>
                ${handleOrRole && dm.type === 'dm' ? `<span class="nx-dm-row-handle">${escapeHtml(handleOrRole)}</span>` : ''}
              </span>
              ${timeLabel ? `<span class="nx-dm-row-time">${escapeHtml(timeLabel)}</span>` : ''}
            </span>
            <span class="nx-dm-row-bottom">
              <span class="nx-dm-row-preview">${escapeHtml(previewText)}</span>
              ${unreadCount > 0 ? `<span class="nx-dm-unread-count" aria-label="${unreadCount} unread">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
            </span>
          </span>
        </button>
        <button type="button" class="icon-btn nx-dm-archive-btn" data-action="toggle-archive-dm" data-dm-id="${escapeHtml(dm.id)}" title="${archived ? 'Unarchive conversation' : 'Archive conversation'}" aria-label="${archived ? 'Unarchive conversation' : 'Archive conversation'}">
          ${svgIcon(archived ? 'bookmarkFilled' : 'bookmark', 12)}
        </button>
      </div>
    `;
  };

  let activeTab = 'all';
  if (state.dmInboxTab === 'unread') activeTab = 'unread';
  else if (state.dmInboxTab === 'requests') activeTab = 'requests';
  else if (state.dmInboxTab === 'groups') activeTab = 'groups';

  const unreadDms = visibleDms.filter((d) => (unreadCountMap.get(d.id) || 0) > 0);
  const reqCount = incomingPending.length + outgoingPending.length;

  const renderRequestsSection = () => `
    ${
      incomingPending.length > 0
        ? `<div class="nx-dm-section">
            <div class="nx-dm-section-label">Incoming Requests (${incomingPending.length})</div>
            <div class="nx-dm-list-stack">
              ${incomingPending
                .map((r) => {
                  const sender = getMember(r.fromUid);
                  return `
                  <div class="nx-dm-request-card">
                    ${renderUserAvatarHtml(sender || { displayName: r.fromName, initials: getInitials(r.fromName || 'MB') }, 36)}
                    <div class="nx-dm-request-meta">
                      <strong>${escapeHtml(r.fromName || 'Member')}</strong>
                      <span>Wants to message &amp; call</span>
                    </div>
                    <div class="nx-dm-request-actions">
                      <button type="button" class="icon-btn nx-dm-accept-btn" data-action="accept-conn-req" data-req-id="${escapeHtml(r.id)}" data-from-uid="${escapeHtml(r.fromUid)}" title="Accept" aria-label="Accept request">${svgIcon('check', 14)}</button>
                      <button type="button" class="icon-btn nx-dm-decline-btn" data-action="decline-conn-req" data-req-id="${escapeHtml(r.id)}" title="Decline" aria-label="Decline request">${svgIcon('close', 14)}</button>
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>`
        : ''
    }
    ${
      outgoingPending.length > 0
        ? `<div class="nx-dm-section">
            <div class="nx-dm-section-label">Pending Sent (${outgoingPending.length})</div>
            <div class="nx-dm-list-stack">
              ${outgoingPending
                .map((r) => {
                  const target = getMember(r.toUid);
                  return `
                  <button type="button" class="nx-dm-row" data-action="start-dm" data-user-id="${escapeHtml(r.toUid)}">
                    ${renderUserAvatarHtml(target || { displayName: r.toName, initials: getInitials(r.toName || 'MB') }, 38)}
                    <span class="nx-dm-row-body">
                      <span class="nx-dm-row-top">
                        <span class="nx-dm-row-name">${escapeHtml(r.toName || 'Member')}</span>
                        <span class="nx-dm-row-time">Pending</span>
                      </span>
                      <span class="nx-dm-row-preview">Awaiting approval</span>
                    </span>
                  </button>
                `;
                })
                .join('')}
            </div>
          </div>`
        : ''
    }
  `;

  const renderPeopleDiscovery = (maxUsers = 10) =>
    matchedUsers.length > 0
      ? `<div class="nx-dm-section">
          <div class="nx-dm-section-label">People on NEXORA (${matchedUsers.length})</div>
          <div class="nx-dm-list-stack">
            ${matchedUsers
              .slice(0, maxUsers)
              .map(
                (u) => `
                <button type="button" class="nx-dm-row" data-action="start-dm" data-user-id="${escapeHtml(u.id)}">
                  ${renderUserAvatarHtml(u, 38)}
                  <span class="nx-dm-row-body">
                    <span class="nx-dm-row-top">
                      <span class="nx-dm-row-name">${escapeHtml(u.displayName)}</span>
                      <span class="nx-dm-row-time">Connect</span>
                    </span>
                    <span class="nx-dm-row-preview">@${escapeHtml(u.username)}</span>
                  </span>
                </button>
              `
              )
              .join('')}
          </div>
        </div>`
      : '';

  const errorBannerHtml = state.dmError
    ? `<div class="nx-dm-error-banner" role="alert">
        <span>${escapeHtml(state.dmError)}</span>
        <button type="button" class="btn btn-secondary" style="height:26px;font-size:0.74rem;padding:0 9px;" data-action="retry-dm-sync">Retry</button>
      </div>`
    : '';

  let bodyHtml = '';
  if (q) {
    bodyHtml = `
      ${
        visibleDms.length > 0
          ? `<div class="nx-dm-section">
              <div class="nx-dm-section-label">Conversations (${visibleDms.length})</div>
              <div class="nx-dm-list-stack">${visibleDms.map(renderDmRow).join('')}</div>
            </div>`
          : ''
      }
      ${renderRequestsSection()}
      ${renderPeopleDiscovery(14)}
      ${
        visibleDms.length === 0 && matchedUsers.length === 0 && reqCount === 0
          ? `<div class="nx-dm-empty-state">
              <p class="nx-dm-empty-hint">No matching conversations or people found for "${escapeHtml(state.dmSearchQuery.trim())}".</p>
              <button type="button" class="btn btn-secondary" style="height:30px;font-size:0.78rem;" data-action="clear-dm-search">Clear Search</button>
            </div>`
          : ''
      }
    `;
  } else if (activeTab === 'unread') {
    bodyHtml = `
      <div class="nx-dm-section">
        <div class="nx-dm-section-label">Unread Conversations (${unreadDms.length})</div>
        <div class="nx-dm-list-stack">
          ${
            unreadDms.map(renderDmRow).join('') ||
            '<p class="nx-dm-empty-hint">You are all caught up. No unread messages right now.</p>'
          }
        </div>
      </div>
    `;
  } else if (activeTab === 'requests') {
    bodyHtml = `
      ${renderRequestsSection()}
      ${renderPeopleDiscovery(12)}
      ${reqCount === 0 && matchedUsers.length === 0 ? '<p class="nx-dm-empty-hint">No message requests right now.</p>' : ''}
    `;
  } else if (activeTab === 'groups') {
    const groupChats = visibleDms.filter((d) => d.type === 'group');
    bodyHtml = `
      <div class="nx-dm-section">
        <div class="nx-dm-section-head">
          <span class="nx-dm-section-label">Group Chats (${groupChats.length})</span>
          <button type="button" class="nx-dm-inline-cta" data-action="open-create-group-chat">${svgIcon('plus', 12)} New Group</button>
        </div>
        <div class="nx-dm-list-stack">
          ${groupChats.map(renderDmRow).join('') || '<p class="nx-dm-empty-hint">No group conversations yet. Start one with New Group.</p>'}
        </div>
      </div>
    `;
  } else {
    bodyHtml = `
      ${incomingPending.length > 0 ? renderRequestsSection() : ''}
      <div class="nx-dm-section">
        <div class="nx-dm-section-head">
          <span class="nx-dm-section-label">Conversations (${visibleDms.length})</span>
          <button type="button" class="nx-dm-inline-cta" data-action="open-create-group-chat">${svgIcon('plus', 12)} New</button>
        </div>
        <div class="nx-dm-list-stack">
          ${visibleDms.map(renderDmRow).join('') || '<p class="nx-dm-empty-hint">No conversations yet. Search a handle or check Requests to connect.</p>'}
        </div>
      </div>
      ${visibleDms.length < 3 ? renderPeopleDiscovery(6) : ''}
    `;
  }

  listEl.innerHTML = `
    <div class="nx-dm-tabs" role="tablist" aria-label="Message inbox filters">
      <button type="button" role="tab" aria-selected="${activeTab === 'all'}" class="nx-dm-tab-btn ${activeTab === 'all' ? 'active' : ''}" data-action="set-dm-tab" data-dm-tab="all">
        <span>All</span>
      </button>
      <button type="button" role="tab" aria-selected="${activeTab === 'unread'}" class="nx-dm-tab-btn ${activeTab === 'unread' ? 'active' : ''}" data-action="set-dm-tab" data-dm-tab="unread">
        <span>Unread</span>
        ${totalUnreadThreads > 0 ? `<span class="nx-dm-tab-count is-alert">${totalUnreadThreads}</span>` : ''}
      </button>
      <button type="button" role="tab" aria-selected="${activeTab === 'requests'}" class="nx-dm-tab-btn ${activeTab === 'requests' ? 'active' : ''}" data-action="set-dm-tab" data-dm-tab="requests">
        <span>Requests</span>
        ${incomingPending.length > 0 ? `<span class="nx-dm-tab-count is-alert">${incomingPending.length}</span>` : ''}
      </button>
    </div>

    ${
      archivedCount > 0
        ? `<div class="nx-dm-archive-toggle-row">
            <button type="button" class="nx-dm-archive-toggle-btn" data-action="toggle-show-archived-dms">
              ${svgIcon('bookmark', 12)}
              <span>${state.showArchivedDms ? 'Hide Archived' : `Archived (${archivedCount})`}</span>
            </button>
          </div>`
        : ''
    }

    ${errorBannerHtml}

    <div class="nx-dm-scroll-content">
      ${bodyHtml}
    </div>
  `;
}

function renderSidebar() {
  const titleEl = document.getElementById('sidebar-server-name');
  const scrollEl = document.getElementById('sidebar-scroll');
  if (!scrollEl || !titleEl) return;

  if (state.activeView === 'home') {
    titleEl.textContent = profile.username ? `@${profile.username}` : 'Messages';
    const existingSearch = document.getElementById('dm-user-search-input');
    if (existingSearch && document.getElementById('dm-sidebar-list')) {
      if (existingSearch instanceof HTMLInputElement && existingSearch.value !== state.dmSearchQuery) {
        existingSearch.value = state.dmSearchQuery;
      }
      renderDmSidebarList();
    } else {
      scrollEl.innerHTML = `
        <div class="nx-dm-sidebar-top">
          <div class="nx-dm-sidebar-title-row">
            <h2 class="nx-dm-sidebar-heading">Messages</h2>
            <div class="nx-dm-header-actions">
              <button type="button" class="icon-btn nx-dm-compose-btn" data-action="open-create-group-chat" title="New message or group" aria-label="New message or group">
                ${svgIcon('edit', 15)}
              </button>
              <button type="button" class="icon-btn nx-dm-compose-btn" data-action="open-messages-more" title="Message management options" aria-label="Message management options">
                ${svgIcon('more', 15)}
              </button>
            </div>
          </div>
          <div class="nx-dm-search-wrap">
            <span class="nx-dm-search-icon" aria-hidden="true">${svgIcon('search', 14)}</span>
            <input
              type="text"
              class="sidebar-search-input nx-dm-search-input"
              id="dm-user-search-input"
              placeholder="Search conversations or @username..."
              aria-label="Search conversations, names, and usernames"
              value="${escapeHtml(state.dmSearchQuery)}"
            />
            <button
              type="button"
              class="nx-dm-search-clear"
              id="dm-search-clear-btn"
              data-action="clear-dm-search"
              aria-label="Clear conversation search"
              title="Clear search"
              ${state.dmSearchQuery.trim() ? '' : 'hidden'}
            >
              ${svgIcon('close', 13)}
            </button>
          </div>
        </div>
        <div id="dm-sidebar-list"></div>
      `;
      renderDmSidebarList();
    }
  } else if (state.activeView === 'discover') {
    titleEl.textContent = 'Communities';
    scrollEl.innerHTML = `
      <div class="category-block">
        <div class="category-header"><span class="category-toggle">Communities</span></div>
        <div class="channel-list">
          <button type="button" class="channel-btn active" data-action="nav-discover"><span class="channel-btn-main"><span class="channel-icon">${svgIcon('compass', 13)}</span><span class="channel-label">Public Directory</span></span></button>
          <button type="button" class="channel-btn" data-action="open-create-server"><span class="channel-btn-main"><span class="channel-icon">${svgIcon('plus', 13)}</span><span class="channel-label">Create Community</span></span></button>
          <button type="button" class="channel-btn" data-action="open-join-community-link"><span class="channel-btn-main"><span class="channel-icon">${svgIcon('link', 13)}</span><span class="channel-label">Join via Invite Link</span></span></button>
        </div>
      </div>
    `;
  } else {
    const srv = getActiveServer();
    if (!srv) {
      titleEl.textContent = 'Communities';
      scrollEl.innerHTML = `
        <div style="padding:10px;display:grid;gap:10px;">
          <p class="member-sub" style="white-space:normal;line-height:1.45;">You have not joined a community yet. Join with an invite link, browse public communities, or create your own.</p>
          <button type="button" class="btn btn-primary" data-action="open-create-server">Create Community</button>
          <button type="button" class="btn btn-secondary" data-action="open-join-community-link">Join via Invite Link</button>
          <button type="button" class="btn btn-secondary" data-action="nav-discover">Browse Public Directory</button>
        </div>
      `;
    } else {
      titleEl.textContent = srv.name;
      const cats = srv.categories && srv.categories.length > 0
        ? srv.categories
        : [{ id: 'cat-default', name: 'Channels', channelIds: Object.keys(state.channels) }];

      const groupedIds = new Set(cats.flatMap((c) => c.channelIds || []));
      const uncategorized = Object.values(state.channels).filter((ch) => ch.serverId === srv.id && !groupedIds.has(ch.id));

      const blocks = cats.map((cat) => {
        const collapsed = Boolean(state.collapsedCategories[cat.id]);
        const chans = (cat.channelIds || []).map((id) => state.channels[id]).filter(Boolean);
        return { id: cat.id, name: cat.name, collapsed, chans };
      });
      if (uncategorized.length > 0 && blocks.length > 0) {
        blocks[0].chans.push(...uncategorized);
      }

      scrollEl.innerHTML = blocks
        .map(
          (cat) => `
          <div class="category-block ${cat.collapsed ? 'collapsed' : ''}">
            <div class="category-header">
              <button type="button" class="category-toggle" data-action="toggle-cat" data-cat-id="${escapeHtml(cat.id)}">
                <span>${cat.collapsed ? svgIcon('chevronRight', 12) : svgIcon('chevronDown', 12)}</span>
                <span>${escapeHtml(cat.name)}</span>
              </button>
              ${
                srv.ownerId === profile.id
                  ? `<button type="button" class="category-add-btn" data-action="open-create-channel" data-cat-id="${escapeHtml(cat.id)}" aria-label="Create channel in ${escapeHtml(cat.name)}" title="Create Channel">${svgIcon('plus', 13)}</button>`
                  : ''
              }
            </div>
            <div class="channel-list">
              ${cat.chans
                .map((ch) => {
                  const active = ch.id === state.activeChannelId;
                  return `
                    <button type="button" class="channel-btn ${active ? 'active' : ''}" data-action="select-channel" data-channel-id="${escapeHtml(ch.id)}">
                      <span class="channel-btn-main">
                        <span class="channel-icon">${getChannelIconSvg(ch.type, 14)}</span>
                        <span class="channel-label">${escapeHtml(ch.name)}</span>
                      </span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          </div>
        `
        )
        .join('');
    }
  }

  const voiceDock = document.getElementById('voice-dock');
  const voiceRoom = document.getElementById('voice-dock-room');
  if (voiceDock && voiceRoom) {
    if (rtcState.activeCall) {
      voiceDock.hidden = false;
      const suffix = rtcState.screenSharing ? ' · Sharing' : rtcState.videoOn ? ' · Video' : '';
      voiceRoom.innerHTML = `<span class="voice-eq-bars" aria-hidden="true"><span></span><span></span><span></span></span> ${escapeHtml(rtcState.activeCall.title)}${suffix}`;
    } else {
      voiceDock.hidden = true;
    }
  }

  const dockInitials = document.getElementById('dock-initials');
  const dockDisplay = document.getElementById('dock-display-name');
  const dockStatus = document.getElementById('dock-custom-status');
  const dockDot = document.getElementById('dock-status-dot');
  if (dockInitials) dockInitials.textContent = profile.initials;
  if (dockDisplay) dockDisplay.textContent = profile.displayName;
  if (dockStatus) dockStatus.textContent = profile.customStatus || `@${profile.username}`;
  if (dockDot) dockDot.className = `status-dot ${profile.status || 'online'}`;
}

function renderDeviceControlsBar(isDarkSurface = true) {
  const mics = rtcState.devices?.mics || [];
  const speakers = rtcState.devices?.speakers || [];
  const selectCls = isDarkSurface ? 'device-select' : 'voice-device-select';
  return `
    <div class="device-controls-row">
      <button type="button" class="btn ${rtcState.noiseSuppression ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-noise-suppression">
        ${svgIcon('sliders', 13)} <span>Noise Suppress: ${rtcState.noiseSuppression ? 'On' : 'Off'}</span>
      </button>
      <button type="button" class="btn ${rtcState.echoCancellation ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-echo-cancel">
        <span>Echo Cancel: ${rtcState.echoCancellation ? 'On' : 'Off'}</span>
      </button>
      ${
        mics.length > 0
          ? `<select class="${selectCls}" data-action="select-audio-input" aria-label="Select microphone">
              <option value="">Default Microphone</option>
              ${mics.map((d, idx) => `<option value="${escapeHtml(d.deviceId)}" ${rtcState.audioInputId === d.deviceId ? 'selected' : ''}>${escapeHtml(d.label || `Mic ${idx + 1}`)}</option>`).join('')}
            </select>`
          : ''
      }
      ${
        speakers.length > 0
          ? `<select class="${selectCls}" data-action="select-audio-output" aria-label="Select speaker">
              <option value="">Default Speaker</option>
              ${speakers.map((d, idx) => `<option value="${escapeHtml(d.deviceId)}" ${rtcState.audioOutputId === d.deviceId ? 'selected' : ''}>${escapeHtml(d.label || `Speaker ${idx + 1}`)}</option>`).join('')}
            </select>`
          : ''
      }
    </div>
  `;
}

function renderDmCallStage() {
  const stageEl = document.getElementById('dm-call-stage');
  if (!stageEl) return;

  const activeCall = rtcState.activeCall;
  const tabOpen = Boolean(callTab?.isTabShowing?.());
  if (tabOpen || state.activeView !== 'home' || !activeCall || activeCall.kind !== 'dm') {
    stageEl.hidden = true;
    stageEl.innerHTML = '';
    return;
  }

  stageEl.hidden = false;
  const peers = rtcState.peers.length > 0
    ? rtcState.peers
    : [{ userId: profile.id, displayName: profile.displayName, initials: profile.initials, muted: rtcState.muted, videoOn: rtcState.videoOn, screenSharing: rtcState.screenSharing }];

  stageEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="voice-eq-bars" aria-hidden="true"><span></span><span></span><span></span></span>
        <div>
          <strong style="font-size:0.95rem;">Live Call with ${escapeHtml(activeCall.title)}</strong>
          <div class="member-sub" style="color:#a9bbd8;">${rtcState.mediaNotice ? escapeHtml(rtcState.mediaNotice) : `${peers.length} participant${peers.length === 1 ? '' : 's'} connected via WebRTC`}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" data-action="open-call-tab"><span>Open Call Tab</span></button>
        <button type="button" class="btn ${rtcState.muted ? 'btn-danger' : 'btn-secondary'}" data-action="toggle-mute">${rtcState.muted ? svgIcon('micOff', 14) : svgIcon('mic', 14)} <span>${rtcState.muted ? 'Unmute' : 'Mute'}</span></button>
        <button type="button" class="btn ${rtcState.videoOn ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-camera">${rtcState.videoOn ? svgIcon('videoOff', 14) : svgIcon('video', 14)} <span>${rtcState.videoOn ? 'Camera Off' : 'Camera'}</span></button>
        <button type="button" class="btn btn-secondary" data-action="flip-camera" title="Switch Front / Rear Camera">${svgIcon('cameraFlip', 14)} <span>${rtcState.cameraFacing === 'environment' ? 'Front Cam' : 'Rear Cam'}</span></button>
        <button type="button" class="btn ${rtcState.screenSharing ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-screen-share">${svgIcon('screen', 14)} <span>${rtcState.screenSharing ? 'Stop Share' : 'Share Screen'}</span></button>
        <button type="button" class="btn btn-secondary" data-action="open-share-options" title="Mobile Photo, Whiteboard &amp; Share Options">${svgIcon('image', 14)} <span>${rtcState.screenSharing && (rtcState.screenShareKind === 'board' || rtcState.screenShareKind === 'photo') ? 'Edit Board' : 'Share Options'}</span></button>
        <button type="button" class="btn btn-danger" data-action="leave-voice">${svgIcon('phoneOff', 14)} <span>End Call</span></button>
      </div>
    </div>
    <div class="rtc-stage-grid">
      ${peers
        .map((p) => {
          const isMe = p.userId === profile.id;
          const hasStream = isMe
            ? Boolean(rtcState.screenStream || rtcState.localStream?.getVideoTracks().length)
            : Boolean(rtcState.remoteStreams?.get(p.userId)?.getVideoTracks().length);
          const summary = summarizeMediaState(p);
          const statusLabel =
            isMe && rtcState.screenSharing && rtcState.screenShareKind === 'board'
              ? 'Sharing Whiteboard'
              : isMe && rtcState.screenSharing && rtcState.screenShareKind === 'photo'
                ? 'Sharing Photo'
                : summary.label;
          return `
            <div class="rtc-video-card ${p.screenSharing ? 'screen-active' : ''}">
              ${
                hasStream
                  ? `<video class="rtc-video-el" data-rtc-video="${escapeHtml(p.userId)}" data-rtc-local="${isMe ? 'true' : 'false'}" autoplay playsinline ${isMe ? 'muted' : ''}></video>`
                  : `<div class="speaker-avatar-lg">${escapeHtml(p.initials || getInitials(p.displayName || 'MB'))}</div>`
              }
              ${!isMe ? `<audio data-rtc-remote-audio="${escapeHtml(p.userId)}" autoplay></audio>` : ''}
              <div class="rtc-card-overlay">
                <span class="rtc-name-pill">${escapeHtml(p.displayName)}${isMe ? ' (You)' : ''}</span>
                <span class="rtc-status-pill">${escapeHtml(statusLabel)}</span>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
    ${renderDeviceControlsBar(true)}
  `;

  rtc.attachMediaElements(stageEl);
}

function renderPendingPeerGate(scroll, targetUserId) {
  const target = getMember(targetUserId);
  const { status, request } = getConnectionStatusForPeer(profile.id, targetUserId, state.connectionRequests);
  const isIncoming = status === 'pending' && request?.toUid === profile.id;
  const isOutgoing = status === 'pending' && request?.fromUid === profile.id;

  let controls = '';
  if (isIncoming) {
    controls = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" data-action="accept-conn-req" data-req-id="${escapeHtml(request.id)}" data-from-uid="${escapeHtml(request.fromUid)}">${svgIcon('check', 15)} <span>Accept Request &amp; Unlock Chat</span></button>
        <button type="button" class="btn btn-secondary" data-action="decline-conn-req" data-req-id="${escapeHtml(request.id)}">${svgIcon('close', 15)} <span>Decline</span></button>
      </div>
    `;
  } else if (isOutgoing) {
    controls = `
      <div style="display:flex;align-items:center;gap:10px;color:var(--text-secondary);font-size:0.88rem;font-weight:600;">
        ${svgIcon('clock', 16)}
        <span>Chat request sent to ${escapeHtml(target.displayName)}. Messaging and calls unlock automatically once accepted.</span>
      </div>
    `;
  } else {
    controls = `
      <form id="send-conn-req-form" data-target-uid="${escapeHtml(target.id)}" style="display:grid;gap:10px;">
        <input type="text" class="input" id="conn-req-note" maxlength="200" placeholder="Optional intro note (e.g. Hey, let's collaborate here)..." />
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="submit" class="btn btn-primary">${svgIcon('userPlus', 15)} <span>Send Chat &amp; Call Request</span></button>
          <button type="button" class="btn btn-secondary" data-action="block-user" data-user-id="${escapeHtml(target.id)}">${svgIcon('ban', 14)} <span>Block User</span></button>
        </div>
      </form>
    `;
  }

  scroll.innerHTML = `
    <div class="request-banner-card">
      <div style="display:flex;align-items:center;gap:14px;">
        <div class="avatar-circle" style="width:46px;height:46px;font-size:1rem;">
          <span>${escapeHtml(target.initials || getInitials(target.displayName))}</span>
          <span class="status-dot ${escapeHtml(target.status || 'online')}"></span>
        </div>
        <div>
          <h2>${escapeHtml(target.displayName)}</h2>
          <div class="member-sub">@${escapeHtml(target.username)} · Connection approval required</div>
        </div>
      </div>
      <p class="member-sub" style="white-space:normal;line-height:1.55;">
        ${escapeHtml(target.bio || 'Direct messaging, voice calls, video calls, and screen sharing require mutual request approval.')}
      </p>
      ${controls}
    </div>
  `;
}

function renderEmptyHomeCard(scroll) {
  if (state.activeView !== 'home') {
    scroll.innerHTML = `
      <div class="empty-workspace-card">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="/assets/logo.svg" alt="NEXORA" width="36" height="36" />
          <div>
            <h2>Your NEXORA Communities</h2>
            <div class="member-sub">Invite-screened groups, channels, and voice stages</div>
          </div>
        </div>
        <p class="member-sub" style="white-space:normal;line-height:1.55;">
          Create a new community with custom channels &amp; moderation rules, join via a shared invite link, or browse the public directory.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;padding-top:4px;">
          <button type="button" class="btn btn-primary" data-action="open-create-server">${svgIcon('plus', 15)} <span>Create Community</span></button>
          <button type="button" class="btn btn-secondary" data-action="open-join-community-link">${svgIcon('link', 15)} <span>Join via Invite Link</span></button>
          <button type="button" class="btn btn-secondary" data-action="nav-discover">${svgIcon('compass', 15)} <span>Discover Communities</span></button>
        </div>
      </div>
    `;
    return;
  }

  const incomingPending = state.connectionRequests.filter(
    (r) => r.status === 'pending' && r.toUid === profile.id && !state.blockedSet.has(r.fromUid)
  );
  scroll.innerHTML = `
    <div class="empty-workspace-card">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="/assets/logo.svg" alt="NEXORA" width="36" height="36" />
        <div>
          <h2>Messages, ${escapeHtml(profile.displayName)}</h2>
          <div class="member-sub">Direct messages, group chats &amp; connection requests</div>
        </div>
      </div>
      <p class="member-sub" style="white-space:normal;line-height:1.55;">
        Select any conversation or person from the sidebar to message or call, or use the <strong>⋮</strong> menu above to share or join a community invite link.
      </p>
      ${
        incomingPending.length > 0
          ? `<div style="display:grid;gap:8px;padding-top:6px;">
              <strong>Pending Chat Requests (${incomingPending.length})</strong>
              ${incomingPending
                .map(
                  (r) => `
                  <div class="file-row">
                    <div>
                      <strong>${escapeHtml(r.fromName || 'Member')}</strong>
                      <div class="member-sub">${escapeHtml(r.note || 'Wants to connect')}</div>
                    </div>
                    <div style="display:flex;gap:6px;">
                      <button type="button" class="btn btn-primary" data-action="accept-conn-req" data-req-id="${escapeHtml(r.id)}" data-from-uid="${escapeHtml(r.fromUid)}">Accept</button>
                      <button type="button" class="btn btn-secondary" data-action="decline-conn-req" data-req-id="${escapeHtml(r.id)}">Decline</button>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>`
          : ''
      }
      <div style="display:flex;gap:10px;flex-wrap:wrap;padding-top:4px;">
        <button type="button" class="btn btn-primary" data-action="open-create-group-chat">${svgIcon('users', 15)} <span>New Group Chat</span></button>
        <button type="button" class="btn btn-secondary" data-action="open-join-community-link">${svgIcon('link', 15)} <span>Join Community via Link</span></button>
      </div>
    </div>
  `;
}

function syncComposerState() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const attachInput = document.getElementById('msg-attach-input');
  const voiceBtn = document.getElementById('msg-voice-btn');
  const hasAcceptedHumanDm =
    state.activeView === 'home' &&
    !state.pendingPeerId &&
    state.dms.some((d) => d.id === state.activeDmId && Array.isArray(d.participants) && d.participants.length >= 2);
  const hasChannel = state.activeView === 'server' && Boolean(getActiveServer()) && Boolean(state.activeChannelId);

  const canCompose = hasAcceptedHumanDm || hasChannel;
  const busy = state.isSendingMessage;

  if (input instanceof HTMLTextAreaElement) {
    input.disabled = !canCompose || busy;
  }
  if (sendBtn instanceof HTMLButtonElement) {
    sendBtn.disabled = !canCompose || busy;
    sendBtn.textContent = state.isSendingMessage ? 'Sending...' : 'Send';
    sendBtn.classList.toggle('is-sending', busy);
  }
  if (attachInput instanceof HTMLInputElement) {
    attachInput.disabled = !canCompose || busy;
  }
  if (voiceBtn instanceof HTMLButtonElement) {
    voiceBtn.disabled = !canCompose || busy;
  }
}

function renderMainWorkspace() {
  const legacyEl = document.getElementById('nx-legacy-workspace');
  if (legacyEl) {
    legacyEl.setAttribute('data-workspace-mode', state.activeView === 'home' ? 'messages' : 'communities');
    const hasThreadOpen =
      state.activeView === 'home' && Boolean(state.dmThreadActiveMobile) && Boolean(state.activeDmId || state.pendingPeerId);
    legacyEl.classList.toggle('nx-dm-thread-active', hasThreadOpen);
  }

  const headerName = document.getElementById('header-channel-name');
  const headerTopic = document.getElementById('header-topic');
  const headerPeerAvatar = document.getElementById('header-peer-avatar');
  const dmCallActions = document.getElementById('dm-call-actions');
  const pinsBtn = document.getElementById('pins-btn');
  const inspectorBtn = document.getElementById('inspector-toggle-btn');
  const pollTrigger = document.getElementById('create-poll-trigger');
  const composerWrap = document.getElementById('composer-wrap');
  const chatCol = document.getElementById('chat-column');
  const voiceView = document.getElementById('voice-stage-view');
  const discView = document.getElementById('discovery-view');
  const searchInput = document.getElementById('msg-search-input');
  const searchClearBtn = document.getElementById('msg-search-clear-btn');
  const searchWrap = document.getElementById('msg-search-wrap');

  if (searchInput instanceof HTMLInputElement && searchInput.value !== state.searchQuery) {
    searchInput.value = state.searchQuery;
  }
  if (searchClearBtn) {
    searchClearBtn.hidden = !state.searchQuery.trim();
  }
  if (searchWrap) {
    searchWrap.classList.toggle('is-open', state.threadSearchOpen || Boolean(state.searchQuery.trim()));
  }
  if (pollTrigger) {
    pollTrigger.hidden = state.activeView === 'home';
  }

  const setHeaderAvatar = (html) => {
    if (!headerPeerAvatar) return;
    if (html) {
      headerPeerAvatar.innerHTML = html;
      headerPeerAvatar.hidden = false;
    } else {
      headerPeerAvatar.innerHTML = '';
      headerPeerAvatar.hidden = true;
    }
  };

  if (state.activeView === 'discover') {
    setHeaderAvatar('');
    if (dmCallActions) dmCallActions.hidden = true;
    if (pinsBtn) pinsBtn.hidden = true;
    if (inspectorBtn) inspectorBtn.hidden = true;
    if (headerName) headerName.textContent = 'Discover Communities';
    if (headerTopic) headerTopic.textContent = 'Browse public communities and request access or accept an invite.';
    if (chatCol) chatCol.hidden = true;
    if (voiceView) voiceView.hidden = true;
    if (discView) {
      discView.hidden = false;
      renderDiscoveryView(discView);
    }
    return;
  }

  if (discView) discView.hidden = true;

  if (state.activeView === 'home') {
    if (voiceView) voiceView.hidden = true;
    if (chatCol) chatCol.hidden = false;

    if (state.pendingPeerId) {
      const target = getMember(state.pendingPeerId);
      setHeaderAvatar(renderUserAvatarHtml(target, 34));
      if (dmCallActions) dmCallActions.hidden = true;
      if (pinsBtn) pinsBtn.hidden = true;
      if (inspectorBtn) inspectorBtn.hidden = true;
      if (composerWrap) composerWrap.hidden = true;
      if (headerName) headerName.textContent = `Request · ${target.displayName}`;
      if (headerTopic) headerTopic.textContent = 'Connection request approval required before messaging or calling.';
      renderDmCallStage();
      const scroll = document.getElementById('messages-scroll');
      if (scroll) renderPendingPeerGate(scroll, state.pendingPeerId);
      syncComposerState();
      return;
    }

    const dm =
      state.dms.find((d) => d.id === state.activeDmId) ||
      state.dms.find((d) => !(Array.isArray(d.archivedBy) && d.archivedBy.includes(profile.id))) ||
      state.dms[0] ||
      null;
    if (!dm) {
      setHeaderAvatar('');
      if (dmCallActions) dmCallActions.hidden = true;
      if (pinsBtn) pinsBtn.hidden = true;
      if (inspectorBtn) inspectorBtn.hidden = true;
      if (composerWrap) composerWrap.hidden = true;
      if (headerName) headerName.textContent = 'Messages';
      if (headerTopic) headerTopic.textContent = 'Direct chats, group conversations, and chat requests.';
      renderDmCallStage();
      renderDmTypingIndicator();
      const scroll = document.getElementById('messages-scroll');
      if (scroll) renderEmptyHomeCard(scroll);
      syncComposerState();
      return;
    }

    const peer = dm.userId ? getMember(dm.userId) : null;
    const isOnline = dm.type !== 'group' && (state.onlineUids.has(dm.userId) || (peer?.status || dm.status) === 'online');
    if (dm.type === 'group') {
      setHeaderAvatar(`<span class="nx-dm-group-avatar is-header">${svgIcon('users', 16)}</span>`);
    } else {
      setHeaderAvatar(
        `${renderUserAvatarHtml(peer || { displayName: dm.name, initials: dm.initials }, 34)}${isOnline ? '<span class="nx-online-dot online" aria-label="Online"></span>' : ''}`
      );
    }

    if (composerWrap) composerWrap.hidden = false;
    if (dmCallActions) dmCallActions.hidden = dm.type === 'group';
    if (pinsBtn) pinsBtn.hidden = false;
    if (inspectorBtn) inspectorBtn.hidden = false;
    if (headerName) headerName.textContent = dm.name;
    if (headerTopic) {
      if (dm.type === 'group') {
        headerTopic.textContent = `${(dm.participants || []).length} members`;
      } else {
        const handle = peer?.username ? `@${peer.username}` : 'Direct message';
        headerTopic.textContent = isOnline ? `${handle} · Active now` : handle;
      }
    }
    renderDmCallStage();
    renderDmTypingIndicator();
    updateComposerAttachmentBar();
    renderMessages(dm.id, dm.name, dm.topic, state.dmMessages[dm.id] || []);
    syncComposerState();
    return;
  }

  setHeaderAvatar('');
  if (dmCallActions) dmCallActions.hidden = true;
  if (pinsBtn) pinsBtn.hidden = false;
  if (inspectorBtn) inspectorBtn.hidden = false;
  renderDmCallStage();

  const srv = getActiveServer();
  const channel = getActiveChannel();
  if (!srv || !channel) {
    if (composerWrap) composerWrap.hidden = true;
    if (headerName) headerName.textContent = 'NEXORA Workspace';
    if (headerTopic) headerTopic.textContent = 'Create a community or accept an invite to begin.';
    if (voiceView) voiceView.hidden = true;
    if (chatCol) chatCol.hidden = false;
    const scroll = document.getElementById('messages-scroll');
    if (scroll) renderEmptyHomeCard(scroll);
    syncComposerState();
    return;
  }

  if (composerWrap) composerWrap.hidden = false;
  if (headerName) headerName.innerHTML = `${getChannelIconSvg(channel.type, 16)} <span>${escapeHtml(channel.name)}</span>`;
  if (headerTopic) headerTopic.textContent = channel.topic || '';

  if (channel.type === 'voice' || channel.type === 'stage') {
    if (chatCol) chatCol.hidden = true;
    if (voiceView) {
      voiceView.hidden = false;
      renderVoiceStageView(voiceView, channel);
    }
  } else {
    if (voiceView) voiceView.hidden = true;
    if (chatCol) chatCol.hidden = false;
    renderMessages(channel.id, `#${channel.name}`, channel.topic, state.messages[channel.id] || []);
  }
  syncComposerState();
}

function renderMessages(streamId, label, topic, streamMessages) {
  const scroll = document.getElementById('messages-scroll');
  const input = document.getElementById('message-input');
  const replyBar = document.getElementById('composer-reply-bar');
  const replyLabel = document.getElementById('composer-reply-label');

  if (input) {
    input.placeholder = `Message ${label}`;
  }
  if (replyBar && replyLabel) {
    if (state.replyToMsgId) {
      const target = streamMessages.find((m) => m.id === state.replyToMsgId);
      replyBar.classList.add('visible');
      replyLabel.textContent = target ? `Replying to ${target.senderName || getMember(target.authorId).displayName}` : 'Replying to message';
    } else {
      replyBar.classList.remove('visible');
    }
  }

  if (!scroll) return;
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = q
    ? streamMessages.filter(
        (m) =>
          (m.content || '').toLowerCase().includes(q) ||
          (m.senderName || getMember(m.authorId).displayName).toLowerCase().includes(q)
      )
    : streamMessages;

  const srv = state.activeView === 'server' ? getActiveServer() : null;
  const activeAlertsSummary = srv ? summarizeUserAlerts(state.serverAlerts, profile.id, { onlyUnacknowledged: true }) : null;
  const alertBannersHtml =
    activeAlertsSummary && activeAlertsSummary.unackedCount > 0
      ? activeAlertsSummary.items
          .map(
            (a) => `
            <div class="nx-leader-alert-banner ${a.severity === 'urgent' ? 'is-urgent' : ''}" role="alert">
              <div class="nx-leader-alert-copy">
                <div class="nx-leader-alert-badge">
                  ${svgIcon('shield', 13)}
                  <span>${a.severity === 'urgent' ? 'Urgent Leader Alert' : 'Community Leader Warning'}</span>
                  <span>· ${escapeHtml(a.time || 'Now')}</span>
                </div>
                <p class="nx-leader-alert-reason">${escapeHtml(a.reason)}</p>
                <span class="member-sub" style="white-space:normal;">Issued by ${escapeHtml(a.actorName || 'Community Leader')}</span>
              </div>
              <button
                type="button"
                class="btn btn-primary"
                style="height:32px;font-size:0.78rem;flex-shrink:0;"
                data-action="acknowledge-leader-alert"
                data-alert-id="${escapeHtml(a.id)}"
                data-server-id="${escapeHtml(a.serverId)}"
              >Acknowledge</button>
            </div>
          `
          )
          .join('')
      : '';

  const dmErrorHtml =
    state.activeView === 'home' && state.dmError
      ? `<div class="nx-dm-error-banner" role="alert">
          <span>${escapeHtml(state.dmError)}</span>
          <button type="button" class="btn btn-secondary" style="height:26px;font-size:0.74rem;padding:0 9px;" data-action="retry-dm-sync">Retry</button>
        </div>`
      : '';

  const welcomeHtml = `
      ${alertBannersHtml}
      ${dmErrorHtml}
      <div class="channel-welcome">
        <h2>${escapeHtml(label)}</h2>
        <p>${escapeHtml(topic || 'Focused conversation inside your workspace.')}</p>
      </div>
    `;

  if (
    state.activeView === 'home' &&
    state.dmMessagesLoadingThreadId === streamId &&
    streamMessages.length === 0
  ) {
    scroll.innerHTML =
      welcomeHtml +
      `<div class="nx-dm-skeleton-list" aria-label="Loading messages">
        <div class="nx-dm-skeleton-row is-peer"><span class="nx-dm-skeleton-bubble"></span></div>
        <div class="nx-dm-skeleton-row is-self"><span class="nx-dm-skeleton-bubble is-short"></span></div>
        <div class="nx-dm-skeleton-row is-peer"><span class="nx-dm-skeleton-bubble is-mid"></span></div>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    scroll.innerHTML =
      welcomeHtml +
      `<div class="nx-thread-empty-state">
        <p class="member-sub">${q ? 'No messages match your search filter.' : 'No messages yet. Say hello below.'}</p>
        ${q ? '<button type="button" class="btn btn-secondary" style="height:30px;font-size:0.78rem;" data-action="clear-msg-search">Clear Search</button>' : ''}
      </div>`;
    return;
  }

  const bookmarkedIds = new Set(state.bookmarks.map((b) => b.messageId));
  let prevMsg = null;
  let lastDayKey = '';
  const rowsHtml = filtered
    .map((msg) => {
      const dayKey = getMessageDayKey(msg.timestamp);
      const dateSeparatorHtml =
        dayKey !== lastDayKey
          ? `<div class="nx-msg-date-sep" role="separator"><span>${escapeHtml(formatMessageDateLabel(msg.timestamp))}</span></div>`
          : '';
      lastDayKey = dayKey;

      const member = getMember(msg.authorId);
      const authorName = msg.authorId === profile.id ? profile.displayName : msg.senderName || member.displayName;
      const authorInitials = msg.authorId === profile.id ? profile.initials : msg.senderInitials || member.initials;
      const isGrouped = shouldGroupMessages(prevMsg, msg);
      prevMsg = msg;

      const replyTarget = msg.replyToId ? streamMessages.find((x) => x.id === msg.replyToId) : null;
      const replyHtml = replyTarget
        ? `<div class="msg-reply-ref">${svgIcon('reply', 12)} <strong>${escapeHtml(replyTarget.senderName || getMember(replyTarget.authorId).displayName)}</strong> ${escapeHtml(replyTarget.content.slice(0, 60))}</div>`
        : '';

      const reactionsHtml = (msg.reactions || []).length
        ? `<div class="msg-reactions">
            ${msg.reactions
              .map((r) => {
                const reacted = (r.userIds || []).includes(profile.id);
                return `<button type="button" class="reaction-btn ${reacted ? 'reacted' : ''}" data-action="toggle-reaction" data-msg-id="${escapeHtml(msg.id)}" data-emoji="${escapeHtml(r.emoji)}">${escapeHtml(r.emoji)} <span>${(r.userIds || []).length}</span></button>`;
              })
              .join('')}
          </div>`
        : '';

      let pollHtml = '';
      if (msg.poll && Array.isArray(msg.poll.options)) {
        const total = msg.poll.options.reduce((acc, o) => acc + (o.userIds || []).length, 0);
        pollHtml = `
          <div class="poll-card">
            <div class="poll-question">${escapeHtml(msg.poll.question)}</div>
            <div class="poll-options">
              ${msg.poll.options
                .map((opt) => {
                  const votes = opt.userIds || [];
                  const pct = total > 0 ? Math.round((votes.length / total) * 100) : 0;
                  const voted = votes.includes(profile.id);
                  return `
                    <button type="button" class="poll-option-btn ${voted ? 'voted' : ''}" data-action="vote-poll" data-msg-id="${escapeHtml(msg.id)}" data-opt-id="${escapeHtml(opt.id)}">
                      <div class="poll-bar" style="width:${pct}%"></div>
                      <span>${escapeHtml(opt.text)} ${voted ? svgIcon('check', 13) : ''}</span>
                      <span class="tabular mono">${pct}%</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
            <div class="poll-footer">${total} vote${total === 1 ? '' : 's'}</div>
          </div>
        `;
      }

      const threadHtml =
        (msg.replies || []).length > 0
          ? `<button type="button" class="thread-summary-btn" data-action="open-thread" data-msg-id="${escapeHtml(msg.id)}">${svgIcon('chat', 13)} <span>${msg.replies.length} repl${msg.replies.length === 1 ? 'y' : 'ies'} in thread</span></button>`
          : '';

      const canEdit = msg.authorId === profile.id;
      const isEditing = editingMessageId === msg.id;
      const isBookmarked = bookmarkedIds.has(msg.id);

      let attachmentHtml = '';
      if (msg.attachment && msg.attachment.dataUrl) {
        const attType = String(msg.attachment.type || '');
        const attUrl = escapeHtml(msg.attachment.dataUrl);
        const attName = escapeHtml(msg.attachment.name || 'Attachment');
        if (attType.startsWith('image/')) {
          attachmentHtml = `<div style="margin-top:6px;"><img src="${attUrl}" alt="${attName}" style="max-width:340px;max-height:260px;border-radius:12px;border:1px solid var(--border-subtle);display:block;" /></div>`;
        } else if (attType.startsWith('video/')) {
          attachmentHtml = `<div style="margin-top:6px;"><video src="${attUrl}" controls style="max-width:360px;max-height:260px;border-radius:12px;border:1px solid var(--border-subtle);display:block;"></video></div>`;
        } else if (attType.startsWith('audio/')) {
          attachmentHtml = `<div style="margin-top:6px;"><audio src="${attUrl}" controls style="max-width:300px;"></audio></div>`;
        } else {
          attachmentHtml = `<div style="margin-top:6px;"><a href="${attUrl}" download="${attName}" class="file-row" style="display:inline-flex;gap:8px;text-decoration:none;"><span>${svgIcon('paperclip', 13)}</span><span>${attName} (${escapeHtml(formatFileSize(msg.attachment.size || 0))})</span></a></div>`;
        }
      }

      const isDmMode = state.activeView === 'home';
      const isDmSelf = isDmMode && msg.authorId === profile.id;
      const otherSeen = isDmSelf && Array.isArray(msg.seenBy) && msg.seenBy.some((uid) => uid !== profile.id);
      const receiptHtml = isDmSelf
        ? `<div class="nx-dm-receipt">${svgIcon(otherSeen ? 'checkDouble' : 'check', 12)} <span>${otherSeen ? 'Seen' : 'Sent'}</span> · <span class="nx-dm-inline-time">${escapeHtml(msg.time)}</span></div>`
        : '';

      const inviteCode = extractCommunityInviteCodeFromText(msg.content);
      const inviteCardHtml = inviteCode
        ? `<div class="nx-chat-invite-card">
            <div class="nx-chat-invite-meta">
              <span class="nx-chat-invite-title">${svgIcon('users', 13)} NEXORA Community Invite</span>
              <span class="nx-chat-invite-code mono">Code: ${escapeHtml(inviteCode)}</span>
            </div>
            <button type="button" class="btn btn-primary" style="height:30px;font-size:0.76rem;padding:0 12px;" data-action="join-from-chat-invite" data-invite-code="${escapeHtml(inviteCode)}">
              Join Community
            </button>
          </div>`
        : '';

      const bodyContent = isEditing
        ? `<div style="display:flex;gap:8px;margin-top:6px;">
            <input type="text" class="input" id="inline-edit-input" value="${escapeHtml(msg.content)}" />
            <button type="button" class="btn btn-primary" data-action="save-edit" data-msg-id="${escapeHtml(msg.id)}">Save</button>
            <button type="button" class="btn btn-secondary" data-action="cancel-edit">Cancel</button>
          </div>`
        : `<div class="msg-text">${formatMessageMarkdown(msg.content)}${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}</div>`;

      const peerAvatarMarkup = `<button type="button" class="msg-avatar nx-dm-msg-avatar" data-action="open-member-popover" data-user-id="${escapeHtml(msg.authorId)}" aria-label="View profile of ${escapeHtml(authorName)}">${renderUserAvatarHtml(member, 28)}</button>`;

      const rowInnerHtml = isDmMode
        ? `
          ${
            !isDmSelf
              ? isGrouped
                ? `<div class="nx-dm-avatar-spacer"></div>`
                : peerAvatarMarkup
              : ''
          }
          <div class="nx-dm-msg-stack ${isDmSelf ? 'is-self' : 'is-peer'}">
            ${
              !isDmSelf && !isGrouped
                ? `<div class="msg-header nx-dm-msg-meta">
                    <button type="button" class="msg-author" data-action="open-member-popover" data-user-id="${escapeHtml(msg.authorId)}">${escapeHtml(authorName)}</button>
                    <span class="msg-time">${escapeHtml(msg.time)}</span>
                    ${msg.pinned ? `<span class="msg-role-tag">${svgIcon('pin', 11)} Pinned</span>` : ''}
                  </div>`
                : ''
            }
            <div class="nx-dm-bubble ${isDmSelf ? 'is-self' : 'is-peer'} ${msg.isError ? 'is-error' : ''}">
              ${replyHtml}
              ${bodyContent}
              ${inviteCardHtml}
              ${attachmentHtml}
              ${pollHtml}
            </div>
            ${reactionsHtml}
            ${threadHtml}
            ${receiptHtml}
          </div>
        `
        : `
          ${
            isGrouped
              ? `<div class="msg-gutter-time">${escapeHtml(msg.time.split(' ')[0])}</div>`
              : `<button type="button" class="msg-avatar" data-action="open-member-popover" data-user-id="${escapeHtml(msg.authorId)}" aria-label="View profile of ${escapeHtml(authorName)}">${escapeHtml(authorInitials)}</button>`
          }
          <div>
            ${
              isGrouped
                ? ''
                : `<div class="msg-header">
                    <button type="button" class="msg-author" data-action="open-member-popover" data-user-id="${escapeHtml(msg.authorId)}">${escapeHtml(authorName)}</button>
                    <span class="msg-time">${escapeHtml(msg.time)}</span>
                    ${msg.pinned ? `<span class="msg-role-tag">${svgIcon('pin', 11)} Pinned</span>` : ''}
                  </div>`
            }
            ${replyHtml}
            ${bodyContent}
            ${inviteCardHtml}
            ${attachmentHtml}
            ${pollHtml}
            ${reactionsHtml}
            ${threadHtml}
            ${receiptHtml}
          </div>
        `;

      const toolbarHtml = `<div class="msg-actions" role="toolbar" aria-label="Message actions">
            <button type="button" class="msg-action-btn" data-action="toggle-reaction" data-msg-id="${escapeHtml(msg.id)}" data-emoji="👍" title="Thumbs Up" aria-label="Add thumbs up reaction">${svgIcon('heart', 13)}</button>
            <button type="button" class="msg-action-btn" data-action="reply-msg" data-msg-id="${escapeHtml(msg.id)}" title="Reply" aria-label="Reply to message">${svgIcon('reply', 13)}</button>
            <button type="button" class="msg-action-btn" data-action="open-thread" data-msg-id="${escapeHtml(msg.id)}" title="Open Thread" aria-label="Open message thread">${svgIcon('chat', 13)}</button>
            <button type="button" class="msg-action-btn" data-action="toggle-bookmark" data-msg-id="${escapeHtml(msg.id)}" title="${isBookmarked ? 'Remove Bookmark' : 'Save Bookmark'}" aria-label="Bookmark message">${svgIcon(isBookmarked ? 'bookmarkFilled' : 'bookmark', 13)}</button>
            <button type="button" class="msg-action-btn" data-action="toggle-pin" data-msg-id="${escapeHtml(msg.id)}" title="Pin / Unpin" aria-label="Toggle pin message">${svgIcon('pin', 13)}</button>
            ${canEdit ? `<button type="button" class="msg-action-btn" data-action="edit-msg" data-msg-id="${escapeHtml(msg.id)}" title="Edit" aria-label="Edit message">${svgIcon('edit', 13)}</button>` : ''}
            ${canEdit || getActiveServer()?.ownerId === profile.id ? `<button type="button" class="msg-action-btn" data-action="delete-msg" data-msg-id="${escapeHtml(msg.id)}" title="Delete" aria-label="Delete message">${svgIcon('trash', 13)}</button>` : ''}
            ${!canEdit ? `<button type="button" class="msg-action-btn" data-action="open-report" data-target-type="message" data-target-id="${escapeHtml(msg.id)}" title="Report Message" aria-label="Report message">${svgIcon('flag', 13)}</button>` : ''}
          </div>`;

      return `
        ${dateSeparatorHtml}
        <article class="msg-row ${isDmMode ? `is-dm-msg ${isDmSelf ? 'is-self' : 'is-peer'}` : ''} ${isGrouped ? 'grouped' : ''} ${msg.pinned ? 'pinned-highlight' : ''}" data-msg-id="${escapeHtml(msg.id)}">
          ${rowInnerHtml}
          ${toolbarHtml}
        </article>
      `;
    })
    .join('');

  scroll.innerHTML = welcomeHtml + rowsHtml;
  scroll.scrollTop = scroll.scrollHeight;
}

function renderVoiceStageView(container, channel) {
  const connected = rtcState.activeCall?.targetId === channel.id;
  const peers = connected
    ? (rtcState.peers.length > 0
        ? rtcState.peers
        : [{ userId: profile.id, displayName: profile.displayName, initials: profile.initials, muted: rtcState.muted, videoOn: rtcState.videoOn, screenSharing: rtcState.screenSharing, handRaised: rtcState.handRaised }])
    : [];

  container.innerHTML = `
    <div class="stage-banner">
      <div>
        <h2 style="margin:0;font-size:1.15rem;display:flex;align-items:center;gap:8px;">${getChannelIconSvg(channel.type, 18)} <span>${escapeHtml(channel.name)}</span></h2>
        <p class="member-sub" style="margin:4px 0 0;">${escapeHtml(channel.topic || 'Live voice, video & screen-share room')}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${
          connected
            ? `<button type="button" class="btn btn-danger" data-action="leave-voice">${svgIcon('phoneOff', 14)} <span>Disconnect</span></button>`
            : `
              <button type="button" class="btn btn-secondary" data-action="join-voice" data-channel-id="${escapeHtml(channel.id)}" data-call-mode="audio">${svgIcon('phone', 14)} <span>Join Audio Room</span></button>
              <button type="button" class="btn btn-secondary" data-action="join-voice" data-channel-id="${escapeHtml(channel.id)}" data-call-mode="video">${svgIcon('video', 14)} <span>Join Video Call</span></button>
              <button type="button" class="btn btn-primary" data-action="join-voice" data-channel-id="${escapeHtml(channel.id)}" data-call-mode="screen">${svgIcon('screen', 14)} <span>Share Screen</span></button>
            `
        }
      </div>
    </div>

    ${
      connected && rtcState.mediaNotice
        ? `<div class="file-row" style="background:var(--accent-soft);border:1px solid var(--accent-border);">
            <span class="member-sub" style="color:var(--text-primary);white-space:normal;">${escapeHtml(rtcState.mediaNotice)}</span>
          </div>`
        : ''
    }

    <div>
      <div class="member-group-title" style="margin-bottom:10px;">Active Participants (${peers.length})</div>
      ${
        connected
          ? `<div class="rtc-stage-grid">
              ${peers
                .map((p) => {
                  const isMe = p.userId === profile.id;
                  const hasVideo = isMe
                    ? Boolean(rtcState.screenStream || rtcState.localStream?.getVideoTracks().length)
                    : Boolean(rtcState.remoteStreams?.get(p.userId)?.getVideoTracks().length);
                  const summary = summarizeMediaState(p);
                  const statusLabel =
                    isMe && rtcState.screenSharing && rtcState.screenShareKind === 'board'
                      ? 'Sharing Whiteboard'
                      : isMe && rtcState.screenSharing && rtcState.screenShareKind === 'photo'
                        ? 'Sharing Photo'
                        : summary.label;
                  return `
                    <div class="rtc-video-card ${p.screenSharing ? 'screen-active' : ''}">
                      ${
                        hasVideo
                          ? `<video class="rtc-video-el" data-rtc-video="${escapeHtml(p.userId)}" data-rtc-local="${isMe ? 'true' : 'false'}" autoplay playsinline ${isMe ? 'muted' : ''}></video>`
                          : `<div class="speaker-avatar-lg">${escapeHtml(p.initials || getInitials(p.displayName || 'MB'))}</div>`
                      }
                      ${!isMe ? `<audio data-rtc-remote-audio="${escapeHtml(p.userId)}" autoplay></audio>` : ''}
                      <div class="rtc-card-overlay">
                        <span class="rtc-name-pill">${escapeHtml(p.displayName)}${isMe ? ' (You)' : ''}</span>
                        <span class="rtc-status-pill">${escapeHtml(statusLabel)}</span>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>`
          : `<div class="speakers-grid">
              <div class="speaker-card">
                <div class="speaker-avatar-lg">${svgIcon('stage', 24)}</div>
                <strong>Room Ready for Live Call &amp; Screen Share</strong>
                <span class="member-sub" style="white-space:normal;">Choose Audio, Video, or Share Screen above to start talking live with community members.</span>
              </div>
            </div>`
      }
    </div>

    <div style="display:grid;gap:10px;">
      <div class="voice-controls-bar">
        <button type="button" class="btn ${rtcState.muted ? 'btn-danger' : 'btn-secondary'}" data-action="toggle-mute">${rtcState.muted ? svgIcon('micOff', 14) : svgIcon('mic', 14)} <span>${rtcState.muted ? 'Unmute Mic' : 'Mute Mic'}</span></button>
        <button type="button" class="btn ${rtcState.videoOn ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-camera">${rtcState.videoOn ? svgIcon('videoOff', 14) : svgIcon('video', 14)} <span>${rtcState.videoOn ? 'Camera Off' : 'Camera On'}</span></button>
        <button type="button" class="btn btn-secondary" data-action="flip-camera" title="Switch Front / Rear Camera">${svgIcon('cameraFlip', 14)} <span>${rtcState.cameraFacing === 'environment' ? 'Front Cam' : 'Rear Cam'}</span></button>
        <button type="button" class="btn ${rtcState.screenSharing ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-screen-share">${svgIcon('screen', 14)} <span>${rtcState.screenSharing ? 'Stop Screen Share' : 'Share Screen'}</span></button>
        <button type="button" class="btn btn-secondary" data-action="open-share-options">${svgIcon('image', 14)} <span>${rtcState.screenSharing && (rtcState.screenShareKind === 'board' || rtcState.screenShareKind === 'photo') ? 'Edit Board' : 'Share Options'}</span></button>
        <button type="button" class="btn ${rtcState.deafened ? 'btn-danger' : 'btn-secondary'}" data-action="toggle-deafen">${svgIcon('headphones', 14)} <span>${rtcState.deafened ? 'Undeafen' : 'Deafen'}</span></button>
        <button type="button" class="btn ${rtcState.handRaised ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-hand">${svgIcon('hand', 14)} <span>${rtcState.handRaised ? 'Lower Hand' : 'Raise Hand'}</span></button>
      </div>
      ${renderDeviceControlsBar(false)}
    </div>
  `;

  rtc.attachMediaElements(container);
}

function renderDiscoveryView(container) {
  const list = state.publicServers || [];
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0 0 6px;font-size:1.25rem;">Discover Public Communities</h2>
        <p class="member-sub" style="margin:0;">Every community uses request-to-join approval or a shared invite link before access is granted.</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary" data-action="open-join-community-link">${svgIcon('link', 14)} <span>Join via Invite Link</span></button>
        <button type="button" class="btn btn-primary" data-action="open-create-server">${svgIcon('plus', 14)} <span>Create Community</span></button>
      </div>
    </div>
    ${
      list.length === 0
        ? `<div class="empty-workspace-card" style="margin:12px 0;">
            <h2>No Public Communities Listed Yet</h2>
            <p class="member-sub" style="white-space:normal;">Create a public or private community, or join one using an invite link shared with you.</p>
          </div>`
        : `<div class="discovery-grid">
            ${list
              .map((srv) => {
                const status = formatMembershipStatus(srv, profile.id, state.joinedServerIds, state.myJoinRequests);
                let actionBtn = '';
                if (status === 'owner' || status === 'member') {
                  actionBtn = `<button type="button" class="btn btn-secondary" data-action="open-owned-or-joined" data-server-id="${escapeHtml(srv.id)}">Open Community</button>`;
                } else if (status === 'approved') {
                  actionBtn = `<button type="button" class="btn btn-primary" data-action="complete-approved-join" data-server-id="${escapeHtml(srv.id)}">Approved — Enter Community</button>`;
                } else if (status === 'pending') {
                  actionBtn = `<button type="button" class="btn btn-secondary" disabled>${svgIcon('clock', 14)} <span>Request Pending Approval</span></button>`;
                } else {
                  actionBtn = `<button type="button" class="btn btn-primary" data-action="request-join-public" data-server-id="${escapeHtml(srv.id)}">${svgIcon('userPlus', 14)} <span>Request to Join</span></button>`;
                }
                return `
                  <article class="discovery-card">
                    <div class="discovery-body">
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                          <div class="avatar-circle">${escapeHtml(srv.glyph || getInitials(srv.name))}</div>
                          <div style="min-width:0;">
                            <strong>${escapeHtml(srv.name)}</strong>
                            <div class="member-sub">${escapeHtml(srv.category || 'Community')} · Request Gated</div>
                          </div>
                        </div>
                        <button type="button" class="icon-btn" style="width:28px;height:28px;flex-shrink:0;" data-action="community-card-menu" data-server-id="${escapeHtml(srv.id)}" aria-label="Community options for ${escapeHtml(srv.name)}" title="Community Options">⋮</button>
                      </div>
                      <p class="member-sub" style="white-space:normal;line-height:1.45;">${escapeHtml(srv.description || 'Community space on NEXORA.')}</p>
                      ${
                        srv.rules
                          ? `<div style="font-size:0.76rem;color:var(--text-muted);white-space:pre-line;border-top:1px solid var(--border-subtle);padding-top:8px;"><strong>Rules:</strong> ${escapeHtml(srv.rules.slice(0, 140))}</div>`
                          : ''
                      }
                      <div style="margin-top:auto;padding-top:6px;">${actionBtn}</div>
                    </div>
                  </article>
                `;
              })
              .join('')}
          </div>`
    }
  `;
}

function renderLeaderAdminAddResultsHtml(srv) {
  if (!srv || srv.ownerId !== profile.id) return '';
  const candidates = filterAddableUsers(state.directoryUsers, state.serverMemberIds, srv.ownerId, state.leaderAddSearch, 8);
  if (candidates.length === 0) {
    return '<p class="member-sub" style="padding:4px 2px;">No matching users found outside this community.</p>';
  }
  return candidates
    .map(
      (u) => `
      <div class="file-row" style="justify-content:space-between;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
          <div class="avatar-circle" style="width:28px;height:28px;font-size:0.72rem;">
            <span>${escapeHtml(u.initials || getInitials(u.displayName))}</span>
            <span class="status-dot ${escapeHtml(u.status || 'online')}"></span>
          </div>
          <div style="min-width:0;">
            <strong>${escapeHtml(u.displayName)}</strong>
            <div class="member-sub">@${escapeHtml(u.username)} · ${escapeHtml(u.status || 'online')}</div>
          </div>
        </div>
        <button
          type="button"
          class="btn btn-primary"
          style="height:28px;font-size:0.75rem;flex-shrink:0;"
          data-action="leader-add-member"
          data-user-id="${escapeHtml(u.id)}"
        >+ Add to Community</button>
      </div>
    `
    )
    .join('');
}

function renderLeaderInspectorAddResultsHtml(srv) {
  if (!srv || srv.ownerId !== profile.id) return '';
  const candidates = filterAddableUsers(state.directoryUsers, state.serverMemberIds, srv.ownerId, state.leaderInspectorAddSearch, 6);
  if (candidates.length === 0) {
    return '<p class="member-sub" style="padding:4px 2px;">No matching users outside this community.</p>';
  }
  return candidates
    .map(
      (u) => `
      <div class="member-row" style="justify-content:space-between;padding:5px 6px;">
        <div style="min-width:0;display:flex;align-items:center;gap:8px;flex:1;">
          <div class="avatar-circle" style="width:26px;height:26px;font-size:0.68rem;">
            <span>${escapeHtml(u.initials || getInitials(u.displayName))}</span>
          </div>
          <div class="member-info">
            <div class="member-name" style="font-size:0.78rem;">${escapeHtml(u.displayName)}</div>
            <div class="member-sub">@${escapeHtml(u.username)}</div>
          </div>
        </div>
        <button
          type="button"
          class="btn btn-primary"
          style="height:26px;padding:0 9px;font-size:0.72rem;flex-shrink:0;"
          data-action="leader-add-member"
          data-user-id="${escapeHtml(u.id)}"
        >+ Add</button>
      </div>
    `
    )
    .join('');
}

function renderInspectorMembersList() {
  const listWrap = document.getElementById('inspector-members-list');
  if (!listWrap) return;

  const srv = state.activeView === 'server' ? getActiveServer() : null;
  const isLeader = Boolean(srv && srv.ownerId === profile.id);
  const q = state.userSearchQuery.trim();
  const allUsers = filterDirectoryUsers([profile, ...state.directoryUsers], q, {
    blockedSet: state.blockedSet,
    respectPrivacy: true,
    limit: 60,
  });
  const inServer = allUsers.filter((u) => u.id === srv?.ownerId || state.serverMemberIds.has(u.id));

  const renderMemberRow = (m) => {
    const isSelf = m.id === profile.id;
    const isConnected = state.acceptedPeerIds.has(m.id);
    const meta = state.serverMembersMeta.get(m.id);
    const isRowLeader = srv && m.id === srv.ownerId;
    const alertSummary = isLeader ? summarizeUserAlerts(state.serverAlerts, m.id) : null;
    const roleChip = isRowLeader ? 'Leader' : meta?.role === 'moderator' ? 'Mod' : '';
    return `
      <div class="member-row" style="justify-content:space-between;cursor:default;">
        <button type="button" data-action="open-member-popover" data-user-id="${escapeHtml(m.id)}" style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit;">
          <div class="avatar-circle">
            <span>${escapeHtml(m.initials || getInitials(m.displayName))}</span>
            <span class="status-dot ${escapeHtml(m.status || 'online')}"></span>
          </div>
          <div class="member-info">
            <div class="member-name">
              ${escapeHtml(m.displayName)}${isSelf ? ' (You)' : ''}
              ${roleChip ? `<span class="nx-role-mini-badge">${escapeHtml(roleChip)}</span>` : ''}
              ${alertSummary && alertSummary.totalCount > 0 ? `<span class="nx-warn-count-pill" title="${alertSummary.totalCount} abuse warning(s)">${alertSummary.totalCount}</span>` : ''}
            </div>
            <div class="member-sub">${escapeHtml(m.customStatus || `@${m.username}`)}</div>
          </div>
        </button>
        ${
          !isSelf
            ? `<div style="display:flex;gap:4px;flex-shrink:0;">
                <button type="button" class="icon-btn" style="width:28px;height:28px;" data-action="start-dm" data-user-id="${escapeHtml(m.id)}" title="${isConnected ? 'Open Chat' : 'Request Chat'}" aria-label="${isConnected ? 'Open Chat' : 'Request Chat'} with ${escapeHtml(m.displayName)}">${svgIcon(isConnected ? 'chat' : 'userPlus', 14)}</button>
                ${
                  isLeader && !isRowLeader
                    ? `<button type="button" class="icon-btn" style="width:28px;height:28px;color:#f59e0b;" data-action="open-leader-alert-modal" data-user-id="${escapeHtml(m.id)}" title="Warn / Alert for Abuse" aria-label="Send abuse alert to ${escapeHtml(m.displayName)}">${svgIcon('flag', 13)}</button>
                       <button type="button" class="icon-btn" style="width:28px;height:28px;color:#dc2626;" data-action="kick-server-member" data-user-id="${escapeHtml(m.id)}" title="Remove from Community" aria-label="Remove ${escapeHtml(m.displayName)}">${svgIcon('trash', 13)}</button>`
                    : isConnected
                      ? `<button type="button" class="icon-btn" style="width:28px;height:28px;" data-action="call-user-direct" data-call-mode="audio" data-user-id="${escapeHtml(m.id)}" title="Call ${escapeHtml(m.displayName)}" aria-label="Call ${escapeHtml(m.displayName)}">${svgIcon('phone', 14)}</button>`
                      : ''
                }
              </div>`
            : ''
        }
      </div>
    `;
  };

  listWrap.innerHTML = `
    ${
      srv
        ? `<div>
            <div class="member-group-title">${q ? `Matched Members (${inServer.length})` : `Community Members — ${inServer.length}`}</div>
            ${inServer.map(renderMemberRow).join('') || '<p class="member-sub" style="padding:4px 8px;">No community members match.</p>'}
          </div>
          ${
            isLeader
              ? `<div class="nx-leader-add-box">
                  <div class="member-group-title" style="padding-left:0;">Leader: Add User</div>
                  <input
                    type="search"
                    class="directory-search-input"
                    id="leader-inspector-add-input"
                    placeholder="Find user to add..."
                    aria-label="Find registered user to add to community"
                    value="${escapeHtml(state.leaderInspectorAddSearch)}"
                  />
                  <div id="leader-inspector-add-results" style="display:grid;gap:4px;">${renderLeaderInspectorAddResultsHtml(srv)}</div>
                </div>`
              : ''
          }`
        : '<p class="member-sub" style="padding:8px;">Select a community server to view members.</p>'
    }
  `;
}

function renderInspector() {
  const scroll = document.getElementById('inspector-scroll');
  if (!scroll) return;

  document.querySelectorAll('[data-inspector-tab]').forEach((t) => {
    const active = t.getAttribute('data-inspector-tab') === state.inspectorTab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });

  if (state.inspectorTab === 'saved') {
    const srv = getActiveServer();
    scroll.innerHTML = `
      ${
        srv
          ? `<div>
              <div class="member-group-title">Community About</div>
              <p class="member-sub" style="white-space:normal;padding-inline:6px;line-height:1.5;">${escapeHtml(srv.description || 'NEXORA Community Space')}</p>
            </div>
            <div>
              <div class="member-group-title">Upcoming Events (${state.serverEvents.length})</div>
              <div style="display:grid;gap:8px;">
                ${
                  state.serverEvents
                    .map((ev) => {
                      const interested = Array.isArray(ev.interestedUids) ? ev.interestedUids : [];
                      const isGoing = interested.includes(profile.id);
                      return `
                        <div class="event-card">
                          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                            <strong style="font-size:0.84rem;">${escapeHtml(ev.title)}</strong>
                            <span class="member-sub mono">${escapeHtml(ev.scheduledFor)}</span>
                          </div>
                          ${ev.description ? `<span class="member-sub" style="white-space:normal;">${escapeHtml(ev.description)}</span>` : ''}
                          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                            <span class="member-sub tabular">${interested.length} going</span>
                            <button type="button" class="btn ${isGoing ? 'btn-primary' : 'btn-secondary'}" style="height:26px;font-size:0.74rem;" data-action="rsvp-event" data-event-id="${escapeHtml(ev.id)}">${isGoing ? 'Going' : 'RSVP'}</button>
                          </div>
                        </div>
                      `;
                    })
                    .join('') || '<p class="member-sub" style="padding:4px 6px;">No scheduled events yet.</p>'
                }
              </div>
            </div>`
          : ''
      }
      <div>
        <div class="member-group-title">Saved Bookmarks (${state.bookmarks.length})</div>
        <div style="display:grid;gap:6px;">
          ${
            state.bookmarks
              .map(
                (b) => `
                <div class="file-row" style="flex-direction:column;align-items:flex-start;">
                  <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                    <strong>${escapeHtml(b.authorName)}</strong>
                    <button type="button" class="icon-btn" style="width:24px;height:24px;" data-action="remove-bookmark" data-bookmark-id="${escapeHtml(b.id)}" aria-label="Remove bookmark">${svgIcon('close', 12)}</button>
                  </div>
                  <span class="member-sub" style="white-space:normal;color:var(--text-secondary);">${escapeHtml(b.content)}</span>
                </div>
              `
              )
              .join('') || '<p class="member-sub" style="padding:4px 6px;">Bookmark any message to save it here.</p>'
          }
        </div>
      </div>
    `;
    return;
  }

  if (state.inspectorTab === 'thread') {
    const msgs =
      state.activeView === 'home' ? state.dmMessages[state.activeDmId] || [] : state.messages[state.activeChannelId] || [];
    const parent = msgs.find((m) => m.id === state.activeThreadMsgId);
    if (!parent) {
      scroll.innerHTML = `<p class="member-sub" style="padding:12px;white-space:normal;">Click the thread icon on any message to view or reply in its thread.</p>`;
      return;
    }
    scroll.innerHTML = `
      <div>
        <div class="member-group-title">Thread Parent</div>
        <div class="file-row" style="flex-direction:column;align-items:flex-start;">
          <strong>${escapeHtml(parent.senderName || getMember(parent.authorId).displayName)}</strong>
          <div style="font-size:0.83rem;">${formatMessageMarkdown(parent.content)}</div>
        </div>
      </div>
      <div style="display:grid;gap:8px;">
        <div class="member-group-title">Replies (${(parent.replies || []).length})</div>
        ${(parent.replies || [])
          .map(
            (rep) => `
              <div class="file-row" style="flex-direction:column;align-items:flex-start;">
                <div style="display:flex;justify-content:space-between;width:100%;">
                  <strong>${escapeHtml(rep.senderName || getMember(rep.authorId).displayName)}</strong>
                  <span class="member-sub mono">${escapeHtml(rep.time)}</span>
                </div>
                <div style="font-size:0.82rem;">${formatMessageMarkdown(rep.content)}</div>
              </div>
            `
          )
          .join('')}
      </div>
      <form id="thread-reply-form" style="display:grid;gap:8px;margin-top:auto;">
        <input type="text" class="input" id="thread-reply-input" placeholder="Reply in thread..." required />
        <button type="submit" class="btn btn-primary">Send Reply</button>
      </form>
    `;
    return;
  }

  const existingInput = document.getElementById('inspector-user-search');
  if (existingInput && document.getElementById('inspector-members-list')) {
    if (existingInput instanceof HTMLInputElement && existingInput.value !== state.userSearchQuery) {
      existingInput.value = state.userSearchQuery;
    }
    renderInspectorMembersList();
    return;
  }

  scroll.innerHTML = `
    <div>
      <input
        type="search"
        class="directory-search-input"
        id="inspector-user-search"
        placeholder="Search name or @handle..."
        aria-label="Search registered NEXORA users"
        value="${escapeHtml(state.userSearchQuery)}"
      />
    </div>
    <div id="inspector-members-list" style="display:grid;gap:14px;"></div>
  `;
  renderInspectorMembersList();
}

function renderEmojiPicker() {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;

  const q = emojiQuery.trim().toLowerCase();
  const list = EMOJI_BANK.filter((e) => {
    const catOk = emojiCategory === 'all' || e.cat === emojiCategory;
    const qOk = !q || e.name.includes(q);
    return catOk && qOk;
  });

  grid.innerHTML = list
    .map(
      (e) =>
        `<button type="button" class="emoji-cell" data-action="insert-emoji" data-emoji="${e.char}" aria-label="${escapeHtml(e.name)}">${e.char}</button>`
    )
    .join('');
}

function renderUserSettingsContent() {
  const content = document.getElementById('settings-content');
  if (!content) return;

  document.querySelectorAll('[data-user-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-user-tab') === activeSettingsTab);
  });

  if (activeSettingsTab === 'appearance') {
    content.innerHTML = `
      <div>
        <h3 style="margin:0 0 10px;">Workspace Theme</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn ${normalizeThemePreference(prefs.theme) === 'light' ? 'btn-primary' : 'btn-secondary'}" data-action="set-theme" data-theme="light">Light Lavender</button>
          <button type="button" class="btn ${normalizeThemePreference(prefs.theme) === 'dark' ? 'btn-primary' : 'btn-secondary'}" data-action="set-theme" data-theme="dark">Dark Neon</button>
        </div>
      </div>

      <div>
        <h3 style="margin:0 0 10px;">Primary Accent</h3>
        <div class="swatch-row">
          ${ACCENTS.map(
            (a) =>
              `<button type="button" class="swatch-btn ${prefs.accent === a.hex ? 'active' : ''}" style="background:${a.hex};" data-action="set-accent" data-accent="${a.hex}" aria-label="${a.name} accent"></button>`
          ).join('')}
        </div>
      </div>

      <div class="setting-row">
        <div>
          <strong>Message Density</strong>
          <div class="member-sub">Switch between comfortable spacing and compact scannable rows.</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn ${prefs.density === 'cozy' ? 'btn-primary' : 'btn-secondary'}" data-action="set-density" data-density="cozy">Cozy</button>
          <button type="button" class="btn ${prefs.density === 'compact' ? 'btn-primary' : 'btn-secondary'}" data-action="set-density" data-density="compact">Compact</button>
        </div>
      </div>
    `;
    return;
  }

  if (activeSettingsTab === 'notifications') {
    content.innerHTML = `
      <div class="setting-row">
        <div>
          <strong>Mention Alerts</strong>
          <div class="member-sub">Highlight when someone replies or mentions @${escapeHtml(profile.username)}.</div>
        </div>
        <button type="button" role="switch" class="switch-btn" aria-checked="${prefs.notifyMentions}" data-action="toggle-pref" data-pref="notifyMentions"></button>
      </div>
      <div class="setting-row">
        <div>
          <strong>Direct Message &amp; Request Alerts</strong>
          <div class="member-sub">Show unread indicator when chat requests arrive.</div>
        </div>
        <button type="button" role="switch" class="switch-btn" aria-checked="${prefs.notifyDms}" data-action="toggle-pref" data-pref="notifyDms"></button>
      </div>
      <div class="setting-row">
        <div>
          <strong>Server Guard Notifications</strong>
          <div class="member-sub">Receive alerts when moderation rules trigger.</div>
        </div>
        <button type="button" role="switch" class="switch-btn" aria-checked="${prefs.notifyGuard}" data-action="toggle-pref" data-pref="notifyGuard"></button>
      </div>
    `;
    return;
  }

  if (activeSettingsTab === 'keybinds') {
    content.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td class="mono">Ctrl+K / Cmd+K</td><td>Open Quick Jump switcher</td></tr>
          <tr><td class="mono">[</td><td>Collapse or expand community sidebar</td></tr>
          <tr><td class="mono">Enter</td><td>Send message in active composer</td></tr>
          <tr><td class="mono">Escape</td><td>Close open modal, emoji panel, or popover</td></tr>
        </tbody>
      </table>
    `;
    return;
  }

  const identityLine = profile.email || profile.phoneNumber || 'Verified Member';
  content.innerHTML = `
    <div class="setting-row" style="padding-top:0;">
      <div>
        <strong>Verified Identity</strong>
        <div class="member-sub">${escapeHtml(identityLine)}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-secondary" data-action="export-user-data">${svgIcon('download', 14)} <span>Export Data</span></button>
        <button type="button" class="btn btn-secondary" data-action="sign-out">Sign Out</button>
      </div>
    </div>

    <form id="account-settings-form" style="display:grid;gap:10px;">
      <label>
        <span class="member-sub">Display Name</span>
        <input type="text" class="input" id="set-display-name" value="${escapeHtml(profile.displayName)}" required />
      </label>
      <label>
        <span class="member-sub">Username Handle</span>
        <input type="text" class="input" id="set-username" value="${escapeHtml(profile.username)}" required />
      </label>
      <label>
        <span class="member-sub">Account Privacy</span>
        <select class="select" id="set-account-privacy">
          <option value="everyone" ${profile.accountPrivacy === 'everyone' ? 'selected' : ''}>Discoverable in Directory (Requests Required)</option>
          <option value="requests_only" ${profile.accountPrivacy === 'requests_only' ? 'selected' : ''}>Requests Only</option>
          <option value="private" ${profile.accountPrivacy === 'private' ? 'selected' : ''}>Private (Only found via exact search)</option>
        </select>
      </label>
      <label>
        <span class="member-sub">Custom Status</span>
        <input type="text" class="input" id="set-custom-status" value="${escapeHtml(profile.customStatus)}" />
      </label>
      <label>
        <span class="member-sub">Bio</span>
        <textarea class="textarea" id="set-bio" rows="2">${escapeHtml(profile.bio)}</textarea>
      </label>
      <div>
        <button type="submit" class="btn btn-primary">Save Profile &amp; Privacy</button>
      </div>
    </form>

    <div style="border-top:1px solid var(--border-subtle);padding-top:14px;display:grid;gap:10px;">
      <strong>Blocked Users (${state.blockedUsers.length})</strong>
      ${
        state.blockedUsers.length > 0
          ? state.blockedUsers
              .map(
                (b) => `<div class="file-row">
                  <span>${escapeHtml(b.blockedName || b.id)}</span>
                  <button type="button" class="btn btn-secondary" style="height:28px;font-size:0.75rem;" data-action="unblock-user" data-user-id="${escapeHtml(b.id)}">Unblock</button>
                </div>`
              )
              .join('')
          : '<span class="member-sub">You have not blocked any users.</span>'
      }
    </div>

    <div style="border-top:1px solid var(--border-subtle);padding-top:14px;display:grid;gap:12px;">
      <strong>Security &amp; Credentials</strong>
      <form id="change-email-form" style="display:flex;gap:8px;flex-wrap:wrap;">
        <input type="email" class="input" id="new-account-email" placeholder="New email address..." style="flex:1;min-width:190px;" required />
        <button type="submit" class="btn btn-secondary">Change Email</button>
      </form>
      <form id="change-password-form" style="display:flex;gap:8px;flex-wrap:wrap;">
        <input type="password" class="input" id="new-account-password" placeholder="New password (min 6 chars)..." minlength="6" style="flex:1;min-width:190px;" required />
        <button type="submit" class="btn btn-secondary">Update Password</button>
      </form>
    </div>

    <div style="border-top:1px solid var(--border-subtle);padding-top:14px;display:grid;gap:8px;">
      ${
        confirmDeleteOpen
          ? `<div style="padding:12px;border-radius:var(--radius-sm);background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);display:grid;gap:8px;">
              <strong style="color:var(--danger);">Delete your NEXORA account permanently?</strong>
              <span class="member-sub" style="white-space:normal;">This removes your Firebase Auth user and Firestore profile permanently.</span>
              <div style="display:flex;gap:8px;">
                <button type="button" class="btn btn-danger" data-action="confirm-delete-account">Confirm Permanent Deletion</button>
                <button type="button" class="btn btn-secondary" data-action="cancel-delete-account">Cancel</button>
              </div>
            </div>`
          : `<div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="member-sub">Permanently delete your account &amp; profile</span>
              <button type="button" class="btn btn-danger" data-action="prompt-delete-account">Delete Account</button>
            </div>`
      }
    </div>
  `;
}

function renderAdminContent() {
  const content = document.getElementById('admin-content');
  if (!content) return;
  const srv = getActiveServer();
  if (!srv) {
    content.innerHTML = '<p class="member-sub">Create or enter a community first to manage settings.</p>';
    return;
  }

  const isOwner = srv.ownerId === profile.id;
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-admin-tab') === activeAdminTab);
  });

  if (activeAdminTab === 'requests') {
    if (!isOwner) {
      content.innerHTML = '<p class="member-sub">Only the community owner can review pending join requests.</p>';
      return;
    }
    const pending = state.serverJoinRequests.filter((r) => r.status === 'pending');
    content.innerHTML = `
      <div>
        <h3 style="margin:0 0 6px;">Community Join Requests (${pending.length} pending)</h3>
        <p class="member-sub" style="white-space:normal;">Members must accept community guidelines and receive approval before accessing channels.</p>
      </div>
      <div style="display:grid;gap:8px;">
        ${
          state.serverJoinRequests
            .map(
              (r) => `
              <div class="file-row">
                <div>
                  <strong>${escapeHtml(r.displayName || 'Member')}</strong>
                  <div class="member-sub">@${escapeHtml(r.username || 'member')} · Rules accepted: ${r.rulesAccepted ? 'Yes' : 'No'} · Status: ${escapeHtml(r.status)}</div>
                </div>
                ${
                  r.status === 'pending'
                    ? `<div style="display:flex;gap:6px;">
                        <button type="button" class="btn btn-primary" data-action="approve-join-req" data-user-id="${escapeHtml(r.userId)}">Approve</button>
                        <button type="button" class="btn btn-danger" data-action="decline-join-req" data-user-id="${escapeHtml(r.userId)}">Decline</button>
                      </div>`
                    : `<span class="member-sub mono">${escapeHtml(r.status)}</span>`
                }
              </div>
            `
            )
            .join('') || '<p class="member-sub">No join requests yet.</p>'
        }
      </div>
    `;
    return;
  }

  if (activeAdminTab === 'invites') {
    if (!isOwner) {
      content.innerHTML = '<p class="member-sub">Only the community owner can manage invite links.</p>';
      return;
    }
    const srvInvites = state.myInvites.filter((inv) => inv.serverId === srv.id);
    content.innerHTML = `
      <div>
        <h3 style="margin:0 0 6px;">Friend Invite Links</h3>
        <p class="member-sub" style="white-space:normal;">Share a verified invite link to let friends screen rules on the Welcome Hub and enter directly.</p>
      </div>
      <form id="create-invite-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <label style="display:grid;gap:4px;flex:1;min-width:130px;">
          <span class="member-sub">Expires (hours, 0 = never)</span>
          <input type="number" class="input" id="inv-expiry-hours" min="0" max="720" value="48" />
        </label>
        <label style="display:grid;gap:4px;flex:1;min-width:130px;">
          <span class="member-sub">Max Uses (0 = unlimited)</span>
          <input type="number" class="input" id="inv-max-uses" min="0" max="500" value="10" />
        </label>
        <button type="submit" class="btn btn-primary">Generate Invite</button>
      </form>
      <div style="display:grid;gap:8px;">
        ${
          srvInvites
            .map((inv) => {
              const v = validateInviteRecord(inv);
              return `
                <div class="file-row">
                  <div>
                    <strong class="mono">${escapeHtml(inv.code)}</strong>
                    <div class="member-sub tabular">Uses: ${inv.uses || 0}${inv.maxUses ? ` / ${inv.maxUses}` : ' (unlimited)'} · ${v.valid ? 'Active' : escapeHtml(v.reason)}</div>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <button type="button" class="btn btn-secondary" data-action="copy-invite-code" data-code="${escapeHtml(inv.code)}">Copy Link</button>
                    ${
                      inv.active
                        ? `<button type="button" class="btn btn-danger" data-action="revoke-invite-code" data-code="${escapeHtml(inv.code)}">Revoke</button>`
                        : ''
                    }
                  </div>
                </div>
              `;
            })
            .join('') || '<p class="member-sub">No custom invite links generated yet.</p>'
        }
      </div>
    `;
    return;
  }

  if (activeAdminTab === 'events') {
    content.innerHTML = `
      <div>
        <h3 style="margin:0 0 6px;">Scheduled Community Events (${state.serverEvents.length})</h3>
        <p class="member-sub" style="white-space:normal;">Schedule sessions and let members RSVP directly from the Saved inspector tab.</p>
      </div>
      <form id="create-event-form" style="display:grid;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle);">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <input type="text" class="input" id="ev-title" placeholder="Event title..." minlength="2" maxlength="100" required />
          <input type="text" class="input" id="ev-when" placeholder="e.g. Friday 18:00 UTC" minlength="3" maxlength="64" required />
        </div>
        <input type="text" class="input" id="ev-desc" placeholder="Topic or agenda (optional)..." maxlength="300" />
        <div><button type="submit" class="btn btn-primary">${svgIcon('calendar', 14)} <span>Create Event</span></button></div>
      </form>
      <div style="display:grid;gap:8px;">
        ${
          state.serverEvents
            .map(
              (ev) => `
              <div class="file-row">
                <div>
                  <strong>${escapeHtml(ev.title)}</strong>
                  <div class="member-sub">${escapeHtml(ev.scheduledFor)} · ${(ev.interestedUids || []).length} going</div>
                </div>
                <button type="button" class="btn btn-secondary" data-action="rsvp-event" data-event-id="${escapeHtml(ev.id)}">RSVP</button>
              </div>
            `
            )
            .join('') || '<p class="member-sub">No events scheduled yet.</p>'
        }
      </div>
    `;
    return;
  }

  if (activeAdminTab === 'roles') {
    const roles = srv.roles || DEFAULT_ROLES;
    const role = roles.find((r) => r.id === selectedRoleId) || roles[0];
    const permDefs = [
      ['manageRoles', 'Manage Roles', 'Create, edit, and reorder server roles.'],
      ['manageMembers', 'Manage Members', 'Assign roles and manage server member profiles.'],
      ['moderateContent', 'Moderate Content', 'Pin, delete, and review reported channel messages.'],
      ['banMembers', 'Ban Members', 'Restrict accounts from rejoining the server.'],
      ['manageChannels', 'Manage Channels', 'Create, rename, and organize channel categories.'],
      ['pinMessages', 'Pin Messages', 'Pin reference messages inside text channels.'],
      ['voiceSpeak', 'Speak in Voice', 'Broadcast audio inside voice and stage rooms.'],
    ];

    content.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${roles
          .map(
            (r) =>
              `<button type="button" class="btn ${r.id === role.id ? 'btn-primary' : 'btn-secondary'}" data-action="select-admin-role" data-role-id="${escapeHtml(r.id)}">${escapeHtml(r.name)}</button>`
          )
          .join('')}
      </div>
      <div>
        ${permDefs
          .map(([key, title, desc]) => {
            const checked = Boolean(role.permissions[key]);
            return `
              <div class="setting-row">
                <div>
                  <strong>${title}</strong>
                  <div class="member-sub">${desc}</div>
                </div>
                <button type="button" role="switch" class="switch-btn" aria-checked="${checked}" data-action="toggle-role-perm" data-role-id="${escapeHtml(role.id)}" data-perm="${key}"></button>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
    return;
  }

  if (activeAdminTab === 'guard') {
    const g = srv.guard || { active: true, antiSpamLinks: true, purgeUnverified: false, purgeDays: 7, blockedWords: [] };
    content.innerHTML = `
      <div class="setting-row">
        <div>
          <strong>Server Guard Active</strong>
          <div class="member-sub">Automated spam screening and keyword moderation for ${escapeHtml(srv.name)}.</div>
        </div>
        <button type="button" role="switch" class="switch-btn" aria-checked="${Boolean(g.active)}" data-action="toggle-guard" data-guard-key="active"></button>
      </div>
      <div class="setting-row">
        <div>
          <strong>Anti-Spam Link Filter</strong>
          <div class="member-sub">Flag suspicious invite URLs posted by non-moderator accounts.</div>
        </div>
        <button type="button" role="switch" class="switch-btn" aria-checked="${Boolean(g.antiSpamLinks)}" data-action="toggle-guard" data-guard-key="antiSpamLinks"></button>
      </div>
      <div class="setting-row">
        <div>
          <strong>Purge Unverified Accounts</strong>
          <div class="member-sub">Automatically remove inactive unverified joins after ${g.purgeDays || 7} days.</div>
        </div>
        <button type="button" role="switch" class="switch-btn" aria-checked="${Boolean(g.purgeUnverified)}" data-action="toggle-guard" data-guard-key="purgeUnverified"></button>
      </div>
      <div>
        <strong>Blocked Keywords</strong>
        <p class="member-sub" style="margin:4px 0 10px;">Messages containing these terms are blocked by Server Guard.</p>
        <form id="add-blocked-word-form" style="display:flex;gap:8px;margin-bottom:10px;">
          <input type="text" class="input" id="blocked-word-input" placeholder="Add blocked keyword..." required />
          <button type="submit" class="btn btn-primary">Add</button>
        </form>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${(g.blockedWords || [])
            .map(
              (w) =>
                `<button type="button" class="btn btn-secondary" data-action="remove-blocked-word" data-word="${escapeHtml(w)}">${escapeHtml(w)} ${svgIcon('close', 12)}</button>`
            )
            .join('') || '<span class="member-sub">No blocked words configured.</span>'}
        </div>
      </div>
    `;
    return;
  }

  if (activeAdminTab === 'members') {
    const srvMembers = state.members.filter((m) => m.id === srv.ownerId || state.serverMemberIds.has(m.id));
    const alertsHistory = state.serverAlerts || [];
    content.innerHTML = `
      ${
        isOwner
          ? `<div class="nx-leader-add-box" style="margin-bottom:4px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                <div>
                  <strong>Leader: Add User Directly</strong>
                  <div class="member-sub">Search any NEXORA user and add them immediately to ${escapeHtml(srv.name)}.</div>
                </div>
              </div>
              <input
                type="search"
                class="input"
                id="leader-admin-add-input"
                placeholder="Search display name or @username to add..."
                value="${escapeHtml(state.leaderAddSearch)}"
              />
              <div id="leader-admin-add-results" style="display:grid;gap:6px;">
                ${renderLeaderAdminAddResultsHtml(srv)}
              </div>
            </div>`
          : ''
      }
      <div class="nx-table-scroll">
        <table class="data-table">
          <thead><tr><th>Member</th><th>Role</th><th>Alerts</th><th>Status</th>${isOwner ? '<th>Leader Actions</th>' : ''}</tr></thead>
          <tbody>
            ${srvMembers
              .map((m) => {
                const meta = state.serverMembersMeta.get(m.id);
                const roleLabel = m.id === srv.ownerId ? 'Leader (Owner)' : meta?.role || 'member';
                const warnSummary = summarizeUserAlerts(alertsHistory, m.id);
                return `
                  <tr>
                    <td><strong>${escapeHtml(m.displayName)}</strong><div class="member-sub">@${escapeHtml(m.username)}</div></td>
                    <td>
                      ${
                        isOwner && m.id !== srv.ownerId
                          ? `<button type="button" class="btn btn-secondary" style="height:26px;font-size:0.72rem;padding:0 8px;" data-action="leader-toggle-role" data-user-id="${escapeHtml(m.id)}" title="Switch between Member and Moderator">${escapeHtml(roleLabel)}</button>`
                          : `<span class="member-sub">${escapeHtml(roleLabel)}</span>`
                      }
                    </td>
                    <td>
                      ${
                        warnSummary.totalCount > 0
                          ? `<span class="nx-warn-count-pill">${warnSummary.totalCount} (${warnSummary.unackedCount} unread)</span>`
                          : '<span class="member-sub">0</span>'
                      }
                    </td>
                    <td class="member-sub">${escapeHtml(m.status)}</td>
                    ${
                      isOwner
                        ? `<td>${
                            m.id !== srv.ownerId
                              ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
                                  <button type="button" class="btn btn-secondary" style="height:28px;font-size:0.73rem;color:#d97706;border-color:rgba(217,119,6,0.4);" data-action="open-leader-alert-modal" data-user-id="${escapeHtml(m.id)}">Alert Abuse</button>
                                  <button type="button" class="btn btn-danger" style="height:28px;font-size:0.73rem;" data-action="kick-server-member" data-user-id="${escapeHtml(m.id)}">Remove</button>
                                </div>`
                              : '<span class="member-sub">Community Leader</span>'
                          }</td>`
                        : ''
                    }
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      ${
        isOwner
          ? `<div style="display:grid;gap:8px;padding-top:6px;">
              <strong>Issued Abuse Alerts (${alertsHistory.length})</strong>
              ${
                alertsHistory
                  .map(
                    (a) => `
                    <div class="file-row" style="flex-wrap:wrap;">
                      <div style="min-width:0;flex:1;">
                        <strong>${escapeHtml(a.targetName || 'Member')}</strong>
                        <span class="nx-leader-sev-pill ${a.severity === 'urgent' ? 'urgent' : ''}">${escapeHtml(a.severity)}</span>
                        <span class="member-sub"> · ${a.acknowledged ? 'Acknowledged' : 'Pending'} · ${escapeHtml(a.time || '')}</span>
                        <div class="member-sub" style="white-space:normal;">${escapeHtml(a.reason)}</div>
                      </div>
                      <button type="button" class="btn btn-secondary" style="height:26px;font-size:0.72rem;" data-action="leader-delete-alert" data-alert-id="${escapeHtml(a.id)}">Dismiss</button>
                    </div>
                  `
                  )
                  .join('') || '<p class="member-sub">No abuse alerts issued in this community yet.</p>'
              }
            </div>`
          : ''
      }
    `;
    return;
  }

  if (activeAdminTab === 'reports') {
    const srvReports = state.reports.filter((r) => r.serverId === srv.id || !r.serverId);
    content.innerHTML = `
      <div>
        <h3 style="margin:0 0 6px;">Safety Reports Queue (${srvReports.length})</h3>
        <p class="member-sub">Reports filed by members for moderator review.</p>
      </div>
      <div style="display:grid;gap:8px;">
        ${
          srvReports
            .map(
              (r) => `
              <div class="file-row" style="flex-wrap:wrap;">
                <div>
                  <strong>${escapeHtml(r.targetType)} report by ${escapeHtml(r.reporterName || 'Member')}</strong>
                  <div class="member-sub" style="white-space:normal;">${escapeHtml(r.reason)} · Status: <strong>${escapeHtml(r.status)}</strong></div>
                </div>
                ${
                  isOwner && r.status === 'open' && r.serverOwnerId === profile.id
                    ? `<div style="display:flex;gap:6px;">
                        <button type="button" class="btn btn-primary" style="height:28px;font-size:0.75rem;" data-action="resolve-report" data-report-id="${escapeHtml(r.id)}" data-status="resolved">Resolve</button>
                        <button type="button" class="btn btn-secondary" style="height:28px;font-size:0.75rem;" data-action="resolve-report" data-report-id="${escapeHtml(r.id)}" data-status="dismissed">Dismiss</button>
                      </div>`
                    : ''
                }
              </div>
            `
            )
            .join('') || '<p class="member-sub">No safety reports logged.</p>'
        }
      </div>
    `;
    return;
  }

  if (activeAdminTab === 'audit') {
    content.innerHTML = `
      <div class="nx-table-scroll">
        <table class="data-table">
          <thead><tr><th>Actor</th><th>Action</th><th>Time</th></tr></thead>
          <tbody>
            ${(srv.auditLog || [])
              .map(
                (a) =>
                  `<tr><td><strong>${escapeHtml(a.actor)}</strong></td><td>${escapeHtml(a.action)}</td><td class="mono">${escapeHtml(a.time)}</td></tr>`
              )
              .join('') || '<tr><td colspan="3" class="member-sub">No moderation actions recorded yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (activeAdminTab === 'analytics') {
    const channelCount = Object.values(state.channels).filter((c) => c.serverId === srv.id).length;
    const msgTotal = Object.keys(state.channels)
      .filter((id) => state.channels[id].serverId === srv.id)
      .reduce((sum, id) => sum + (state.messages[id]?.length || 0), 0);

    content.innerHTML = `
      <div class="stat-grid">
        <div class="stat-tile"><div class="label">Members</div><div class="value">${state.serverMemberIds.size || 1}</div></div>
        <div class="stat-tile"><div class="label">Channels</div><div class="value">${channelCount}</div></div>
        <div class="stat-tile"><div class="label">Messages</div><div class="value">${msgTotal}</div></div>
        <div class="stat-tile"><div class="label">Events</div><div class="value">${state.serverEvents.length}</div></div>
      </div>
      <div class="stat-tile">
        <div class="label" style="margin-bottom:6px;">Moderation &amp; Safety Snapshot</div>
        <div class="member-sub" style="white-space:normal;">
          Pending join requests: ${state.serverJoinRequests.filter((r) => r.status === 'pending').length} ·
          Audit entries: ${(srv.auditLog || []).length} ·
          Open reports: ${state.reports.filter((r) => r.serverId === srv.id && r.status === 'open').length}
        </div>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <form id="server-overview-form" style="display:grid;gap:12px;">
      <label>
        <span class="member-sub">Community Name</span>
        <input type="text" class="input" id="admin-srv-name" value="${escapeHtml(srv.name)}" required />
      </label>
      <label>
        <span class="member-sub">Description</span>
        <textarea class="textarea" id="admin-srv-desc" rows="2">${escapeHtml(srv.description)}</textarea>
      </label>
      <label>
        <span class="member-sub">Community Guidelines</span>
        <textarea class="textarea" id="admin-srv-rules" rows="3">${escapeHtml(srv.rules || '')}</textarea>
      </label>
      <div class="setting-row">
        <div>
          <strong>Invite Code</strong>
          <div class="member-sub mono">${escapeHtml(srv.inviteCode || srv.id)}</div>
        </div>
        <button type="button" class="btn btn-secondary" data-action="copy-invite">Copy Invite Link</button>
      </div>
      <div>
        <button type="submit" class="btn btn-primary">Save Community Overview</button>
      </div>
    </form>
  `;
}

function renderAll() {
  applyPrefsToDom();
  renderIncomingCallBanner();
  renderRail();
  renderSidebar();
  renderMainWorkspace();
  renderInspector();
  renderEmojiPicker();
  notifyInboxBridge();
}

/* ---------- POPOVERS & MODALS ---------- */

function openModal(id) {
  closePopover();
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('open');
  if (id === 'settings-modal') {
    confirmDeleteOpen = false;
    renderUserSettingsContent();
  }
  if (id === 'server-admin-modal') renderAdminContent();
  if (id === 'quickswitcher-modal') renderQuickSwitcher('');
  const focusable = modal.querySelector('input, button, select, textarea');
  if (focusable instanceof HTMLElement) focusable.focus();
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
}

function safeRoundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

function paintShareLiveBadge(ctx, width) {
  if (!ctx) return;
  ctx.save();
  ctx.fillStyle = '#111d33';
  safeRoundRectPath(ctx, width - 140, 14, 124, 30, 8);
  ctx.fill();
  ctx.fillStyle = sharePulseOn ? '#FF7A2F' : '#9a4d22';
  ctx.beginPath();
  ctx.arc(width - 122, 29, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.fillText('LIVE SHARE', width - 108, 34);
  ctx.restore();
}

function startShareBoardKeepAlive() {
  stopShareBoardKeepAlive();
  shareKeepAliveTimer = window.setInterval(() => {
    const canvas = document.getElementById('share-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    if (!rtcState.screenSharing) {
      stopShareBoardKeepAlive();
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    sharePulseOn = !sharePulseOn;
    paintShareLiveBadge(ctx, canvas.width);
  }, 600);
}

function stopShareBoardKeepAlive() {
  if (shareKeepAliveTimer !== null) {
    clearInterval(shareKeepAliveTimer);
    shareKeepAliveTimer = null;
  }
}

function initShareBoardCanvas({ clear = false, titleText = '' } = {}) {
  const canvas = document.getElementById('share-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (shareBoardReady && !clear) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#0b1424';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 20px system-ui, -apple-system, sans-serif';
  ctx.fillText(titleText || `NEXORA Live Whiteboard • @${profile.username || 'member'}`, 22, 36);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 14px system-ui, -apple-system, sans-serif';
  ctx.fillText('Draw with finger or mouse, add notes below, or load a screenshot to stream live.', 22, 60);

  paintShareLiveBadge(ctx, w);
  shareBoardReady = true;
  shareNoteSlot = 0;
  return canvas;
}

function drawImageOntoShareCanvas(img, fileName = 'Shared Photo') {
  const canvas = document.getElementById('share-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#0b1424';
  ctx.fillRect(0, 0, w, h);

  const pad = 24;
  const availW = w - pad * 2;
  const availH = h - 72;
  const scale = Math.min(availW / img.width, availH / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const drawX = (w - drawW) / 2;
  const drawY = 56 + (availH - drawH) / 2;

  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  ctx.fillStyle = 'rgba(11, 20, 36, 0.85)';
  ctx.fillRect(0, 0, w, 50);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 16px system-ui, -apple-system, sans-serif';
  ctx.fillText(`Shared Slide: ${fileName.slice(0, 48)}`, 20, 32);
  paintShareLiveBadge(ctx, w);

  shareBoardReady = true;
  shareNoteSlot = 0;
  return canvas;
}

function stampNoteOntoShareCanvas(text) {
  const canvas = initShareBoardCanvas();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const note = String(text || '').trim().slice(0, 90);
  if (!note) return;

  const y = 94 + (shareNoteSlot % 7) * 58;
  shareNoteSlot += 1;

  ctx.save();
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  const metrics = ctx.measureText(note);
  const pillW = Math.min(canvas.width - 60, Math.max(180, metrics.width + 36));

  ctx.fillStyle = 'rgba(17, 29, 51, 0.92)';
  ctx.strokeStyle = shareInkColor || '#FF7A2F';
  ctx.lineWidth = 2;
  safeRoundRectPath(ctx, 28, y, pillW, 44, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.fillText(note, 44, y + 29, pillW - 32);
  ctx.restore();
}

function renderMobileShareStatusButtons() {
  const stopBtn = document.getElementById('btn-stop-board-share');
  if (stopBtn) stopBtn.hidden = !rtcState.screenSharing;
}

function openMobileShareModal(support = detectScreenShareSupport(), reason = '') {
  openModal('mobile-share-modal');
  initShareBoardCanvas();

  const labelEl = document.getElementById('mobile-share-platform-label');
  const noteEl = document.getElementById('mobile-share-compat-note');
  const dispBtn = document.getElementById('btn-share-display');
  const dispSub = document.getElementById('mobile-share-display-sub');

  if (labelEl) {
    labelEl.textContent =
      support.platform === 'ios'
        ? 'iOS / iPadOS Mobile Share Options'
        : support.platform === 'android'
          ? 'Android Mobile Share Options'
          : 'Live Screen & Media Share Options';
  }
  if (noteEl) {
    noteEl.textContent =
      reason === 'capture_failed'
        ? 'System screen capture could not start on this device. Use Photo/Screenshot, Live Whiteboard, or Rear Camera below — all stream live over WebRTC.'
        : support.supportNote;
  }
  if (dispBtn && dispSub) {
    if (!support.nativeDisplayMedia) {
      dispBtn.classList.add('is-unavailable');
      dispSub.textContent = 'Unavailable in iOS Safari / WebKit — use Photo, Board, or Rear Cam';
    } else {
      dispBtn.classList.remove('is-unavailable');
      dispSub.textContent = support.isMobile
        ? 'Mobile browser screen capture (automatic compatibility fallback)'
        : 'Stream your full screen, browser tab, or window live';
    }
  }
  renderMobileShareStatusButtons();
}

async function ensureActiveCallForShare() {
  if (rtcState.activeCall) return true;
  if (state.activeView === 'home' && state.activeDmId) {
    const activeDm = state.dms.find((d) => d.id === state.activeDmId);
    if (activeDm?.userId) {
      await startDmCallWithUser(activeDm.userId, 'audio');
      return Boolean(rtcState.activeCall);
    }
  } else if (state.activeView === 'server' && state.activeChannelId) {
    const ch = state.channels[state.activeChannelId];
    if (ch && (ch.type === 'voice' || ch.type === 'stage')) {
      return await rtc.joinCall({
        callId: getRoomCallId(ch.type, ch.id),
        kind: ch.type === 'stage' ? 'stage' : 'voice',
        targetId: ch.id,
        title: ch.name,
        currentUserProfile: profile,
        withVideo: false,
        withScreen: false,
        muted: prefs.muted,
        deafened: prefs.deafened,
        handRaised: rtcState.handRaised,
      });
    }
  }
  showToast('Open an accepted DM chat or Voice/Stage room before sharing.');
  return false;
}

function closePopover() {
  const pop = document.getElementById('popover-panel');
  if (pop) {
    pop.classList.remove('open');
    pop.innerHTML = '';
  }
}

function openPopoverNear(anchorEl, html) {
  const pop = document.getElementById('popover-panel');
  if (!pop || !anchorEl) return;
  pop.innerHTML = html;
  pop.classList.add('open');

  const rect = anchorEl.getBoundingClientRect();
  const top = Math.min(window.innerHeight - pop.offsetHeight - 12, Math.max(12, rect.bottom + 8));
  const left = Math.min(window.innerWidth - pop.offsetWidth - 12, Math.max(12, rect.left));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function renderQuickSwitcher(queryText) {
  const results = document.getElementById('qs-results');
  if (!results) return;
  const q = queryText.trim().toLowerCase();
  const items = [];

  for (const srv of state.servers) {
    items.push({ type: 'Community', label: srv.name, action: `qs-server:${srv.id}` });
  }
  for (const ch of Object.values(state.channels)) {
    const srv = state.servers.find((s) => s.id === ch.serverId);
    items.push({ type: 'Channel', label: `#${ch.name} (${srv ? srv.name : ''})`, action: `qs-channel:${ch.id}` });
  }
  for (const u of filterDirectoryUsers(state.directoryUsers, q, { excludeUid: profile.id, blockedSet: state.blockedSet, respectPrivacy: true, limit: 80 })) {
    items.push({ type: state.acceptedPeerIds.has(u.id) ? 'Chat' : 'Request', label: `${u.displayName} (@${u.username})`, action: `qs-dm:${u.id}` });
  }

  const matched = items.filter((it) => !q || it.label.toLowerCase().includes(q)).slice(0, 12);
  results.innerHTML =
    matched
      .map(
        (it) =>
          `<button type="button" class="menu-item" data-qs-action="${escapeHtml(it.action)}"><span>${escapeHtml(it.label)}</span><span class="kbd-chip">${it.type}</span></button>`
      )
      .join('') || '<span class="member-sub">No matching users, channels, or communities.</span>';
}

/* ---------- FIRESTORE WRITES & MESSAGE ACTIONS ---------- */

async function logModerationAction(srv, actionText) {
  if (!srv || !currentFirebaseUser || srv.ownerId !== currentFirebaseUser.uid) return;
  const logId = `log-${Date.now()}`;
  try {
    await setDoc(doc(db, 'servers', srv.id, 'moderation_logs', logId), {
      id: logId,
      actorId: currentFirebaseUser.uid,
      actorName: profile.displayName,
      ownerId: srv.ownerId,
      action: String(actionText).slice(0, 240),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Mod log write skipped:', err?.message);
  }
}

async function sendDmMessagePayload({ threadId, text, replyToId = null, attachment = null }) {
  const activeDm = state.dms.find((d) => d.id === threadId);
  if (!activeDm || !currentFirebaseUser || !Array.isArray(activeDm.participants) || activeDm.participants.length < 2) {
    showToast('Select an accepted chat or group conversation first.');
    return false;
  }

  const rawText = String(text || '').trim();
  if (!rawText && !attachment) return false;
  const messageText = (rawText || `[Attachment: ${attachment?.name || 'File'}]`).slice(0, 2000);
  const msgId = `dmmsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    id: msgId,
    threadId: activeDm.id,
    participantIds: activeDm.participants,
    senderId: currentFirebaseUser.uid,
    senderName: profile.displayName.slice(0, 50),
    senderInitials: profile.initials.slice(0, 4),
    content: messageText,
    seenBy: [currentFirebaseUser.uid],
    edited: false,
    pinned: false,
    reactions: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (replyToId) payload.replyToId = replyToId;
  if (attachment) payload.attachment = attachment;

  state.isSendingMessage = true;
  notifyInboxBridge();
  try {
    await setDoc(doc(db, 'dm_threads', activeDm.id, 'messages', msgId), payload);
    await updateDoc(doc(db, 'dm_threads', activeDm.id), {
      lastMessage: messageText.slice(0, 300),
      lastSenderId: currentFirebaseUser.uid,
      seenBy: [currentFirebaseUser.uid],
      [`typing.${currentFirebaseUser.uid}`]: 0,
      updatedAt: serverTimestamp(),
    });
    const recipientIds = activeDm.participants.filter((uid) => uid !== currentFirebaseUser.uid);
    if (nexoraWsClient && recipientIds.length > 0) {
      nexoraWsClient.send({
        type: 'dm:notify',
        threadId: activeDm.id,
        messageId: msgId,
        recipientIds,
      });
      nexoraWsClient.send({
        type: 'typing:stop',
        threadId: activeDm.id,
        recipientIds,
      });
    }
    return true;
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `dm_threads/${activeDm.id}/messages/${msgId}`,
      'Could not send message right now. Site may be busy.'
    );
    return false;
  } finally {
    state.isSendingMessage = false;
    syncComposerState();
    notifyInboxBridge();
  }
}

async function uploadChatAttachmentFile(file) {
  if (!file) return null;
  try {
    const uploaded = await uploadMediaFileToServer(file, { folder: 'dm' });
    if (uploaded?.url) {
      return {
        name: String(file.name || uploaded.name || 'file').slice(0, 80),
        type: String(uploaded.mimeType || file.type || 'application/octet-stream').slice(0, 60),
        size: Number(uploaded.size || file.size || 0),
        dataUrl: uploaded.url,
      };
    }
  } catch {}
  const dataUrl = file.type.startsWith('image/')
    ? await compressImageFile(file, { maxW: 1080, maxH: 1080, quality: 0.78, maxBytes: 240000 })
    : await readMediaFileBounded(file, 520000);
  return {
    name: String(file.name || 'file').slice(0, 80),
    type: String(file.type || 'application/octet-stream').slice(0, 60),
    size: Number(file.size || 0),
    dataUrl,
  };
}

async function sendMessageFromComposer() {
  const input = document.getElementById('message-input');
  if (!(input instanceof HTMLTextAreaElement)) return;
  if (state.isSendingMessage) return;
  const text = input.value.trim();
  const hasAttachment = Boolean(pendingMessageAttachment);
  if (!text && !hasAttachment) return;

  const messageText = (text || `[Attachment: ${pendingMessageAttachment?.name || 'File'}]`).slice(0, 2000);

  const srv = getActiveServer();
  if (state.activeView === 'server' && srv?.guard?.active) {
    const hit = (srv.guard.blockedWords || []).find((w) => w && messageText.toLowerCase().includes(w.toLowerCase()));
    if (hit) {
      showToast(`Server Guard blocked message containing "${hit}"`);
      return;
    }
  }

  if (state.activeView === 'home') {
    const replyBackup = state.replyToMsgId;
    const attachBackup = pendingMessageAttachment;
    state.replyToMsgId = null;
    pendingMessageAttachment = null;
    updateComposerAttachmentBar();
    input.value = '';
    input.style.height = 'auto';
    syncComposerState();

    const ok = await sendDmMessagePayload({
      threadId: state.activeDmId,
      text: messageText,
      replyToId: replyBackup,
      attachment: attachBackup,
    });
    if (!ok) {
      state.replyToMsgId = replyBackup;
      pendingMessageAttachment = attachBackup;
      updateComposerAttachmentBar();
      input.value = text;
    }
    return;
  }

  if (!srv || !state.activeChannelId || !currentFirebaseUser) return;
  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    id: msgId,
    channelId: state.activeChannelId,
    senderId: currentFirebaseUser.uid,
    senderName: profile.displayName.slice(0, 50),
    senderInitials: profile.initials.slice(0, 4),
    content: messageText,
    edited: false,
    pinned: false,
    reactions: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (state.replyToMsgId) payload.replyToId = state.replyToMsgId;
  if (pendingMessageAttachment) payload.attachment = pendingMessageAttachment;

  const replyBackup = state.replyToMsgId;
  const attachBackup = pendingMessageAttachment;
  state.replyToMsgId = null;
  pendingMessageAttachment = null;
  state.isSendingMessage = true;
  updateComposerAttachmentBar();
  input.value = '';
  input.style.height = 'auto';
  syncComposerState();

  try {
    await setDoc(doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', msgId), payload);
  } catch (err) {
    state.replyToMsgId = replyBackup;
    pendingMessageAttachment = attachBackup;
    updateComposerAttachmentBar();
    input.value = text;
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `servers/${srv.id}/channels/${state.activeChannelId}/messages/${msgId}`,
      'You cannot send a message here right now. Check community membership.'
    );
  } finally {
    state.isSendingMessage = false;
    syncComposerState();
  }
}

/* ---------- EVENT LISTENERS (DELEGATED ONCE) ---------- */

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  const shell = document.getElementById('nx-legacy-workspace') || document.getElementById('app-shell');

  const compactMq = window.matchMedia('(max-width: 1080px)');
  if (compactMq.matches && !prefs.inspectorCollapsed) {
    prefs.inspectorCollapsed = true;
    applyPrefsToDom();
  }
  compactMq.addEventListener('change', (ev) => {
    if (ev.matches && !prefs.inspectorCollapsed) {
      prefs.inspectorCollapsed = true;
      applyPrefsToDom();
    }
  });

  document.getElementById('mobile-nav-btn')?.addEventListener('click', () => {
    shell?.classList.toggle('mobile-nav-open');
  });

  document.getElementById('dm-mobile-back-btn')?.addEventListener('click', () => {
    state.dmThreadActiveMobile = false;
    renderMainWorkspace();
  });

  document.getElementById('drawer-scrim')?.addEventListener('click', () => {
    shell?.classList.remove('mobile-nav-open');
    if (window.innerWidth <= 1080 && !prefs.inspectorCollapsed) {
      prefs.inspectorCollapsed = true;
      applyPrefsToDom();
    }
  });

  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
    prefs.sidebarCollapsed = !prefs.sidebarCollapsed;
    savePrefs();
    applyPrefsToDom();
  });

  document.getElementById('inspector-toggle-btn')?.addEventListener('click', () => {
    prefs.inspectorCollapsed = !prefs.inspectorCollapsed;
    savePrefs();
    applyPrefsToDom();
  });

  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    prefs.theme = normalizeThemePreference(prefs.theme) === 'dark' ? 'light' : 'dark';
    savePrefs();
    applyPrefsToDom();
    showToast(prefs.theme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
  });

  document.getElementById('quickfind-btn')?.addEventListener('click', () => openModal('quickswitcher-modal'));
  document.getElementById('server-manage-btn')?.addEventListener('click', () => openModal('server-admin-modal'));
  document.getElementById('create-poll-trigger')?.addEventListener('click', () => openModal('create-poll-modal'));

  document.getElementById('mute-btn')?.addEventListener('click', async () => {
    prefs.muted = !prefs.muted;
    savePrefs();
    applyPrefsToDom();
    await rtc.setMuted(prefs.muted, profile);
  });

  document.getElementById('deafen-btn')?.addEventListener('click', () => {
    prefs.deafened = !prefs.deafened;
    savePrefs();
    applyPrefsToDom();
    rtc.setDeafened(prefs.deafened);
  });

  document.getElementById('leave-voice-dock-btn')?.addEventListener('click', async () => {
    await rtc.leaveCall();
    showToast('Call disconnected');
  });

  document.getElementById('inspector-scroll')?.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'inspector-user-search') {
      state.userSearchQuery = e.target.value;
      renderInspectorMembersList();
    } else if (e.target instanceof HTMLInputElement && e.target.id === 'leader-inspector-add-input') {
      state.leaderInspectorAddSearch = e.target.value;
      const resultsEl = document.getElementById('leader-inspector-add-results');
      const srv = getActiveServer();
      if (resultsEl && srv) {
        resultsEl.innerHTML = renderLeaderInspectorAddResultsHtml(srv);
      }
    }
  });

  document.getElementById('admin-content')?.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'leader-admin-add-input') {
      state.leaderAddSearch = e.target.value;
      const resultsEl = document.getElementById('leader-admin-add-results');
      const srv = getActiveServer();
      if (resultsEl && srv) {
        resultsEl.innerHTML = renderLeaderAdminAddResultsHtml(srv);
      }
    }
  });

  document.getElementById('sidebar-scroll')?.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'dm-user-search-input') {
      state.dmSearchQuery = e.target.value;
      renderDmSidebarList();
    }
  });

  document.getElementById('msg-search-input')?.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement) {
      state.searchQuery = e.target.value;
      renderMainWorkspace();
    }
  });

  document.getElementById('msg-search-clear-btn')?.addEventListener('click', () => {
    state.searchQuery = '';
    state.threadSearchOpen = false;
    renderMainWorkspace();
  });

  document.getElementById('msg-search-toggle-btn')?.addEventListener('click', () => {
    state.threadSearchOpen = !state.threadSearchOpen;
    renderMainWorkspace();
    if (state.threadSearchOpen) {
      document.getElementById('msg-search-input')?.focus();
    }
  });

  document.getElementById('cancel-reply-btn')?.addEventListener('click', () => {
    state.replyToMsgId = null;
    renderMainWorkspace();
  });

  document.getElementById('cancel-attachment-btn')?.addEventListener('click', () => {
    pendingMessageAttachment = null;
    updateComposerAttachmentBar();
  });

  document.getElementById('msg-voice-btn')?.addEventListener('click', async () => {
    if (voiceRecorder && voiceRecorder.state === 'recording') {
      voiceRecorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('Voice recording is not supported in this browser.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceRecordingChunks = [];
      voiceRecorder = new MediaRecorder(stream);
      const voiceBtn = document.getElementById('msg-voice-btn');
      voiceBtn?.classList.add('danger-active');
      voiceRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) voiceRecordingChunks.push(ev.data);
      };
      voiceRecorder.onstop = () => {
        voiceBtn?.classList.remove('danger-active');
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(voiceRecordingChunks, { type: voiceRecorder?.mimeType || 'audio/webm' });
        voiceRecordingChunks = [];
        if (blob.size > 520000) {
          showToast('Voice note was too large to sync. Keep recordings under ~30 seconds.', 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          pendingMessageAttachment = {
            name: `voice-note-${Date.now()}.webm`,
            type: blob.type || 'audio/webm',
            size: blob.size,
            dataUrl: String(reader.result || ''),
          };
          updateComposerAttachmentBar();
          showToast('Voice note ready to send');
        };
        reader.readAsDataURL(blob);
      };
      voiceRecorder.start();
      showToast('Recording voice note... Click the mic icon again to stop.');
    } catch {
      showToast('Microphone unavailable or permission denied right now.', 'error');
    }
  });

  document.getElementById('send-btn')?.addEventListener('click', sendMessageFromComposer);

  const msgInput = document.getElementById('message-input');
  msgInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessageFromComposer();
    }
  });
  msgInput?.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = `${Math.min(msgInput.scrollHeight, 140)}px`;
    if (
      state.activeView === 'home' &&
      state.activeDmId &&
      currentFirebaseUser &&
      !state.pendingPeerId
    ) {
      const now = Date.now();
      if (now - lastTypingSentMs > 2400) {
        lastTypingSentMs = now;
        const activeDm = state.dms.find((d) => d.id === state.activeDmId);
        if (nexoraWsClient && activeDm?.participants) {
          nexoraWsClient.send({
            type: 'typing:start',
            threadId: state.activeDmId,
            recipientIds: activeDm.participants.filter((uid) => uid !== currentFirebaseUser.uid),
          });
        }
        updateDoc(doc(db, 'dm_threads', state.activeDmId), {
          [`typing.${currentFirebaseUser.uid}`]: now,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }
  });

  const emojiPopover = document.getElementById('emoji-popover');
  const emojiToggle = document.getElementById('emoji-toggle-btn');
  emojiToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = emojiPopover?.classList.toggle('open');
    emojiToggle.setAttribute('aria-expanded', String(Boolean(open)));
    if (open) document.getElementById('emoji-search-input')?.focus();
  });

  document.getElementById('emoji-search-input')?.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement) {
      emojiQuery = e.target.value;
      renderEmojiPicker();
    }
  });

  document.getElementById('emoji-cats')?.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-emoji-cat]') : null;
    if (!btn) return;
    emojiCategory = btn.getAttribute('data-emoji-cat') || 'all';
    document.querySelectorAll('[data-emoji-cat]').forEach((b) => b.classList.toggle('active', b === btn));
    renderEmojiPicker();
  });

  document.querySelectorAll('[data-inspector-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.inspectorTab = btn.getAttribute('data-inspector-tab') || 'members';
      renderInspector();
    });
  });

  document.querySelectorAll('[data-user-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSettingsTab = btn.getAttribute('data-user-tab') || 'account';
      renderUserSettingsContent();
    });
  });

  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeAdminTab = btn.getAttribute('data-admin-tab') || 'overview';
      renderAdminContent();
    });
  });

  document.getElementById('qs-input')?.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement) renderQuickSwitcher(e.target.value);
  });

  function openMessagesMoreMenu(anchorEl) {
    openPopoverNear(
      anchorEl,
      `
        <strong>Messages Options</strong>
        <div class="menu-list">
          <button type="button" class="menu-item" data-action="open-share-community-link">
            <span>Share Community Invite Link</span>
            <span>${svgIcon('share', 14)}</span>
          </button>
          <button type="button" class="menu-item" data-action="open-join-community-link">
            <span>Join Community via Link</span>
            <span>${svgIcon('link', 14)}</span>
          </button>
          <button type="button" class="menu-item" data-action="open-create-group-chat">
            <span>New Group Chat</span>
            <span>${svgIcon('users', 14)}</span>
          </button>
          <button type="button" class="menu-item" data-action="toggle-show-archived-dms">
            <span>${state.showArchivedDms ? 'Hide Archived Chats' : 'Show Archived Chats'}</span>
            <span>${svgIcon('bookmark', 14)}</span>
          </button>
        </div>
      `
    );
  }

  document.getElementById('server-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.activeView === 'home') {
      openMessagesMoreMenu(e.currentTarget);
      return;
    }
    const srv = getActiveServer();
    if (!srv) return;
    openPopoverNear(
      e.currentTarget,
      `
        <strong>${escapeHtml(srv.name)}</strong>
        <div class="menu-list">
          <button type="button" class="menu-item" data-action="open-server-admin"><span>Community Management</span> <span>${svgIcon('shield', 14)}</span></button>
          ${srv.ownerId === profile.id ? `<button type="button" class="menu-item" data-action="open-create-channel"><span>Create Channel</span> <span>${svgIcon('plus', 14)}</span></button>` : ''}
          <button type="button" class="menu-item" data-action="copy-invite"><span>Copy Invite Link</span> <span>${svgIcon('link', 14)}</span></button>
        </div>
      `
    );
  });

  document.getElementById('messages-more-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openMessagesMoreMenu(e.currentTarget);
  });

  document.getElementById('profile-popover-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openMemberPopover(profile.id, e.currentTarget, true);
  });

  document.getElementById('pins-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const msgs =
      state.activeView === 'home' ? state.dmMessages[state.activeDmId] || [] : state.messages[state.activeChannelId] || [];
    const pinned = msgs.filter((m) => m.pinned);
    openPopoverNear(
      e.currentTarget,
      `
        <strong>Pinned Messages (${pinned.length})</strong>
        <div style="display:grid;gap:8px;max-height:240px;overflow-y:auto;">
          ${pinned
            .map(
              (m) => `<div class="file-row" style="flex-direction:column;align-items:flex-start;">
                <strong>${escapeHtml(m.senderName || getMember(m.authorId).displayName)}</strong>
                <span class="member-sub" style="white-space:normal;">${escapeHtml(m.content)}</span>
              </div>`
            )
            .join('') || '<span class="member-sub">No pinned messages in this channel.</span>'}
        </div>
      `
    );
  });

  document.getElementById('join-invite-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const invEl = document.getElementById('join-invite-input');
    const val = invEl instanceof HTMLInputElement ? invEl.value.trim() : '';
    if (!val) return;
    await joinServerByInviteInput(val);
  });

  document.getElementById('join-comm-link-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = document.getElementById('join-comm-link-input');
    const raw = inp instanceof HTMLInputElement ? inp.value.trim() : '';
    const extracted = extractCommunityInviteCodeFromText(raw) || raw;
    if (!extracted) {
      showToast('Paste a valid community invite link or code.');
      return;
    }
    const ok = await joinServerByInviteInput(extracted);
    if (!ok) {
      showToast('Invalid community invite code.', 'error');
    }
  });

  document.getElementById('create-server-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentFirebaseUser) return;
    const nameEl = document.getElementById('new-server-name');
    const catEl = document.getElementById('new-server-cat');
    const visEl = document.getElementById('new-server-visibility');
    const descEl = document.getElementById('new-server-desc');
    const rulesEl = document.getElementById('new-server-rules');
    const name = nameEl instanceof HTMLInputElement ? nameEl.value.trim() : '';
    if (name.length < 2) return;

    const srvId = `srv-${Date.now()}`;
    const chId = `chn-${Date.now()}-gen`;
    const voiceId = `chn-${Date.now()}-voc`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'nx';
    const inviteCode = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const category = catEl instanceof HTMLSelectElement ? catEl.value : 'Technology';
    const visibility = visEl instanceof HTMLSelectElement && visEl.value === 'public' ? 'public' : 'private';
    const description = (descEl instanceof HTMLTextAreaElement ? descEl.value.trim().slice(0, 300) : '') || 'Community workspace on NEXORA.';
    const rules = rulesEl instanceof HTMLTextAreaElement ? rulesEl.value.trim().slice(0, 1000) : '';

    const serverPayload = {
      id: srvId,
      name: name.slice(0, 50),
      glyph: getInitials(name),
      category,
      description,
      rules,
      welcomeMessage: `Welcome to ${name}!`,
      inviteCode,
      visibility,
      ownerId: currentFirebaseUser.uid,
      defaultChannelId: chId,
      categories: [
        { id: `cat-${Date.now()}-1`, name: 'Text Channels', channelIds: [chId] },
        { id: `cat-${Date.now()}-2`, name: 'Voice & Screen Share', channelIds: [voiceId] },
      ],
      guard: { active: true, purgeUnverified: false, purgeDays: 7, antiSpamLinks: true, blockedWords: [] },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, 'servers', srvId), serverPayload);
      await setDoc(doc(db, 'servers', srvId, 'channels', chId), {
        id: chId,
        serverId: srvId,
        name: 'general',
        type: 'text',
        topic: `Welcome to ${name}`,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'servers', srvId, 'channels', voiceId), {
        id: voiceId,
        serverId: srvId,
        name: 'voice-lounge',
        type: 'voice',
        topic: 'Live voice, video, and screen share room.',
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'servers', srvId, 'members', currentFirebaseUser.uid), {
        userId: currentFirebaseUser.uid,
        displayName: profile.displayName,
        role: 'owner',
        joinedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'invites', inviteCode), {
        code: inviteCode,
        serverId: srvId,
        serverName: name.slice(0, 50),
        serverCategory: category,
        serverDescription: description,
        serverRules: rules,
        ownerId: currentFirebaseUser.uid,
        createdBy: currentFirebaseUser.uid,
        createdByName: profile.displayName.slice(0, 80),
        active: true,
        expiresAtMs: 0,
        maxUses: 0,
        uses: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'users', currentFirebaseUser.uid, 'joined_servers', srvId), {
        serverId: srvId,
        joinedAt: serverTimestamp(),
      });

      const localSrv = safeServerDoc(srvId, serverPayload);
      ownedServersMap.set(srvId, localSrv);
      state.joinedServerIds.add(srvId);
      state.activeView = 'server';
      state.activeServerId = srvId;
      state.activeChannelId = chId;
      mergeServersFromSnapshots();
      subscribeServerResources(localSrv);
      saveUiNav();
      closeAllModals();
      renderAll();
      showToast(`Created community "${name}"`);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `servers/${srvId}`,
        'Site is busy right now. Could not create community.'
      );
    }
  });

  document.getElementById('create-channel-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const srv = getActiveServer();
    if (!srv || !currentFirebaseUser) return;
    if (srv.ownerId !== currentFirebaseUser.uid) {
      showToast('Only the community owner can create channels.');
      return;
    }

    const nameEl = document.getElementById('new-channel-name');
    const typeEl = document.getElementById('new-channel-type');
    const topicEl = document.getElementById('new-channel-topic');
    const cleanName = (nameEl instanceof HTMLInputElement ? nameEl.value : '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!cleanName) return;

    const chId = `chn-${Date.now()}`;
    try {
      await setDoc(doc(db, 'servers', srv.id, 'channels', chId), {
        id: chId,
        serverId: srv.id,
        name: cleanName.slice(0, 50),
        type: typeEl instanceof HTMLSelectElement ? typeEl.value : 'text',
        topic: topicEl instanceof HTMLInputElement ? topicEl.value.trim().slice(0, 200) : '',
        createdAt: serverTimestamp(),
      });
      const updatedCategories = (srv.categories || [{ id: 'cat-default', name: 'General', channelIds: [] }]).map((c, idx) =>
        idx === 0 ? { ...c, channelIds: [...(c.channelIds || []), chId] } : c
      );
      await updateDoc(doc(db, 'servers', srv.id), {
        categories: updatedCategories,
        updatedAt: serverTimestamp(),
      });
      state.activeChannelId = chId;
      saveUiNav();
      subscribeMessages(srv.id, chId);
      closeAllModals();
      showToast(`Created #${cleanName}`);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `servers/${srv.id}/channels/${chId}`,
        'Site is busy right now. Could not create channel.'
      );
    }
  });

  document.getElementById('create-poll-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = document.getElementById('poll-question-input')?.value?.trim();
    const o1 = document.getElementById('poll-opt-1')?.value?.trim();
    const o2 = document.getElementById('poll-opt-2')?.value?.trim();
    const o3 = document.getElementById('poll-opt-3')?.value?.trim();
    if (!q || !o1 || !o2) return;

    const options = [
      { id: 'opt-1', text: o1, userIds: [] },
      { id: 'opt-2', text: o2, userIds: [] },
    ];
    if (o3) options.push({ id: 'opt-3', text: o3, userIds: [] });

    const srv = getActiveServer();
    if (state.activeView === 'server' && srv && state.activeChannelId && currentFirebaseUser) {
      const msgId = `msg-${Date.now()}`;
      try {
        await setDoc(doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', msgId), {
          id: msgId,
          channelId: state.activeChannelId,
          senderId: currentFirebaseUser.uid,
          senderName: profile.displayName,
          senderInitials: profile.initials,
          content: 'Community Poll',
          edited: false,
          pinned: false,
          reactions: [],
          poll: { id: `poll-${Date.now()}`, question: q, options },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        closeAllModals();
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `servers/${srv.id}/channels/${state.activeChannelId}/messages/${msgId}`,
          'Site is busy right now. Could not create poll.'
        );
      }
    }
  });

  document.getElementById('report-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentFirebaseUser) return;
    const targetType = document.getElementById('report-target-type')?.value || 'user';
    const targetId = document.getElementById('report-target-id')?.value || '';
    const reason = document.getElementById('report-reason-input')?.value.trim() || '';
    if (!targetId || reason.length < 3) return;

    const srv = getActiveServer();
    const reportId = `rep-${Date.now()}`;
    try {
      await setDoc(doc(db, 'reports', reportId), {
        id: reportId,
        reporterId: currentFirebaseUser.uid,
        reporterName: profile.displayName.slice(0, 80),
        targetType,
        targetId: targetId.slice(0, 128),
        serverId: srv?.id || '',
        serverOwnerId: srv?.ownerId || currentFirebaseUser.uid,
        reason: reason.slice(0, 300),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      closeAllModals();
      showToast('Report submitted for moderation review.');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `reports/${reportId}`,
        'Site is busy right now. Could not submit report.'
      );
    }
  });

  document.addEventListener('change', async (e) => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'msg-attach-input') {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        pendingMessageAttachment = await uploadChatAttachmentFile(file);
        updateComposerAttachmentBar();
      } catch (err) {
        showToast(formatFriendlyError(err, 'Could not attach selected file.'), 'error');
      }
      e.target.value = '';
      return;
    }

    if (e.target instanceof HTMLInputElement && e.target.id === 'share-photo-input') {
      const file = e.target.files?.[0];
      if (!file) return;
      const objUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        const ready = await ensureActiveCallForShare();
        const canvas = drawImageOntoShareCanvas(img, file.name);
        URL.revokeObjectURL(objUrl);
        if (!ready || !canvas) return;
        const res = await rtc.startCanvasScreenShare(canvas, profile, {
          fps: 15,
          kind: 'photo',
          label: 'Photo / Slide',
        });
        if (res?.started) {
          startShareBoardKeepAlive();
          renderMobileShareStatusButtons();
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        showToast('Could not decode selected image.');
      };
      img.src = objUrl;
      e.target.value = '';
      return;
    }

    const target = e.target instanceof HTMLSelectElement ? e.target : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'select-audio-input') {
      await rtc.updateAudioSettings({ audioInputId: target.value });
      showToast('Microphone updated');
    } else if (action === 'select-audio-output') {
      await rtc.updateAudioSettings({ audioOutputId: target.value });
      rtc.attachMediaElements(document);
      showToast('Speaker output updated');
    }
  });

  const shareCanvas = document.getElementById('share-canvas');
  if (shareCanvas instanceof HTMLCanvasElement) {
    const getCanvasPos = (ev) => {
      const rect = shareCanvas.getBoundingClientRect();
      return {
        x: ((ev.clientX - rect.left) / Math.max(1, rect.width)) * shareCanvas.width,
        y: ((ev.clientY - rect.top) / Math.max(1, rect.height)) * shareCanvas.height,
      };
    };

    shareCanvas.addEventListener('pointerdown', (ev) => {
      initShareBoardCanvas();
      shareDrawing = true;
      shareLastPoint = getCanvasPos(ev);
      if (typeof shareCanvas.setPointerCapture === 'function') {
        try {
          shareCanvas.setPointerCapture(ev.pointerId);
        } catch {}
      }
    });

    shareCanvas.addEventListener('pointermove', (ev) => {
      if (!shareDrawing || !shareLastPoint) return;
      const ctx = shareCanvas.getContext('2d');
      if (!ctx) return;
      const pt = getCanvasPos(ev);
      ctx.save();
      ctx.strokeStyle = shareInkColor || '#FF7A2F';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(shareLastPoint.x, shareLastPoint.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.restore();
      shareLastPoint = pt;
    });

    const endStroke = () => {
      shareDrawing = false;
      shareLastPoint = null;
    };
    shareCanvas.addEventListener('pointerup', endStroke);
    shareCanvas.addEventListener('pointercancel', endStroke);
  }

  document.getElementById('share-note-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('share-note-input');
    const txt = input instanceof HTMLInputElement ? input.value.trim() : '';
    if (!txt) return;
    stampNoteOntoShareCanvas(txt);
    if (input instanceof HTMLInputElement) input.value = '';
  });

  document.addEventListener('submit', async (e) => {
    if (!(e.target instanceof HTMLFormElement)) return;

    if (e.target.id === 'send-conn-req-form') {
      e.preventDefault();
      const targetUid = e.target.getAttribute('data-target-uid');
      const note = document.getElementById('conn-req-note')?.value.trim() || '';
      if (targetUid) {
        await sendConnectionRequest(targetUid, note);
      }
    } else if (e.target.id === 'account-settings-form') {
      e.preventDefault();
      if (!currentFirebaseUser) return;
      const displayName = document.getElementById('set-display-name')?.value.trim() || profile.displayName;
      const username = document.getElementById('set-username')?.value.trim().toLowerCase() || profile.username;
      const accountPrivacy = document.getElementById('set-account-privacy')?.value || 'everyone';
      const customStatus = document.getElementById('set-custom-status')?.value.trim() || '';
      const bio = document.getElementById('set-bio')?.value.trim() || '';

      const updated = await updateUserProfile(currentFirebaseUser.uid, {
        displayName,
        username,
        accountPrivacy,
        customStatus,
        bio,
        status: profile.status,
      });
      if (updated) {
        Object.assign(profile, { ...updated, customStatus, bio });
        renderAll();
        showToast('Profile & privacy updated');
      }
    } else if (e.target.id === 'change-email-form') {
      e.preventDefault();
      const newEmail = document.getElementById('new-account-email')?.value?.trim();
      if (!newEmail) return;
      try {
        await changeAccountEmail(newEmail);
        showToast(`Verification link sent to ${newEmail}`);
      } catch (err) {
        showToast(
          formatFriendlyError(err, 'For your security, please sign out and sign back in before changing your email.'),
          'error'
        );
      }
    } else if (e.target.id === 'change-password-form') {
      e.preventDefault();
      const newPw = document.getElementById('new-account-password')?.value || '';
      if (newPw.length < 6) return;
      try {
        await changeAccountPassword(newPw);
        showToast('Password updated securely', 'success');
      } catch (err) {
        showToast(
          formatFriendlyError(err, 'For your security, please sign out and sign back in before updating your password.'),
          'error'
        );
      }
    } else if (e.target.id === 'server-overview-form') {
      e.preventDefault();
      const srv = getActiveServer();
      if (!srv || srv.ownerId !== currentFirebaseUser?.uid) {
        showToast('Only the community owner can modify details.');
        return;
      }
      const nextName = document.getElementById('admin-srv-name')?.value.trim() || srv.name;
      const nextDesc = document.getElementById('admin-srv-desc')?.value.trim() || srv.description;
      const nextRules = document.getElementById('admin-srv-rules')?.value.trim() || '';
      await updateDoc(doc(db, 'servers', srv.id), {
        name: nextName.slice(0, 50),
        glyph: getInitials(nextName),
        description: nextDesc.slice(0, 300),
        rules: nextRules.slice(0, 1000),
        updatedAt: serverTimestamp(),
      });
      await logModerationAction(srv, `Updated community overview (${nextName})`);
      showToast('Community overview updated');
    } else if (e.target.id === 'create-invite-form') {
      e.preventDefault();
      const srv = getActiveServer();
      if (!srv || srv.ownerId !== currentFirebaseUser?.uid) return;
      const hours = Number(document.getElementById('inv-expiry-hours')?.value || 0);
      const maxUses = Number(document.getElementById('inv-max-uses')?.value || 0);
      const slug = srv.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'nx';
      const code = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
      const expiresAtMs = hours > 0 ? Date.now() + hours * 3600 * 1000 : 0;
      await setDoc(doc(db, 'invites', code), {
        code,
        serverId: srv.id,
        serverName: srv.name.slice(0, 50),
        serverCategory: srv.category || 'Technology',
        serverDescription: srv.description || '',
        serverRules: srv.rules || '',
        ownerId: currentFirebaseUser.uid,
        createdBy: currentFirebaseUser.uid,
        createdByName: profile.displayName.slice(0, 80),
        active: true,
        expiresAtMs,
        maxUses: Math.max(0, maxUses),
        uses: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logModerationAction(srv, `Generated invite ${code}`);
      showToast(`Created invite code ${code}`);
    } else if (e.target.id === 'create-event-form') {
      e.preventDefault();
      const srv = getActiveServer();
      if (!srv || !currentFirebaseUser) return;
      const title = document.getElementById('ev-title')?.value.trim() || '';
      const when = document.getElementById('ev-when')?.value.trim() || '';
      const desc = document.getElementById('ev-desc')?.value.trim() || '';
      if (title.length < 2 || when.length < 3) return;
      const eventId = `ev-${Date.now()}`;
      await setDoc(doc(db, 'servers', srv.id, 'events', eventId), {
        id: eventId,
        serverId: srv.id,
        title: title.slice(0, 100),
        scheduledFor: when.slice(0, 64),
        description: desc.slice(0, 300),
        createdBy: currentFirebaseUser.uid,
        createdByName: profile.displayName.slice(0, 80),
        interestedUids: [currentFirebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast(`Scheduled "${title}"`);
    } else if (e.target.id === 'add-blocked-word-form') {
      e.preventDefault();
      const srv = getActiveServer();
      if (!srv || srv.ownerId !== currentFirebaseUser?.uid) return;
      const word = document.getElementById('blocked-word-input')?.value.trim().toLowerCase();
      const words = [...(srv.guard?.blockedWords || [])];
      if (word && !words.includes(word)) {
        words.push(word);
        const nextGuard = { ...(srv.guard || {}), blockedWords: words };
        await updateDoc(doc(db, 'servers', srv.id), { guard: nextGuard, updatedAt: serverTimestamp() });
        await logModerationAction(srv, `Added blocked keyword "${word}"`);
      }
    } else if (e.target.id === 'leader-alert-form') {
      e.preventDefault();
      if (!currentFirebaseUser) return;
      const srvId = document.getElementById('leader-alert-server-id')?.value || '';
      const targetUid = document.getElementById('leader-alert-target-uid')?.value || '';
      const severity = document.getElementById('leader-alert-severity')?.value || 'warning';
      const reason = document.getElementById('leader-alert-reason')?.value || '';
      const srv = state.servers.find((s) => s.id === srvId) || getActiveServer();
      const targetUser = getMember(targetUid);
      try {
        const { alertId, notifId, alertPayload, notificationPayload, auditText } = buildCommunityAlertPayload({
          server: srv,
          actor: profile,
          targetUser,
          severity,
          reason,
          timestamp: serverTimestamp(),
        });
        await setDoc(doc(db, 'servers', srv.id, 'alerts', alertId), alertPayload);
        await setDoc(doc(db, 'users', targetUser.id, 'notifications', notifId), notificationPayload).catch(() => {});
        await logModerationAction(srv, auditText);
        closeAllModals();
        showToast(`Abuse alert sent to ${targetUser.displayName}`, 'success');
      } catch (err) {
        showToast(formatFriendlyError(err, 'Could not send abuse alert.'), 'error');
      }
    } else if (e.target.id === 'create-group-chat-form') {
      e.preventDefault();
      if (!currentFirebaseUser) return;
      const nameInput = document.getElementById('group-chat-name-input');
      const groupName = nameInput instanceof HTMLInputElement ? nameInput.value.trim().slice(0, 80) : '';
      const selectedUids = Array.from(
        document.querySelectorAll('#group-chat-members-picker input[name="group-member"]:checked')
      )
        .map((el) => (el instanceof HTMLInputElement ? el.value : ''))
        .filter((uid) => uid && uid !== currentFirebaseUser.uid);
      if (groupName.length < 2 || selectedUids.length < 1) {
        showToast('Enter a group name and select at least one member.', 'error');
        return;
      }
      const participants = [currentFirebaseUser.uid, ...selectedUids.slice(0, 28)];
      const participantMeta = {
        [currentFirebaseUser.uid]: {
          displayName: profile.displayName.slice(0, 80),
          username: profile.username.slice(0, 50),
          initials: profile.initials.slice(0, 16),
        },
      };
      for (const uid of selectedUids.slice(0, 28)) {
        const m = getMember(uid);
        participantMeta[uid] = {
          displayName: String(m.displayName || 'Member').slice(0, 80),
          username: String(m.username || 'member').slice(0, 50),
          initials: String(m.initials || 'MB').slice(0, 16),
        };
      }
      const grpId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        await setDoc(doc(db, 'dm_threads', grpId), {
          id: grpId,
          type: 'group',
          groupName,
          participants,
          participantMeta,
          archivedBy: [],
          typing: {},
          lastMessage: 'Group created',
          createdBy: currentFirebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        state.activeView = 'home';
        state.activeDmId = grpId;
        state.pendingPeerId = '';
        subscribeDmMessages(grpId);
        closeAllModals();
        socialModule?.navigateTo('messages', { dmId: grpId });
        showToast(`Created group "${groupName}"`);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `dm_threads/${grpId}`, 'Could not create group chat right now.');
      }
    } else if (e.target.id === 'thread-reply-form') {
      e.preventDefault();
      const input = document.getElementById('thread-reply-input');
      const val = input instanceof HTMLInputElement ? input.value.trim() : '';
      if (!val || !state.activeThreadMsgId || !currentFirebaseUser) return;

      const srv = getActiveServer();
      if (state.activeView === 'home' && state.activeDmId) {
        const dm = state.dms.find((d) => d.id === state.activeDmId);
        if (dm && Array.isArray(dm.participants) && dm.participants.length >= 2) {
          const msgId = `dmmsg-${Date.now()}`;
          await setDoc(doc(db, 'dm_threads', dm.id, 'messages', msgId), {
            id: msgId,
            threadId: dm.id,
            participantIds: dm.participants,
            senderId: currentFirebaseUser.uid,
            senderName: profile.displayName.slice(0, 50),
            senderInitials: profile.initials.slice(0, 4),
            content: val.slice(0, 2000),
            seenBy: [currentFirebaseUser.uid],
            replyToId: state.activeThreadMsgId,
            edited: false,
            pinned: false,
            reactions: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          input.value = '';
        }
      } else if (state.activeView === 'server' && srv && state.activeChannelId) {
        const msgId = `msg-${Date.now()}`;
        await setDoc(doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', msgId), {
          id: msgId,
          channelId: state.activeChannelId,
          senderId: currentFirebaseUser.uid,
          senderName: profile.displayName.slice(0, 50),
          senderInitials: profile.initials.slice(0, 4),
          content: val.slice(0, 2000),
          replyToId: state.activeThreadMsgId,
          edited: false,
          pinned: false,
          reactions: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        input.value = '';
      }
    }
  });

  document.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const closeId = target.closest('[data-close-modal]')?.getAttribute('data-close-modal');
    if (closeId) {
      closeAllModals();
      return;
    }
    if (target.classList.contains('modal-backdrop')) {
      closeAllModals();
      return;
    }

    if (!target.closest('#emoji-popover') && !target.closest('#emoji-toggle-btn')) {
      emojiPopover?.classList.remove('open');
      emojiToggle?.setAttribute('aria-expanded', 'false');
    }
    if (
      !target.closest('#popover-panel') &&
      !target.closest('#server-menu-btn') &&
      !target.closest('#messages-more-btn') &&
      !target.closest('#profile-popover-btn') &&
      !target.closest('#pins-btn') &&
      !target.closest('#notifications-btn') &&
      !target.closest('[data-action="community-card-menu"]')
    ) {
      closePopover();
    }

    const qsEl = target.closest('[data-qs-action]');
    if (qsEl) {
      const val = qsEl.getAttribute('data-qs-action') || '';
      const [kind, id] = val.split(':');
      if (kind === 'qs-server') {
        const srv = state.servers.find((s) => s.id === id);
        if (srv) {
          state.activeView = 'server';
          state.activeServerId = srv.id;
          state.activeChannelId = srv.defaultChannelId;
          subscribeServerResources(srv);
        }
      } else if (kind === 'qs-channel') {
        const ch = state.channels[id];
        if (ch) {
          state.activeView = 'server';
          state.activeServerId = ch.serverId;
          state.activeChannelId = ch.id;
          subscribeMessages(ch.serverId, ch.id);
        }
      } else if (kind === 'qs-dm') {
        await openDirectMessageWithUser(id);
        return;
      }
      saveUiNav();
      closeAllModals();
      renderAll();
      return;
    }

    const actionEl = target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');
    const srv = getActiveServer();

    switch (action) {
      case 'nav-home':
        state.activeView = 'home';
        state.pendingPeerId = '';
        shell?.classList.remove('mobile-nav-open');
        if (window.innerWidth <= 1080) {
          prefs.inspectorCollapsed = true;
          applyPrefsToDom();
        }
        if (state.activeDmId) {
          subscribeDmMessages(state.activeDmId);
        }
        saveUiNav();
        renderAll();
        break;
      case 'nav-discover':
        state.activeView = 'discover';
        shell?.classList.remove('mobile-nav-open');
        if (window.innerWidth <= 1080) {
          prefs.inspectorCollapsed = true;
          applyPrefsToDom();
        }
        saveUiNav();
        renderAll();
        break;

      case 'start-dm': {
        const uid = actionEl.getAttribute('data-user-id');
        if (uid) await openDirectMessageWithUser(uid);
        break;
      }
      case 'accept-conn-req': {
        const reqId = actionEl.getAttribute('data-req-id');
        const fromUid = actionEl.getAttribute('data-from-uid');
        if (reqId) await respondConnectionRequest(reqId, true, fromUid);
        break;
      }
      case 'decline-conn-req': {
        const reqId = actionEl.getAttribute('data-req-id');
        if (reqId) await respondConnectionRequest(reqId, false, '');
        break;
      }
      case 'start-dm-call': {
        const activeDm = state.dms.find((d) => d.id === state.activeDmId);
        const mode = actionEl.getAttribute('data-call-mode') || 'audio';
        if (activeDm && activeDm.userId) {
          await startDmCallWithUser(activeDm.userId, mode);
        }
        break;
      }
      case 'call-user-direct': {
        const uid = actionEl.getAttribute('data-user-id');
        const mode = actionEl.getAttribute('data-call-mode') || 'audio';
        if (uid) {
          closePopover();
          await startDmCallWithUser(uid, mode);
        }
        break;
      }
      case 'select-server':
      case 'open-owned-or-joined': {
        const targetSrv = state.servers.find((s) => s.id === actionEl.getAttribute('data-server-id'));
        if (targetSrv) {
          state.activeView = 'server';
          state.activeServerId = targetSrv.id;
          state.activeChannelId = targetSrv.defaultChannelId || '';
          shell?.classList.remove('mobile-nav-open');
          saveUiNav();
          subscribeServerResources(targetSrv);
          renderAll();
        }
        break;
      }
      case 'request-join-public': {
        const srvId = actionEl.getAttribute('data-server-id');
        const targetSrv = state.publicServers.find((s) => s.id === srvId);
        if (!targetSrv || !currentFirebaseUser) break;
        try {
          const reqData = {
            userId: currentFirebaseUser.uid,
            serverId: targetSrv.id,
            ownerId: targetSrv.ownerId,
            displayName: profile.displayName.slice(0, 80),
            username: profile.username.slice(0, 50),
            initials: profile.initials.slice(0, 16),
            inviteCode: targetSrv.inviteCode || '',
            rulesAccepted: true,
            note: 'Requested to join from community discovery',
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(doc(db, 'servers', targetSrv.id, 'join_requests', currentFirebaseUser.uid), reqData);
          state.myJoinRequests.set(targetSrv.id, reqData);
          showToast(`Join request sent to ${targetSrv.name}`);
          renderMainWorkspace();
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.CREATE,
            `servers/${targetSrv.id}/join_requests/${currentFirebaseUser.uid}`,
            'You cannot request access right now. Please try again later.'
          );
        }
        break;
      }
      case 'complete-approved-join': {
        const srvId = actionEl.getAttribute('data-server-id');
        const targetSrv = state.publicServers.find((s) => s.id === srvId);
        if (!targetSrv || !currentFirebaseUser) break;
        try {
          const memSnap = await getDoc(doc(db, 'servers', targetSrv.id, 'members', currentFirebaseUser.uid));
          if (!memSnap.exists()) {
            await setDoc(doc(db, 'servers', targetSrv.id, 'members', currentFirebaseUser.uid), {
              userId: currentFirebaseUser.uid,
              displayName: profile.displayName.slice(0, 50),
              role: 'member',
              joinedAt: serverTimestamp(),
            });
          }
          await setDoc(doc(db, 'users', currentFirebaseUser.uid, 'joined_servers', targetSrv.id), {
            serverId: targetSrv.id,
            joinedAt: serverTimestamp(),
          });
          joinedServersMap.set(targetSrv.id, targetSrv);
          mergeServersFromSnapshots();
          state.activeView = 'server';
          state.activeServerId = targetSrv.id;
          state.activeChannelId = targetSrv.defaultChannelId || '';
          subscribeServerResources(targetSrv);
          renderAll();
          showToast(`Entered ${targetSrv.name}`);
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.WRITE,
            `servers/${targetSrv.id}/members/${currentFirebaseUser.uid}`,
            'You cannot enter this community right now. Please try again shortly.'
          );
        }
        break;
      }
      case 'approve-join-req':
      case 'decline-join-req': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) break;
        const reqUid = actionEl.getAttribute('data-user-id');
        if (!reqUid) break;
        const approve = action === 'approve-join-req';
        const reqObj = state.serverJoinRequests.find((r) => r.userId === reqUid);
        await updateDoc(doc(db, 'servers', srv.id, 'join_requests', reqUid), {
          status: approve ? 'approved' : 'declined',
          updatedAt: serverTimestamp(),
        });
        if (approve) {
          await setDoc(doc(db, 'servers', srv.id, 'members', reqUid), {
            userId: reqUid,
            displayName: String(reqObj?.displayName || 'Member').slice(0, 50),
            role: 'member',
            joinedAt: serverTimestamp(),
          });
          await logModerationAction(srv, `Approved join request for ${reqObj?.displayName || reqUid}`);
          showToast('Member approved');
        } else {
          await logModerationAction(srv, `Declined join request for ${reqObj?.displayName || reqUid}`);
          showToast('Join request declined');
        }
        break;
      }
      case 'copy-invite-code': {
        const code = actionEl.getAttribute('data-code') || '';
        if (code) {
          navigator.clipboard?.writeText(`${window.location.origin}/welcome.html?invite=${code}`).catch(() => {});
          showToast(`Copied invite link for ${code}`);
        }
        break;
      }
      case 'revoke-invite-code': {
        const code = actionEl.getAttribute('data-code') || '';
        if (code) {
          await updateDoc(doc(db, 'invites', code), { active: false, updatedAt: serverTimestamp() });
          showToast(`Revoked invite ${code}`);
        }
        break;
      }
      case 'rsvp-event': {
        if (!srv || !currentFirebaseUser) break;
        const evId = actionEl.getAttribute('data-event-id');
        const ev = state.serverEvents.find((x) => x.id === evId);
        if (!ev) break;
        const cur = Array.isArray(ev.interestedUids) ? ev.interestedUids : [];
        const next = cur.includes(currentFirebaseUser.uid)
          ? cur.filter((id) => id !== currentFirebaseUser.uid)
          : [...cur, currentFirebaseUser.uid].slice(0, 200);
        await updateDoc(doc(db, 'servers', srv.id, 'events', ev.id), {
          interestedUids: next,
          updatedAt: serverTimestamp(),
        });
        break;
      }
      case 'leader-add-member': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) {
          showToast('Only the community leader can add members.');
          break;
        }
        const uid = actionEl.getAttribute('data-user-id') || '';
        const targetUser = state.directoryUsers.find((u) => u.id === uid) || getMember(uid);
        try {
          const { notifId, memberPayload, joinedServerPayload, notificationPayload, auditText } =
            buildLeaderAddMemberPayloads({
              server: srv,
              actor: profile,
              targetUser,
              role: 'member',
              timestamp: serverTimestamp(),
            });
          await setDoc(doc(db, 'servers', srv.id, 'members', uid), memberPayload);
          await setDoc(doc(db, 'users', uid, 'joined_servers', srv.id), joinedServerPayload);
          await setDoc(doc(db, 'users', uid, 'notifications', notifId), notificationPayload).catch(() => {});
          await logModerationAction(srv, auditText);
          showToast(`Added ${targetUser.displayName} to ${srv.name}`, 'success');
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `servers/${srv.id}/members/${uid}`, 'Could not add user right now.');
        }
        break;
      }
      case 'leader-toggle-role': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) break;
        const uid = actionEl.getAttribute('data-user-id') || '';
        if (!uid || uid === srv.ownerId) break;
        const meta = state.serverMembersMeta.get(uid);
        const targetUser = getMember(uid);
        const nextRole = meta?.role === 'moderator' ? 'member' : 'moderator';
        try {
          await updateDoc(doc(db, 'servers', srv.id, 'members', uid), {
            role: nextRole,
            displayName: String(targetUser.displayName || meta?.displayName || 'Member').slice(0, 50),
          });
          await logModerationAction(srv, `Set ${targetUser.displayName} role to ${nextRole}`);
          showToast(`${targetUser.displayName} is now ${nextRole}`);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `servers/${srv.id}/members/${uid}`, 'Could not update role.');
        }
        break;
      }
      case 'open-leader-alert-modal': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) {
          showToast('Only the community leader can issue abuse alerts.');
          break;
        }
        const uid = actionEl.getAttribute('data-user-id') || '';
        if (!uid || uid === srv.ownerId) break;
        const targetUser = getMember(uid);
        const srvInput = document.getElementById('leader-alert-server-id');
        const uidInput = document.getElementById('leader-alert-target-uid');
        const nameInput = document.getElementById('leader-alert-target-name');
        const summaryEl = document.getElementById('leader-alert-target-summary');
        const sevEl = document.getElementById('leader-alert-severity');
        const reasonEl = document.getElementById('leader-alert-reason');
        const presetsEl = document.getElementById('leader-alert-presets');
        if (srvInput instanceof HTMLInputElement) srvInput.value = srv.id;
        if (uidInput instanceof HTMLInputElement) uidInput.value = uid;
        if (nameInput instanceof HTMLInputElement) nameInput.value = targetUser.displayName;
        if (sevEl instanceof HTMLSelectElement) sevEl.value = 'warning';
        if (reasonEl instanceof HTMLTextAreaElement) reasonEl.value = '';
        if (summaryEl) {
          summaryEl.innerHTML = `Issuing moderation alert in <strong>${escapeHtml(srv.name)}</strong> to <strong>${escapeHtml(targetUser.displayName)}</strong> (@${escapeHtml(targetUser.username)})`;
        }
        if (presetsEl) {
          presetsEl.innerHTML = ABUSE_ALERT_PRESETS.map(
            (p) =>
              `<button type="button" class="btn btn-secondary" style="height:28px;font-size:0.74rem;padding:0 9px;" data-action="fill-alert-preset" data-preset-id="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`
          ).join('');
        }
        openModal('leader-alert-modal');
        break;
      }
      case 'fill-alert-preset': {
        const pid = actionEl.getAttribute('data-preset-id') || '';
        const preset = ABUSE_ALERT_PRESETS.find((p) => p.id === pid);
        if (!preset) break;
        const sevEl = document.getElementById('leader-alert-severity');
        const reasonEl = document.getElementById('leader-alert-reason');
        if (sevEl instanceof HTMLSelectElement) sevEl.value = preset.severity;
        if (reasonEl instanceof HTMLTextAreaElement) reasonEl.value = preset.reason;
        break;
      }
      case 'acknowledge-leader-alert': {
        const alertId = actionEl.getAttribute('data-alert-id') || '';
        const srvId = actionEl.getAttribute('data-server-id') || srv?.id || '';
        if (!alertId || !srvId || !currentFirebaseUser) break;
        try {
          await updateDoc(doc(db, 'servers', srvId, 'alerts', alertId), {
            acknowledged: true,
            updatedAt: serverTimestamp(),
          });
          showToast('Community leader alert acknowledged');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `servers/${srvId}/alerts/${alertId}`, 'Could not acknowledge alert.');
        }
        break;
      }
      case 'leader-delete-alert': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) break;
        const alertId = actionEl.getAttribute('data-alert-id') || '';
        if (!alertId) break;
        await deleteDoc(doc(db, 'servers', srv.id, 'alerts', alertId));
        showToast('Alert dismissed');
        break;
      }
      case 'kick-server-member': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) break;
        const uid = actionEl.getAttribute('data-user-id');
        if (!uid || uid === srv.ownerId) break;
        const targetMember = getMember(uid);
        await deleteDoc(doc(db, 'servers', srv.id, 'members', uid));
        await deleteDoc(doc(db, 'users', uid, 'joined_servers', srv.id)).catch(() => {});
        const notifId = `notif-removed-${srv.id}-${Date.now()}`.slice(0, 128);
        await setDoc(doc(db, 'users', uid, 'notifications', notifId), {
          id: notifId,
          senderId: currentFirebaseUser.uid,
          category: 'community_alert',
          targetId: srv.id,
          title: `Removed from ${srv.name}`.slice(0, 120),
          body: `${profile.displayName} removed you from ${srv.name}.`.slice(0, 300),
          unread: true,
          createdAt: serverTimestamp(),
        }).catch(() => {});
        await logModerationAction(srv, `Removed member ${targetMember.displayName}`);
        closePopover();
        showToast(`${targetMember.displayName} removed from community`);
        break;
      }
      case 'resolve-report': {
        const repId = actionEl.getAttribute('data-report-id');
        const nextStatus = actionEl.getAttribute('data-status') || 'resolved';
        if (!repId) break;
        await updateDoc(doc(db, 'reports', repId), { status: nextStatus, updatedAt: serverTimestamp() });
        showToast(`Report marked ${nextStatus}`);
        break;
      }
      case 'open-report': {
        const tType = actionEl.getAttribute('data-target-type') || 'user';
        const tId = actionEl.getAttribute('data-target-id') || '';
        const typeInput = document.getElementById('report-target-type');
        const idInput = document.getElementById('report-target-id');
        const summaryEl = document.getElementById('report-target-summary');
        if (typeInput instanceof HTMLInputElement) typeInput.value = tType;
        if (idInput instanceof HTMLInputElement) idInput.value = tId;
        if (summaryEl) summaryEl.textContent = `Reporting ${tType} (${tId.slice(0, 18)}) to community moderators.`;
        openModal('report-modal');
        break;
      }
      case 'block-user': {
        if (!currentFirebaseUser) break;
        const uid = actionEl.getAttribute('data-user-id');
        if (!uid || uid === currentFirebaseUser.uid) break;
        const targetUser = getMember(uid);
        await setDoc(doc(db, 'users', currentFirebaseUser.uid, 'blocks', uid), {
          blockedUid: uid,
          blockedName: String(targetUser.displayName || 'Member').slice(0, 80),
          createdAt: serverTimestamp(),
        });
        closePopover();
        showToast(`Blocked ${targetUser.displayName}`);
        break;
      }
      case 'unblock-user': {
        if (!currentFirebaseUser) break;
        const uid = actionEl.getAttribute('data-user-id');
        if (uid) {
          await deleteDoc(doc(db, 'users', currentFirebaseUser.uid, 'blocks', uid));
          showToast('User unblocked');
        }
        break;
      }
      case 'toggle-bookmark': {
        if (!currentFirebaseUser) break;
        const mid = actionEl.getAttribute('data-msg-id');
        if (!mid) break;
        const existingBm = state.bookmarks.find((b) => b.messageId === mid);
        if (existingBm) {
          await deleteDoc(doc(db, 'users', currentFirebaseUser.uid, 'bookmarks', existingBm.id));
          showToast('Bookmark removed');
        } else {
          const isDmThread = state.activeView === 'home' && state.activeDmId;
          const list = isDmThread ? state.dmMessages[state.activeDmId] || [] : state.messages[state.activeChannelId] || [];
          const msg = list.find((m) => m.id === mid);
          if (msg) {
            const bmId = `bm-${mid}`;
            await setDoc(doc(db, 'users', currentFirebaseUser.uid, 'bookmarks', bmId), {
              id: bmId,
              sourceType: isDmThread ? 'dm' : 'channel',
              sourceId: isDmThread ? state.activeDmId : state.activeChannelId,
              messageId: mid,
              authorName: String(msg.senderName || 'Member').slice(0, 80),
              content: String(msg.content || '').slice(0, 2000),
              createdAt: serverTimestamp(),
            });
            showToast('Saved to Bookmarks');
          }
        }
        break;
      }
      case 'remove-bookmark': {
        if (!currentFirebaseUser) break;
        const bmId = actionEl.getAttribute('data-bookmark-id');
        if (bmId) {
          await deleteDoc(doc(db, 'users', currentFirebaseUser.uid, 'bookmarks', bmId));
        }
        break;
      }
      case 'export-user-data': {
        const exportObj = {
          exportedAt: new Date().toISOString(),
          profile,
          servers: state.servers.map((s) => ({ id: s.id, name: s.name, category: s.category })),
          bookmarks: state.bookmarks,
          blockedUsers: state.blockedUsers,
        };
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexora-export-${profile.username || 'user'}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Downloaded JSON account export');
        break;
      }
      case 'select-channel': {
        const chId = actionEl.getAttribute('data-channel-id');
        if (chId && state.channels[chId] && srv) {
          state.activeView = 'server';
          state.activeChannelId = chId;
          state.searchQuery = '';
          shell?.classList.remove('mobile-nav-open');
          saveUiNav();
          subscribeMessages(srv.id, chId);
          renderAll();
        }
        break;
      }
      case 'select-dm':
        state.activeDmId = actionEl.getAttribute('data-dm-id') || state.activeDmId;
        state.pendingPeerId = '';
        state.activeView = 'home';
        state.dmThreadActiveMobile = true;
        shell?.classList.remove('mobile-nav-open');
        if (state.activeDmId) {
          subscribeDmMessages(state.activeDmId);
        }
        saveUiNav();
        renderAll();
        break;
      case 'clear-dm-search':
        state.dmSearchQuery = '';
        renderSidebar();
        document.getElementById('dm-user-search-input')?.focus();
        break;
      case 'clear-msg-search':
        state.searchQuery = '';
        state.threadSearchOpen = false;
        renderMainWorkspace();
        break;
      case 'retry-dm-sync':
        if (currentFirebaseUser) {
          state.dmError = '';
          subscribeDmThreads(currentFirebaseUser.uid);
          if (state.activeDmId) {
            subscribeDmMessages(state.activeDmId);
          }
          renderSidebar();
          renderMainWorkspace();
          notifyInboxBridge();
        }
        break;
      case 'open-messages-more': {
        e.stopPropagation();
        openPopoverNear(
          actionEl,
          `
            <strong>Messages Options</strong>
            <div class="menu-list">
              <button type="button" class="menu-item" data-action="open-create-group-chat">
                <span>New Group Chat</span>
                <span>${svgIcon('users', 14)}</span>
              </button>
              <button type="button" class="menu-item" data-action="open-share-community-link">
                <span>Share Community Invite Link</span>
                <span>${svgIcon('share', 14)}</span>
              </button>
              <button type="button" class="menu-item" data-action="open-join-community-link">
                <span>Join Community via Link</span>
                <span>${svgIcon('link', 14)}</span>
              </button>
              <button type="button" class="menu-item" data-action="toggle-show-archived-dms">
                <span>${state.showArchivedDms ? 'Hide Archived Chats' : 'Show Archived Chats'}</span>
                <span>${svgIcon('bookmark', 14)}</span>
              </button>
            </div>
          `
        );
        break;
      }
      case 'set-dm-tab': {
        const tab = actionEl.getAttribute('data-dm-tab');
        if (tab === 'all' || tab === 'unread' || tab === 'requests' || tab === 'primary' || tab === 'groups') {
          state.dmInboxTab = tab === 'primary' ? 'all' : tab;
          renderDmSidebarList();
          notifyInboxBridge();
        }
        break;
      }
      case 'toggle-cat': {
        const cid = actionEl.getAttribute('data-cat-id');
        if (cid) {
          state.collapsedCategories[cid] = !state.collapsedCategories[cid];
          saveUiNav();
          renderSidebar();
        }
        break;
      }
      case 'open-create-group-chat': {
        const picker = document.getElementById('group-chat-members-picker');
        const nameInput = document.getElementById('group-chat-name-input');
        if (nameInput instanceof HTMLInputElement) nameInput.value = '';
        if (picker) {
          const candidates = state.directoryUsers.filter((u) => u.id !== profile.id && !state.blockedSet.has(u.id));
          picker.innerHTML =
            candidates
              .map(
                (u) => `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;">
                  <input type="checkbox" name="group-member" value="${escapeHtml(u.id)}" />
                  <span style="font-weight:700;font-size:0.86rem;">${escapeHtml(u.displayName)}</span>
                  <span class="member-sub">@${escapeHtml(u.username)}</span>
                </label>`
              )
              .join('') || '<span class="member-sub">No members available yet.</span>';
        }
        openModal('create-group-chat-modal');
        break;
      }
      case 'toggle-archive-dm': {
        const dmId = actionEl.getAttribute('data-dm-id');
        if (!dmId || !currentFirebaseUser) break;
        const dm = state.dms.find((d) => d.id === dmId);
        if (!dm) break;
        const cur = Array.isArray(dm.archivedBy) ? dm.archivedBy : [];
        const next = cur.includes(currentFirebaseUser.uid)
          ? cur.filter((id) => id !== currentFirebaseUser.uid)
          : [...cur, currentFirebaseUser.uid].slice(0, 30);
        try {
          await updateDoc(doc(db, 'dm_threads', dmId), {
            archivedBy: next,
            updatedAt: serverTimestamp(),
          });
          showToast(next.includes(currentFirebaseUser.uid) ? 'Conversation archived' : 'Conversation restored');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `dm_threads/${dmId}`, 'Could not update archive status.');
        }
        break;
      }
      case 'toggle-show-archived-dms':
        state.showArchivedDms = !state.showArchivedDms;
        renderDmSidebarList();
        break;
      case 'open-create-server':
        openModal('create-server-modal');
        break;
      case 'open-create-channel':
        openModal('create-channel-modal');
        break;
      case 'open-settings':
        openModal('settings-modal');
        break;
      case 'open-server-admin':
        openModal('server-admin-modal');
        break;
      case 'toggle-notifications':
        e.stopPropagation();
        openPopoverNear(
          actionEl,
          `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong>Notifications</strong>
              <button type="button" class="btn btn-secondary" style="height:26px;font-size:0.74rem;" data-action="mark-notifs-read">Mark all read</button>
            </div>
            <div style="display:grid;gap:8px;">
              ${state.notifications
                .map(
                  (n) => `<div class="file-row" style="flex-direction:column;align-items:flex-start;opacity:${n.unread ? 1 : 0.65};">
                    <strong>${escapeHtml(n.title)}</strong>
                    <span class="member-sub" style="white-space:normal;">${escapeHtml(n.body)} · ${escapeHtml(n.time)}</span>
                  </div>`
                )
                .join('') || '<span class="member-sub">You are all caught up.</span>'}
            </div>
          `
        );
        break;
      case 'mark-notifs-read':
        if (currentFirebaseUser) {
          for (const n of state.notifications) {
            if (n.unread) {
              updateDoc(doc(db, 'users', currentFirebaseUser.uid, 'notifications', n.id), { unread: false }).catch(() => {});
            }
          }
        }
        closePopover();
        break;
      case 'insert-emoji': {
        const emoji = actionEl.getAttribute('data-emoji') || '';
        if (msgInput instanceof HTMLTextAreaElement && emoji) {
          const start = msgInput.selectionStart ?? msgInput.value.length;
          const end = msgInput.selectionEnd ?? msgInput.value.length;
          msgInput.value = msgInput.value.slice(0, start) + emoji + msgInput.value.slice(end);
          msgInput.focus();
          msgInput.setSelectionRange(start + emoji.length, start + emoji.length);
        }
        break;
      }
      case 'toggle-reaction': {
        const mid = actionEl.getAttribute('data-msg-id');
        const emoji = actionEl.getAttribute('data-emoji');
        if (!mid || !emoji) break;
        const isDmThread = state.activeView === 'home' && state.activeDmId;
        const list = isDmThread
          ? state.dmMessages[state.activeDmId] || []
          : state.activeView === 'server' && srv && state.activeChannelId
            ? state.messages[state.activeChannelId] || []
            : [];
        const msg = list.find((m) => m.id === mid);
        if (msg) {
          const nextReactions = (msg.reactions || []).map((r) => ({ emoji: r.emoji, userIds: [...(r.userIds || [])] }));
          let entry = nextReactions.find((x) => x.emoji === emoji);
          if (!entry) {
            nextReactions.push({ emoji, userIds: [profile.id] });
          } else if (entry.userIds.includes(profile.id)) {
            entry.userIds = entry.userIds.filter((id) => id !== profile.id);
          } else {
            entry.userIds.push(profile.id);
          }
          const cleaned = nextReactions.filter((x) => x.userIds.length > 0);
          const msgRef = isDmThread
            ? doc(db, 'dm_threads', state.activeDmId, 'messages', mid)
            : doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', mid);
          await updateDoc(msgRef, {
            reactions: cleaned,
            updatedAt: serverTimestamp(),
          });
        }
        break;
      }
      case 'vote-poll': {
        const mid = actionEl.getAttribute('data-msg-id');
        const oid = actionEl.getAttribute('data-opt-id');
        if (!mid || !oid || state.activeView !== 'server' || !srv || !state.activeChannelId) break;
        const msg = (state.messages[state.activeChannelId] || []).find((m) => m.id === mid);
        if (msg?.poll) {
          const nextPoll = {
            ...msg.poll,
            options: msg.poll.options.map((o) => ({ ...o, userIds: [...(o.userIds || [])] })),
          };
          const targetOpt = nextPoll.options.find((o) => o.id === oid);
          const wasVoted = targetOpt?.userIds.includes(profile.id);
          nextPoll.options.forEach((o) => {
            o.userIds = o.userIds.filter((id) => id !== profile.id);
          });
          if (!wasVoted && targetOpt) targetOpt.userIds.push(profile.id);
          await updateDoc(doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', mid), {
            poll: nextPoll,
            updatedAt: serverTimestamp(),
          });
        }
        break;
      }
      case 'reply-msg':
        state.replyToMsgId = actionEl.getAttribute('data-msg-id');
        renderMainWorkspace();
        msgInput?.focus();
        break;
      case 'open-thread':
        state.activeThreadMsgId = actionEl.getAttribute('data-msg-id');
        state.inspectorTab = 'thread';
        prefs.inspectorCollapsed = false;
        savePrefs();
        applyPrefsToDom();
        renderInspector();
        break;
      case 'toggle-pin': {
        const mid = actionEl.getAttribute('data-msg-id');
        if (!mid) break;
        const isDmThread = state.activeView === 'home' && state.activeDmId;
        const list = isDmThread
          ? state.dmMessages[state.activeDmId] || []
          : state.activeView === 'server' && srv && state.activeChannelId
            ? state.messages[state.activeChannelId] || []
            : [];
        const msg = list.find((m) => m.id === mid);
        if (msg) {
          const msgRef = isDmThread
            ? doc(db, 'dm_threads', state.activeDmId, 'messages', mid)
            : doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', mid);
          await updateDoc(msgRef, {
            pinned: !msg.pinned,
            updatedAt: serverTimestamp(),
          });
          showToast(!msg.pinned ? 'Message pinned' : 'Message unpinned');
        }
        break;
      }
      case 'edit-msg':
        editingMessageId = actionEl.getAttribute('data-msg-id');
        renderMainWorkspace();
        break;
      case 'save-edit': {
        const mid = actionEl.getAttribute('data-msg-id');
        const input = document.getElementById('inline-edit-input');
        if (!mid || !(input instanceof HTMLInputElement) || !input.value.trim()) break;
        const isDmThread = state.activeView === 'home' && state.activeDmId;
        if (isDmThread) {
          await updateDoc(doc(db, 'dm_threads', state.activeDmId, 'messages', mid), {
            content: input.value.trim().slice(0, 2000),
            edited: true,
            updatedAt: serverTimestamp(),
          });
          editingMessageId = null;
        } else if (state.activeView === 'server' && srv && state.activeChannelId) {
          await updateDoc(doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', mid), {
            content: input.value.trim().slice(0, 2000),
            edited: true,
            updatedAt: serverTimestamp(),
          });
          editingMessageId = null;
        }
        break;
      }
      case 'cancel-edit':
        editingMessageId = null;
        renderMainWorkspace();
        break;
      case 'delete-msg': {
        const mid = actionEl.getAttribute('data-msg-id');
        if (!mid) break;
        const isDmThread = state.activeView === 'home' && state.activeDmId;
        if (isDmThread) {
          await deleteDoc(doc(db, 'dm_threads', state.activeDmId, 'messages', mid));
          showToast('Message deleted');
        } else if (state.activeView === 'server' && srv && state.activeChannelId) {
          await deleteDoc(doc(db, 'servers', srv.id, 'channels', state.activeChannelId, 'messages', mid));
          showToast('Message deleted');
        }
        break;
      }
      case 'join-voice': {
        const chId = actionEl.getAttribute('data-channel-id') || state.activeChannelId;
        const mode = actionEl.getAttribute('data-call-mode') || 'audio';
        const ch = state.channels[chId];
        if (!chId || !ch) break;
        await rtc.joinCall({
          callId: getRoomCallId(ch.type, chId),
          kind: ch.type === 'stage' ? 'stage' : 'voice',
          targetId: chId,
          title: ch.name,
          currentUserProfile: profile,
          withVideo: mode === 'video',
          withScreen: mode === 'screen',
          muted: prefs.muted,
          deafened: prefs.deafened,
          handRaised: rtcState.handRaised,
        });
        showToast(`Joined ${ch.name}`);
        break;
      }
      case 'open-call-tab':
        ensureCallTab().openCallTab();
        break;
      case 'leave-voice': {
        const wasDmOrMeeting = rtcState.activeCall?.kind === 'dm' || rtcState.activeCall?.kind === 'meeting';
        await rtc.leaveCall();
        if (!wasDmOrMeeting) {
          showToast('Disconnected from live room');
        }
        break;
      }
      case 'toggle-mute':
        prefs.muted = !prefs.muted;
        savePrefs();
        applyPrefsToDom();
        await rtc.setMuted(prefs.muted, profile);
        break;
      case 'toggle-deafen':
        prefs.deafened = !prefs.deafened;
        savePrefs();
        applyPrefsToDom();
        rtc.setDeafened(prefs.deafened);
        break;
      case 'toggle-hand':
        await rtc.setHandRaised(!rtcState.handRaised, profile);
        break;
      case 'toggle-camera':
        await rtc.toggleCamera(profile);
        break;
      case 'flip-camera':
        await rtc.switchCameraFacing(profile);
        break;
      case 'toggle-screen-share': {
        if (rtcState.screenSharing) {
          await rtc.stopScreenShare(profile);
          stopShareBoardKeepAlive();
        } else {
          const support = detectScreenShareSupport();
          if (!support.nativeDisplayMedia) {
            openMobileShareModal(support, 'unsupported');
          } else {
            await rtc.startScreenShare(profile);
          }
        }
        break;
      }
      case 'open-share-options':
        openMobileShareModal(detectScreenShareSupport());
        break;
      case 'mobile-share-display': {
        const support = detectScreenShareSupport();
        if (!support.nativeDisplayMedia) {
          showToast('System screen recording is blocked by iOS WebKit. Pick Photo, Whiteboard, or Rear Camera below.');
          break;
        }
        const ready = await ensureActiveCallForShare();
        if (!ready) break;
        const res = await rtc.startScreenShare(profile);
        if (res?.started) {
          closeAllModals();
        }
        break;
      }
      case 'mobile-share-board': {
        const ready = await ensureActiveCallForShare();
        if (!ready) break;
        const canvas = initShareBoardCanvas();
        const res = await rtc.startCanvasScreenShare(canvas, profile, {
          fps: 15,
          kind: 'board',
          label: 'Live Whiteboard',
        });
        if (res?.started) {
          startShareBoardKeepAlive();
          renderMobileShareStatusButtons();
        }
        break;
      }
      case 'mobile-share-rear-cam': {
        const ready = await ensureActiveCallForShare();
        if (!ready) break;
        closeAllModals();
        await rtc.switchCameraFacing(profile, 'environment');
        break;
      }
      case 'share-ink-color': {
        shareInkColor = actionEl.getAttribute('data-color') || '#FF7A2F';
        document.querySelectorAll('.share-color-dot').forEach((dot) => dot.classList.remove('active'));
        actionEl.classList.add('active');
        break;
      }
      case 'share-clear-board':
        initShareBoardCanvas({ clear: true });
        break;
      case 'stop-mobile-share':
        await rtc.stopScreenShare(profile);
        stopShareBoardKeepAlive();
        renderMobileShareStatusButtons();
        break;
      case 'toggle-noise-suppression':
        await rtc.updateAudioSettings({ noiseSuppression: !rtcState.noiseSuppression });
        break;
      case 'toggle-echo-cancel':
        await rtc.updateAudioSettings({ echoCancellation: !rtcState.echoCancellation });
        break;
      case 'answer-incoming-call': {
        const inc = rtcState.incomingCall;
        const mode = actionEl.getAttribute('data-call-mode') || 'audio';
        if (inc) {
          const joined = await rtc.joinCall({
            callId: inc.id,
            kind: 'dm',
            targetId: inc.targetId,
            title: inc.callerName || 'Member',
            currentUserProfile: profile,
            targetPeerProfile: { id: inc.callerId },
            withVideo: mode === 'video',
            withScreen: mode === 'screen',
            muted: prefs.muted,
            deafened: prefs.deafened,
          });
          if (joined) {
            if (inc.targetId) {
              subscribeDmMessages(inc.targetId);
            }
            ensureCallTab().openCallTab();
          }
        }
        break;
      }
      case 'decline-incoming-call':
        if (rtcState.incomingCall) {
          await rtc.declineIncomingCall(rtcState.incomingCall.id);
        }
        break;
      case 'open-member-popover':
        e.stopPropagation();
        openMemberPopover(actionEl.getAttribute('data-user-id') || profile.id, actionEl, actionEl.getAttribute('data-user-id') === profile.id);
        break;
      case 'set-status': {
        const nextStatus = actionEl.getAttribute('data-status') || 'online';
        profile.status = nextStatus;
        if (currentFirebaseUser) {
          await updateUserProfile(currentFirebaseUser.uid, { ...profile, status: nextStatus });
        }
        renderAll();
        closePopover();
        break;
      }
      case 'set-theme':
        prefs.theme = normalizeThemePreference(actionEl.getAttribute('data-theme'));
        savePrefs();
        applyPrefsToDom();
        renderUserSettingsContent();
        socialModule?.render();
        break;
      case 'set-accent':
        prefs.accent = actionEl.getAttribute('data-accent') || '#F07827';
        savePrefs();
        applyPrefsToDom();
        renderUserSettingsContent();
        break;
      case 'set-density':
        prefs.density = actionEl.getAttribute('data-density') || 'cozy';
        savePrefs();
        applyPrefsToDom();
        renderUserSettingsContent();
        break;
      case 'toggle-pref': {
        const k = actionEl.getAttribute('data-pref');
        if (k) {
          prefs[k] = !prefs[k];
          savePrefs();
          renderUserSettingsContent();
        }
        break;
      }
      case 'sign-out':
        await signOutSession('/login.html');
        break;
      case 'prompt-delete-account':
        confirmDeleteOpen = true;
        renderUserSettingsContent();
        break;
      case 'cancel-delete-account':
        confirmDeleteOpen = false;
        renderUserSettingsContent();
        break;
      case 'confirm-delete-account':
        try {
          await deleteCurrentAccount();
        } catch (err) {
          showToast(
            formatFriendlyError(err, 'Site is busy right now. Could not delete account at this time.'),
            'error'
          );
          confirmDeleteOpen = false;
          renderUserSettingsContent();
        }
        break;
      case 'select-admin-role':
        selectedRoleId = actionEl.getAttribute('data-role-id') || 'role-owner';
        renderAdminContent();
        break;
      case 'toggle-role-perm': {
        if (!srv) break;
        const role = (srv.roles || DEFAULT_ROLES).find((r) => r.id === actionEl.getAttribute('data-role-id'));
        const perm = actionEl.getAttribute('data-perm');
        if (role && perm) {
          role.permissions[perm] = !role.permissions[perm];
          await logModerationAction(srv, `Toggled ${perm} permission for ${role.name}`);
          renderAdminContent();
        }
        break;
      }
      case 'toggle-guard': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) break;
        const key = actionEl.getAttribute('data-guard-key');
        if (key) {
          const nextGuard = { ...(srv.guard || {}), [key]: !srv.guard?.[key] };
          await updateDoc(doc(db, 'servers', srv.id), { guard: nextGuard, updatedAt: serverTimestamp() });
          await logModerationAction(srv, `Updated Server Guard (${key}: ${nextGuard[key]})`);
        }
        break;
      }
      case 'remove-blocked-word': {
        if (!srv || srv.ownerId !== currentFirebaseUser?.uid) break;
        const w = actionEl.getAttribute('data-word');
        const nextGuard = { ...(srv.guard || {}), blockedWords: (srv.guard?.blockedWords || []).filter((x) => x !== w) };
        await updateDoc(doc(db, 'servers', srv.id), { guard: nextGuard, updatedAt: serverTimestamp() });
        break;
      }
      case 'copy-invite':
        if (srv) {
          const code = srv.inviteCode || srv.id;
          navigator.clipboard?.writeText(`${window.location.origin}/welcome.html?invite=${code}`).catch(() => {});
          closePopover();
          showToast(`Copied invite link: ${code}`);
        }
        break;
      case 'open-join-community-link': {
        closePopover();
        const inp = document.getElementById('join-comm-link-input');
        if (inp instanceof HTMLInputElement) inp.value = '';
        openModal('join-community-link-modal');
        setTimeout(() => document.getElementById('join-comm-link-input')?.focus(), 40);
        break;
      }
      case 'open-share-community-link': {
        closePopover();
        const body = document.getElementById('share-community-link-body');
        const activeDm = state.dms.find((d) => d.id === state.activeDmId);
        if (body) {
          const srvs = state.servers || [];
          body.innerHTML =
            srvs.length === 0
              ? `<div style="display:grid;gap:10px;">
                  <p class="member-sub" style="white-space:normal;">You haven't joined or created any community yet. Create or join a community first to share its invite link here.</p>
                  <button type="button" class="btn btn-secondary" data-action="open-join-community-link">Join Community via Link</button>
                </div>`
              : `<div style="display:grid;gap:10px;">
                  <p class="member-sub" style="margin:0;white-space:normal;">
                    ${
                      activeDm
                        ? `Send a clickable invite card directly into <strong>${escapeHtml(activeDm.name)}</strong> or copy the link.`
                        : 'Select a conversation to send directly, or copy the invite link below.'
                    }
                  </p>
                  <div style="display:grid;gap:8px;max-height:280px;overflow-y:auto;">
                    ${srvs
                      .map(
                        (s) => `
                        <div class="file-row" style="justify-content:space-between;gap:10px;">
                          <div style="min-width:0;">
                            <strong>${escapeHtml(s.name)}</strong>
                            <div class="member-sub mono">Code: ${escapeHtml(s.inviteCode || s.id)}</div>
                          </div>
                          <div style="display:flex;gap:6px;flex-shrink:0;">
                            <button type="button" class="btn btn-secondary" data-action="copy-community-invite-link" data-server-id="${escapeHtml(s.id)}">Copy Link</button>
                            ${
                              activeDm
                                ? `<button type="button" class="btn btn-primary" data-action="send-community-invite-to-chat" data-server-id="${escapeHtml(s.id)}">Send to Chat</button>`
                                : ''
                            }
                          </div>
                        </div>
                      `
                      )
                      .join('')}
                  </div>
                </div>`;
        }
        openModal('share-community-link-modal');
        break;
      }
      case 'copy-community-invite-link': {
        const sid = actionEl.getAttribute('data-server-id');
        const targetSrv = (state.servers || []).find((s) => s.id === sid);
        if (targetSrv) {
          const code = targetSrv.inviteCode || targetSrv.id;
          const url = `${window.location.origin}/welcome.html?invite=${code}`;
          navigator.clipboard?.writeText(url).catch(() => {});
          showToast(`Copied invite link for ${targetSrv.name}`, 'success');
        }
        break;
      }
      case 'send-community-invite-to-chat': {
        const sid = actionEl.getAttribute('data-server-id');
        const targetSrv = (state.servers || []).find((s) => s.id === sid);
        const activeDm = state.dms.find((d) => d.id === state.activeDmId);
        if (!targetSrv || !activeDm || !currentFirebaseUser) {
          showToast('Open a conversation first to send this invite.');
          break;
        }
        const inviteText = buildCommunityInviteMessage(targetSrv, window.location.origin).slice(0, 2000);
        const msgId = `dmmsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          await setDoc(doc(db, 'dm_threads', activeDm.id, 'messages', msgId), {
            id: msgId,
            threadId: activeDm.id,
            participantIds: activeDm.participants,
            senderId: currentFirebaseUser.uid,
            senderName: profile.displayName.slice(0, 50),
            senderInitials: profile.initials.slice(0, 4),
            content: inviteText,
            seenBy: [currentFirebaseUser.uid],
            edited: false,
            pinned: false,
            reactions: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, 'dm_threads', activeDm.id), {
            lastMessage: `Community invite: ${targetSrv.name}`.slice(0, 300),
            updatedAt: serverTimestamp(),
          });
          closeAllModals();
          showToast(`Sent invite link for ${targetSrv.name}`, 'success');
        } catch (err) {
          showToast(formatFriendlyError(err, 'Could not share community link right now.'), 'error');
        }
        break;
      }
      case 'join-from-chat-invite': {
        const code = actionEl.getAttribute('data-invite-code') || '';
        if (code) await joinServerByInviteInput(code);
        break;
      }
      case 'community-card-menu': {
        e.stopPropagation();
        const sid = actionEl.getAttribute('data-server-id') || '';
        const targetSrv =
          (state.publicServers || []).find((s) => s.id === sid) ||
          (state.servers || []).find((s) => s.id === sid);
        if (!targetSrv) break;
        const code = targetSrv.inviteCode || targetSrv.id;
        openPopoverNear(
          actionEl,
          `
            <strong>${escapeHtml(targetSrv.name)}</strong>
            <div class="menu-list">
              <button type="button" class="menu-item" data-action="copy-invite-code" data-code="${escapeHtml(code)}">
                <span>Copy Community Invite Link</span>
                <span>${svgIcon('link', 14)}</span>
              </button>
              <button type="button" class="menu-item" data-action="join-from-chat-invite" data-invite-code="${escapeHtml(code)}">
                <span>Preview Rules &amp; Join</span>
                <span>${svgIcon('arrowRight', 14)}</span>
              </button>
            </div>
          `
        );
        break;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openModal('quickswitcher-modal');
    } else if (e.key === 'Escape') {
      closeAllModals();
      closePopover();
      emojiPopover?.classList.remove('open');
      emojiToggle?.setAttribute('aria-expanded', 'false');
    } else if (e.key === '[' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      prefs.sidebarCollapsed = !prefs.sidebarCollapsed;
      savePrefs();
      applyPrefsToDom();
    }
  });

  window.addEventListener('beforeunload', () => {
    rtc.leaveCall().catch(() => {});
  });
}

function openMemberPopover(userId, anchorEl, isSelf) {
  const m = getMember(userId);
  const isConnected = state.acceptedPeerIds.has(m.id);
  const srv = state.activeView === 'server' ? getActiveServer() : null;
  const canLeaderModerate = Boolean(srv && srv.ownerId === profile.id && !isSelf && m.id !== srv.ownerId);

  const leaderActionsHtml = canLeaderModerate
    ? `<div style="display:flex;gap:6px;padding-top:6px;border-top:1px solid var(--border-subtle);">
        <button type="button" class="btn btn-secondary" style="flex:1;color:#d97706;border-color:rgba(217,119,6,0.4);" data-action="open-leader-alert-modal" data-user-id="${escapeHtml(m.id)}">${svgIcon('flag', 13)} <span>Alert Abuse</span></button>
        <button type="button" class="btn btn-danger" style="flex:1;" data-action="kick-server-member" data-user-id="${escapeHtml(m.id)}">${svgIcon('trash', 13)} <span>Remove</span></button>
      </div>`
    : '';

  const actionsHtml = isSelf
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
        <button type="button" class="btn btn-secondary" data-action="set-status" data-status="online">Online</button>
        <button type="button" class="btn btn-secondary" data-action="set-status" data-status="idle">Idle</button>
        <button type="button" class="btn btn-secondary" data-action="set-status" data-status="dnd">Do Not Disturb</button>
        <button type="button" class="btn btn-secondary" data-action="set-status" data-status="invisible">Invisible</button>
      </div>
      <button type="button" class="btn btn-primary" data-action="open-settings">Edit Profile &amp; Privacy</button>
      <button type="button" class="btn btn-danger" data-action="sign-out">Sign Out</button>`
    : isConnected
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button type="button" class="btn btn-primary" data-action="start-dm" data-user-id="${escapeHtml(m.id)}">${svgIcon('chat', 14)} <span>Message</span></button>
          <button type="button" class="btn btn-secondary" data-action="call-user-direct" data-call-mode="audio" data-user-id="${escapeHtml(m.id)}">${svgIcon('phone', 14)} <span>Voice Call</span></button>
          <button type="button" class="btn btn-secondary" data-action="call-user-direct" data-call-mode="video" data-user-id="${escapeHtml(m.id)}">${svgIcon('video', 14)} <span>Video Call</span></button>
          <button type="button" class="btn btn-secondary" data-action="call-user-direct" data-call-mode="screen" data-user-id="${escapeHtml(m.id)}">${svgIcon('screen', 14)} <span>Share Screen</span></button>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn btn-secondary" style="flex:1;" data-action="open-report" data-target-type="user" data-target-id="${escapeHtml(m.id)}">${svgIcon('flag', 13)} <span>Report</span></button>
          <button type="button" class="btn btn-danger" style="flex:1;" data-action="block-user" data-user-id="${escapeHtml(m.id)}">${svgIcon('ban', 13)} <span>Block</span></button>
        </div>
        ${leaderActionsHtml}`
      : `<div style="display:grid;gap:6px;">
          <button type="button" class="btn btn-primary" data-action="start-dm" data-user-id="${escapeHtml(m.id)}">${svgIcon('userPlus', 14)} <span>Send Chat Request</span></button>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn btn-secondary" style="flex:1;" data-action="open-report" data-target-type="user" data-target-id="${escapeHtml(m.id)}">${svgIcon('flag', 13)} <span>Report</span></button>
            <button type="button" class="btn btn-danger" style="flex:1;" data-action="block-user" data-user-id="${escapeHtml(m.id)}">${svgIcon('ban', 13)} <span>Block</span></button>
          </div>
          ${leaderActionsHtml}
        </div>`;

  openPopoverNear(
    anchorEl,
    `
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="avatar-circle" style="width:42px;height:42px;font-size:0.95rem;">
          <span>${escapeHtml(m.initials || getInitials(m.displayName))}</span>
          <span class="status-dot ${escapeHtml(m.status)}"></span>
        </div>
        <div>
          <strong>${escapeHtml(m.displayName)}</strong>
          <div class="member-sub">@${escapeHtml(m.username)} · ${escapeHtml(m.status)}</div>
        </div>
      </div>
      <p class="member-sub" style="white-space:normal;margin:0;line-height:1.45;">${escapeHtml(m.bio || 'NEXORA community member.')}</p>
      ${actionsHtml}
    `
  );
}

let nexoraWsClient = null;
const inboxBridgeListeners = new Set();
let lastBridgeEmitTimer = null;

function connectNexoraWs(fbUser) {
  if (!fbUser) return;
  if (nexoraWsClient) {
    nexoraWsClient.disconnect();
    nexoraWsClient = null;
  }
  nexoraWsClient = createNexoraWsClient({
    getToken: async () => (auth.currentUser ? await auth.currentUser.getIdToken() : ''),
    onEvent: (ev) => {
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'presence:snapshot') {
        state.wsConnected = true;
        state.onlineUids = new Set(Array.isArray(ev.onlineUids) ? ev.onlineUids : []);
        notifyInboxBridge();
        return;
      }
      if (ev.type === 'presence:update' && ev.uid) {
        if (ev.online) state.onlineUids.add(ev.uid);
        else state.onlineUids.delete(ev.uid);
        notifyInboxBridge();
        return;
      }
      if (ev.type === 'typing:start' && ev.threadId && ev.uid) {
        if (!state.wsTypingMap[ev.threadId]) state.wsTypingMap[ev.threadId] = {};
        state.wsTypingMap[ev.threadId][ev.uid] = Date.now() + 5500;
        renderDmTypingIndicator();
        notifyInboxBridge();
        return;
      }
      if (ev.type === 'typing:stop' && ev.threadId && ev.uid) {
        if (state.wsTypingMap[ev.threadId]) {
          delete state.wsTypingMap[ev.threadId][ev.uid];
        }
        renderDmTypingIndicator();
        notifyInboxBridge();
        return;
      }
      if (ev.type === 'msg:read' || ev.type === 'msg:delivered' || ev.type === 'dm:notify') {
        notifyInboxBridge();
      }
    },
  });
  void nexoraWsClient.connect();
}

function getInboxSnapshot() {
  const now = Date.now();
  const dms = state.dms.map((dm) => {
    const peer = dm.userId ? getMember(dm.userId) : null;
    const msgs = state.dmMessages[dm.id] || [];
    const unreadCount = getDmUnreadCount(dm, msgs, profile.id);
    const isOnline =
      dm.type !== 'group' &&
      Boolean(dm.userId) &&
      (state.onlineUids.has(dm.userId) || (peer?.status || dm.status) === 'online');

    const fsTypers = dm.typing
      ? Object.entries(dm.typing)
          .filter(([uid, ts]) => uid !== profile.id && now - Number(ts || 0) < 5500)
          .map(([uid]) => uid)
      : [];
    const wsTypers = state.wsTypingMap[dm.id]
      ? Object.entries(state.wsTypingMap[dm.id])
          .filter(([uid, exp]) => uid !== profile.id && Number(exp || 0) > now)
          .map(([uid]) => uid)
      : [];
    const typingUids = Array.from(new Set([...fsTypers, ...wsTypers]));
    const typingNames = typingUids.map((uid) => getMember(uid).displayName);

    return {
      ...dm,
      peer: peer
        ? {
            id: peer.id,
            displayName: peer.displayName,
            username: peer.username,
            initials: peer.initials,
            avatar: peer.avatar || '',
            status: isOnline ? 'online' : peer.status || 'offline',
            customStatus: peer.customStatus || '',
          }
        : null,
      unreadCount,
      isOnline,
      typingNames,
    };
  });

  const directoryUsers = state.directoryUsers.map((u) => ({
    ...u,
    isOnline: state.onlineUids.has(u.id) || u.status === 'online',
  }));

  return {
    currentUser: {
      id: profile.id,
      displayName: profile.displayName,
      username: profile.username,
      initials: profile.initials,
      avatar: profile.avatar || '',
      status: profile.status || 'online',
    },
    dms,
    dmMessages: { ...state.dmMessages },
    directoryUsers,
    connectionRequests: [...state.connectionRequests],
    blockedIds: Array.from(state.blockedSet),
    acceptedPeerIds: Array.from(state.acceptedPeerIds),
    activeDmId: state.activeDmId,
    pendingPeerId: state.pendingPeerId,
    dmSearchQuery: state.dmSearchQuery,
    dmInboxTab: state.dmInboxTab,
    showArchivedDms: Boolean(state.showArchivedDms),
    dmThreadActiveMobile: Boolean(state.dmThreadActiveMobile),
    dmMessagesLoadingThreadId: state.dmMessagesLoadingThreadId,
    dmError: state.dmError,
    isSendingMessage: Boolean(state.isSendingMessage),
    replyToMsgId: state.replyToMsgId,
    onlineUids: Array.from(state.onlineUids),
    wsConnected: Boolean(state.wsConnected),
  };
}

function notifyInboxBridge() {
  if (lastBridgeEmitTimer) return;
  lastBridgeEmitTimer = window.setTimeout(() => {
    lastBridgeEmitTimer = null;
    const snap = getInboxSnapshot();
    for (const listener of inboxBridgeListeners) {
      try {
        listener(snap);
      } catch {}
    }
  }, 16);
}

window.NEXORA_APP_BRIDGE = {
  getSnapshot: () => getInboxSnapshot(),
  subscribe: (listener) => {
    if (typeof listener !== 'function') return () => {};
    inboxBridgeListeners.add(listener);
    try {
      listener(getInboxSnapshot());
    } catch {}
    return () => {
      inboxBridgeListeners.delete(listener);
    };
  },
  selectDm: (dmId) => {
    if (!dmId) return;
    state.activeDmId = dmId;
    state.pendingPeerId = '';
    state.activeView = 'home';
    state.replyToMsgId = null;
    state.dmThreadActiveMobile = true;
    subscribeDmMessages(dmId);
    saveUiNav();
    renderAll();
    notifyInboxBridge();
  },
  setMobileThreadOpen: (open) => {
    state.dmThreadActiveMobile = Boolean(open);
    notifyInboxBridge();
  },
  openPendingPeer: async (uid) => {
    await openDirectMessageWithUser(uid);
    notifyInboxBridge();
  },
  setDmSearchQuery: (q) => {
    state.dmSearchQuery = String(q || '');
    renderDmSidebarList();
    notifyInboxBridge();
  },
  setDmInboxTab: (tab) => {
    if (tab === 'all' || tab === 'unread' || tab === 'requests' || tab === 'groups') {
      state.dmInboxTab = tab;
      renderDmSidebarList();
      notifyInboxBridge();
    }
  },
  toggleShowArchivedDms: () => {
    state.showArchivedDms = !state.showArchivedDms;
    renderDmSidebarList();
    notifyInboxBridge();
  },
  retryDmSync: () => {
    if (!currentFirebaseUser) return;
    state.dmError = '';
    subscribeDmThreads(currentFirebaseUser.uid);
    if (state.activeDmId) subscribeDmMessages(state.activeDmId);
    notifyInboxBridge();
  },
  sendDmMessage: async (args) => sendDmMessagePayload(args),
  uploadAttachment: async (file) => uploadChatAttachmentFile(file),
  setReplyTo: (msgId) => {
    state.replyToMsgId = msgId || null;
    notifyInboxBridge();
  },
  toggleReaction: async (threadId, msgId, emoji) => {
    if (!threadId || !msgId || !emoji || !profile.id) return;
    const msg = (state.dmMessages[threadId] || []).find((m) => m.id === msgId);
    if (!msg) return;
    const nextReactions = (msg.reactions || []).map((r) => ({ emoji: r.emoji, userIds: [...(r.userIds || [])] }));
    let entry = nextReactions.find((x) => x.emoji === emoji);
    if (!entry) {
      nextReactions.push({ emoji, userIds: [profile.id] });
    } else if (entry.userIds.includes(profile.id)) {
      entry.userIds = entry.userIds.filter((id) => id !== profile.id);
    } else {
      entry.userIds.push(profile.id);
    }
    const cleaned = nextReactions.filter((x) => x.userIds.length > 0);
    await updateDoc(doc(db, 'dm_threads', threadId, 'messages', msgId), {
      reactions: cleaned,
      updatedAt: serverTimestamp(),
    });
  },
  editDmMessage: async (threadId, msgId, newContent) => {
    const clean = String(newContent || '').trim().slice(0, 2000);
    if (!threadId || !msgId || !clean) return;
    await updateDoc(doc(db, 'dm_threads', threadId, 'messages', msgId), {
      content: clean,
      edited: true,
      updatedAt: serverTimestamp(),
    });
  },
  deleteDmMessage: async (threadId, msgId) => {
    if (!threadId || !msgId) return;
    await deleteDoc(doc(db, 'dm_threads', threadId, 'messages', msgId));
    showToast('Message deleted');
  },
  togglePinDmMessage: async (threadId, msgId) => {
    if (!threadId || !msgId) return;
    const msg = (state.dmMessages[threadId] || []).find((m) => m.id === msgId);
    if (!msg) return;
    await updateDoc(doc(db, 'dm_threads', threadId, 'messages', msgId), {
      pinned: !msg.pinned,
      updatedAt: serverTimestamp(),
    });
    showToast(!msg.pinned ? 'Message pinned' : 'Message unpinned');
  },
  toggleArchiveDm: async (dmId) => {
    if (!dmId || !currentFirebaseUser) return;
    const dm = state.dms.find((d) => d.id === dmId);
    if (!dm) return;
    const cur = Array.isArray(dm.archivedBy) ? dm.archivedBy : [];
    const next = cur.includes(currentFirebaseUser.uid)
      ? cur.filter((id) => id !== currentFirebaseUser.uid)
      : [...cur, currentFirebaseUser.uid].slice(0, 30);
    await updateDoc(doc(db, 'dm_threads', dmId), {
      archivedBy: next,
      updatedAt: serverTimestamp(),
    });
    showToast(next.includes(currentFirebaseUser.uid) ? 'Conversation archived' : 'Conversation restored');
  },
  sendTypingSignal: (threadId, isTyping) => {
    if (!threadId || !currentFirebaseUser) return;
    const activeDm = state.dms.find((d) => d.id === threadId);
    if (!activeDm) return;
    const recipientIds = (activeDm.participants || []).filter((uid) => uid !== currentFirebaseUser.uid);
    if (nexoraWsClient && recipientIds.length > 0) {
      nexoraWsClient.send({
        type: isTyping ? 'typing:start' : 'typing:stop',
        threadId,
        recipientIds,
      });
    }
    const now = Date.now();
    if (!isTyping) {
      updateDoc(doc(db, 'dm_threads', threadId), {
        [`typing.${currentFirebaseUser.uid}`]: 0,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    } else if (now - lastTypingSentMs > 2400) {
      lastTypingSentMs = now;
      updateDoc(doc(db, 'dm_threads', threadId), {
        [`typing.${currentFirebaseUser.uid}`]: now,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  },
  markThreadRead: (threadId) => {
    if (!threadId || !currentFirebaseUser) return;
    const msgs = state.dmMessages[threadId] || [];
    const activeDm = state.dms.find((d) => d.id === threadId);
    const recipientIds = (activeDm?.participants || []).filter((uid) => uid !== currentFirebaseUser.uid);
    for (const msg of msgs) {
      const seenBy = Array.isArray(msg.seenBy) ? msg.seenBy : [];
      if (
        msg.authorId &&
        msg.authorId !== currentFirebaseUser.uid &&
        !seenBy.includes(currentFirebaseUser.uid) &&
        !markedSeenIds.has(msg.id) &&
        seenBy.length < 30
      ) {
        markedSeenIds.add(msg.id);
        updateDoc(doc(db, 'dm_threads', threadId, 'messages', msg.id), {
          seenBy: [...seenBy, currentFirebaseUser.uid],
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        if (nexoraWsClient && recipientIds.length > 0) {
          nexoraWsClient.send({
            type: 'msg:read',
            threadId,
            messageId: msg.id,
            recipientIds,
          });
        }
      }
    }
  },
  acceptRequest: async (reqId, fromUid) => respondConnectionRequest(reqId, true, fromUid),
  declineRequest: async (reqId) => respondConnectionRequest(reqId, false, ''),
  sendConnectionRequest: async (targetUid, note) => sendConnectionRequest(targetUid, note),
  startCall: async (userId, mode = 'audio') => startDmCallWithUser(userId, mode),
  openNewGroupModal: () => {
    const picker = document.getElementById('group-chat-members-picker');
    const nameInput = document.getElementById('group-chat-name-input');
    if (nameInput instanceof HTMLInputElement) nameInput.value = '';
    if (picker) {
      const candidates = state.directoryUsers.filter((u) => u.id !== profile.id && !state.blockedSet.has(u.id));
      picker.innerHTML =
        candidates
          .map(
            (u) => `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;">
              <input type="checkbox" name="group-member" value="${escapeHtml(u.id)}" />
              <span style="font-weight:700;font-size:0.86rem;">${escapeHtml(u.displayName)}</span>
              <span class="member-sub">@${escapeHtml(u.username)}</span>
            </label>`
          )
          .join('') || '<span class="member-sub">No members available yet.</span>';
    }
    openModal('create-group-chat-modal');
  },
  openShareCommunityModal: () => {
    const body = document.getElementById('share-community-link-body');
    const activeDm = state.dms.find((d) => d.id === state.activeDmId);
    if (body) {
      const srvs = state.servers || [];
      body.innerHTML =
        srvs.length === 0
          ? `<div style="display:grid;gap:10px;">
              <p class="member-sub" style="white-space:normal;">You haven't joined or created any community yet. Create or join a community first to share its invite link here.</p>
              <button type="button" class="btn btn-secondary" data-action="open-join-community-link">Join Community via Link</button>
            </div>`
          : `<div style="display:grid;gap:10px;">
              <p class="member-sub" style="margin:0;white-space:normal;">
                ${
                  activeDm
                    ? `Send a clickable invite card directly into <strong>${escapeHtml(activeDm.name)}</strong> or copy the link.`
                    : 'Select a conversation to send directly, or copy the invite link below.'
                }
              </p>
              <div style="display:grid;gap:8px;max-height:280px;overflow-y:auto;">
                ${srvs
                  .map(
                    (s) => `
                    <div class="file-row" style="justify-content:space-between;gap:10px;">
                      <div style="min-width:0;">
                        <strong>${escapeHtml(s.name)}</strong>
                        <div class="member-sub mono">Code: ${escapeHtml(s.inviteCode || s.id)}</div>
                      </div>
                      <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button type="button" class="btn btn-secondary" data-action="copy-community-invite-link" data-server-id="${escapeHtml(s.id)}">Copy Link</button>
                        ${
                          activeDm
                            ? `<button type="button" class="btn btn-primary" data-action="send-community-invite-to-chat" data-server-id="${escapeHtml(s.id)}">Send to Chat</button>`
                            : ''
                        }
                      </div>
                    </div>
                  `
                  )
                  .join('')}
              </div>
            </div>`;
    }
    openModal('share-community-link-modal');
  },
  openJoinCommunityModal: () => {
    const inp = document.getElementById('join-comm-link-input');
    if (inp instanceof HTMLInputElement) inp.value = '';
    openModal('join-community-link-modal');
    setTimeout(() => document.getElementById('join-comm-link-input')?.focus(), 40);
  },
  joinCommunityInvite: async (code) => joinServerByInviteInput(code),
  blockUser: async (uid) => {
    if (!currentFirebaseUser || !uid || uid === currentFirebaseUser.uid) return;
    const targetUser = getMember(uid);
    await setDoc(doc(db, 'users', currentFirebaseUser.uid, 'blocks', uid), {
      blockedUid: uid,
      blockedName: String(targetUser.displayName || 'Member').slice(0, 80),
      createdAt: serverTimestamp(),
    });
    showToast(`Blocked ${targetUser.displayName}`);
    notifyInboxBridge();
  },
  openReportModal: (targetType, targetId) => {
    const typeInput = document.getElementById('report-target-type');
    const idInput = document.getElementById('report-target-id');
    const summaryEl = document.getElementById('report-target-summary');
    if (typeInput instanceof HTMLInputElement) typeInput.value = targetType || 'user';
    if (idInput instanceof HTMLInputElement) idInput.value = targetId || '';
    if (summaryEl) summaryEl.textContent = `Reporting ${targetType || 'user'} (${String(targetId || '').slice(0, 18)}) to community moderators.`;
    openModal('report-modal');
  },
  viewProfile: (uid) => {
    if (uid && socialModule?.navigateTo) {
      socialModule.navigateTo('profile', { uid });
    }
  },
};

if (typeof window !== 'undefined') {
  window.dispatchEvent(new CustomEvent('nexora:bridge-ready'));
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.innerWidth <= 1080) {
    prefs.inspectorCollapsed = true;
  }
  initThemeSync();
  applyPrefsToDom();
  bindEvents();

  requireAuth({
    onAuthenticated: async (fbUser, loadedProfile) => {
      await initWorkspaceForUser(fbUser, loadedProfile);
    },
  });
});
