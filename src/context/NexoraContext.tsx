import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  User,
  Server,
  Channel,
  Message,
  Friendship,
  FriendRequest,
  DirectConversation,
  ServerEvent,
  ModerationReport,
  AuditLogEntry,
  ForumPost,
  VoiceParticipant,
  ChannelType,
} from '../types';
import {
  CURRENT_USER,
  NEXORA_BOT,
  INITIAL_SERVERS,
  INITIAL_CHANNELS,
  INITIAL_MESSAGES,
  INITIAL_EVENTS,
  INITIAL_FRIENDS,
  INITIAL_FRIEND_REQUESTS,
  INITIAL_DIRECT_CONVERSATIONS,
  INITIAL_DM_MESSAGES,
  INITIAL_FORUM_POSTS,
  INITIAL_REPORTS,
  INITIAL_AUDIT_LOGS,
  DISCOVERY_SERVERS,
  INITIAL_SERVER_USERS,
} from '../data/mockData';
import { castPollVote, sanitizeChannelName } from '../utils/rules';
import { logoutAuth } from '../services/firebase';

interface VoiceSession {
  serverId: string;
  channelId: string;
  channelName: string;
  isStage: boolean;
}

export type ModalType =
  | null
  | 'create-server'
  | 'server-settings'
  | 'user-settings'
  | 'create-channel'
  | 'create-member'
  | 'auth'
  | 'discovery'
  | 'search'
  | 'workspace';

interface NexoraContextType {
  currentUser: User;
  setCurrentUser: React.Dispatch<React.SetStateAction<User>>;
  serverMembers: User[];
  addMember: (memberData: Omit<User, 'id'>) => User;
  removeMember: (userId: string) => void;
  switchCurrentUser: (user: User) => void;
  servers: Server[];
  activeServerId: string | null;
  activeServer: Server | null;
  activeChannelId: string | null;
  activeChannel: Channel | null;
  channels: Record<string, Channel>;
  messages: Record<string, Message[]>;
  friends: Friendship[];
  friendRequests: FriendRequest[];
  directConversations: DirectConversation[];
  dmMessages: Record<string, Message[]>;
  events: ServerEvent[];
  forumPosts: ForumPost[];
  reports: ModerationReport[];
  auditLogs: AuditLogEntry[];
  discoveryServers: Server[];
  voiceSession: VoiceSession | null;
  voiceParticipants: VoiceParticipant[];
  isMuted: boolean;
  isDeafened: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  ping: number;
  activeModal: ModalType;
  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  isMemberListOpen: boolean;
  setIsMemberListOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedUserProfile: User | null;
  setSelectedUserProfile: (user: User | null) => void;
  typingUsers: string[];
  unreadNotice: string | null;
  setUnreadNotice: (notice: string | null) => void;
  isCaptchaPassed: boolean;
  setCaptchaPassed: (passed: boolean) => void;
  logoutUser: () => Promise<void>;

  // Actions
  setActiveServerId: (id: string | null) => void;
  setActiveChannelId: (id: string) => void;
  sendMessage: (channelId: string, content: string, attachments?: any[], replyTo?: any) => void;
  sendDmMessage: (dmId: string, content: string) => void;
  toggleReaction: (channelId: string, messageId: string, emoji: string) => void;
  togglePinMessage: (channelId: string, messageId: string) => void;
  deleteMessage: (channelId: string, messageId: string) => void;
  editMessage: (channelId: string, messageId: string, newContent: string) => void;
  votePoll: (channelId: string, messageId: string, optionId: string) => void;
  createServer: (name: string, category: string, icon?: string, template?: string) => string;
  deleteServer: (serverId: string) => void;
  updateServer: (serverId: string, updates: Partial<Server>) => void;
  createChannel: (serverId: string, name: string, type: ChannelType, categoryId?: string, topic?: string) => string;
  deleteChannel: (channelId: string) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  joinVoiceChannel: (serverId: string, channelId: string) => void;
  leaveVoiceChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => void;
  joinDiscoveryServer: (server: Server) => void;
  sendFriendRequest: (username: string) => { success: boolean; message: string };
  acceptFriendRequest: (requestId: string) => void;
  rejectFriendRequest: (requestId: string) => void;
  removeFriend: (friendshipId: string) => void;
  toggleEventInterested: (eventId: string) => void;
  createForumPost: (channelId: string, title: string, content: string, tags: string[]) => void;
  upvoteForumPost: (postId: string) => void;
  resolveReport: (reportId: string, resolution: 'resolved' | 'dismissed') => void;
  timeoutUser: (userId: string, minutes: number) => void;
  banUser: (userId: string, reason: string) => void;
  simulateTyping: () => void;
}

const NexoraContext = createContext<NexoraContextType | undefined>(undefined);

export const NexoraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Current user state
  const [currentUser, setCurrentUser] = useState<User>(() => {
    const saved = localStorage.getItem('nexora_user_v2');
    return saved ? JSON.parse(saved) : CURRENT_USER;
  });

  // Dynamic server members list (clean state with only Owner and NexoraBot initially)
  const [serverMembers, setServerMembers] = useState<User[]>(() => {
    const saved = localStorage.getItem('nexora_members_v2');
    return saved ? JSON.parse(saved) : INITIAL_SERVER_USERS;
  });

  // Servers
  const [servers, setServers] = useState<Server[]>(() => {
    const saved = localStorage.getItem('nexora_servers_v2');
    return saved ? JSON.parse(saved) : INITIAL_SERVERS;
  });

  const [activeServerId, setActiveServerIdState] = useState<string | null>('srv-nexora');
  const [activeChannelId, setActiveChannelIdState] = useState<string>('chn-general');

  // Channels & Messages
  const [channels, setChannels] = useState<Record<string, Channel>>(() => {
    const saved = localStorage.getItem('nexora_channels_v2');
    return saved ? JSON.parse(saved) : INITIAL_CHANNELS;
  });

  const [messages, setMessages] = useState<Record<string, Message[]>>(() => {
    const saved = localStorage.getItem('nexora_messages_v2');
    return saved ? JSON.parse(saved) : INITIAL_MESSAGES;
  });

  // Friends & DMs
  const [friends, setFriends] = useState<Friendship[]>(INITIAL_FRIENDS);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>(INITIAL_FRIEND_REQUESTS);
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>(INITIAL_DIRECT_CONVERSATIONS);
  const [dmMessages, setDmMessages] = useState<Record<string, Message[]>>(INITIAL_DM_MESSAGES);
  const [events, setEvents] = useState<ServerEvent[]>(INITIAL_EVENTS);
  const [forumPosts, setForumPosts] = useState<ForumPost[]>(INITIAL_FORUM_POSTS);
  const [reports, setReports] = useState<ModerationReport[]>(INITIAL_REPORTS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [discoveryServers] = useState<Server[]>(DISCOVERY_SERVERS);

  // Voice State
  const [voiceSession, setVoiceSession] = useState<VoiceSession | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [ping] = useState(19);

  // Modals & Panels
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMemberListOpen, setIsMemberListOpen] = useState(true);
  const [selectedUserProfile, setSelectedUserProfile] = useState<User | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [unreadNotice, setUnreadNotice] = useState<string | null>(null);

  // Captcha / Verification State (default to true per user request to remove reCAPTCHA)
  const [isCaptchaPassed, setCaptchaPassed] = useState<boolean>(true);

  const handleSetCaptchaPassed = (passed: boolean) => {
    setCaptchaPassed(passed);
  };

  const logoutUser = async () => {
    await logoutAuth();
    setCurrentUser(CURRENT_USER);
    setActiveModal('auth');
  };

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('nexora_user_v2', JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('nexora_members_v2', JSON.stringify(serverMembers));
  }, [serverMembers]);

  useEffect(() => {
    localStorage.setItem('nexora_servers_v2', JSON.stringify(servers));
  }, [servers]);

  useEffect(() => {
    localStorage.setItem('nexora_channels_v2', JSON.stringify(channels));
  }, [channels]);

  useEffect(() => {
    localStorage.setItem('nexora_messages_v2', JSON.stringify(messages));
  }, [messages]);

  // Derived current server and channel
  const activeServer = activeServerId ? servers.find(s => s.id === activeServerId) || null : null;
  const activeChannel = activeChannelId ? channels[activeChannelId] || null : null;

  const setActiveServerId = (id: string | null) => {
    setActiveServerIdState(id);
    if (id) {
      const srv = servers.find(s => s.id === id);
      if (srv) {
        setActiveChannelIdState(srv.defaultChannelId);
      }
    }
    setIsMobileSidebarOpen(false);
  };

  const setActiveChannelId = (id: string) => {
    setActiveChannelIdState(id);
    setIsMobileSidebarOpen(false);
    if (channels[id]?.unreadCount) {
      setChannels(prev => ({
        ...prev,
        [id]: { ...prev[id], unreadCount: 0 },
      }));
    }
  };

  const openModal = (modal: ModalType) => {
    setActiveModal(modal);
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  // User Management
  const addMember = (memberData: Omit<User, 'id'>): User => {
    const newId = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newMember: User = {
      ...memberData,
      id: newId,
      joinedAt: 'Just now',
    };

    setServerMembers(prev => [...prev, newMember]);

    // Update server member count
    setServers(prev =>
      prev.map(s =>
        s.id === 'srv-nexora' ? { ...s, membersCount: s.membersCount + 1 } : s
      )
    );

    // Announce in #general
    const welcomeMsg: Message = {
      id: `msg-join-${newId}`,
      channelId: 'chn-general',
      serverId: 'srv-nexora',
      senderId: 'usr-bot',
      sender: NEXORA_BOT,
      content: `🎉 Welcome **${newMember.displayName}** (@${newMember.username}) to NEXORA!`,
      timestamp: new Date().toISOString(),
      reactions: [{ emoji: '👋', count: 1, users: [currentUser.id] }],
    };

    setMessages(prev => ({
      ...prev,
      'chn-general': [...(prev['chn-general'] || []), welcomeMsg],
    }));

    return newMember;
  };

  const removeMember = (userId: string) => {
    if (userId === currentUser.id || userId === 'usr-bot') return;
    setServerMembers(prev => prev.filter(m => m.id !== userId));
    setServers(prev =>
      prev.map(s =>
        s.id === 'srv-nexora'
          ? { ...s, membersCount: Math.max(1, s.membersCount - 1) }
          : s
      )
    );
  };

  const switchCurrentUser = (user: User) => {
    setCurrentUser(user);
    if (selectedUserProfile?.id === user.id) {
      setSelectedUserProfile(null);
    }
  };

  // Messaging Actions
  const sendMessage = (channelId: string, content: string, attachments?: any[], replyTo?: any) => {
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    const newMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      channelId,
      serverId: activeServerId || undefined,
      senderId: currentUser.id,
      sender: currentUser,
      content,
      timestamp: new Date().toISOString(),
      attachments,
      reactions: [],
      replyTo,
    };

    setMessages(prev => ({
      ...prev,
      [channelId]: [...(prev[channelId] || []), newMessage],
    }));

    // Check for NexoraBot commands or Google Search grounding query
    const lower = content.toLowerCase();
    if (lower.startsWith('/search ') || lower.startsWith('@nexorabot')) {
      const query = lower.startsWith('/search ')
        ? content.slice(8).trim()
        : content.replace(/@nexorabot/i, '').trim();

      setTimeout(async () => {
        let answer = `🔍 **Search Results for "${query}"**:\nHere is what I found on the web: NEXORA brings low-latency audio rooms, flexible channel organization, and real-time community engagement.`;

        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.answer) {
              answer = data.answer;
            }
          }
        } catch {
          // Fallback gracefully
        }

        const botReply: Message = {
          id: `msg-bot-${Date.now()}`,
          channelId,
          serverId: activeServerId || undefined,
          senderId: 'usr-bot',
          sender: NEXORA_BOT,
          content: answer,
          timestamp: new Date().toISOString(),
          reactions: [{ emoji: '🌐', count: 1, users: [currentUser.id] }],
        };

        setMessages(p => ({
          ...p,
          [channelId]: [...(p[channelId] || []), botReply],
        }));
      }, 600);
    } else if (lower.includes('/help')) {
      setTimeout(() => {
        const botReply: Message = {
          id: `msg-bot-${Date.now()}`,
          channelId,
          serverId: activeServerId || undefined,
          senderId: 'usr-bot',
          sender: NEXORA_BOT,
          content: "🤖 **NEXORA Platform Help**:\n• `/search <query>` - Live web search\n• `/poll [question]` - Create an interactive community poll\n• Google Workspace Hub - Sync Gmail, Chat, and Contacts\n• Click **+ Add Member** in the members list to create and manage users!",
          timestamp: new Date().toISOString(),
          reactions: [{ emoji: '⚡', count: 1, users: [currentUser.id] }],
        };
        setMessages(p => ({
          ...p,
          [channelId]: [...(p[channelId] || []), botReply],
        }));
      }, 500);
    }
  };

  const sendDmMessage = (dmId: string, content: string) => {
    if (!content.trim()) return;

    const newMsg: Message = {
      id: `dm-msg-${Date.now()}`,
      channelId: dmId,
      senderId: currentUser.id,
      sender: currentUser,
      content,
      timestamp: new Date().toISOString(),
      reactions: [],
    };

    setDmMessages(prev => ({
      ...prev,
      [dmId]: [...(prev[dmId] || []), newMsg],
    }));

    setDirectConversations(prev =>
      prev.map(c =>
        c.id === dmId
          ? {
              ...c,
              lastMessage: content,
              lastMessageTimestamp: 'Just now',
            }
          : c
      )
    );
  };

  const toggleReaction = (channelId: string, messageId: string, emoji: string) => {
    const isDm = channelId.startsWith('dm-');
    const updateFn = (list: Message[]) =>
      list.map(msg => {
        if (msg.id !== messageId) return msg;

        const existingReaction = msg.reactions.find(r => r.emoji === emoji);
        if (existingReaction) {
          const hasVoted = existingReaction.users.includes(currentUser.id);
          const newUsers = hasVoted
            ? existingReaction.users.filter(u => u !== currentUser.id)
            : [...existingReaction.users, currentUser.id];

          const newReactions = msg.reactions
            .map(r =>
              r.emoji === emoji
                ? { ...r, count: newUsers.length, users: newUsers }
                : r
            )
            .filter(r => r.count > 0);

          return { ...msg, reactions: newReactions };
        } else {
          return {
            ...msg,
            reactions: [
              ...msg.reactions,
              { emoji, count: 1, users: [currentUser.id] },
            ],
          };
        }
      });

    if (isDm) {
      setDmMessages(prev => ({
        ...prev,
        [channelId]: updateFn(prev[channelId] || []),
      }));
    } else {
      setMessages(prev => ({
        ...prev,
        [channelId]: updateFn(prev[channelId] || []),
      }));
    }
  };

  const togglePinMessage = (channelId: string, messageId: string) => {
    setMessages(prev => ({
      ...prev,
      [channelId]: (prev[channelId] || []).map(msg =>
        msg.id === messageId ? { ...msg, isPinned: !msg.isPinned } : msg
      ),
    }));
  };

  const deleteMessage = (channelId: string, messageId: string) => {
    setMessages(prev => ({
      ...prev,
      [channelId]: (prev[channelId] || []).filter(msg => msg.id !== messageId),
    }));
  };

  const editMessage = (channelId: string, messageId: string, newContent: string) => {
    setMessages(prev => ({
      ...prev,
      [channelId]: (prev[channelId] || []).map(msg =>
        msg.id === messageId
          ? {
              ...msg,
              content: newContent,
              edited: true,
              editedAt: new Date().toISOString(),
            }
          : msg
      ),
    }));
  };

  const votePoll = (channelId: string, messageId: string, optionId: string) => {
    setMessages(prev => ({
      ...prev,
      [channelId]: (prev[channelId] || []).map(msg => {
        if (msg.id === messageId && msg.poll) {
          const updatedPoll = castPollVote(msg.poll, optionId, currentUser.id);
          return { ...msg, poll: updatedPoll };
        }
        return msg;
      }),
    }));
  };

  // Server & Channel Management
  const createServer = (name: string, category: string, icon?: string, template?: string): string => {
    const newServerId = `srv-${Date.now()}`;
    const defaultGenChannelId = `chn-${Date.now()}-gen`;

    const defaultChannels: Channel[] = [
      {
        id: defaultGenChannelId,
        serverId: newServerId,
        name: 'general',
        type: 'text',
        topic: `Welcome to the ${name} community!`,
      },
      {
        id: `chn-${Date.now()}-ann`,
        serverId: newServerId,
        name: 'announcements',
        type: 'announcement',
        topic: 'Important server announcements',
      },
      {
        id: `chn-${Date.now()}-voice`,
        serverId: newServerId,
        name: 'Lounge',
        type: 'voice',
      },
    ];

    const newChannelsMap = { ...channels };
    defaultChannels.forEach(c => {
      newChannelsMap[c.id] = c;
    });
    setChannels(newChannelsMap);

    const newServer: Server = {
      id: newServerId,
      name,
      icon:
        icon ||
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
      description: `Welcome to ${name}. Created on NEXORA.`,
      category: category || 'General discussion',
      ownerId: currentUser.id,
      membersCount: 1,
      defaultChannelId: defaultGenChannelId,
      categories: [
        {
          id: `cat-${Date.now()}-text`,
          name: 'TEXT CHANNELS',
          channelIds: defaultChannels.filter(c => c.type !== 'voice').map(c => c.id),
        },
        {
          id: `cat-${Date.now()}-voice`,
          name: 'VOICE CHANNELS',
          channelIds: defaultChannels.filter(c => c.type === 'voice').map(c => c.id),
        },
      ],
      roles: [
        {
          id: `role-owner-${newServerId}`,
          name: 'Owner',
          color: '#EAB308',
          permissions: {
            administrator: true,
            viewChannels: true,
            sendMessages: true,
            manageMessages: true,
            manageChannels: true,
            manageRoles: true,
            kickMembers: true,
            banMembers: true,
            connectVoice: true,
            speakVoice: true,
            manageEvents: true,
          },
        },
      ],
      invites: [
        {
          code: `join-${name.toLowerCase().replace(/\s+/g, '-')}-${Math.floor(1000 + Math.random() * 9000)}`,
          channelId: defaultGenChannelId,
          creatorId: currentUser.id,
          uses: 0,
        },
      ],
    };

    setServers(prev => [...prev, newServer]);
    setActiveServerId(newServerId);
    setActiveChannelId(defaultGenChannelId);

    setMessages(prev => ({
      ...prev,
      [defaultGenChannelId]: [
        {
          id: `msg-welcome-${newServerId}`,
          channelId: defaultGenChannelId,
          serverId: newServerId,
          senderId: currentUser.id,
          sender: currentUser,
          content: `Welcome to **${name}**! This is the beginning of the server. Invite friends using your invite code or customize channels in Server Settings! 🎉`,
          timestamp: new Date().toISOString(),
          reactions: [{ emoji: '👋', count: 1, users: [currentUser.id] }],
        },
      ],
    }));

    return newServerId;
  };

  const deleteServer = (serverId: string) => {
    setServers(prev => prev.filter(s => s.id !== serverId));
    if (activeServerId === serverId) {
      setActiveServerId('srv-nexora');
    }
  };

  const updateServer = (serverId: string, updates: Partial<Server>) => {
    setServers(prev =>
      prev.map(s => (s.id === serverId ? { ...s, ...updates } : s))
    );
  };

  const createChannel = (
    serverId: string,
    rawName: string,
    type: ChannelType,
    categoryId?: string,
    topic?: string
  ): string => {
    const sanitized = sanitizeChannelName(rawName);
    const channelName = sanitized.valid ? sanitized.formatted : 'new-channel';
    const channelId = `chn-${Date.now()}-${channelName}`;

    const newChannel: Channel = {
      id: channelId,
      serverId,
      name: channelName,
      type,
      topic: topic || `Discussion in #${channelName}`,
    };

    setChannels(prev => ({ ...prev, [channelId]: newChannel }));

    setServers(prev =>
      prev.map(srv => {
        if (srv.id !== serverId) return srv;

        const targetCategory =
          srv.categories.find(c => c.id === categoryId) ||
          srv.categories[0] || {
            id: `cat-${Date.now()}`,
            name: type === 'voice' ? 'VOICE CHANNELS' : 'CHANNELS',
            channelIds: [],
          };

        const updatedCategories = srv.categories.map(c =>
          c.id === targetCategory.id
            ? { ...c, channelIds: [...c.channelIds, channelId] }
            : c
        );

        return { ...srv, categories: updatedCategories };
      })
    );

    setActiveChannelId(channelId);
    return channelId;
  };

  const deleteChannel = (channelId: string) => {
    const chn = channels[channelId];
    if (!chn) return;

    setChannels(prev => {
      const copy = { ...prev };
      delete copy[channelId];
      return copy;
    });

    setServers(prev =>
      prev.map(srv => {
        if (srv.id !== chn.serverId) return srv;
        return {
          ...srv,
          categories: srv.categories.map(cat => ({
            ...cat,
            channelIds: cat.channelIds.filter(id => id !== channelId),
          })),
        };
      })
    );

    if (activeChannelId === channelId) {
      const srv = servers.find(s => s.id === chn.serverId);
      if (srv && srv.defaultChannelId !== channelId) {
        setActiveChannelId(srv.defaultChannelId);
      }
    }
  };

  const updateChannel = (channelId: string, updates: Partial<Channel>) => {
    setChannels(prev => ({
      ...prev,
      [channelId]: { ...prev[channelId], ...updates },
    }));
  };

  // Voice & Video Controls
  const joinVoiceChannel = (serverId: string, channelId: string) => {
    const chn = channels[channelId];
    if (!chn) return;

    setVoiceSession({
      serverId,
      channelId,
      channelName: chn.name,
      isStage: chn.type === 'stage',
    });
  };

  const leaveVoiceChannel = () => {
    setVoiceSession(null);
    setIsVideoOn(false);
    setIsScreenSharing(false);
  };

  const toggleMute = () => setIsMuted(prev => !prev);
  const toggleDeafen = () => {
    setIsDeafened(prev => {
      const next = !prev;
      if (next) setIsMuted(true);
      return next;
    });
  };
  const toggleVideo = () => setIsVideoOn(prev => !prev);
  const toggleScreenShare = () => setIsScreenSharing(prev => !prev);

  // Dynamic voice participants based on current server members
  const voiceParticipants: VoiceParticipant[] = voiceSession
    ? [
        {
          user: currentUser,
          isMuted,
          isDeafened,
          isSpeaking: !isMuted,
          isVideoOn,
          isScreenSharing,
          role: 'Speaker',
          volume: 100,
        },
        ...serverMembers
          .filter(m => m.id !== currentUser.id)
          .slice(0, 4)
          .map((m, idx) => ({
            user: m,
            isMuted: idx % 2 === 1,
            isDeafened: false,
            isSpeaking: idx === 0,
            isVideoOn: false,
            isScreenSharing: false,
            role: m.roleTitle === 'Server Owner' || m.roleTitle === 'Admin' ? 'Speaker' : 'Audience',
            volume: 95,
          })),
      ]
    : [];

  // Discovery
  const joinDiscoveryServer = (server: Server) => {
    if (!servers.some(s => s.id === server.id)) {
      setServers(prev => [...prev, { ...server, membersCount: server.membersCount + 1 }]);
    }
    setActiveServerId(server.id);
    closeModal();
  };

  // Friends & Social
  const sendFriendRequest = (username: string) => {
    const trimmed = username.trim().toLowerCase();
    if (!trimmed) return { success: false, message: 'Please enter a valid username.' };

    if (trimmed === currentUser.username.toLowerCase()) {
      return { success: false, message: "You cannot add yourself as a friend." };
    }

    if (friends.some(f => f.friend.username.toLowerCase() === trimmed)) {
      return { success: false, message: 'You are already friends with this user.' };
    }

    const foundMember = serverMembers.find(m => m.username.toLowerCase() === trimmed);
    const targetUser = foundMember || {
      id: `usr-custom-${Date.now()}`,
      username: trimmed,
      displayName: trimmed,
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      status: 'online' as const,
    };

    setFriendRequests(prev => [
      ...prev,
      {
        id: `fr-${Date.now()}`,
        user: targetUser,
        type: 'outgoing',
        createdAt: 'Just now',
      },
    ]);

    return { success: true, message: `Friend request sent to @${trimmed}!` };
  };

  const acceptFriendRequest = (requestId: string) => {
    const req = friendRequests.find(r => r.id === requestId);
    if (!req) return;

    setFriends(prev => [
      ...prev,
      {
        id: `f-${Date.now()}`,
        friend: req.user,
        status: req.user.status,
        activity: { type: 'Playing', name: 'NEXORA' },
        mutualServers: 1,
      },
    ]);

    setFriendRequests(prev => prev.filter(r => r.id !== requestId));

    const newDmId = `dm-${req.user.id}`;
    if (!directConversations.some(c => c.id === newDmId)) {
      setDirectConversations(prev => [
        {
          id: newDmId,
          type: 'dm',
          recipients: [req.user],
          lastMessage: 'Friend request accepted! Say hello 👋',
          lastMessageTimestamp: 'Just now',
          unreadCount: 0,
        },
        ...prev,
      ]);
    }
  };

  const rejectFriendRequest = (requestId: string) => {
    setFriendRequests(prev => prev.filter(r => r.id !== requestId));
  };

  const removeFriend = (friendshipId: string) => {
    setFriends(prev => prev.filter(f => f.id !== friendshipId));
  };

  // Events
  const toggleEventInterested = (eventId: string) => {
    setEvents(prev =>
      prev.map(evt => {
        if (evt.id !== eventId) return evt;
        const nextInterested = !evt.isInterested;
        return {
          ...evt,
          isInterested: nextInterested,
          interestedCount: nextInterested
            ? evt.interestedCount + 1
            : Math.max(0, evt.interestedCount - 1),
        };
      })
    );
  };

  // Forum
  const createForumPost = (
    channelId: string,
    title: string,
    content: string,
    tags: string[]
  ) => {
    const newPost: ForumPost = {
      id: `post-${Date.now()}`,
      channelId,
      title,
      content,
      author: currentUser,
      tags: tags.length ? tags : ['discussion'],
      upvotes: 1,
      upvotedByMe: true,
      repliesCount: 0,
      createdAt: 'Just now',
    };
    setForumPosts(prev => [newPost, ...prev]);
  };

  const upvoteForumPost = (postId: string) => {
    setForumPosts(prev =>
      prev.map(p => {
        if (p.id !== postId) return p;
        const upvoted = !p.upvotedByMe;
        return {
          ...p,
          upvotedByMe: upvoted,
          upvotes: upvoted ? p.upvotes + 1 : Math.max(0, p.upvotes - 1),
        };
      })
    );
  };

  // Moderation
  const resolveReport = (reportId: string, resolution: 'resolved' | 'dismissed') => {
    setReports(prev =>
      prev.map(r => (r.id === reportId ? { ...r, status: resolution } : r))
    );
  };

  const timeoutUser = (userId: string, minutes: number) => {
    setAuditLogs(prev => [
      {
        id: `log-${Date.now()}`,
        action: 'MEMBER_TIMEOUT',
        actor: currentUser.displayName,
        target: userId,
        timestamp: 'Just now',
        details: `Timed out member for ${minutes} minutes.`,
      },
      ...prev,
    ]);
  };

  const banUser = (userId: string, reason: string) => {
    setAuditLogs(prev => [
      {
        id: `log-${Date.now()}`,
        action: 'MEMBER_BAN',
        actor: currentUser.displayName,
        target: userId,
        timestamp: 'Just now',
        details: `Permanently banned. Reason: ${reason}`,
      },
      ...prev,
    ]);
    removeMember(userId);
  };

  const simulateTyping = () => {
    setTypingUsers(['NexoraBot']);
    setTimeout(() => {
      setTypingUsers([]);
    }, 2500);
  };

  return (
    <NexoraContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        serverMembers,
        addMember,
        removeMember,
        switchCurrentUser,
        servers,
        activeServerId,
        activeServer,
        activeChannelId,
        activeChannel,
        channels,
        messages,
        friends,
        friendRequests,
        directConversations,
        dmMessages,
        events,
        forumPosts,
        reports,
        auditLogs,
        discoveryServers,
        voiceSession,
        voiceParticipants,
        isMuted,
        isDeafened,
        isVideoOn,
        isScreenSharing,
        ping,
        activeModal,
        openModal,
        closeModal,
        isMobileSidebarOpen,
        setIsMobileSidebarOpen,
        isMemberListOpen,
        setIsMemberListOpen,
        selectedUserProfile,
        setSelectedUserProfile,
        typingUsers,
        unreadNotice,
        setUnreadNotice,
        isCaptchaPassed,
        setCaptchaPassed: handleSetCaptchaPassed,
        logoutUser,
        setActiveServerId,
        setActiveChannelId,
        sendMessage,
        sendDmMessage,
        toggleReaction,
        togglePinMessage,
        deleteMessage,
        editMessage,
        votePoll,
        createServer,
        deleteServer,
        updateServer,
        createChannel,
        deleteChannel,
        updateChannel,
        joinVoiceChannel,
        leaveVoiceChannel,
        toggleMute,
        toggleDeafen,
        toggleVideo,
        toggleScreenShare,
        joinDiscoveryServer,
        sendFriendRequest,
        acceptFriendRequest,
        rejectFriendRequest,
        removeFriend,
        toggleEventInterested,
        createForumPost,
        upvoteForumPost,
        resolveReport,
        timeoutUser,
        banUser,
        simulateTyping,
      }}
    >
      {children}
    </NexoraContext.Provider>
  );
};

export const useNexora = () => {
  const context = useContext(NexoraContext);
  if (!context) {
    throw new Error('useNexora must be used within a NexoraProvider');
  }
  return context;
};
