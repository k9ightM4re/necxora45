import React from 'react';
import { useNexora } from '../../context/NexoraContext';
import { Crown, Shield, Bot, UserPlus, Radio, RadioTower } from 'lucide-react';
import { User } from '../../types';

export const MemberList: React.FC = () => {
  const {
    isMemberListOpen,
    setSelectedUserProfile,
    activeServer,
    currentUser,
    serverMembers,
    openModal,
    events,
    joinVoiceChannel,
    setActiveChannelId,
  } = useNexora();

  if (!isMemberListOpen || !activeServer) return null;

  // Derive groups from current dynamic serverMembers list
  const owners = serverMembers.filter(
    u => u.roleTitle === 'Server Owner' || u.id === activeServer.ownerId
  );
  const admins = serverMembers.filter(
    u => u.roleTitle === 'Admin' && u.id !== activeServer.ownerId
  );
  const mods = serverMembers.filter(u => u.roleTitle === 'Moderator');
  const bots = serverMembers.filter(u => u.roleTitle === 'Bot');
  const members = serverMembers.filter(
    u =>
      !['Server Owner', 'Admin', 'Moderator', 'Bot'].includes(u.roleTitle || '') &&
      u.id !== activeServer.ownerId
  );

  const totalMembers = serverMembers.length;

  // Live Stage Event
  const liveStageEvent = events.find(e => e.status === 'live');

  const renderGroup = (title: string, count: number, membersGroup: User[]) => {
    if (membersGroup.length === 0) return null;

    return (
      <div className="mb-4">
        <h3 className="px-2 mb-1.5 text-[11px] font-bold text-[#9B9EAC] uppercase tracking-wider flex items-center justify-between">
          <span>{title}</span>
          <span className="text-[10px] text-[#717585]">{count}</span>
        </h3>
        <div className="space-y-0.5">
          {membersGroup.map(member => {
            const isMe = member.id === currentUser.id;

            return (
              <button
                key={member.id}
                onClick={() => setSelectedUserProfile(member)}
                aria-label={`View ${member.displayName}'s profile`}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl transition-colors text-left group ${
                  isMe ? 'bg-[#191C24]/60 hover:bg-[#191C24]' : 'hover:bg-[#191C24]'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <img
                    src={member.avatar}
                    alt={member.displayName}
                    className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10"
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#15171E] ${
                      member.status === 'online'
                        ? 'bg-[#35C98B]'
                        : member.status === 'idle'
                        ? 'bg-[#F59E0B]'
                        : member.status === 'dnd'
                        ? 'bg-[#EF4444]'
                        : 'bg-[#6B7280]'
                    }`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`text-xs font-semibold truncate ${
                        member.roleTitle === 'Server Owner' || member.id === activeServer.ownerId
                          ? 'text-[#EAB308]'
                          : member.roleTitle === 'Admin'
                          ? 'text-[#EF4444]'
                          : member.roleTitle === 'Moderator'
                          ? 'text-[#10B981]'
                          : member.roleTitle === 'Bot'
                          ? 'text-[#7667F7]'
                          : 'text-[#d8dbe6]'
                      }`}
                    >
                      {member.displayName}
                    </span>

                    {member.roleTitle === 'Server Owner' || member.id === activeServer.ownerId ? (
                      <Crown className="w-3 h-3 text-[#EAB308] flex-shrink-0" />
                    ) : member.roleTitle === 'Admin' ? (
                      <Shield className="w-3 h-3 text-[#EF4444] flex-shrink-0" />
                    ) : member.roleTitle === 'Bot' ? (
                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-[#7667F7] text-white flex items-center gap-0.5">
                        BOT
                      </span>
                    ) : null}

                    {isMe && (
                      <span className="text-[9px] text-[#717585] font-mono ml-auto">
                        YOU
                      </span>
                    )}
                  </div>

                  {member.customStatus && (
                    <p className="text-[10px] text-[#9B9EAC] truncate leading-none mt-0.5">
                      {member.customStatus}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <aside
      className="w-64 bg-[#15171E] flex flex-col h-full border-l border-[#1f232f] p-3 select-none overflow-y-auto flex-shrink-0"
      aria-label="Server members"
    >
      {/* Header with Add Member Action */}
      <div className="mb-3">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            MEMBERS — {totalMembers}
          </span>
        </div>

        {/* Add / Create Member Button */}
        <button
          onClick={() => openModal('create-member')}
          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-[#7667F7]/20 to-[#35C98B]/20 border border-[#7667F7]/40 hover:border-[#7667F7] text-white text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-[#7667F7]/10 group"
        >
          <UserPlus className="w-4 h-4 text-[#7667F7] group-hover:scale-110 transition-transform" />
          <span>+ Add / Create Member</span>
        </button>
      </div>

      {/* Live Stage Widget (Matching screenshot 8) */}
      {liveStageEvent && (
        <div className="mb-4 p-3 rounded-2xl bg-[#191C24] border border-[#262A36] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#EF4444] uppercase tracking-wider">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Event Stage • LIVE
            </span>
            <span className="text-[10px] text-[#35C98B] font-semibold">
              ● 1,024 listening
            </span>
          </div>

          <p className="text-xs font-bold text-white line-clamp-1">
            {liveStageEvent.title}
          </p>

          {/* Speakers Avatars Grid */}
          <div className="flex items-center justify-between">
            <div className="flex -space-x-2 overflow-hidden">
              {serverMembers.slice(0, 4).map(u => (
                <img
                  key={u.id}
                  src={u.avatar}
                  alt={u.displayName}
                  className="w-6 h-6 rounded-full border-2 border-[#191C24] object-cover"
                />
              ))}
              <span className="w-6 h-6 rounded-full border-2 border-[#191C24] bg-[#262A36] text-[9px] font-bold text-[#9B9EAC] flex items-center justify-center">
                +1K
              </span>
            </div>

            <button
              onClick={() => {
                if (liveStageEvent.channelId) {
                  joinVoiceChannel(activeServer.id, liveStageEvent.channelId);
                  setActiveChannelId(liveStageEvent.channelId);
                }
              }}
              className="px-3 py-1 bg-[#EF4444] hover:bg-[#dc2626] text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 shadow-sm shadow-[#EF4444]/30"
            >
              <RadioTower className="w-3 h-3" />
              Join Voice
            </button>
          </div>
        </div>
      )}

      {/* Member Groups */}
      {renderGroup('Owner', owners.length, owners)}
      {renderGroup('Admins', admins.length, admins)}
      {renderGroup('Moderators', mods.length, mods)}
      {renderGroup('Members', members.length, members)}
      {renderGroup('Bots', bots.length, bots)}

      {members.length === 0 && (
        <div className="p-3 text-center border border-dashed border-[#262A36] rounded-xl text-xs text-[#9B9EAC] space-y-1 mt-2">
          <p className="font-semibold text-white">Create Your Community</p>
          <p className="text-[11px]">Click "+ Add / Create Member" above to add new members to your server.</p>
        </div>
      )}
    </aside>
  );
};
