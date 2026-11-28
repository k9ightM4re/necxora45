export interface InboxUserSummary {
  id: string;
  displayName: string;
  username: string;
  initials: string;
  avatar?: string;
  status?: string;
  customStatus?: string;
  accountPrivacy?: string;
  isOnline?: boolean;
}

export interface DmReaction {
  emoji: string;
  userIds: string[];
}

export interface DmAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface DmMessageItem {
  id: string;
  authorId: string;
  senderName: string;
  senderInitials: string;
  time: string;
  timestamp: number;
  pinned?: boolean;
  edited?: boolean;
  replyToId?: string;
  content: string;
  attachment?: DmAttachment | null;
  seenBy: string[];
  reactions: DmReaction[];
  isError?: boolean;
}

export interface DmThreadItem {
  id: string;
  type: 'dm' | 'group';
  groupName?: string;
  participants: string[];
  archivedBy?: string[];
  mutedBy?: string[];
  deletedFor?: string[];
  memberRoles?: Record<string, string>;
  typing?: Record<string, number>;
  createdBy?: string;
  userId?: string;
  username?: string;
  name: string;
  initials: string;
  status?: string;
  lastMessage?: string;
  lastSenderId?: string;
  seenBy?: string[];
  updatedAtMs: number;
  topic?: string;
  peer?: InboxUserSummary | null;
  unreadCount: number;
  isOnline: boolean;
  typingNames: string[];
}

export interface ConnectionRequestItem {
  id: string;
  fromUid: string;
  fromName?: string;
  fromInitials?: string;
  toUid: string;
  toName?: string;
  toInitials?: string;
  participantIds?: string[];
  status: 'pending' | 'accepted' | 'declined';
  note?: string;
}

export type DmInboxTab = 'all' | 'unread' | 'requests' | 'groups';

export interface InboxSnapshot {
  currentUser: InboxUserSummary;
  dms: DmThreadItem[];
  dmMessages: Record<string, DmMessageItem[]>;
  directoryUsers: InboxUserSummary[];
  connectionRequests: ConnectionRequestItem[];
  blockedIds: string[];
  acceptedPeerIds: string[];
  activeDmId: string;
  pendingPeerId: string;
  dmSearchQuery: string;
  dmInboxTab: DmInboxTab;
  showArchivedDms: boolean;
  dmThreadActiveMobile: boolean;
  dmMessagesLoadingThreadId: string;
  dmError: string;
  isSendingMessage: boolean;
  replyToMsgId: string | null;
  onlineUids: string[];
  wsConnected: boolean;
}

export interface NexoraAppBridge {
  getSnapshot: () => InboxSnapshot;
  subscribe: (listener: (snapshot: InboxSnapshot) => void) => () => void;
  selectDm: (dmId: string) => void;
  setMobileThreadOpen: (open: boolean) => void;
  openPendingPeer: (uid: string) => Promise<void>;
  setDmSearchQuery: (q: string) => void;
  setDmInboxTab: (tab: DmInboxTab) => void;
  toggleShowArchivedDms: () => void;
  retryDmSync: () => void;
  sendDmMessage: (args: {
    threadId: string;
    text: string;
    replyToId?: string | null;
    attachment?: DmAttachment | null;
  }) => Promise<boolean>;
  uploadAttachment: (file: File) => Promise<DmAttachment | null>;
  setReplyTo: (msgId: string | null) => void;
  toggleReaction: (threadId: string, msgId: string, emoji: string) => Promise<void>;
  editDmMessage: (threadId: string, msgId: string, newContent: string) => Promise<void>;
  deleteDmMessage: (threadId: string, msgId: string) => Promise<void>;
  togglePinDmMessage: (threadId: string, msgId: string) => Promise<void>;
  toggleArchiveDm: (dmId: string) => Promise<void>;
  toggleMuteDm: (dmId: string) => Promise<void>;
  deleteThreadForMe: (dmId: string) => Promise<void>;
  manageGroupMembers: (
    dmId: string,
    args: { action: 'add' | 'remove' | 'rename' | 'leave' | 'promote' | 'demote'; targetUid?: string; groupName?: string }
  ) => Promise<boolean>;
  sendTypingSignal: (threadId: string, isTyping: boolean) => void;
  markThreadRead: (threadId: string) => void;
  acceptRequest: (reqId: string, fromUid: string) => Promise<void>;
  declineRequest: (reqId: string) => Promise<void>;
  sendConnectionRequest: (targetUid: string, note?: string) => Promise<boolean>;
  startCall: (userId: string, mode?: 'audio' | 'video') => Promise<void>;
  openNewGroupModal: () => void;
  openShareCommunityModal: () => void;
  openJoinCommunityModal: () => void;
  joinCommunityInvite: (code: string) => Promise<boolean>;
  blockUser: (uid: string) => Promise<void>;
  openReportModal: (targetType: string, targetId: string) => void;
  viewProfile: (uid: string) => void;
}

declare global {
  interface Window {
    NEXORA_APP_BRIDGE?: NexoraAppBridge;
  }
}

export function sanitizeSafeMediaUrl(url: unknown): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/api/media/') || raw.startsWith('/assets/')) return raw;
  if (
    /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw) ||
    /^data:video\/(mp4|webm);base64,[A-Za-z0-9+/=]+$/i.test(raw) ||
    /^data:audio\/(webm|ogg|mpeg|mp3|wav);base64,[A-Za-z0-9+/=]+$/i.test(raw)
  ) {
    return raw;
  }
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch {}
  return '';
}

export function formatRelativeTimeShort(ms: number): string {
  if (!ms) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 45) return 'Now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  const days = Math.floor(diffSec / 86400);
  if (days < 7) return `${days}d`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function getMessageDayKey(ms: number): string {
  const d = new Date(ms || Date.now());
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function formatMessageDateLabel(ms: number): string {
  const target = new Date(ms || Date.now());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const diffDays = Math.round((today - targetDay) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return target.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatFileSize(bytes: number): string {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function extractInviteCode(text: string): string {
  const raw = String(text || '');
  const urlMatch = raw.match(/welcome\.html\?invite=([a-zA-Z0-9_-]{3,40})/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const codeMatch = raw.match(/\bInvite Code:\s*([a-zA-Z0-9_-]{3,40})\b/i);
  return codeMatch?.[1] || '';
}
