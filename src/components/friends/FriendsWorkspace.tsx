import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  Users,
  MessageSquare,
  Phone,
  Video,
  UserPlus,
  Check,
  X,
  Search,
  MoreVertical,
  Radio,
  Gamepad2,
  Headphones,
  Compass,
  Smile,
  Send,
  PlusCircle,
} from 'lucide-react';
import { Friendship, FriendRequest, User, Message } from '../../types';
import { formatMessageTime } from '../../utils/rules';

export const FriendsWorkspace: React.FC = () => {
  const {
    friends,
    friendRequests,
    directConversations,
    dmMessages,
    sendDmMessage,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
    setSelectedUserProfile,
    currentUser,
    joinVoiceChannel,
    setActiveChannelId,
  } = useNexora();

  const [activeTab, setActiveTab] = useState<'online' | 'all' | 'pending' | 'add'>('online');
  const [selectedDmId, setSelectedDmId] = useState<string | null>(null);
  const [friendSearchTerm, setFriendSearchTerm] = useState('');
  const [addFriendInput, setAddFriendInput] = useState('');
  const [addFriendFeedback, setAddFriendFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [dmInput, setDmInput] = useState('');

  const selectedConversation = directConversations.find(c => c.id === selectedDmId);
  const activeChatPartner = selectedConversation?.recipients[0];
  const activeDmMessages = selectedDmId ? dmMessages[selectedDmId] || [] : [];

  const onlineFriends = friends.filter(f => f.status !== 'offline');
  const filteredFriends = (activeTab === 'online' ? onlineFriends : friends).filter(f =>
    f.friend.displayName.toLowerCase().includes(friendSearchTerm.toLowerCase()) ||
    f.friend.username.toLowerCase().includes(friendSearchTerm.toLowerCase())
  );

  const handleSendFriendRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addFriendInput.trim()) return;
    const res = sendFriendRequest(addFriendInput);
    setAddFriendFeedback(res);
    if (res.success) {
      setAddFriendInput('');
    }
  };

  const handleSendDm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDmId || !dmInput.trim()) return;
    sendDmMessage(selectedDmId, dmInput);
    setDmInput('');
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden select-none bg-[#111318]" aria-label="Direct messages and friends">
      {/* Sub-Sidebar: DM Conversations List */}
      <nav
        className="w-60 bg-[#15171E] flex flex-col border-r border-[#1f232f] flex-shrink-0"
        aria-label="Direct conversations"
      >
        {/* Friends Tab Button */}
        <div className="p-3 border-b border-[#202430]">
          <button
            onClick={() => setSelectedDmId(null)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
              selectedDmId === null
                ? 'bg-[#7667F7] text-white shadow-md shadow-[#7667F7]/20'
                : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Friends</span>
            {friendRequests.length > 0 && (
              <span className="ml-auto bg-[#EF4444] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {friendRequests.length}
              </span>
            )}
          </button>
        </div>

        {/* Direct Messages Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 text-[11px] font-bold text-[#9B9EAC] uppercase tracking-wider">
          <span>Direct Messages</span>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {directConversations.map(conv => {
            const partner = conv.recipients[0];
            const isSelected = selectedDmId === conv.id;

            return (
              <button
                key={conv.id}
                onClick={() => setSelectedDmId(conv.id)}
                className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-left transition-all ${
                  isSelected
                    ? 'bg-[#252936] text-white'
                    : 'text-[#9B9EAC] hover:bg-[#191C24] hover:text-[#d3d6e2]'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <img
                    src={partner.avatar}
                    alt={partner.displayName}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#15171E] ${
                      partner.status === 'online'
                        ? 'bg-[#35C98B]'
                        : partner.status === 'idle'
                        ? 'bg-[#F59E0B]'
                        : 'bg-[#6B7280]'
                    }`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {partner.displayName}
                  </p>
                  <p className="text-[10px] text-[#9B9EAC] truncate">
                    {conv.lastMessage || 'Start a conversation'}
                  </p>
                </div>

                {conv.unreadCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-[#7667F7] flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content: Either DM Chat or Friends Dashboard */}
      {selectedDmId && activeChatPartner ? (
        /* Direct Message Chat View */
        <main
          className="flex-1 flex flex-col h-full bg-[#111318]"
          aria-label={`Conversation with ${activeChatPartner.displayName}`}
        >
          {/* DM Header */}
          <header className="h-12 border-b border-[#1f232f] px-4 flex items-center justify-between flex-shrink-0 bg-[#111318]">
            <div className="flex items-center gap-2.5">
              <img
                src={activeChatPartner.avatar}
                alt={activeChatPartner.displayName}
                className="w-7 h-7 rounded-full object-cover"
              />
              <div>
                <p className="text-xs font-bold text-white leading-none">
                  {activeChatPartner.displayName}
                </p>
                <p className="text-[10px] text-[#35C98B] leading-none mt-0.5">
                  ● {activeChatPartner.status}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[#9B9EAC]">
              <button
                onClick={() => alert(`Starting voice call with ${activeChatPartner.displayName}...`)}
                aria-label="Start Voice Call"
                className="p-1.5 rounded-lg hover:bg-[#1a1d26] hover:text-white transition-colors"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                onClick={() => alert(`Starting video call with ${activeChatPartner.displayName}...`)}
                aria-label="Start Video Call"
                className="p-1.5 rounded-lg hover:bg-[#1a1d26] hover:text-white transition-colors"
              >
                <Video className="w-4 h-4" />
              </button>
              <button
                onClick={() => setSelectedUserProfile(activeChatPartner)}
                aria-label="View Profile"
                className="p-1.5 rounded-lg hover:bg-[#1a1d26] hover:text-white transition-colors"
              >
                <Users className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* DM Message Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="pt-6 pb-4 border-b border-[#1f232f]">
              <img
                src={activeChatPartner.avatar}
                alt={activeChatPartner.displayName}
                className="w-16 h-16 rounded-full object-cover mb-3 ring-4 ring-[#7667F7]/30"
              />
              <h1 className="text-2xl font-bold text-white mb-1">
                {activeChatPartner.displayName}
              </h1>
              <p className="text-xs text-[#9B9EAC]">
                This is the beginning of your direct message history with @{activeChatPartner.username}.
              </p>
            </div>

            {activeDmMessages.map(msg => (
              <div key={msg.id} className="flex gap-3">
                <img
                  src={msg.sender.avatar}
                  alt={msg.sender.displayName}
                  className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">
                      {msg.sender.displayName}
                    </span>
                    <span className="text-[10px] text-[#9B9EAC]">
                      {formatMessageTime(msg.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-[#F4F5FA]">{msg.content}</p>
                </div>
              </div>
            ))}
          </div>

          {/* DM Input Bar */}
          <footer className="p-4 pt-1">
            <form
              onSubmit={handleSendDm}
              className="flex items-center gap-2 bg-[#191C24] border border-[#262A36] focus-within:border-[#7667F7] px-3 py-2 rounded-2xl"
            >
              <input
                type="text"
                value={dmInput}
                onChange={e => setDmInput(e.target.value)}
                placeholder={`Message @${activeChatPartner.displayName}`}
                className="flex-1 bg-transparent text-xs text-white placeholder-[#717585] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!dmInput.trim()}
                className="p-1.5 bg-[#7667F7] text-white rounded-xl disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </footer>
        </main>
      ) : (
        /* Friends Dashboard View */
        <main
          className="flex-1 flex flex-col h-full bg-[#111318]"
          aria-label="Friends dashboard"
        >
          {/* Header Tabs Bar */}
          <header className="h-12 border-b border-[#1f232f] px-4 flex items-center justify-between flex-shrink-0 bg-[#111318]">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <Users className="w-5 h-5 text-[#9B9EAC]" />
                <span>Friends</span>
              </div>

              <div className="w-[1px] h-4 bg-[#282d3c]" />

              <div className="flex items-center gap-1 text-xs font-semibold">
                <button
                  onClick={() => setActiveTab('online')}
                  className={`px-3 py-1 rounded-lg transition-colors ${
                    activeTab === 'online'
                      ? 'bg-[#252936] text-white'
                      : 'text-[#9B9EAC] hover:text-white'
                  }`}
                >
                  Online ({onlineFriends.length})
                </button>
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1 rounded-lg transition-colors ${
                    activeTab === 'all'
                      ? 'bg-[#252936] text-white'
                      : 'text-[#9B9EAC] hover:text-white'
                  }`}
                >
                  All ({friends.length})
                </button>
                <button
                  onClick={() => setActiveTab('pending')}
                  className={`px-3 py-1 rounded-lg transition-colors relative ${
                    activeTab === 'pending'
                      ? 'bg-[#252936] text-white'
                      : 'text-[#9B9EAC] hover:text-white'
                  }`}
                >
                  Pending
                  {friendRequests.length > 0 && (
                    <span className="ml-1.5 bg-[#EF4444] text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                      {friendRequests.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('add')}
                  className={`px-3 py-1 rounded-lg transition-colors font-bold ${
                    activeTab === 'add'
                      ? 'bg-[#35C98B] text-white'
                      : 'text-[#35C98B] hover:bg-[#35C98B]/20'
                  }`}
                >
                  Add Friend
                </button>
              </div>
            </div>
          </header>

          {/* Tab Body */}
          <div className="flex-1 flex overflow-hidden">
            {/* Friends / Add Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
              {activeTab === 'add' ? (
                /* Add Friend Form */
                <div className="max-w-xl space-y-4">
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">
                      ADD FRIEND
                    </h2>
                    <p className="text-xs text-[#9B9EAC]">
                      You can add friends with their NEXORA tag. It's case-sensitive!
                    </p>
                  </div>

                  <form
                    onSubmit={handleSendFriendRequest}
                    className="flex items-center gap-2 bg-[#191C24] border border-[#262A36] focus-within:border-[#35C98B] p-2 rounded-2xl"
                  >
                    <input
                      type="text"
                      placeholder="You can add friends by username (e.g. cyber_phoenix)"
                      value={addFriendInput}
                      onChange={e => setAddFriendInput(e.target.value)}
                      className="flex-1 bg-transparent px-3 text-xs text-white placeholder-[#717585] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!addFriendInput.trim()}
                      className="px-4 py-2 bg-[#7667F7] hover:bg-[#6353f4] disabled:opacity-40 text-xs font-bold text-white rounded-xl transition-colors"
                    >
                      Send Friend Request
                    </button>
                  </form>

                  {addFriendFeedback && (
                    <p
                      className={`text-xs font-semibold ${
                        addFriendFeedback.success
                          ? 'text-[#35C98B]'
                          : 'text-[#EF4444]'
                      }`}
                    >
                      {addFriendFeedback.message}
                    </p>
                  )}
                </div>
              ) : activeTab === 'pending' ? (
                /* Pending Requests List */
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider">
                    PENDING REQUESTS — {friendRequests.length}
                  </h3>

                  {friendRequests.length === 0 ? (
                    <p className="text-xs text-[#9B9EAC] pt-4">
                      There are no pending friend requests. Here's a taco instead! 🌮
                    </p>
                  ) : (
                    friendRequests.map(req => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between p-3 rounded-2xl bg-[#191C24] border border-[#262A36]"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={req.user.avatar}
                            alt={req.user.displayName}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                          <div>
                            <p className="text-xs font-bold text-white">
                              {req.user.displayName}
                            </p>
                            <p className="text-[10px] text-[#9B9EAC]">
                              Incoming Friend Request • {req.createdAt}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => acceptFriendRequest(req.id)}
                            aria-label="Accept Request"
                            className="w-8 h-8 rounded-full bg-[#35C98B]/20 text-[#35C98B] hover:bg-[#35C98B] hover:text-white flex items-center justify-center transition-colors"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => rejectFriendRequest(req.id)}
                            aria-label="Reject Request"
                            className="w-8 h-8 rounded-full bg-[#EF4444]/20 text-[#EF4444] hover:bg-[#EF4444] hover:text-white flex items-center justify-center transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                /* Online or All Friends List */
                <div className="space-y-3">
                  {/* Search Input */}
                  <div className="relative mb-4">
                    <input
                      type="text"
                      placeholder="Search friends..."
                      value={friendSearchTerm}
                      onChange={e => setFriendSearchTerm(e.target.value)}
                      className="w-full bg-[#191C24] border border-[#262A36] rounded-xl px-3 pl-9 py-2 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7]"
                    />
                    <Search className="w-4 h-4 text-[#717585] absolute left-3 top-2.5" />
                  </div>

                  <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider">
                    {activeTab === 'online' ? 'Online' : 'All'} Friends — {filteredFriends.length}
                  </h3>

                  <div className="space-y-1">
                    {filteredFriends.map(f => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between p-2.5 rounded-2xl hover:bg-[#191C24] border border-transparent hover:border-[#262A36] transition-colors group"
                      >
                        <div
                          onClick={() => setSelectedUserProfile(f.friend)}
                          className="flex items-center gap-3 cursor-pointer truncate"
                        >
                          <div className="relative flex-shrink-0">
                            <img
                              src={f.friend.avatar}
                              alt={f.friend.displayName}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111318] ${
                                f.status === 'online'
                                  ? 'bg-[#35C98B]'
                                  : f.status === 'idle'
                                  ? 'bg-[#F59E0B]'
                                  : f.status === 'dnd'
                                  ? 'bg-[#EF4444]'
                                  : 'bg-[#6B7280]'
                              }`}
                            />
                          </div>

                          <div className="truncate">
                            <p className="text-xs font-bold text-white group-hover:text-[#7667F7] transition-colors truncate">
                              {f.friend.displayName}
                            </p>
                            <p className="text-[11px] text-[#9B9EAC] truncate">
                              {f.activity
                                ? `${f.activity.type} ${f.activity.name} • ${f.activity.detail || ''}`
                                : `@${f.friend.username}`}
                            </p>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setSelectedDmId(`dm-${f.friend.id}`)}
                            aria-label={`Message ${f.friend.displayName}`}
                            className="w-8 h-8 rounded-full bg-[#191C24] text-[#9B9EAC] hover:bg-[#7667F7] hover:text-white flex items-center justify-center transition-colors"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => removeFriend(f.id)}
                            aria-label="Remove Friend"
                            className="w-8 h-8 rounded-full bg-[#191C24] text-[#9B9EAC] hover:bg-[#EF4444] hover:text-white flex items-center justify-center transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Active Now Right Panel */}
            <aside
              className="w-80 bg-[#15171E] border-l border-[#1f232f] p-4 hidden lg:flex flex-col select-none overflow-y-auto"
              aria-label="Active friends activity"
            >
              <h3 className="text-sm font-bold text-white mb-4">Active Now</h3>
              <div className="space-y-3">
                {onlineFriends
                  .filter(f => f.activity)
                  .map(f => (
                    <div
                      key={f.id}
                      onClick={() => setSelectedUserProfile(f.friend)}
                      className="p-3 rounded-2xl bg-[#191C24] border border-[#262A36] hover:border-[#7667F7] transition-all cursor-pointer space-y-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <img
                          src={f.friend.avatar}
                          alt={f.friend.displayName}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                        <div className="truncate">
                          <p className="text-xs font-bold text-white truncate">
                            {f.friend.displayName}
                          </p>
                          <p className="text-[10px] text-[#9B9EAC]">
                            {f.activity?.type} {f.activity?.name}
                          </p>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-[#111318] flex items-center gap-2.5">
                        {f.activity?.type === 'Playing' ? (
                          <Gamepad2 className="w-6 h-6 text-[#7667F7]" />
                        ) : (
                          <Headphones className="w-6 h-6 text-[#35C98B]" />
                        )}
                        <div className="truncate">
                          <p className="text-xs font-semibold text-white truncate">
                            {f.activity?.name}
                          </p>
                          <p className="text-[10px] text-[#9B9EAC] truncate">
                            {f.activity?.detail || 'Playing with squad'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
};
