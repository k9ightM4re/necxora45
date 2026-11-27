import React from 'react';
import { NexoraProvider, useNexora } from './context/NexoraContext';
import { ServerSidebar } from './components/navigation/ServerSidebar';
import { ChannelSidebar } from './components/navigation/ChannelSidebar';
import { ChatWorkspace } from './components/chat/ChatWorkspace';
import { VoiceRoomView } from './components/voice/VoiceRoomView';
import { ForumWorkspace } from './components/forum/ForumWorkspace';
import { FriendsWorkspace } from './components/friends/FriendsWorkspace';
import { MemberList } from './components/members/MemberList';
import { DiscoveryWorkspace } from './components/discovery/DiscoveryWorkspace';
import { MobileNavigation } from './components/navigation/MobileNavigation';

// Modals
import { CreateServerModal } from './components/modals/CreateServerModal';
import { ServerSettingsModal } from './components/modals/ServerSettingsModal';
import { UserSettingsModal } from './components/modals/UserSettingsModal';
import { CreateMemberModal } from './components/modals/CreateMemberModal';
import { UserProfileCard } from './components/modals/UserProfileCard';
import { CreateChannelModal } from './components/modals/CreateChannelModal';
import { AuthModal } from './components/modals/AuthModal';
import { WorkspaceHubModal } from './components/workspace/WorkspaceHubModal';

import { X } from 'lucide-react';

const NexoraAppContent: React.FC = () => {
  const {
    activeServerId,
    activeChannel,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    activeModal,
    closeModal,
  } = useNexora();

  const isVoiceOrStageChannel =
    activeChannel &&
    (activeChannel.type === 'voice' || activeChannel.type === 'stage');

  const isForumChannel = activeChannel && activeChannel.type === 'forum';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#111318] text-[#F4F5FA] font-sans antialiased">
      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Server Navigation Rail (Desktop) */}
        <div className="hidden md:flex">
          <ServerSidebar />
        </div>

        {/* Mobile Server Drawer Overlay */}
        {isMobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setIsMobileSidebarOpen(false)}
            />
            <div className="relative z-50 flex h-full">
              <ServerSidebar />
              {activeServerId !== null && <ChannelSidebar />}
            </div>
          </div>
        )}

        {/* Content View Routing */}
        {activeServerId === null ? (
          /* Direct Messages & Friends Workspace */
          <FriendsWorkspace />
        ) : (
          /* Server View (Channels Sidebar + Main Content + Member List) */
          <div className="flex-1 flex overflow-hidden">
            {/* Channels Sidebar (Desktop) */}
            <div className="hidden md:flex">
              <ChannelSidebar />
            </div>

            {/* Main Stage / Chat / Forum Center Area */}
            <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
              {isVoiceOrStageChannel ? (
                <VoiceRoomView />
              ) : isForumChannel ? (
                <ForumWorkspace />
              ) : (
                <ChatWorkspace />
              )}
            </div>

            {/* Members List (Desktop) */}
            <div className="hidden lg:flex">
              {!isVoiceOrStageChannel && <MemberList />}
            </div>
          </div>
        )}
      </div>

      {/* Community Discovery Overlay Modal */}
      {activeModal === 'discovery' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex flex-col">
          <div className="h-14 px-6 border-b border-[#262A36] bg-[#111318] flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              NEXORA Community Discovery
            </h2>
            <button
              onClick={closeModal}
              className="p-2 text-[#9B9EAC] hover:text-white rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <DiscoveryWorkspace />
          </div>
        </div>
      )}

      {/* Modal Dialogs */}
      <WorkspaceHubModal />
      <CreateServerModal />
      <ServerSettingsModal />
      <UserSettingsModal />
      <CreateMemberModal />
      <UserProfileCard />
      <CreateChannelModal />
      <AuthModal />

      {/* Mobile Responsive Bottom Navigation */}
      <MobileNavigation />
    </div>
  );
};

export default function App() {
  return (
    <NexoraProvider>
      <NexoraAppContent />
    </NexoraProvider>
  );
}
