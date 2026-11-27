import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import { X, UserPlus, Sparkles, Shield, Crown, Bot, Check, Shuffle } from 'lucide-react';
import { UserStatus } from '../../types';

const AVATAR_PRESETS = [
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
];

export const CreateMemberModal: React.FC = () => {
  const { activeModal, closeModal, addMember, switchCurrentUser } = useNexora();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_PRESETS[0]);
  const [roleTitle, setRoleTitle] = useState<'Admin' | 'Moderator' | 'Member' | 'Bot'>('Member');
  const [status, setStatus] = useState<UserStatus>('online');
  const [customStatus, setCustomStatus] = useState('Chilling on NEXORA ✨');
  const [bio, setBio] = useState('New member of the NEXORA community!');
  const [switchToNewUser, setSwitchToNewUser] = useState(false);

  if (activeModal !== 'create-member') return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    const formattedUsername = (username.trim() || displayName.toLowerCase().replace(/\s+/g, '_')).replace(/[^a-zA-Z0-9_]/g, '');

    const newMember = addMember({
      displayName: displayName.trim(),
      username: formattedUsername,
      avatar,
      roleTitle,
      status,
      customStatus: customStatus.trim() || undefined,
      bio: bio.trim() || undefined,
      badges: roleTitle === 'Admin' ? ['🛡️ Admin'] : roleTitle === 'Moderator' ? ['⚔️ Moderator'] : roleTitle === 'Bot' ? ['🤖 Bot'] : ['✨ Member'],
    });

    if (switchToNewUser) {
      switchCurrentUser(newMember);
    }

    closeModal();
    // Reset form
    setDisplayName('');
    setUsername('');
    setCustomStatus('Chilling on NEXORA ✨');
  };

  const handleRandomize = () => {
    const randomIndex = Math.floor(Math.random() * AVATAR_PRESETS.length);
    setAvatar(AVATAR_PRESETS[randomIndex]);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#15171E] border border-[#2b303e] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="h-14 px-6 border-b border-[#262A36] bg-[#111318] flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <UserPlus className="w-5 h-5 text-[#7667F7]" />
            <span>Create & Add New Member</span>
          </div>
          <button
            onClick={closeModal}
            className="p-1.5 text-[#9B9EAC] hover:text-white rounded-lg hover:bg-[#1f232f] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Avatar selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider">
                Avatar Preview & Presets
              </label>
              <button
                type="button"
                onClick={handleRandomize}
                className="text-xs text-[#7667F7] hover:underline flex items-center gap-1 font-semibold"
              >
                <Shuffle className="w-3.5 h-3.5" />
                Randomize
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <img
                  src={avatar}
                  alt="Avatar Preview"
                  className="w-16 h-16 rounded-2xl object-cover ring-2 ring-[#7667F7]"
                />
                <span
                  className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#15171E] ${
                    status === 'online'
                      ? 'bg-[#35C98B]'
                      : status === 'idle'
                      ? 'bg-[#F59E0B]'
                      : status === 'dnd'
                      ? 'bg-[#EF4444]'
                      : 'bg-[#6B7280]'
                  }`}
                />
              </div>

              <div className="grid grid-cols-4 gap-1.5 flex-1">
                {AVATAR_PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatar(p)}
                    className={`relative rounded-xl overflow-hidden aspect-square border-2 transition-all ${
                      avatar === p ? 'border-[#7667F7] ring-1 ring-[#7667F7]' : 'border-[#262A36] hover:border-[#383e50]'
                    }`}
                  >
                    <img src={p} alt={`Preset ${idx}`} className="w-full h-full object-cover" />
                    {avatar === p && (
                      <div className="absolute inset-0 bg-[#7667F7]/30 flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="url"
              placeholder="Or paste custom image URL..."
              value={avatar}
              onChange={e => setAvatar(e.target.value)}
              className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7]"
            />
          </div>

          {/* Name & Username */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-1">
                Display Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Kartik"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-1">
                Handle / Username
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-[#717585] text-xs">@</span>
                <input
                  type="text"
                  placeholder="kartik_dev"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full bg-[#111318] border border-[#262A36] rounded-xl pl-7 pr-3 py-2 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7]"
                />
              </div>
            </div>
          </div>

          {/* Role selector */}
          <div>
            <label className="block text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-1.5">
              Assigned Server Role
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Admin', icon: <Shield className="w-3.5 h-3.5 text-[#EF4444]" />, color: 'border-[#EF4444]/40 bg-[#EF4444]/10 text-[#EF4444]' },
                { label: 'Moderator', icon: <Shield className="w-3.5 h-3.5 text-[#10B981]" />, color: 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]' },
                { label: 'Member', icon: <Sparkles className="w-3.5 h-3.5 text-[#9CA3AF]" />, color: 'border-[#9CA3AF]/40 bg-[#9CA3AF]/10 text-white' },
                { label: 'Bot', icon: <Bot className="w-3.5 h-3.5 text-[#7667F7]" />, color: 'border-[#7667F7]/40 bg-[#7667F7]/10 text-[#7667F7]' },
              ].map(r => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setRoleTitle(r.label as any)}
                  className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-all ${
                    roleTitle === r.label ? r.color + ' ring-2 ring-white/20' : 'border-[#262A36] bg-[#111318] text-[#9B9EAC] hover:text-white'
                  }`}
                >
                  {r.icon}
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Status & Custom Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-1">
                Online Presence
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as UserStatus)}
                className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#7667F7]"
              >
                <option value="online">🟢 Online</option>
                <option value="idle">🟡 Idle</option>
                <option value="dnd">🔴 Do Not Disturb</option>
                <option value="offline">⚪ Invisible</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-1">
                Custom Status
              </label>
              <input
                type="text"
                placeholder="What is this user up to?"
                value={customStatus}
                onChange={e => setCustomStatus(e.target.value)}
                className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7]"
              />
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-1">
              About / Bio
            </label>
            <textarea
              rows={2}
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Short bio or introduction..."
              className="w-full bg-[#111318] border border-[#262A36] rounded-xl p-2.5 text-xs text-white placeholder-[#717585] focus:outline-none focus:border-[#7667F7] resize-none"
            />
          </div>

          {/* Switch persona option */}
          <label className="flex items-center gap-2 p-3 rounded-xl bg-[#191C24] border border-[#262A36] cursor-pointer">
            <input
              type="checkbox"
              checked={switchToNewUser}
              onChange={e => setSwitchToNewUser(e.target.checked)}
              className="rounded accent-[#7667F7]"
            />
            <span className="text-xs text-white font-medium">
              Immediately switch active account to this user (Test chatting as them)
            </span>
          </label>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="flex-1 py-2.5 px-4 bg-[#191C24] hover:bg-[#20242f] text-xs font-semibold text-[#9B9EAC] hover:text-white rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!displayName.trim()}
              className="flex-1 py-2.5 px-4 bg-[#7667F7] hover:bg-[#6353f4] disabled:opacity-50 text-xs font-bold text-white rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-[#7667F7]/25"
            >
              <UserPlus className="w-4 h-4" />
              <span>Create Member</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
