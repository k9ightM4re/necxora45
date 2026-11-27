export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  banner?: string;
  bio?: string;
  status: UserStatus;
  customStatus?: string;
  badges?: string[];
  roleTitle?: string;
  joinedAt?: string;
  accentColor?: string;
}

export type ChannelType = 'text' | 'voice' | 'announcement' | 'forum' | 'stage';

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  topic?: string;
  isPrivate?: boolean;
  unreadCount?: number;
  slowModeSeconds?: number;
}

export interface ServerCategory {
  id: string;
  name: string;
  channelIds: string[];
}

export interface RolePermissions {
  administrator: boolean;
  viewChannels: boolean;
  sendMessages: boolean;
  manageMessages: boolean;
  manageChannels: boolean;
  manageRoles: boolean;
  kickMembers: boolean;
  banMembers: boolean;
  connectVoice: boolean;
  speakVoice: boolean;
  manageEvents: boolean;
}

export interface Role {
  id: string;
  name: string;
  color: string;
  isHoisted?: boolean;
  permissions: RolePermissions;
}

export interface ServerMember {
  userId: string;
  user: User;
  roleIds: string[];
  joinedAt: string;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
}

export interface ServerInvite {
  code: string;
  channelId: string;
  creatorId: string;
  uses: number;
  maxUses?: number;
  expiresAt?: string;
}

export interface Server {
  id: string;
  name: string;
  icon: string;
  banner?: string;
  description: string;
  category: string;
  ownerId: string;
  membersCount: number;
  verified?: boolean;
  featured?: boolean;
  tags?: string[];
  defaultChannelId: string;
  categories: ServerCategory[];
  roles: Role[];
  invites: ServerInvite[];
}

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[]; // user IDs
}

export interface MessageAttachment {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video' | 'file';
  size?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  votedUserIds: string[];
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  expiresAt?: string;
}

export interface Message {
  id: string;
  channelId: string;
  serverId?: string;
  senderId: string;
  sender: User;
  content: string;
  timestamp: string;
  edited?: boolean;
  editedAt?: string;
  isPinned?: boolean;
  replyTo?: {
    id: string;
    senderName: string;
    content: string;
  };
  attachments?: MessageAttachment[];
  reactions: MessageReaction[];
  poll?: Poll;
  threadId?: string;
}

export interface Thread {
  id: string;
  parentMessageId: string;
  channelId: string;
  name: string;
  messageCount: number;
  lastReplyAt: string;
}

export interface ForumPost {
  id: string;
  channelId: string;
  title: string;
  content: string;
  author: User;
  tags: string[];
  upvotes: number;
  upvotedByMe?: boolean;
  repliesCount: number;
  createdAt: string;
  pinned?: boolean;
}

export interface ServerEvent {
  id: string;
  serverId: string;
  title: string;
  description: string;
  startsAt: string;
  location: string;
  channelId?: string;
  banner?: string;
  interestedCount: number;
  isInterested?: boolean;
  status: 'upcoming' | 'live' | 'ended';
}

export interface Friendship {
  id: string;
  friend: User;
  status: UserStatus;
  activity?: {
    type: 'Playing' | 'Listening to' | 'Streaming' | 'Watching';
    name: string;
    detail?: string;
  };
  mutualServers?: number;
}

export interface FriendRequest {
  id: string;
  user: User;
  type: 'incoming' | 'outgoing';
  createdAt: string;
}

export interface DirectConversation {
  id: string;
  type: 'dm' | 'group';
  recipients: User[];
  lastMessage?: string;
  lastMessageTimestamp?: string;
  unreadCount: number;
}

export interface NotificationItem {
  id: string;
  type: 'mention' | 'dm' | 'server' | 'event' | 'friend_request';
  title: string;
  message: string;
  time: string;
  read: boolean;
  serverId?: string;
  channelId?: string;
}

export interface ModerationReport {
  id: string;
  targetType: 'user' | 'message' | 'server';
  targetId: string;
  targetName: string;
  reason: string;
  reporter: string;
  timestamp: string;
  status: 'pending' | 'resolved' | 'dismissed';
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  details?: string;
}

export interface VoiceParticipant {
  user: User;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  role?: string;
  volume: number;
}
