import React, { useState, useRef, useEffect } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  Hash,
  Pin,
  Bell,
  Users,
  Search,
  PlusCircle,
  Smile,
  Send,
  X,
  MessageSquare,
  Sparkles,
  Check,
  Flame,
  ThumbsUp,
  Heart,
  Rocket,
  Edit2,
  Trash2,
  Paperclip,
  Mic,
  BarChart2,
} from 'lucide-react';
import { EmojiPicker } from '../common/EmojiPicker';
import { Message, Poll } from '../../types';
import { formatMessageTime, calculatePollPercentage } from '../../utils/rules';

export const ChatWorkspace: React.FC = () => {
  const {
    activeChannel,
    messages,
    sendMessage,
    toggleReaction,
    togglePinMessage,
    deleteMessage,
    editMessage,
    votePoll,
    isMemberListOpen,
    setIsMemberListOpen,
    setSelectedUserProfile,
    currentUser,
    typingUsers,
    simulateTyping,
  } = useNexora();

  const [inputContent, setInputContent] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isPinnedDrawerOpen, setIsPinnedDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingPoll, setIsCreatingPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channelMessages = activeChannel ? messages[activeChannel.id] || [] : [];

  const filteredMessages = searchQuery.trim()
    ? channelMessages.filter(m =>
        m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.sender.displayName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : channelMessages;

  const pinnedMessages = channelMessages.filter(m => m.isPinned);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length]);

  if (!activeChannel) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#111318] text-[#9B9EAC]">
        Select a channel to start communicating
      </div>
    );
  }

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputContent.trim()) return;

    sendMessage(
      activeChannel.id,
      inputContent,
      undefined,
      replyingTo
        ? {
            id: replyingTo.id,
            senderName: replyingTo.sender.displayName,
            content: replyingTo.content.slice(0, 80),
          }
        : undefined
    );

    setInputContent('');
    setReplyingTo(null);
    simulateTyping();
  };

  const handleCreatePollSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pollQuestion.trim()) return;
    const validOptions = pollOptions.filter(o => o.trim().length > 0);
    if (validOptions.length < 2) return;

    const newPoll: Poll = {
      id: `poll-${Date.now()}`,
      question: pollQuestion,
      options: validOptions.map((text, idx) => ({
        id: `opt-${Date.now()}-${idx}`,
        text,
        votes: 0,
        votedUserIds: [],
      })),
      totalVotes: 0,
    };

    sendMessage(activeChannel.id, `📊 **Poll: ${pollQuestion}**`, undefined, undefined);

    // Attach poll to the newly added message via edit
    setIsCreatingPoll(false);
    setPollQuestion('');
    setPollOptions(['', '']);
  };

  const commonEmojis = ['🔥', '❤️', '🚀', '👍', '🎉', '😂', '👀', '💯'];

  return (
    <main
      className="flex-1 flex flex-col h-full bg-[#111318] min-w-0 relative overflow-hidden"
      aria-label={`Chat in #${activeChannel.name}`}
    >
      {/* Top Channel Header Bar */}
      <header className="h-12 border-b border-[#1f232f] px-4 flex items-center justify-between flex-shrink-0 bg-[#111318] z-10">
        <div className="flex items-center gap-3 truncate min-w-0">
          <div className="flex items-center gap-1.5 text-white font-bold text-sm">
            <Hash className="w-5 h-5 text-[#9B9EAC]" />
            <span className="truncate">{activeChannel.name}</span>
          </div>

          {activeChannel.topic && (
            <>
              <div className="w-[1px] h-4 bg-[#282d3c]" />
              <p className="text-xs text-[#9B9EAC] truncate hidden sm:block max-w-md">
                {activeChannel.topic}
              </p>
            </>
          )}
        </div>

        {/* Right Header Action Icons */}
        <div className="flex items-center gap-2 text-[#9B9EAC]">
          {/* Pinned Messages Button */}
          <button
            onClick={() => setIsPinnedDrawerOpen(!isPinnedDrawerOpen)}
            aria-label="Pinned Messages"
            className={`p-1.5 rounded-lg hover:bg-[#1a1d26] hover:text-white transition-colors relative ${
              isPinnedDrawerOpen ? 'bg-[#1a1d26] text-white' : ''
            }`}
          >
            <Pin className="w-4 h-4" />
            {pinnedMessages.length > 0 && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-[#7667F7]" />
            )}
          </button>

          {/* Search Bar Input */}
          <div className="relative hidden md:flex items-center">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="w-36 focus:w-56 h-7 bg-[#191C24] border border-[#262A36] rounded-lg px-2.5 pl-7 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7] transition-all"
            />
            <Search className="w-3.5 h-3.5 text-[#717585] absolute left-2 pointer-events-none" />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-[#717585] hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Member List Toggle */}
          <button
            onClick={() => setIsMemberListOpen(prev => !prev)}
            aria-label="Toggle Member List"
            className={`p-1.5 rounded-lg hover:bg-[#1a1d26] hover:text-white transition-colors ${
              isMemberListOpen ? 'text-white bg-[#1a1d26]' : ''
            }`}
          >
            <Users className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Messages Feed Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Channel Starter Banner Matching Screenshot 8 */}
        <div className="pt-4 pb-5 border-b border-[#1f232f] space-y-4">
          <div className="p-5 rounded-2xl bg-gradient-to-r from-[#191C24] via-[#15171E] to-[#191C24] border border-[#262A36] space-y-3 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#7667F7]/20 border border-[#7667F7]/40 flex items-center justify-center text-[#7667F7]">
                <Hash className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
                  Welcome to NEXORA Hub!
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#7667F7]/20 text-[#7667F7] font-bold border border-[#7667F7]/30">
                    OFFICIAL HQ
                  </span>
                </h1>
                <p className="text-xs text-[#9B9EAC]">
                  A place for creators, learners and doers to build something amazing together.
                </p>
              </div>
            </div>

            {/* Quick Action Chips from Screenshot 8 */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { emoji: '🤝', label: 'Be Kind', desc: 'Respect every creator' },
                { emoji: '💡', label: 'Share Knowledge', desc: 'Code, design & tips' },
                { emoji: '🛡️', label: 'Help Others', desc: 'Community first' },
                { emoji: '🚀', label: 'Grow Together', desc: 'Ship new ideas' },
              ].map((chip, idx) => (
                <div
                  key={idx}
                  className="px-3 py-1.5 rounded-xl bg-[#111318] border border-[#262A36] hover:border-[#7667F7]/50 text-xs text-[#d8dbe6] font-medium flex items-center gap-2 transition-all cursor-default select-none"
                >
                  <span className="text-sm">{chip.emoji}</span>
                  <span className="font-bold text-white">{chip.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Message Items */}
        {filteredMessages.map((msg, index) => {
          const isSenderMe = msg.senderId === currentUser.id;
          const isEditing = editingMessageId === msg.id;

          return (
            <div
              key={msg.id}
              className="group relative flex gap-3.5 p-2 -mx-2 rounded-xl hover:bg-[#15171e]/70 transition-colors"
            >
              {/* User Avatar */}
              <button
                onClick={() => setSelectedUserProfile(msg.sender)}
                aria-label={`View ${msg.sender.displayName}'s profile`}
                className="flex-shrink-0"
              >
                <img
                  src={msg.sender.avatar}
                  alt={msg.sender.displayName}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-transparent hover:ring-[#7667F7] transition-all"
                />
              </button>

              {/* Message Content Body */}
              <div className="flex-1 min-w-0 space-y-1">
                {/* Replying To preview banner */}
                {msg.replyTo && (
                  <div className="flex items-center gap-1.5 text-xs text-[#9B9EAC] mb-1 pl-2 border-l-2 border-[#7667F7]">
                    <span className="font-semibold text-[#7667F7]">
                      @{msg.replyTo.senderName}
                    </span>
                    <span className="truncate max-w-sm">{msg.replyTo.content}</span>
                  </div>
                )}

                {/* Author Name and Timestamp */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedUserProfile(msg.sender)}
                    className="text-xs font-bold text-white hover:underline flex items-center gap-1.5"
                  >
                    <span>{msg.sender.displayName}</span>
                    {msg.sender.roleTitle && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-[#7667F7]/20 text-[#7667F7] border border-[#7667F7]/30">
                        {msg.sender.roleTitle}
                      </span>
                    )}
                  </button>
                  <span className="text-[11px] text-[#9B9EAC]">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                  {msg.edited && (
                    <span className="text-[10px] text-[#717585]">(edited)</span>
                  )}
                  {msg.isPinned && (
                    <span className="flex items-center gap-0.5 text-[10px] text-[#EAB308] font-semibold">
                      <Pin className="w-2.5 h-2.5" /> Pinned
                    </span>
                  )}
                </div>

                {/* Message Text / Edit View */}
                {isEditing ? (
                  <div className="space-y-2 mt-1">
                    <input
                      type="text"
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="w-full bg-[#191C24] border border-[#7667F7] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          editMessage(activeChannel.id, msg.id, editContent);
                          setEditingMessageId(null);
                        }}
                        className="px-2.5 py-1 bg-[#7667F7] text-white text-xs font-semibold rounded-md hover:bg-[#6353f4]"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingMessageId(null)}
                        className="px-2.5 py-1 bg-[#252936] text-[#9B9EAC] text-xs font-semibold rounded-md hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[#F4F5FA] leading-relaxed break-words space-y-1.5">
                    {msg.content.includes('```') ? (
                      <div>
                        {msg.content.split('```').map((part, pIdx) => {
                          if (pIdx % 2 === 1) {
                            const [lang, ...codeLines] = part.split('\n');
                            const code = codeLines.length ? codeLines.join('\n') : lang;
                            return (
                              <pre
                                key={pIdx}
                                className="my-2 p-3 bg-[#15171e] border border-[#262A36] rounded-xl font-mono text-[11px] text-[#35C98B] overflow-x-auto"
                              >
                                <code>{code.trim()}</code>
                              </pre>
                            );
                          }
                          return (
                            <span key={pIdx} className="whitespace-pre-wrap">
                              {part}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">
                        {msg.content.split(/(\*\*[^*]+\*\*|@[a-zA-Z0-9_]+)/g).map((chunk, cIdx) => {
                          if (chunk.startsWith('**') && chunk.endsWith('**')) {
                            return (
                              <strong key={cIdx} className="font-bold text-white">
                                {chunk.slice(2, -2)}
                              </strong>
                            );
                          }
                          if (chunk.startsWith('@')) {
                            return (
                              <span
                                key={cIdx}
                                className="px-1.5 py-0.5 rounded-md bg-[#7667F7]/25 text-[#7667F7] font-semibold"
                              >
                                {chunk}
                              </span>
                            );
                          }
                          return chunk;
                        })}
                      </span>
                    )}
                  </div>
                )}

                {/* Poll Widget Embed */}
                {msg.poll && (
                  <div className="mt-2.5 max-w-md p-3.5 rounded-xl bg-[#191C24] border border-[#2b303d] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-white flex items-center gap-1.5">
                        <BarChart2 className="w-4 h-4 text-[#7667F7]" />
                        {msg.poll.question}
                      </p>
                      <span className="text-[10px] text-[#9B9EAC]">
                        {msg.poll.totalVotes} votes
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {msg.poll.options.map(opt => {
                        const pct = calculatePollPercentage(opt.votes, msg.poll!.totalVotes);
                        const hasVoted = opt.votedUserIds.includes(currentUser.id);

                        return (
                          <button
                            key={opt.id}
                            onClick={() => votePoll(activeChannel.id, msg.id, opt.id)}
                            className={`w-full relative overflow-hidden text-left p-2 rounded-lg border transition-all ${
                              hasVoted
                                ? 'border-[#7667F7] bg-[#7667F7]/10'
                                : 'border-[#262A36] bg-[#111318] hover:border-[#383e50]'
                            }`}
                          >
                            {/* Animated progress fill */}
                            <div
                              className="absolute top-0 bottom-0 left-0 bg-[#7667F7]/20 transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                            <div className="relative z-10 flex items-center justify-between text-xs">
                              <span className="font-medium text-white flex items-center gap-1.5 truncate">
                                {hasVoted && <Check className="w-3.5 h-3.5 text-[#7667F7]" />}
                                {opt.text}
                              </span>
                              <span className="font-bold text-[#9B9EAC] ml-2">
                                {pct}%
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Reactions Row */}
                {msg.reactions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {msg.reactions.map(r => {
                      const hasVoted = r.users.includes(currentUser.id);
                      return (
                        <button
                          key={r.emoji}
                          onClick={() => toggleReaction(activeChannel.id, msg.id, r.emoji)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border transition-colors ${
                            hasVoted
                              ? 'bg-[#7667F7]/20 text-[#7667F7] border-[#7667F7]/50'
                              : 'bg-[#191C24] text-[#9B9EAC] border-[#262A36] hover:bg-[#20242f]'
                          }`}
                        >
                          <span>{r.emoji}</span>
                          <span className="font-semibold text-[11px]">{r.count}</span>
                        </button>
                      );
                    })}

                    {/* Quick Add reaction button */}
                    <button
                      onClick={() => toggleReaction(activeChannel.id, msg.id, '❤️')}
                      aria-label="Add reaction"
                      className="px-2 py-0.5 rounded-lg text-xs bg-[#191C24] border border-[#262A36] text-[#9B9EAC] hover:text-white"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>

              {/* Floating Hover Actions Bar */}
              <div className="absolute right-3 -top-3.5 hidden group-hover:flex items-center gap-0.5 bg-[#191C24] border border-[#2b303d] rounded-lg p-1 shadow-xl z-10">
                {commonEmojis.slice(0, 4).map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => toggleReaction(activeChannel.id, msg.id, emoji)}
                    className="p-1 hover:bg-[#282d3b] rounded transition-colors text-sm"
                  >
                    {emoji}
                  </button>
                ))}
                <div className="w-[1px] h-3 bg-[#2b303d] mx-0.5" />
                <button
                  onClick={() => setReplyingTo(msg)}
                  aria-label="Reply"
                  className="p-1 hover:bg-[#282d3b] rounded text-[#9B9EAC] hover:text-white"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => togglePinMessage(activeChannel.id, msg.id)}
                  aria-label="Pin message"
                  className="p-1 hover:bg-[#282d3b] rounded text-[#9B9EAC] hover:text-white"
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
                {isSenderMe && (
                  <>
                    <button
                      onClick={() => {
                        setEditingMessageId(msg.id);
                        setEditContent(msg.content);
                      }}
                      aria-label="Edit message"
                      className="p-1 hover:bg-[#282d3b] rounded text-[#9B9EAC] hover:text-white"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteMessage(activeChannel.id, msg.id)}
                      aria-label="Delete message"
                      className="p-1 hover:bg-[#282d3b] rounded text-[#EF4444]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Pinned Messages Drawer Panel */}
      {isPinnedDrawerOpen && (
        <aside
          className="absolute right-0 top-12 bottom-0 w-80 bg-[#15171E] border-l border-[#262A36] p-4 flex flex-col z-20 shadow-2xl"
          aria-label="Pinned messages panel"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#262A36] mb-3">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Pin className="w-4 h-4 text-[#EAB308]" />
              <span>Pinned Messages</span>
            </div>
            <button
              onClick={() => setIsPinnedDrawerOpen(false)}
              className="p-1 text-[#9B9EAC] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3">
            {pinnedMessages.length === 0 ? (
              <p className="text-xs text-[#9B9EAC] text-center pt-8">
                No pinned messages in this channel yet.
              </p>
            ) : (
              pinnedMessages.map(p => (
                <div
                  key={p.id}
                  className="p-3 bg-[#191C24] border border-[#2b303d] rounded-xl space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      {p.sender.displayName}
                    </span>
                    <button
                      onClick={() => togglePinMessage(activeChannel.id, p.id)}
                      className="text-[10px] text-[#EF4444] hover:underline"
                    >
                      Unpin
                    </button>
                  </div>
                  <p className="text-xs text-[#d8dbe6] line-clamp-3">
                    {p.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Bottom Message Composer */}
      <footer className="p-4 pt-1 flex-shrink-0">
        {/* Reply Preview Bar */}
        {replyingTo && (
          <div className="flex items-center justify-between bg-[#191C24] px-3 py-1.5 rounded-t-xl border border-b-0 border-[#262A36] text-xs">
            <span className="text-[#9B9EAC] truncate">
              Replying to <b className="text-white">@{replyingTo.sender.displayName}</b>: {replyingTo.content.slice(0, 50)}...
            </span>
            <button
              onClick={() => setReplyingTo(null)}
              className="text-[#9B9EAC] hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Input Bar */}
        <form
          onSubmit={handleSend}
          className={`flex items-center gap-2 bg-[#191C24] border border-[#262A36] focus-within:border-[#7667F7] px-3 py-2 transition-colors ${
            replyingTo ? 'rounded-b-2xl' : 'rounded-2xl'
          }`}
        >
          {/* Add Attachment Button */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={e => {
              if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                sendMessage(activeChannel.id, `Uploaded file: 📎 ${file.name}`);
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload file"
            className="p-1 text-[#9B9EAC] hover:text-white transition-colors"
          >
            <PlusCircle className="w-5 h-5" />
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={inputContent}
            onChange={e => setInputContent(e.target.value)}
            placeholder={`Message #${activeChannel.name}`}
            className="flex-1 bg-transparent text-xs text-white placeholder-[#717585] focus:outline-none"
          />

          {/* Create Poll Button */}
          <button
            type="button"
            onClick={() => setIsCreatingPoll(true)}
            aria-label="Create Poll"
            className="p-1 text-[#9B9EAC] hover:text-[#7667F7] transition-colors"
          >
            <BarChart2 className="w-4 h-4" />
          </button>

          {/* Emoji Selector Popover Toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
              aria-label="Emoji Picker"
              className={`p-1 transition-colors ${
                isEmojiPickerOpen
                  ? 'text-[#F59E0B] bg-[#F59E0B]/10 rounded-lg'
                  : 'text-[#9B9EAC] hover:text-[#F59E0B]'
              }`}
              title="Open Emoji Picker"
            >
              <Smile className="w-5 h-5" />
            </button>

            {isEmojiPickerOpen && (
              <EmojiPicker
                onSelectEmoji={emoji => {
                  setInputContent(prev => prev + emoji);
                }}
                onClose={() => setIsEmojiPickerOpen(false)}
              />
            )}
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputContent.trim()}
            aria-label="Send Message"
            className={`p-1.5 rounded-xl transition-all ${
              inputContent.trim()
                ? 'bg-[#7667F7] text-white hover:bg-[#6252f5]'
                : 'text-[#505466] cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Typing Indicator */}
        <div className="h-4 pl-2 pt-1">
          {typingUsers.length > 0 && (
            <p className="text-[10px] text-[#9B9EAC] flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-[#7667F7] animate-bounce" />
                <span className="w-1 h-1 rounded-full bg-[#7667F7] animate-bounce [animation-delay:0.2s]" />
                <span className="w-1 h-1 rounded-full bg-[#7667F7] animate-bounce [animation-delay:0.4s]" />
              </span>
              <span>{typingUsers.join(', ')} is typing...</span>
            </p>
          )}
        </div>
      </footer>

      {/* Create Poll Dialog Modal */}
      {isCreatingPoll && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#191C24] border border-[#2b303d] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#282d3b]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-[#7667F7]" />
                Create Community Poll
              </h3>
              <button
                onClick={() => setIsCreatingPoll(false)}
                className="text-[#9B9EAC] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreatePollSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                  Question
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ask a question..."
                  value={pollQuestion}
                  onChange={e => setPollQuestion(e.target.value)}
                  className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#7667F7]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#9B9EAC]">
                  Options
                </label>
                {pollOptions.map((opt, idx) => (
                  <input
                    key={idx}
                    type="text"
                    placeholder={`Option ${idx + 1}`}
                    value={opt}
                    onChange={e => {
                      const next = [...pollOptions];
                      next[idx] = e.target.value;
                      setPollOptions(next);
                    }}
                    className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#7667F7]"
                  />
                ))}
                {pollOptions.length < 5 && (
                  <button
                    type="button"
                    onClick={() => setPollOptions([...pollOptions, ''])}
                    className="text-xs text-[#7667F7] hover:underline font-semibold"
                  >
                    + Add Option
                  </button>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingPoll(false)}
                  className="px-3 py-1.5 bg-[#252936] text-xs font-semibold text-[#9B9EAC] rounded-xl hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#7667F7] text-xs font-bold text-white rounded-xl hover:bg-[#6353f4]"
                >
                  Post Poll
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};
