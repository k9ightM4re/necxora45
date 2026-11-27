import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Link2,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Users,
  X,
} from 'lucide-react';
import { AvatarBadge } from './AvatarBadge';
import {
  formatRelativeTimeShort,
  type DmInboxTab,
  type DmThreadItem,
  type InboxSnapshot,
  type NexoraAppBridge,
} from './types';

interface ConversationPanelProps {
  snapshot: InboxSnapshot;
  bridge: NexoraAppBridge | undefined;
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({ snapshot, bridge }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [menuOpen]);

  const blockedSet = new Set(snapshot.blockedIds);
  const currentUid = snapshot.currentUser.id;
  const q = snapshot.dmSearchQuery.trim().toLowerCase();

  const isArchived = (dm: DmThreadItem) =>
    Array.isArray(dm.archivedBy) && dm.archivedBy.includes(currentUid);

  const archivedCount = snapshot.dms.filter((dm) => {
    if (dm.userId && blockedSet.has(dm.userId)) return false;
    return isArchived(dm);
  }).length;

  const unarchivedDms = snapshot.dms.filter((dm) => {
    if (dm.userId && blockedSet.has(dm.userId)) return false;
    return snapshot.showArchivedDms || !isArchived(dm);
  });

  const totalUnreadThreads = unarchivedDms.reduce(
    (acc, dm) => acc + (dm.unreadCount > 0 ? 1 : 0),
    0
  );

  const incomingPending = snapshot.connectionRequests.filter(
    (r) => r.status === 'pending' && r.toUid === currentUid && !blockedSet.has(r.fromUid)
  );
  const outgoingPending = snapshot.connectionRequests.filter(
    (r) => r.status === 'pending' && r.fromUid === currentUid && !blockedSet.has(r.toUid)
  );
  const reqCount = incomingPending.length + outgoingPending.length;

  const visibleDms = unarchivedDms.filter((dm) => {
    if (!q) return true;
    const peerUsername = dm.peer?.username || dm.username || '';
    return (
      String(dm.name || '').toLowerCase().includes(q) ||
      String(dm.topic || '').toLowerCase().includes(q) ||
      String(dm.lastMessage || '').toLowerCase().includes(q) ||
      peerUsername.toLowerCase().includes(q)
    );
  });

  const unreadDms = visibleDms.filter((dm) => dm.unreadCount > 0);
  const groupDms = visibleDms.filter((dm) => dm.type === 'group');

  const existingPeerIds = new Set(snapshot.dms.filter((d) => d.userId).map((d) => d.userId!));
  const matchedPeople = snapshot.directoryUsers.filter((u) => {
    if (!u.id || u.id === currentUid || blockedSet.has(u.id)) return false;
    if (u.accountPrivacy === 'private') return false;
    if (existingPeerIds.has(u.id)) return false;
    if (!q) return true;
    return (
      String(u.displayName || '').toLowerCase().includes(q) ||
      String(u.username || '').toLowerCase().includes(q)
    );
  });

  const userLookup = new Map(snapshot.directoryUsers.map((u) => [u.id, u]));

  const tabs: { id: DmInboxTab; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread', count: totalUnreadThreads },
    { id: 'requests', label: 'Requests', count: reqCount },
    { id: 'groups', label: 'Groups' },
  ];

  const renderDmRow = (dm: DmThreadItem) => {
    const active = snapshot.activeDmId === dm.id && !snapshot.pendingPeerId;
    const archived = isArchived(dm);
    const msgs = snapshot.dmMessages[dm.id] || [];
    const latestMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const isTyping = Array.isArray(dm.typingNames) && dm.typingNames.length > 0;

    let previewText = '';
    if (isTyping) {
      previewText = dm.type === 'group' ? `${dm.typingNames[0]} is typing...` : 'Typing...';
    } else if (latestMsg) {
      const prefix = latestMsg.authorId === currentUid ? 'You: ' : '';
      previewText = `${prefix}${
        latestMsg.content ||
        (latestMsg.attachment ? `Sent ${latestMsg.attachment.name || 'an attachment'}` : 'Message')
      }`;
    } else if (dm.lastMessage) {
      const prefix = dm.lastSenderId === currentUid ? 'You: ' : '';
      previewText = `${prefix}${dm.lastMessage}`;
    } else if (dm.type === 'group') {
      previewText = `${dm.participants.length} members`;
    } else {
      previewText = dm.peer?.username ? `@${dm.peer.username}` : 'Tap to message';
    }

    const timeLabel = formatRelativeTimeShort(latestMsg?.timestamp || dm.updatedAtMs);
    const handleText =
      dm.type === 'group'
        ? `${dm.participants.length}`
        : dm.peer?.username
          ? `@${dm.peer.username}`
          : '';

    return (
      <div
        key={dm.id}
        className={`group relative flex items-center gap-1 rounded-xl transition-colors ${
          active
            ? 'bg-[#4777DF]/[0.13] dark:bg-[#4777DF]/[0.16]'
            : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
        }`}
      >
        <button
          type="button"
          onClick={() => bridge?.selectDm(dm.id)}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4777DF] rounded-xl"
        >
          <AvatarBadge
            name={dm.name}
            initials={dm.initials}
            avatar={dm.peer?.avatar}
            size={42}
            isGroup={dm.type === 'group'}
            isOnline={dm.isOnline}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span
                  className={`truncate text-[0.9rem] ${
                    active || dm.unreadCount > 0
                      ? 'font-semibold text-[#202630] dark:text-[#F2F4F7]'
                      : 'font-medium text-[#202630] dark:text-[#F2F4F7]'
                  }`}
                >
                  {dm.name}
                </span>
                {handleText && dm.type === 'dm' && (
                  <span className="truncate text-[0.74rem] text-[#677280] dark:text-[#77818F]">
                    {handleText}
                  </span>
                )}
              </span>
              {timeLabel && (
                <span className="shrink-0 text-[0.72rem] tabular-nums text-[#677280] dark:text-[#77818F]">
                  {timeLabel}
                </span>
              )}
            </span>

            <span className="mt-0.5 flex items-center justify-between gap-2">
              <span
                className={`truncate text-[0.8rem] ${
                  isTyping
                    ? 'font-medium text-[#4777DF]'
                    : dm.unreadCount > 0
                      ? 'font-medium text-[#202630] dark:text-[#D5DCE6]'
                      : 'text-[#596473] dark:text-[#A8B0BB]'
                }`}
              >
                {previewText}
              </span>
              {dm.unreadCount > 0 && (
                <span
                  aria-label={`${dm.unreadCount} unread`}
                  className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#4777DF] px-1.5 text-[0.7rem] font-semibold tabular-nums text-white"
                >
                  {dm.unreadCount > 99 ? '99+' : dm.unreadCount}
                </span>
              )}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => void bridge?.toggleArchiveDm(dm.id)}
          title={archived ? 'Unarchive conversation' : 'Archive conversation'}
          aria-label={archived ? 'Unarchive conversation' : 'Archive conversation'}
          className="mr-2 hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#77818F] hover:bg-black/[0.06] hover:text-[#202630] dark:hover:bg-white/[0.08] dark:hover:text-[#F2F4F7] group-hover:inline-flex focus-visible:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4777DF]"
        >
          <Archive size={14} />
        </button>
      </div>
    );
  };

  const renderRequestsBlock = () => {
    if (incomingPending.length === 0 && outgoingPending.length === 0) return null;
    return (
      <div className="space-y-3">
        {incomingPending.length > 0 && (
          <div className="space-y-1.5">
            <div className="px-2 text-[0.72rem] font-semibold text-[#677280] dark:text-[#77818F]">
              Incoming Requests · {incomingPending.length}
            </div>
            <div className="space-y-1.5">
              {incomingPending.map((req) => {
                const sender = userLookup.get(req.fromUid);
                return (
                  <div
                    key={req.id}
                    className="flex items-center gap-2.5 rounded-xl border border-black/[0.08] bg-[#F5F6F8] px-3 py-2.5 dark:border-white/[0.08] dark:bg-[#1D232C]"
                  >
                    <AvatarBadge
                      name={sender?.displayName || req.fromName || 'Member'}
                      initials={sender?.initials || req.fromInitials}
                      avatar={sender?.avatar}
                      size={36}
                      isOnline={Boolean(sender?.isOnline)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[0.86rem] font-semibold text-[#202630] dark:text-[#F2F4F7]">
                        {sender?.displayName || req.fromName || 'Member'}
                      </div>
                      <div className="truncate text-[0.75rem] text-[#596473] dark:text-[#A8B0BB]">
                        Wants to message &amp; call
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void bridge?.acceptRequest(req.id, req.fromUid)}
                        title="Accept request"
                        aria-label="Accept request"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#3868CE] text-white hover:bg-[#2D58B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4777DF]"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void bridge?.declineRequest(req.id)}
                        title="Decline request"
                        aria-label="Decline request"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/[0.06] text-[#596473] hover:bg-red-500/15 hover:text-red-500 dark:bg-white/[0.07] dark:text-[#A8B0BB] dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4777DF]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {outgoingPending.length > 0 && (
          <div className="space-y-1.5">
            <div className="px-2 text-[0.72rem] font-semibold text-[#677280] dark:text-[#77818F]">
              Pending Sent · {outgoingPending.length}
            </div>
            <div className="space-y-1">
              {outgoingPending.map((req) => {
                const target = userLookup.get(req.toUid);
                return (
                  <button
                    key={req.id}
                    type="button"
                    onClick={() => void bridge?.openPendingPeer(req.toUid)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  >
                    <AvatarBadge
                      name={target?.displayName || req.toName || 'Member'}
                      initials={target?.initials || req.toInitials}
                      avatar={target?.avatar}
                      size={36}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[0.86rem] font-medium text-[#202630] dark:text-[#F2F4F7]">
                          {target?.displayName || req.toName || 'Member'}
                        </span>
                        <span className="shrink-0 text-[0.72rem] text-[#C49A52]">Pending</span>
                      </span>
                      <span className="block truncate text-[0.76rem] text-[#677280] dark:text-[#77818F]">
                        Awaiting approval
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPeopleDiscovery = (maxUsers = 10) => {
    if (matchedPeople.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <div className="px-2 text-[0.72rem] font-semibold text-[#677280] dark:text-[#77818F]">
          People on NEXORA · {matchedPeople.length}
        </div>
        <div className="space-y-1">
          {matchedPeople.slice(0, maxUsers).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => void bridge?.openPendingPeer(u.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4777DF]"
            >
              <AvatarBadge
                name={u.displayName}
                initials={u.initials}
                avatar={u.avatar}
                size={36}
                isOnline={Boolean(u.isOnline)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[0.86rem] font-medium text-[#202630] dark:text-[#F2F4F7]">
                    {u.displayName}
                  </span>
                  <span className="shrink-0 text-[0.74rem] font-medium text-[#4777DF]">
                    Connect
                  </span>
                </span>
                <span className="block truncate text-[0.76rem] text-[#677280] dark:text-[#77818F]">
                  @{u.username}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Conversations list"
      className={`${
        snapshot.dmThreadActiveMobile ? 'hidden md:flex' : 'flex'
      } h-full w-full shrink-0 flex-col border-r border-black/[0.09] bg-white dark:border-white/[0.09] dark:bg-[#171C23] md:w-[328px] xl:w-[356px]`}
    >
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-black/[0.09] px-4 dark:border-white/[0.09]">
        <div className="min-w-0">
          <h2 className="truncate text-[1.125rem] font-semibold tracking-tight text-[#202630] dark:text-[#F2F4F7]">
            Messages
          </h2>
        </div>

        <div className="relative flex shrink-0 items-center gap-1" ref={menuRef}>
          <button
            type="button"
            onClick={() => bridge?.openNewGroupModal()}
            title="New group chat"
            aria-label="New group chat"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#596473] transition-colors hover:bg-black/[0.05] hover:text-[#202630] dark:text-[#A8B0BB] dark:hover:bg-white/[0.06] dark:hover:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4777DF]"
          >
            <Plus size={18} />
          </button>

          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            title="Messages options"
            aria-label="Messages options"
            aria-expanded={menuOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#596473] transition-colors hover:bg-black/[0.05] hover:text-[#202630] dark:text-[#A8B0BB] dark:hover:bg-white/[0.06] dark:hover:text-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4777DF]"
          >
            <MoreHorizontal size={18} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-11 z-40 w-60 rounded-xl border border-black/[0.1] bg-white p-1.5 shadow-xl dark:border-white/[0.1] dark:bg-[#1D232C]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  bridge?.openNewGroupModal();
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#202630] hover:bg-black/[0.05] dark:text-[#F2F4F7] dark:hover:bg-white/[0.06]"
              >
                <span>New Group Chat</span>
                <Users size={14} className="text-[#77818F]" />
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  bridge?.openShareCommunityModal();
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#202630] hover:bg-black/[0.05] dark:text-[#F2F4F7] dark:hover:bg-white/[0.06]"
              >
                <span>Share Community Invite Link</span>
                <Share2 size={14} className="text-[#77818F]" />
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  bridge?.openJoinCommunityModal();
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#202630] hover:bg-black/[0.05] dark:text-[#F2F4F7] dark:hover:bg-white/[0.06]"
              >
                <span>Join Community via Link</span>
                <Link2 size={14} className="text-[#77818F]" />
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  bridge?.toggleShowArchivedDms();
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.84rem] text-[#202630] hover:bg-black/[0.05] dark:text-[#F2F4F7] dark:hover:bg-white/[0.06]"
              >
                <span>
                  {snapshot.showArchivedDms ? 'Hide Archived Chats' : 'Show Archived Chats'}
                </span>
                <Archive size={14} className="text-[#77818F]" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search + Segmented Filter */}
      <div className="shrink-0 space-y-3 border-b border-black/[0.06] px-3.5 py-3 dark:border-white/[0.06]">
        <div className="relative flex items-center">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 text-[#677280] dark:text-[#77818F]"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={snapshot.dmSearchQuery}
            onChange={(e) => bridge?.setDmSearchQuery(e.target.value)}
            placeholder="Search chats, names, or @handles..."
            aria-label="Search conversations and people"
            className="h-9 w-full rounded-xl border border-black/[0.09] bg-[#F5F6F8] pl-9 pr-8 text-[0.85rem] text-[#202630] placeholder:text-[#677280] focus:border-[#4777DF] focus:outline-none dark:border-white/[0.09] dark:bg-[#1D232C] dark:text-[#F2F4F7] dark:placeholder:text-[#77818F]"
          />
          {snapshot.dmSearchQuery.trim() && (
            <button
              type="button"
              onClick={() => {
                bridge?.setDmSearchQuery('');
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-[#677280] hover:text-[#202630] dark:text-[#77818F] dark:hover:text-[#F2F4F7]"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Conversation filters"
          className="grid grid-cols-4 gap-1 rounded-xl bg-[#EBEEF2] p-1 dark:bg-[#1D232C]"
        >
          {tabs.map((tab) => {
            const selected = snapshot.dmInboxTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => bridge?.setDmInboxTab(tab.id)}
                className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[0.76rem] font-medium whitespace-nowrap transition-colors ${
                  selected
                    ? 'bg-white text-[#202630] shadow-xs dark:bg-[#242B35] dark:text-[#F2F4F7]'
                    : 'text-[#596473] hover:text-[#202630] dark:text-[#A8B0BB] dark:hover:text-[#F2F4F7]'
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && tab.count > 0 && (
                  <span
                    className={`text-[0.68rem] tabular-nums ${
                      selected ? 'text-[#4777DF]' : 'text-[#677280] dark:text-[#77818F]'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Conversation List */}
      <div className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3">
        {snapshot.dmError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-600 dark:text-red-300"
          >
            <span>{snapshot.dmError}</span>
            <button
              type="button"
              onClick={() => bridge?.retryDmSync()}
              className="shrink-0 rounded-lg border border-red-500/30 px-2.5 py-1 text-[0.74rem] font-medium hover:bg-red-500/15"
            >
              Retry
            </button>
          </div>
        )}

        {q ? (
          <>
            {visibleDms.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[0.72rem] font-semibold text-[#677280] dark:text-[#77818F]">
                  Conversations · {visibleDms.length}
                </div>
                {visibleDms.map(renderDmRow)}
              </div>
            )}
            {renderRequestsBlock()}
            {renderPeopleDiscovery(14)}
            {visibleDms.length === 0 && matchedPeople.length === 0 && reqCount === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-[0.84rem] text-[#596473] dark:text-[#A8B0BB]">
                  No matching conversations or people found for "{snapshot.dmSearchQuery.trim()}".
                </p>
                <button
                  type="button"
                  onClick={() => bridge?.setDmSearchQuery('')}
                  className="mt-3 rounded-lg border border-black/[0.1] px-3 py-1.5 text-[0.78rem] font-medium text-[#202630] hover:bg-black/[0.04] dark:border-white/[0.1] dark:text-[#F2F4F7] dark:hover:bg-white/[0.05]"
                >
                  Clear Search
                </button>
              </div>
            )}
          </>
        ) : snapshot.dmInboxTab === 'unread' ? (
          <div className="space-y-1">
            <div className="px-2 text-[0.72rem] font-semibold text-[#677280] dark:text-[#77818F]">
              Unread · {unreadDms.length}
            </div>
            {unreadDms.length > 0 ? (
              unreadDms.map(renderDmRow)
            ) : (
              <p className="px-3 py-6 text-center text-[0.84rem] text-[#677280] dark:text-[#77818F]">
                You are all caught up. No unread messages right now.
              </p>
            )}
          </div>
        ) : snapshot.dmInboxTab === 'requests' ? (
          <div className="space-y-4">
            {renderRequestsBlock()}
            {renderPeopleDiscovery(12)}
            {reqCount === 0 && matchedPeople.length === 0 && (
              <p className="px-3 py-6 text-center text-[0.84rem] text-[#677280] dark:text-[#77818F]">
                No message requests right now.
              </p>
            )}
          </div>
        ) : snapshot.dmInboxTab === 'groups' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2">
              <span className="text-[0.72rem] font-semibold text-[#677280] dark:text-[#77818F]">
                Group Chats · {groupDms.length}
              </span>
              <button
                type="button"
                onClick={() => bridge?.openNewGroupModal()}
                className="inline-flex items-center gap-1 text-[0.76rem] font-medium text-[#4777DF] hover:underline"
              >
                <Plus size={13} />
                New Group
              </button>
            </div>
            {groupDms.length > 0 ? (
              groupDms.map(renderDmRow)
            ) : (
              <p className="px-3 py-6 text-center text-[0.84rem] text-[#677280] dark:text-[#77818F]">
                No group conversations yet. Start one with New Group.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {incomingPending.length > 0 && renderRequestsBlock()}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 pb-0.5">
                <span className="text-[0.72rem] font-semibold text-[#677280] dark:text-[#77818F]">
                  Conversations · {visibleDms.length}
                </span>
                <button
                  type="button"
                  onClick={() => bridge?.openNewGroupModal()}
                  className="inline-flex items-center gap-1 text-[0.76rem] font-medium text-[#4777DF] hover:underline"
                >
                  <Plus size={13} />
                  New
                </button>
              </div>
              {visibleDms.length > 0 ? (
                visibleDms.map(renderDmRow)
              ) : (
                <p className="px-3 py-6 text-center text-[0.84rem] text-[#677280] dark:text-[#77818F]">
                  No conversations yet. Search a handle or check Requests to connect.
                </p>
              )}
            </div>
            {visibleDms.length < 3 && renderPeopleDiscovery(6)}
          </div>
        )}

        {archivedCount > 0 && (
          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={() => bridge?.toggleShowArchivedDms()}
              className="text-[0.76rem] font-medium text-[#677280] hover:text-[#202630] dark:text-[#77818F] dark:hover:text-[#F2F4F7]"
            >
              {snapshot.showArchivedDms
                ? `Hide archived (${archivedCount})`
                : `Show ${archivedCount} archived conversation${archivedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
