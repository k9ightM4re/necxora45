import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  ChevronDown,
  Hash,
  Volume2,
  Megaphone,
  MessageSquareText,
  Radio,
  Plus,
  Settings,
  Mic,
  MicOff,
  Headphones,
  PhoneOff,
  RadioTower,
  Sparkles,
  Users,
  UserPlus,
  LogOut,
  Calendar,
  Share2,
} from 'lucide-react';
import { ChannelType } from '../../types';

export const ChannelSidebar: React.FC = () => {
  const {
    currentUser,
    activeServer,
    activeChannelId,
    setActiveChannelId,
    channels,
    events,
    voiceSession,
    joinVoiceChannel,
    leaveVoiceChannel,
    isMuted,
    isDeafened,
    toggleMute,
    toggleDeafen,
    openModal,
    setSelectedUserProfile,
    toggleEventInterested,
    logoutUser,
  } = useNexora();

  const [isServerMenuOpen, setIsServerMenuOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  if (!activeServer) return null;

  const toggleCategoryCollapse = (catId: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  const serverEvents = events.filter(e => e.serverId === activeServer.id);
  const liveEvent = serverEvents.find(e => e.status === 'live');

  const getChannelIcon = (type: ChannelType) => {
    switch (type) {
      case 'text':
        return <Hash className="w-4 h-4 text-[#9B9EAC] flex-shrink-0" />;
      case 'voice':
        return <Volume2 className="w-4 h-4 text-[#9B9EAC] flex-shrink-0" />;
      case 'announcement':
        return <Megaphone className="w-4 h-4 text-[#9B9EAC] flex-shrink-0" />;
      case 'forum':
        return <MessageSquareText className="w-4 h-4 text-[#9B9EAC] flex-shrink-0" />;
      case 'stage':
        return <Radio className="w-4 h-4 text-[#EF4444] animate-pulse flex-shrink-0" />;
    }
  };

  return (
    <nav
      className="w-60 bg-[#15171E] flex flex-col h-full select-none flex-shrink-0 border-r border-[#1f232f]"
      aria-label="Server Channels"
    >
      {/* Server Header Dropdown */}
      <div className="relative border-b border-[#202430]">
        <button
          onClick={() => setIsServerMenuOpen(!isServerMenuOpen)}
          aria-label={`${activeServer.name} server options`}
          aria-expanded={isServerMenuOpen}
          className="w-full h-12 px-4 flex items-center justify-between font-bold text-sm text-[#F4F5FA] hover:bg-[#1a1d26] transition-colors"
        >
          <div className="flex items-center gap-2 truncate">
            {activeServer.verified && (
              <span className="text-[#35C98B] flex-shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
            )}
            <span className="truncate">{activeServer.name}</span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[#9B9EAC] transition-transform duration-200 ${
              isServerMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Server Level Bar from Screenshot 8 */}
        <div className="px-3 pb-2 pt-0.5">
          <div className="flex items-center justify-between text-[10px] text-[#9B9EAC] mb-1 font-semibold">
            <span className="text-[#EAB308] font-bold">Lv. 3</span>
            <span>682 / 1,000 XP</span>
          </div>
          <div className="w-full h-1.5 bg-[#202430] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#7667F7] to-[#35C98B] rounded-full w-[68%]" />
          </div>
        </div>

        {/* Server Dropdown Menu */}
        {isServerMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setIsServerMenuOpen(false)}
            />
            <div className="absolute top-12 left-2 right-2 bg-[#191C24] border border-[#2b303e] rounded-xl shadow-2xl p-1.5 z-40 space-y-0.5 text-xs font-medium">
              <button
                onClick={() => {
                  setIsServerMenuOpen(false);
                  openModal('server-settings');
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[#F4F5FA] hover:bg-[#7667F7] hover:text-white transition-colors"
              >
                <span>Server Settings</span>
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setIsServerMenuOpen(false);
                  openModal('create-channel');
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[#F4F5FA] hover:bg-[#7667F7] hover:text-white transition-colors"
              >
                <span>Create Channel</span>
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setIsServerMenuOpen(false);
                  navigator.clipboard?.writeText?.(
                    `https://nexora.app/invite/${activeServer.invites[0]?.code || 'apex'}`
                  );
                  alert('Invite link copied to clipboard!');
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[#7667F7] hover:bg-[#7667F7] hover:text-white transition-colors"
              >
                <span>Invite People</span>
                <UserPlus className="w-3.5 h-3.5" />
              </button>
              <div className="h-[1px] bg-[#282d3b] my-1" />
              <button
                onClick={() => {
                  setIsServerMenuOpen(false);
                  if (confirm(`Are you sure you want to leave ${activeServer.name}?`)) {
                    // Switch to next server
                  }
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[#EF4444] hover:bg-[#EF4444] hover:text-white transition-colors"
              >
                <span>Leave Server</span>
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Live Event Banner Widget */}
      {liveEvent && (
        <div className="m-2 p-2.5 rounded-xl bg-gradient-to-r from-[#7667F7]/20 to-[#35C98B]/20 border border-[#7667F7]/40">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#EF4444] uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-ping" />
              Live Stage
            </span>
            <span className="text-[10px] text-[#9B9EAC]">
              {liveEvent.interestedCount} attending
            </span>
          </div>
          <p className="text-xs font-semibold text-white truncate">
            {liveEvent.title}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => {
                if (liveEvent.channelId) {
                  joinVoiceChannel(activeServer.id, liveEvent.channelId);
                  setActiveChannelId(liveEvent.channelId);
                }
              }}
              className="flex-1 py-1 px-2 rounded-lg bg-[#7667F7] hover:bg-[#6353f4] text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-colors"
            >
              <RadioTower className="w-3 h-3" />
              Join Stage
            </button>
            <button
              onClick={() => toggleEventInterested(liveEvent.id)}
              className={`py-1 px-2 rounded-lg text-[11px] font-semibold border transition-colors ${
                liveEvent.isInterested
                  ? 'bg-[#35C98B]/20 text-[#35C98B] border-[#35C98B]/50'
                  : 'bg-[#191C24] text-[#9B9EAC] border-[#2b303e] hover:text-white'
              }`}
            >
              {liveEvent.isInterested ? '★ RSVP' : 'Interested'}
            </button>
          </div>
        </div>
      )}

      {/* Channels List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {activeServer.categories.map(category => {
          const isCollapsed = collapsedCategories[category.id];

          return (
            <div key={category.id} className="space-y-0.5">
              {/* Category Header */}
              <div className="flex items-center justify-between px-2 py-1 group cursor-pointer text-[#9B9EAC] hover:text-white transition-colors">
                <button
                  onClick={() => toggleCategoryCollapse(category.id)}
                  aria-expanded={!isCollapsed}
                  className="flex items-center gap-1 text-[11px] font-bold tracking-wider uppercase truncate"
                >
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-200 ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                  <span>{category.name}</span>
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    openModal('create-channel');
                  }}
                  aria-label={`Create channel in ${category.name}`}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-white transition-opacity"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Channels in Category */}
              {!isCollapsed && (
                <div className="space-y-[2px]">
                  {category.channelIds.map(channelId => {
                    const channel = channels[channelId];
                    if (!channel) return null;

                    const isActive = activeChannelId === channel.id;
                    const isVoiceChannel =
                      channel.type === 'voice' || channel.type === 'stage';
                    const isVoiceConnectedHere =
                      voiceSession?.channelId === channel.id;

                    return (
                      <div
                        key={channel.id}
                        className={`group relative flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-all ${
                          isActive
                            ? 'bg-[#252936] text-white font-semibold'
                            : 'text-[#9B9EAC] hover:bg-[#1c202a] hover:text-[#d3d6e2]'
                        }`}
                        onClick={() => {
                          setActiveChannelId(channel.id);
                          if (isVoiceChannel && !isVoiceConnectedHere) {
                            joinVoiceChannel(activeServer.id, channel.id);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {getChannelIcon(channel.type)}
                          <span className="text-xs truncate">{channel.name}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {channel.unreadCount ? (
                            <span className="bg-[#7667F7] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                              {channel.unreadCount}
                            </span>
                          ) : null}

                          {isVoiceConnectedHere && (
                            <span className="w-2 h-2 rounded-full bg-[#35C98B] animate-pulse" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Voice Connected Box (When Active in Voice) */}
      {voiceSession && (
        <div className="p-2.5 mx-2 mb-2 rounded-xl bg-[#191C24] border border-[#262A36] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#35C98B] animate-ping" />
              <div>
                <p className="text-[11px] font-bold text-[#35C98B] leading-none">
                  Voice Connected
                </p>
                <p className="text-[10px] text-[#9B9EAC] truncate">
                  {voiceSession.channelName} / RTC 19ms
                </p>
              </div>
            </div>
            <button
              onClick={leaveVoiceChannel}
              aria-label="Disconnect Voice"
              className="p-1.5 text-[#EF4444] hover:bg-[#EF4444]/20 rounded-lg transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom User Control Panel */}
      <div className="h-[56px] px-2 bg-[#111318] flex items-center justify-between border-t border-[#1e222e]">
        {/* User Card trigger */}
        <button
          onClick={() => setSelectedUserProfile(currentUser)}
          aria-label="View profile"
          className="flex items-center gap-2 p-1 rounded-lg hover:bg-[#1a1d26] transition-colors truncate max-w-[130px]"
        >
          <div className="relative flex-shrink-0">
            <img
              src={currentUser.avatar}
              alt={currentUser.displayName}
              className="w-8 h-8 rounded-full object-cover"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#111318] ${
                currentUser.status === 'online'
                  ? 'bg-[#35C98B]'
                  : currentUser.status === 'idle'
                  ? 'bg-[#F59E0B]'
                  : currentUser.status === 'dnd'
                  ? 'bg-[#EF4444]'
                  : 'bg-[#6B7280]'
              }`}
            />
          </div>
          <div className="text-left truncate">
            <p className="text-xs font-bold text-[#F4F5FA] truncate leading-tight">
              {currentUser.displayName}
            </p>
            <p className="text-[10px] text-[#9B9EAC] truncate leading-none">
              @{currentUser.username}
            </p>
          </div>
        </button>

        {/* Audio & Settings Buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            className={`p-1.5 rounded-lg transition-colors ${
              isMuted
                ? 'text-[#EF4444] hover:bg-[#EF4444]/20'
                : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-[#F4F5FA]'
            }`}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleDeafen}
            aria-label={isDeafened ? 'Undeafen Audio' : 'Deafen Audio'}
            className={`p-1.5 rounded-lg transition-colors ${
              isDeafened
                ? 'text-[#EF4444] hover:bg-[#EF4444]/20'
                : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-[#F4F5FA]'
            }`}
          >
            <Headphones className="w-4 h-4" />
          </button>

          <button
            onClick={() => openModal('user-settings')}
            aria-label="User Settings"
            className="p-1.5 rounded-lg text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-[#F4F5FA] transition-colors"
            title="User Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={() => logoutUser()}
            aria-label="Log Out"
            className="p-1.5 rounded-lg text-[#9B9EAC] hover:bg-[#EF4444]/20 hover:text-[#EF4444] transition-colors"
            title="Log Out / Switch Account"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  );
};
