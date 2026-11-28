import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  Archive,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronRight,
  Flag,
  LogOut,
  Mic,
  MoreVertical,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Trash2,
  User,
  Users,
  Video,
  X,
} from 'lucide-react';
import { AvatarBadge } from './AvatarBadge';
import {
  extractInviteCode,
  formatFileSize,
  formatMessageDateLabel,
  getMessageDayKey,
  sanitizeSafeMediaUrl,
  type DmAttachment,
  type DmMessageItem,
  type InboxSnapshot,
  type NexoraAppBridge,
} from './types';

interface ActiveConversationProps {
  snapshot: InboxSnapshot;
  bridge: NexoraAppBridge | undefined;
}

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '🙌'];
const COMPOSER_EMOJIS = [
  '😀', '😄', '😎', '🤔', '🥳', '🤩',
  '👍', '👏', '🙌', '🤝', '👋', '✌️',
  '🔥', '⚡', '🚀', '✨', '💡', '✅',
];

type TimelineRow =
  | { kind: 'date'; id: string; label: string }
  | { kind: 'msg'; id: string; msg: DmMessageItem; isSelf: boolean; isGrouped: boolean };

export const ActiveConversation: React.FC<ActiveConversationProps> = ({ snapshot, bridge }) => {
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<DmAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = useState('');
  const [brokenMediaIds, setBrokenMediaIds] = useState<Record<string, boolean>>({});

  const moreRef = useRef<HTMLDivElement | null>(null);
  const emojiRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  const currentUid = snapshot.currentUser.id;
  const activeDm = useMemo(() => {
    if (snapshot.pendingPeerId) return null;
    return (
      snapshot.dms.find((d) => d.id === snapshot.activeDmId) ||
      snapshot.dms.find((d) => !(Array.isArray(d.archivedBy) && d.archivedBy.includes(currentUid))) ||
      snapshot.dms[0] ||
      null
    );
  }, [snapshot.dms, snapshot.activeDmId, snapshot.pendingPeerId, currentUid]);

  const activeThreadId = activeDm?.id || '';

  useEffect(() => {
    setThreadSearchOpen(false);
    setThreadQuery('');
    setEditingMsgId(null);
    setEditingText('');
    setEmojiOpen(false);
    setMoreOpen(false);
  }, [activeThreadId, snapshot.pendingPeerId]);

  useEffect(() => {
    if (!moreOpen && !emojiOpen) return;
    const handleOutside = (ev: MouseEvent) => {
      if (moreOpen && moreRef.current && !moreRef.current.contains(ev.target as Node)) {
        setMoreOpen(false);
      }
      if (emojiOpen && emojiRef.current && !emojiRef.current.contains(ev.target as Node)) {
        setEmojiOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [moreOpen, emojiOpen]);

  const rawMessages = useMemo(
    () => (activeThreadId ? snapshot.dmMessages[activeThreadId] || [] : []),
    [snapshot.dmMessages, activeThreadId]
  );

  // Automatically mark unread incoming messages read when viewing the active thread
  useEffect(() => {
    if (!activeThreadId || !bridge || rawMessages.length === 0) return;
    const hasUnread = rawMessages.some(
      (m) => m.authorId && m.authorId !== currentUid && !(m.seenBy || []).includes(currentUid)
    );
    if (hasUnread) {
      bridge.markThreadRead(activeThreadId);
    }
  }, [activeThreadId, rawMessages, currentUid, bridge]);

  const filteredMessages = useMemo(() => {
    const q = threadQuery.trim().toLowerCase();
    if (!q) return rawMessages;
    return rawMessages.filter(
      (m) =>
        String(m.content || '').toLowerCase().includes(q) ||
        String(m.senderName || '').toLowerCase().includes(q)
    );
  }, [rawMessages, threadQuery]);

  const timelineRows = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [];
    let lastDayKey = '';
    let prevMsg: DmMessageItem | null = null;
    for (const msg of filteredMessages) {
      const dayKey = getMessageDayKey(msg.timestamp);
      if (dayKey !== lastDayKey) {
        rows.push({
          kind: 'date',
          id: `date-${dayKey}`,
          label: formatMessageDateLabel(msg.timestamp),
        });
        lastDayKey = dayKey;
      }
      const isGrouped =
        Boolean(prevMsg) &&
        prevMsg!.authorId === msg.authorId &&
        Math.abs(Number(msg.timestamp || 0) - Number(prevMsg!.timestamp || 0)) < 120000;
      rows.push({
        kind: 'msg',
        id: msg.id,
        msg,
        isSelf: msg.authorId === currentUid,
        isGrouped,
      });
      prevMsg = msg;
    }
    return rows;
  }, [filteredMessages, currentUid]);

  const messageById = useMemo(() => {
    const map = new Map<string, DmMessageItem>();
    for (const m of rawMessages) map.set(m.id, m);
    return map;
  }, [rawMessages]);

  const replyTarget = snapshot.replyToMsgId ? messageById.get(snapshot.replyToMsgId) || null : null;

  const handleSend = async () => {
    if (!activeThreadId || !bridge) return;
    if (snapshot.isSendingMessage || isUploading) return;
    const cleanText = composerText.trim();
    if (!cleanText && !pendingAttachment) return;

    const textBackup = composerText;
    const attBackup = pendingAttachment;
    const replyBackup = snapshot.replyToMsgId;

    setComposerText('');
    setPendingAttachment(null);
    bridge.setReplyTo(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const ok = await bridge.sendDmMessage({
      threadId: activeThreadId,
      text: cleanText,
      replyToId: replyBackup,
      attachment: attBackup,
    });
    if (!ok) {
      setComposerText(textBackup);
      setPendingAttachment(attBackup);
      bridge.setReplyTo(replyBackup);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !bridge) return;
    setIsUploading(true);
    try {
      const uploaded = await bridge.uploadAttachment(file);
      if (uploaded) {
        setPendingAttachment(uploaded);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleToggleVoiceRecord = async () => {
    if (!bridge) return;
    if (isRecording && recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      setIsRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordingChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type: mime });
        const ext = mime.includes('ogg') ? 'ogg' : 'webm';
        const voiceFile = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mime });
        setIsUploading(true);
        try {
          const uploaded = await bridge.uploadAttachment(voiceFile);
          if (uploaded) setPendingAttachment(uploaded);
        } finally {
          setIsUploading(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  };

  // Pending Connection Gate View
  if (snapshot.pendingPeerId) {
    const peer = snapshot.directoryUsers.find((u) => u.id === snapshot.pendingPeerId);
    const incomingReq = snapshot.connectionRequests.find(
      (r) => r.status === 'pending' && r.fromUid === snapshot.pendingPeerId && r.toUid === currentUid
    );
    const outgoingReq = snapshot.connectionRequests.find(
      (r) => r.status === 'pending' && r.fromUid === currentUid && r.toUid === snapshot.pendingPeerId
    );
    const displayName = peer?.displayName || incomingReq?.fromName || outgoingReq?.toName || 'Member';
    const username = peer?.username || 'member';

    return (
      <section
        aria-label="Connection request gate"
        className={`${
          snapshot.dmThreadActiveMobile ? 'flex' : 'hidden md:flex'
        } h-full min-w-0 flex-1 flex-col bg-[#FFF0DC] dark:bg-[#1B0709]`}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[#E8D3B8] bg-[#FFF8EE] px-4 dark:border-[#FFF0DC]/15 dark:bg-[#260A0D]">
          <button
            type="button"
            onClick={() => bridge?.setMobileThreadOpen(false)}
            aria-label="Back to messages"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 md:hidden"
          >
            <ArrowLeft size={18} />
          </button>
          <AvatarBadge name={displayName} initials={peer?.initials} avatar={peer?.avatar} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[0.95rem] font-semibold text-[#2A0A0D] dark:text-[#FFF0DC]">
              {displayName}
            </div>
            <div className="truncate text-[0.76rem] text-[#6B4A4D] dark:text-[#C89D8B]">
              @{username} · Connection approval required
            </div>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-[#E8D3B8] bg-[#FFF8EE] p-6 text-center dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12]">
            <div className="mx-auto mb-4 flex justify-center">
              <AvatarBadge
                name={displayName}
                initials={peer?.initials}
                avatar={peer?.avatar}
                size={68}
                isOnline={Boolean(peer?.isOnline)}
              />
            </div>
            <h3 className="font-['Playfair_Display',serif] text-xl font-bold text-[#2A0A0D] dark:text-[#FFF0DC]">{displayName}</h3>
            <p className="mt-0.5 text-[0.84rem] text-[#6B4A4D] dark:text-[#C89D8B]">@{username}</p>

            {incomingReq ? (
              <div className="mt-5 space-y-3">
                <p className="text-[0.86rem] text-[#6B4A4D] dark:text-[#E4C7B2]">
                  {displayName} wants to open a direct conversation and live calls with you.
                </p>
                <div className="flex justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void bridge?.acceptRequest(incomingReq.id, incomingReq.fromUid)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#790B13] px-5 text-[0.86rem] font-medium text-[#FFF0DC] hover:bg-[#5C0810]"
                  >
                    <Check size={16} />
                    <span>Accept &amp; Open Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void bridge?.declineRequest(incomingReq.id)}
                    className="inline-flex h-10 items-center rounded-xl border border-[#E8D3B8] px-4 text-[0.86rem] font-medium text-[#6B4A4D] hover:bg-[#790B13]/10 dark:border-[#FFF0DC]/15 dark:text-[#E4C7B2] dark:hover:bg-[#FFF0DC]/10"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : outgoingReq ? (
              <div className="mt-5 space-y-2">
                <p className="text-[0.86rem] font-medium text-[#B45309] dark:text-[#FBBF24]">Awaiting approval</p>
                <p className="text-[0.82rem] text-[#6B4A4D] dark:text-[#E4C7B2]">
                  Your chat request was sent. Messaging and calls unlock as soon as {displayName} accepts.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-3 text-left">
                <p className="text-center text-[0.85rem] text-[#6B4A4D] dark:text-[#E4C7B2]">
                  Send a connection request before messaging or calling {displayName}.
                </p>
                <input
                  type="text"
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  maxLength={240}
                  placeholder="Optional intro note..."
                  className="h-10 w-full rounded-xl border border-[#E8D3B8] bg-[#F7E5CE] px-3 text-[0.85rem] text-[#2A0A0D] placeholder:text-[#6B4A4D] focus:border-[#790B13] focus:outline-none dark:border-[#FFF0DC]/15 dark:bg-[#260A0D] dark:text-[#FFF0DC] dark:placeholder:text-[#C89D8B]"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await bridge?.sendConnectionRequest(snapshot.pendingPeerId, requestNote);
                    setRequestNote('');
                  }}
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#790B13] px-4 text-[0.86rem] font-medium text-[#FFF0DC] hover:bg-[#5C0810]"
                >
                  Send Chat Request
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Empty Workspace State
  if (!activeDm) {
    return (
      <section
        aria-label="Conversation workspace"
        className={`${
          snapshot.dmThreadActiveMobile ? 'flex' : 'hidden md:flex'
        } h-full min-w-0 flex-1 flex-col items-center justify-center bg-[#FFF0DC] p-6 text-center dark:bg-[#1B0709]`}
      >
        <div className="max-w-sm space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#790B13]/12 text-[#790B13] dark:bg-[#790B13]/30 dark:text-[#FFF0DC]">
            <Users size={26} />
          </div>
          <h3 className="font-['Playfair_Display',serif] text-xl font-bold text-[#2A0A0D] dark:text-[#FFF0DC]">
            Your Messages
          </h3>
          <p className="text-[0.88rem] leading-relaxed text-[#6B4A4D] dark:text-[#E4C7B2]">
            Select a conversation from the left panel or start a new group chat to message and call.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => bridge?.openNewGroupModal()}
              className="inline-flex h-9 items-center rounded-xl bg-[#790B13] px-4 text-[0.84rem] font-medium text-[#FFF0DC] hover:bg-[#5C0810]"
            >
              New Group Chat
            </button>
            <button
              type="button"
              onClick={() => bridge?.openJoinCommunityModal()}
              className="inline-flex h-9 items-center rounded-xl border border-[#E8D3B8] px-4 text-[0.84rem] font-medium text-[#2A0A0D] hover:bg-[#790B13]/10 dark:border-[#FFF0DC]/15 dark:text-[#FFF0DC] dark:hover:bg-[#FFF0DC]/10"
            >
              Join Community
            </button>
          </div>
        </div>
      </section>
    );
  }

  const isArchived = Array.isArray(activeDm.archivedBy) && activeDm.archivedBy.includes(currentUid);
  const isMuted = Array.isArray(activeDm.mutedBy) && activeDm.mutedBy.includes(currentUid);
  const isGroupAdmin =
    activeDm.type === 'group' &&
    (activeDm.createdBy === currentUid || activeDm.memberRoles?.[currentUid] === 'admin');
  const isTyping = activeDm.typingNames.length > 0;
  const statusLine = isTyping
    ? activeDm.typingNames.length === 1
      ? `${activeDm.typingNames[0]} is typing...`
      : `${activeDm.typingNames.slice(0, 2).join(', ')} are typing...`
    : activeDm.type === 'group'
      ? `${activeDm.participants.length} members`
      : activeDm.isOnline
        ? `@${activeDm.peer?.username || activeDm.username || 'member'} · Active now`
        : `@${activeDm.peer?.username || activeDm.username || 'member'}`;

  const renderTimelineItem = (_idx: number, row: TimelineRow) => {
    if (row.kind === 'date') {
      return (
        <div role="separator" className="my-4 flex items-center justify-center gap-3 px-4">
          <span className="h-px flex-1 bg-[#E8D3B8] dark:bg-[#FFF0DC]/15" />
          <span className="text-[0.72rem] font-medium text-[#6B4A4D] dark:text-[#C89D8B]">
            {row.label}
          </span>
          <span className="h-px flex-1 bg-[#E8D3B8] dark:bg-[#FFF0DC]/15" />
        </div>
      );
    }

    const { msg, isSelf, isGrouped } = row;
    const sender = snapshot.directoryUsers.find((u) => u.id === msg.authorId);
    const replyTargetMsg = msg.replyToId ? messageById.get(msg.replyToId) : null;
    const inviteCode = extractInviteCode(msg.content);
    const attUrl = msg.attachment ? sanitizeSafeMediaUrl(msg.attachment.dataUrl) : '';
    const attType = String(msg.attachment?.type || '');
    const otherSeen =
      isSelf && Array.isArray(msg.seenBy) && msg.seenBy.some((uid) => uid !== currentUid);

    return (
      <div
        className={`group relative flex gap-2.5 px-4 md:px-6 ${
          isSelf ? 'justify-end' : 'justify-start'
        } ${isGrouped ? 'mt-1' : 'mt-3.5'}`}
      >
        {!isSelf && (
          <div className="w-8 shrink-0 pt-0.5">
            {!isGrouped && (
              <button
                type="button"
                onClick={() => bridge?.viewProfile(msg.authorId)}
                aria-label={`View profile of ${msg.senderName}`}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#790B13]"
              >
                <AvatarBadge
                  name={msg.senderName}
                  initials={msg.senderInitials}
                  avatar={sender?.avatar}
                  size={30}
                />
              </button>
            )}
          </div>
        )}

        <div className={`flex max-w-[78%] flex-col md:max-w-[66%] ${isSelf ? 'items-end' : 'items-start'}`}>
          {!isSelf && !isGrouped && (
            <div className="mb-1 flex items-center gap-2 px-1 text-[0.74rem]">
              <button
                type="button"
                onClick={() => bridge?.viewProfile(msg.authorId)}
                className="font-semibold text-[#2A0A0D] hover:underline dark:text-[#FFF0DC]"
              >
                {msg.senderName}
              </button>
              <span className="tabular-nums text-[#6B4A4D] dark:text-[#C89D8B]">{msg.time}</span>
              {msg.pinned && (
                <span className="inline-flex items-center gap-1 text-[#B45309] dark:text-[#FBBF24]">
                  <Pin size={11} />
                  <span>Pinned</span>
                </span>
              )}
            </div>
          )}

          <div className="relative flex items-end gap-2">
            {/* Hover actions (left of self bubbles) */}
            {isSelf && editingMsgId !== msg.id && (
              <div className="hidden items-center gap-0.5 rounded-lg border border-[#E8D3B8] bg-[#FFF8EE] p-0.5 shadow-sm group-hover:flex group-focus-within:flex dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12]">
                {QUICK_REACTIONS.slice(0, 3).map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => void bridge?.toggleReaction(activeThreadId, msg.id, em)}
                    className="h-6 w-6 rounded text-xs hover:bg-[#790B13]/10 dark:hover:bg-[#FFF0DC]/10"
                    title={`React ${em}`}
                  >
                    {em}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => bridge?.setReplyTo(msg.id)}
                  title="Reply"
                  aria-label="Reply"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10"
                >
                  <Reply size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingMsgId(msg.id);
                    setEditingText(msg.content);
                  }}
                  title="Edit"
                  aria-label="Edit message"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void bridge?.togglePinDmMessage(activeThreadId, msg.id)}
                  title={msg.pinned ? 'Unpin' : 'Pin'}
                  aria-label="Pin message"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10"
                >
                  <Pin size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void bridge?.deleteDmMessage(activeThreadId, msg.id)}
                  title="Delete"
                  aria-label="Delete message"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-red-600 hover:bg-red-500/12"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}

            <div
              className={`rounded-2xl px-3.5 py-2.5 text-[0.9rem] leading-relaxed ${
                isSelf
                  ? 'rounded-br-sm bg-[#790B13] text-[#FFF0DC]'
                  : 'rounded-bl-sm border border-[#E8D3B8] bg-[#FFF8EE] text-[#2A0A0D] dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12] dark:text-[#FFF0DC]'
              }`}
            >
              {replyTargetMsg && (
                <div
                  className={`mb-2 rounded-lg px-2.5 py-1.5 text-[0.76rem] ${
                    isSelf
                      ? 'bg-[#2A0A0D]/25 text-[#FFF0DC]/90'
                      : 'bg-[#F7E5CE] text-[#6B4A4D] dark:bg-[#260A0D] dark:text-[#E4C7B2]'
                  }`}
                >
                  <div className="font-semibold">{replyTargetMsg.senderName}</div>
                  <div className="truncate">{replyTargetMsg.content}</div>
                </div>
              )}

              {editingMsgId === msg.id ? (
                <div className="flex min-w-[220px] items-center gap-1.5">
                  <input
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void bridge?.editDmMessage(activeThreadId, msg.id, editingText);
                        setEditingMsgId(null);
                      } else if (e.key === 'Escape') {
                        setEditingMsgId(null);
                      }
                    }}
                    className="h-8 flex-1 rounded-lg bg-[#2A0A0D]/30 px-2.5 text-[0.86rem] text-[#FFF0DC] placeholder:text-[#FFF0DC]/60 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void bridge?.editDmMessage(activeThreadId, msg.id, editingText);
                      setEditingMsgId(null);
                    }}
                    className="rounded-lg bg-[#FFF0DC]/20 px-2.5 py-1 text-[0.76rem] font-medium text-[#FFF0DC] hover:bg-[#FFF0DC]/30"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingMsgId(null)}
                    className="rounded-lg px-2 py-1 text-[0.76rem] text-[#FFF0DC]/80 hover:bg-[#FFF0DC]/10"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words">
                  {msg.content}
                  {msg.edited && (
                    <span
                      className={`ml-1.5 text-[0.72rem] ${
                        isSelf ? 'text-[#FFF0DC]/75' : 'text-[#6B4A4D] dark:text-[#C89D8B]'
                      }`}
                    >
                      (edited)
                    </span>
                  )}
                </div>
              )}

              {inviteCode && (
                <div
                  className={`mt-2.5 flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${
                    isSelf
                      ? 'bg-[#2A0A0D]/25 text-[#FFF0DC]'
                      : 'border border-[#E8D3B8] bg-[#FFF0DC] dark:border-[#FFF0DC]/15 dark:bg-[#260A0D]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[0.78rem] font-semibold">Community Invite</div>
                    <div className="truncate font-mono text-[0.72rem] opacity-80">
                      Code: {inviteCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void bridge?.joinCommunityInvite(inviteCode)}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[0.76rem] font-medium ${
                      isSelf
                        ? 'bg-[#FFF0DC] text-[#790B13] hover:bg-[#F7E5CE]'
                        : 'bg-[#790B13] text-[#FFF0DC] hover:bg-[#5C0810]'
                    }`}
                  >
                    Join
                  </button>
                </div>
              )}

              {msg.attachment && attUrl && (
                <div className="mt-2">
                  {attType.startsWith('image/') && !brokenMediaIds[msg.id] ? (
                    <img
                      src={attUrl}
                      alt={msg.attachment.name || 'Attachment'}
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setBrokenMediaIds((prev) => ({ ...prev, [msg.id]: true }))
                      }
                      className="max-h-64 max-w-full rounded-xl object-cover"
                    />
                  ) : attType.startsWith('video/') ? (
                    <video
                      src={attUrl}
                      controls
                      className="max-h-64 max-w-full rounded-xl bg-[#2A0A0D]"
                    />
                  ) : attType.startsWith('audio/') ? (
                    <audio src={attUrl} controls className="max-w-full" />
                  ) : (
                    <a
                      href={attUrl}
                      download={msg.attachment.name || 'attachment'}
                      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[0.8rem] underline ${
                        isSelf
                          ? 'bg-[#2A0A0D]/25 text-[#FFF0DC]'
                          : 'bg-[#F7E5CE] text-[#2A0A0D] dark:bg-[#260A0D] dark:text-[#FFF0DC]'
                      }`}
                    >
                      <Paperclip size={13} />
                      <span>
                        {msg.attachment.name || 'Attachment'} (
                        {formatFileSize(msg.attachment.size || 0)})
                      </span>
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Hover actions (right of peer bubbles) */}
            {!isSelf && (
              <div className="hidden items-center gap-0.5 rounded-lg border border-[#E8D3B8] bg-[#FFF8EE] p-0.5 shadow-sm group-hover:flex group-focus-within:flex dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12]">
                {QUICK_REACTIONS.slice(0, 3).map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => void bridge?.toggleReaction(activeThreadId, msg.id, em)}
                    className="h-6 w-6 rounded text-xs hover:bg-[#790B13]/10 dark:hover:bg-[#FFF0DC]/10"
                    title={`React ${em}`}
                  >
                    {em}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => bridge?.setReplyTo(msg.id)}
                  title="Reply"
                  aria-label="Reply"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10"
                >
                  <Reply size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void bridge?.togglePinDmMessage(activeThreadId, msg.id)}
                  title={msg.pinned ? 'Unpin' : 'Pin'}
                  aria-label="Pin message"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10"
                >
                  <Pin size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => bridge?.openReportModal('message', msg.id)}
                  title="Report message"
                  aria-label="Report message"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#6B4A4D] hover:bg-red-500/12 hover:text-red-600 dark:text-[#C89D8B]"
                >
                  <Flag size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Reaction Chips */}
          {Array.isArray(msg.reactions) && msg.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 px-1">
              {msg.reactions.map((r) => {
                const reacted = (r.userIds || []).includes(currentUid);
                return (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => void bridge?.toggleReaction(activeThreadId, msg.id, r.emoji)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[0.74rem] tabular-nums transition-colors ${
                      reacted
                        ? 'border-[#790B13]/40 bg-[#790B13]/12 text-[#790B13] dark:border-[#F7E1D3]/40 dark:bg-[#790B13]/35 dark:text-[#FFF0DC]'
                        : 'border-[#E8D3B8] bg-[#FFF8EE] text-[#6B4A4D] dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12] dark:text-[#C89D8B]'
                    }`}
                  >
                    <span>{r.emoji}</span>
                    <span>{r.userIds.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Read Receipt / Timestamp */}
          {isSelf && (
            <div className="mt-1 flex items-center gap-1.5 px-1 text-[0.71rem] tabular-nums text-[#6B4A4D] dark:text-[#C89D8B]">
              {otherSeen ? (
                <>
                  <CheckCheck size={12} className="text-[#790B13] dark:text-[#F7E1D3]" />
                  <span>Read</span>
                </>
              ) : (
                <>
                  <Check size={12} />
                  <span>Sent</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{msg.time}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section
      aria-label={`Conversation with ${activeDm.name}`}
      className={`${
        snapshot.dmThreadActiveMobile ? 'flex' : 'hidden md:flex'
      } h-full min-w-0 flex-1 flex-col bg-[#FFF0DC] dark:bg-[#1B0709]`}
    >
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#E8D3B8] bg-[#FFF8EE] px-4 md:px-6 dark:border-[#FFF0DC]/15 dark:bg-[#260A0D]">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => bridge?.setMobileThreadOpen(false)}
            aria-label="Back to conversation list"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 md:hidden"
          >
            <ArrowLeft size={18} />
          </button>

          <button
            type="button"
            disabled={activeDm.type === 'group' || !activeDm.userId}
            onClick={() => {
              if (activeDm.userId) bridge?.viewProfile(activeDm.userId);
            }}
            className="flex min-w-0 items-center gap-3 text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#790B13] rounded-xl"
          >
            <AvatarBadge
              name={activeDm.name}
              initials={activeDm.initials}
              avatar={activeDm.peer?.avatar}
              size={38}
              isGroup={activeDm.type === 'group'}
              isOnline={activeDm.isOnline}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="truncate text-[0.96rem] font-semibold text-[#2A0A0D] dark:text-[#FFF0DC]">
                  {activeDm.name}
                </h2>
                {activeDm.type === 'dm' && activeDm.userId && (
                  <ChevronRight size={14} className="shrink-0 text-[#6B4A4D] dark:text-[#C89D8B]" />
                )}
              </div>
              <p
                className={`truncate text-[0.76rem] ${
                  isTyping
                    ? 'font-medium text-[#790B13] dark:text-[#F7E1D3]'
                    : 'text-[#6B4A4D] dark:text-[#C89D8B]'
                }`}
              >
                {statusLine}
              </p>
            </div>
          </button>
        </div>

        <div className="relative flex shrink-0 items-center gap-1" ref={moreRef}>
          <button
            type="button"
            onClick={() => setThreadSearchOpen((prev) => !prev)}
            title="Search in conversation"
            aria-label="Search in conversation"
            aria-expanded={threadSearchOpen}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
              threadSearchOpen
                ? 'bg-[#790B13]/15 text-[#790B13] dark:bg-[#790B13]/35 dark:text-[#FFF0DC]'
                : 'text-[#6B4A4D] hover:bg-[#790B13]/10 hover:text-[#790B13] dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 dark:hover:text-[#FFF0DC]'
            }`}
          >
            <Search size={17} />
          </button>

          {activeDm.type === 'dm' && activeDm.userId && (
            <>
              <button
                type="button"
                onClick={() => void bridge?.startCall(activeDm.userId!, 'audio')}
                title="Voice call"
                aria-label="Start voice call"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#6B4A4D] transition-colors hover:bg-[#790B13]/10 hover:text-[#790B13] dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 dark:hover:text-[#FFF0DC]"
              >
                <Phone size={17} />
              </button>
              <button
                type="button"
                onClick={() => void bridge?.startCall(activeDm.userId!, 'video')}
                title="Video call"
                aria-label="Start video call"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#6B4A4D] transition-colors hover:bg-[#790B13]/10 hover:text-[#790B13] dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 dark:hover:text-[#FFF0DC]"
              >
                <Video size={18} />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setMoreOpen((prev) => !prev)}
            title="More options"
            aria-label="Conversation options"
            aria-expanded={moreOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#6B4A4D] transition-colors hover:bg-[#790B13]/10 hover:text-[#790B13] dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 dark:hover:text-[#FFF0DC]"
          >
            <MoreVertical size={17} />
          </button>

          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 top-11 z-40 w-52 rounded-xl border border-[#E8D3B8] bg-[#FFF8EE] p-1.5 shadow-xl dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12]"
            >
              {activeDm.type === 'dm' && activeDm.userId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    bridge?.viewProfile(activeDm.userId!);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#2A0A0D] hover:bg-[#790B13]/10 dark:text-[#FFF0DC] dark:hover:bg-[#FFF0DC]/10"
                >
                  <span>View Profile</span>
                  <User size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  void bridge?.toggleArchiveDm(activeThreadId);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#2A0A0D] hover:bg-[#790B13]/10 dark:text-[#FFF0DC] dark:hover:bg-[#FFF0DC]/10"
              >
                <span>{isArchived ? 'Restore Chat' : 'Archive Chat'}</span>
                <Archive size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  void bridge?.toggleMuteDm(activeThreadId);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#2A0A0D] hover:bg-[#790B13]/10 dark:text-[#FFF0DC] dark:hover:bg-[#FFF0DC]/10"
              >
                <span>{isMuted ? 'Unmute Alerts' : 'Mute Alerts'}</span>
                {isMuted ? <Bell size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" /> : <BellOff size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />}
              </button>
              {activeDm.type === 'group' && isGroupAdmin && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    setGroupTitleDraft(activeDm.groupName || activeDm.name || '');
                    setRenamingGroup(true);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#2A0A0D] hover:bg-[#790B13]/10 dark:text-[#FFF0DC] dark:hover:bg-[#FFF0DC]/10"
                >
                  <span>Rename Group</span>
                  <Pencil size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />
                </button>
              )}
              {activeDm.type === 'group' && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    void bridge?.manageGroupMembers(activeThreadId, { action: 'leave' });
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#2A0A0D] hover:bg-[#790B13]/10 dark:text-[#FFF0DC] dark:hover:bg-[#FFF0DC]/10"
                >
                  <span>Leave Group</span>
                  <LogOut size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  void bridge?.deleteThreadForMe(activeThreadId);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#6B4A4D] hover:bg-[#790B13]/10 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10"
              >
                <span>Remove Chat (Me)</span>
                <Trash2 size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />
              </button>
              {activeDm.type === 'dm' && activeDm.userId && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      bridge?.openReportModal('user', activeDm.userId!);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#2A0A0D] hover:bg-[#790B13]/10 dark:text-[#FFF0DC] dark:hover:bg-[#FFF0DC]/10"
                  >
                    <span>Report User</span>
                    <Flag size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      void bridge?.blockUser(activeDm.userId!);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-red-700 hover:bg-red-500/10 dark:text-red-300"
                  >
                    <span>Block User</span>
                    <Ban size={14} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {renamingGroup && activeDm.type === 'group' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const trimmed = groupTitleDraft.trim();
            if (!trimmed) return;
            const ok = await bridge?.manageGroupMembers(activeThreadId, { action: 'rename', groupName: trimmed });
            if (ok) setRenamingGroup(false);
          }}
          className="flex shrink-0 items-center gap-2 border-b border-[#E8D3B8] bg-[#FFF8EE] px-4 py-2 dark:border-[#FFF0DC]/15 dark:bg-[#260A0D]"
        >
          <input
            type="text"
            value={groupTitleDraft}
            onChange={(e) => setGroupTitleDraft(e.target.value)}
            maxLength={60}
            placeholder="Group name..."
            className="h-8 flex-1 rounded-lg border border-[#E8D3B8] bg-[#F7E5CE] px-3 text-[0.84rem] text-[#2A0A0D] focus:border-[#790B13] focus:outline-none dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12] dark:text-[#FFF0DC]"
          />
          <button type="submit" className="h-8 rounded-lg bg-[#790B13] px-3 text-[0.78rem] font-medium text-[#FFF0DC] hover:bg-[#5C0810]">Save</button>
          <button type="button" onClick={() => setRenamingGroup(false)} className="h-8 rounded-lg border border-[#E8D3B8] px-3 text-[0.78rem] text-[#2A0A0D] dark:border-[#FFF0DC]/15 dark:text-[#FFF0DC]">Cancel</button>
        </form>
      )}

      {/* Collapsible In-Thread Search */}
      {threadSearchOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#E8D3B8] bg-[#FFF8EE] px-4 py-2 dark:border-[#FFF0DC]/15 dark:bg-[#260A0D]">
          <Search size={14} className="text-[#6B4A4D] dark:text-[#C89D8B]" />
          <input
            type="search"
            value={threadQuery}
            onChange={(e) => setThreadQuery(e.target.value)}
            placeholder="Search messages in this conversation..."
            autoFocus
            className="h-8 flex-1 bg-transparent text-[0.85rem] text-[#2A0A0D] placeholder:text-[#6B4A4D] focus:outline-none dark:text-[#FFF0DC] dark:placeholder:text-[#C89D8B]"
          />
          {threadQuery && (
            <button
              type="button"
              onClick={() => setThreadQuery('')}
              className="text-[0.76rem] font-semibold text-[#790B13] hover:underline dark:text-[#F7E1D3]"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Message History */}
      <div className="relative min-h-0 flex-1">
        {snapshot.dmMessagesLoadingThreadId === activeThreadId && rawMessages.length === 0 ? (
          <div className="space-y-4 p-6" aria-label="Loading messages">
            <div className="h-10 w-56 rounded-2xl bg-[#790B13]/10 dark:bg-[#FFF0DC]/10" />
            <div className="ml-auto h-10 w-44 rounded-2xl bg-[#790B13]/20 dark:bg-[#790B13]/40" />
            <div className="h-12 w-64 rounded-2xl bg-[#790B13]/10 dark:bg-[#FFF0DC]/10" />
          </div>
        ) : timelineRows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <AvatarBadge
              name={activeDm.name}
              initials={activeDm.initials}
              avatar={activeDm.peer?.avatar}
              size={56}
              isGroup={activeDm.type === 'group'}
              isOnline={activeDm.isOnline}
            />
            <h3 className="mt-3 font-['Playfair_Display',serif] text-lg font-bold text-[#2A0A0D] dark:text-[#FFF0DC]">
              {activeDm.name}
            </h3>
            <p className="mt-1 max-w-xs text-[0.84rem] text-[#6B4A4D] dark:text-[#E4C7B2]">
              {threadQuery.trim()
                ? 'No messages match your search query.'
                : `Beginning of your conversation with ${activeDm.name}. Say hello below.`}
            </p>
            {threadQuery.trim() && (
              <button
                type="button"
                onClick={() => setThreadQuery('')}
                className="mt-3 rounded-lg border border-[#E8D3B8] px-3 py-1.5 text-[0.78rem] font-medium text-[#2A0A0D] dark:border-[#FFF0DC]/15 dark:text-[#FFF0DC]"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <Virtuoso
            key={activeThreadId}
            style={{ height: '100%', width: '100%' }}
            data={timelineRows}
            initialTopMostItemIndex={Math.max(0, timelineRows.length - 1)}
            followOutput="smooth"
            computeItemKey={(_i, item) => item.id}
            itemContent={renderTimelineItem}
            components={{
              Footer: () => <div className="h-4" />,
            }}
          />
        )}
      </div>

      {/* Typing Indicator Strip */}
      {isTyping && (
        <div className="shrink-0 px-6 py-1.5 text-[0.78rem] font-medium text-[#790B13] dark:text-[#F7E1D3]">
          {activeDm.typingNames.length === 1
            ? `${activeDm.typingNames[0]} is typing...`
            : `${activeDm.typingNames.slice(0, 2).join(', ')} are typing...`}
        </div>
      )}

      {/* Pinned Bottom Composer */}
      <div className="shrink-0 border-t border-[#E8D3B8] bg-[#FFF8EE] px-4 py-3 md:px-6 dark:border-[#FFF0DC]/15 dark:bg-[#260A0D]">
        {replyTarget && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-[#E8D3B8] bg-[#F7E5CE] px-3 py-2 text-[0.8rem] dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12]">
            <div className="min-w-0">
              <span className="font-semibold text-[#790B13] dark:text-[#F7E1D3]">
                Replying to {replyTarget.senderName}
              </span>
              <div className="truncate text-[#6B4A4D] dark:text-[#E4C7B2]">
                {replyTarget.content}
              </div>
            </div>
            <button
              type="button"
              onClick={() => bridge?.setReplyTo(null)}
              aria-label="Cancel reply"
              className="rounded-lg p-1 text-[#6B4A4D] hover:text-[#2A0A0D] dark:text-[#C89D8B] dark:hover:text-[#FFF0DC]"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {pendingAttachment && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-[#790B13]/30 bg-[#790B13]/10 px-3 py-2 text-[0.8rem] dark:border-[#FFF0DC]/20 dark:bg-[#790B13]/30">
            <div className="flex min-w-0 items-center gap-2 text-[#2A0A0D] dark:text-[#FFF0DC]">
              <Paperclip size={14} className="shrink-0 text-[#790B13] dark:text-[#F7E1D3]" />
              <span className="truncate font-medium">{pendingAttachment.name}</span>
              <span className="shrink-0 tabular-nums text-[#6B4A4D] dark:text-[#E4C7B2]">
                {formatFileSize(pendingAttachment.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              aria-label="Remove attachment"
              className="rounded-lg p-1 text-[#6B4A4D] hover:text-[#2A0A0D] dark:text-[#E4C7B2] dark:hover:text-[#FFF0DC]"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="relative flex items-end gap-2 rounded-2xl border border-[#E8D3B8] bg-[#F7E5CE] p-2 focus-within:border-[#790B13] dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12]">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,.pdf,.txt,.zip"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            disabled={isUploading || snapshot.isSendingMessage}
            onClick={() => fileInputRef.current?.click()}
            title="Attach image, video, audio, or file"
            aria-label="Attach file"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#6B4A4D] hover:bg-[#790B13]/10 hover:text-[#790B13] disabled:opacity-45 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 dark:hover:text-[#FFF0DC]"
          >
            <Paperclip size={17} />
          </button>

          <div className="relative" ref={emojiRef}>
            <button
              type="button"
              disabled={snapshot.isSendingMessage}
              onClick={() => setEmojiOpen((prev) => !prev)}
              title="Insert emoji"
              aria-label="Insert emoji"
              aria-expanded={emojiOpen}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#6B4A4D] hover:bg-[#790B13]/10 hover:text-[#790B13] disabled:opacity-45 dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 dark:hover:text-[#FFF0DC]"
            >
              <Smile size={17} />
            </button>

            {emojiOpen && (
              <div className="absolute bottom-12 left-0 z-40 grid w-56 grid-cols-6 gap-1 rounded-xl border border-[#E8D3B8] bg-[#FFF8EE] p-2 shadow-xl dark:border-[#FFF0DC]/15 dark:bg-[#2D0E12]">
                {COMPOSER_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      setComposerText((prev) => `${prev}${em}`);
                      setEmojiOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-base hover:bg-[#790B13]/10 dark:hover:bg-[#FFF0DC]/10"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>

          <textarea
            ref={textareaRef}
            rows={1}
            value={composerText}
            disabled={snapshot.isSendingMessage}
            onChange={(e) => {
              setComposerText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 136)}px`;
              if (activeThreadId) {
                bridge?.sendTypingSignal(activeThreadId, e.target.value.trim().length > 0);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              isUploading
                ? 'Uploading attachment...'
                : `Message ${activeDm.name}...`
            }
            aria-label={`Message ${activeDm.name}`}
            className="max-h-36 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[0.9rem] text-[#2A0A0D] placeholder:text-[#6B4A4D] focus:outline-none disabled:opacity-50 dark:text-[#FFF0DC] dark:placeholder:text-[#C89D8B]"
          />

          <button
            type="button"
            onClick={() => void handleToggleVoiceRecord()}
            title={isRecording ? 'Stop recording voice note' : 'Record voice note'}
            aria-label={isRecording ? 'Stop recording voice note' : 'Record voice note'}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
              isRecording
                ? 'bg-[#790B13] text-[#FFF0DC]'
                : 'text-[#6B4A4D] hover:bg-[#790B13]/10 hover:text-[#790B13] dark:text-[#C89D8B] dark:hover:bg-[#FFF0DC]/10 dark:hover:text-[#FFF0DC]'
            }`}
          >
            {isRecording ? <Square size={15} /> : <Mic size={17} />}
          </button>

          <button
            type="button"
            disabled={
              snapshot.isSendingMessage ||
              isUploading ||
              (!composerText.trim() && !pendingAttachment)
            }
            onClick={() => void handleSend()}
            aria-label="Send message"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#790B13] px-3.5 text-[0.84rem] font-medium text-[#FFF0DC] transition-colors hover:bg-[#5C0810] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Send size={15} />
            <span className="hidden sm:inline">
              {snapshot.isSendingMessage ? 'Sending...' : 'Send'}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
};
