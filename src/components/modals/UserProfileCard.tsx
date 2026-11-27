import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import { X, Send, Shield, Sparkles, MessageSquare } from 'lucide-react';

export const UserProfileCard: React.FC = () => {
  const {
    selectedUserProfile,
    setSelectedUserProfile,
    sendMessage,
    activeChannel,
    currentUser,
    switchCurrentUser,
  } = useNexora();
  const [note, setNote] = useState('');
  const [quickMsg, setQuickMsg] = useState('');

  if (!selectedUserProfile) return null;

  const handleSendQuickMsg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickMsg.trim() || !activeChannel) return;
    sendMessage(activeChannel.id, `@${selectedUserProfile.displayName} ${quickMsg}`);
    setQuickMsg('');
    setSelectedUserProfile(null);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#191C24] border border-[#2b303d] rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl relative select-none">
        {/* Banner with Accent */}
        <div
          className="h-28 bg-gradient-to-r from-[#7667F7] via-[#35C98B] to-[#7667F7] relative"
          style={{
            backgroundColor: selectedUserProfile.accentColor || '#7667F7',
          }}
        >
          <button
            onClick={() => setSelectedUserProfile(null)}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-black/40 text-white hover:bg-black/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Profile Details */}
        <div className="p-5 pt-0 relative">
          {/* Avatar with Status Ring */}
          <div className="relative -mt-12 mb-3 inline-block">
            <img
              src={selectedUserProfile.avatar}
              alt={selectedUserProfile.displayName}
              className="w-20 h-20 rounded-full object-cover ring-4 ring-[#191C24]"
            />
            <span
              className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-[#191C24] ${
                selectedUserProfile.status === 'online'
                  ? 'bg-[#35C98B]'
                  : selectedUserProfile.status === 'idle'
                  ? 'bg-[#F59E0B]'
                  : selectedUserProfile.status === 'dnd'
                  ? 'bg-[#EF4444]'
                  : 'bg-[#6B7280]'
              }`}
            />
          </div>

          <div className="space-y-1 mb-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-extrabold text-white">
                {selectedUserProfile.displayName}
              </h3>
              {selectedUserProfile.roleTitle && (
                <span className="px-1.5 py-0.2 rounded font-bold text-[9px] bg-[#7667F7]/20 text-[#7667F7]">
                  {selectedUserProfile.roleTitle}
                </span>
              )}
            </div>
            <p className="text-xs text-[#9B9EAC]">@{selectedUserProfile.username}</p>
          </div>

          {/* Badges */}
          {selectedUserProfile.badges && selectedUserProfile.badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {selectedUserProfile.badges.map(b => (
                <span
                  key={b}
                  className="px-2 py-0.5 rounded-lg bg-[#111318] text-[10px] font-semibold text-white border border-[#262A36]"
                >
                  {b}
                </span>
              ))}
            </div>
          )}

          <div className="h-[1px] bg-[#262A36] my-3" />

          {/* About Me */}
          <div className="space-y-1 mb-3">
            <h4 className="text-[10px] font-extrabold text-[#717585] uppercase tracking-wider">
              ABOUT ME
            </h4>
            <p className="text-xs text-[#d8dbe6] leading-relaxed">
              {selectedUserProfile.bio || 'This user has not added a bio yet.'}
            </p>
          </div>

          {/* Roles */}
          <div className="space-y-1 mb-3">
            <h4 className="text-[10px] font-extrabold text-[#717585] uppercase tracking-wider">
              ROLES
            </h4>
            <div className="flex flex-wrap gap-1">
              <span className="px-2 py-0.5 rounded-md bg-[#111318] text-[#7667F7] text-xs font-semibold flex items-center gap-1 border border-[#262A36]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7667F7]" />
                {selectedUserProfile.roleTitle || 'Community Member'}
              </span>
            </div>
          </div>

          {/* User Note */}
          <div className="space-y-1 mb-4">
            <h4 className="text-[10px] font-extrabold text-[#717585] uppercase tracking-wider">
              NOTE
            </h4>
            <input
              type="text"
              placeholder="Click to add a personal note"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7]"
            />
          </div>

          {/* Quick Message Input */}
          <form onSubmit={handleSendQuickMsg} className="relative mb-2">
            <input
              type="text"
              placeholder={`Message @${selectedUserProfile.displayName}`}
              value={quickMsg}
              onChange={e => setQuickMsg(e.target.value)}
              className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7]"
            />
            <button
              type="submit"
              disabled={!quickMsg.trim()}
              className="absolute right-2 top-2 p-1 text-[#7667F7] disabled:opacity-30 hover:scale-105 transition-transform"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Persona Switcher button */}
          {selectedUserProfile.id !== currentUser.id && (
            <button
              type="button"
              onClick={() => {
                switchCurrentUser(selectedUserProfile);
              }}
              className="w-full py-2 bg-[#252936] hover:bg-[#7667F7] hover:text-white text-[#d8dbe6] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Switch to this Persona (Chat as {selectedUserProfile.displayName})</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
