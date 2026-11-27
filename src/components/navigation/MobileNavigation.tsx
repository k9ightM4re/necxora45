import React from 'react';
import { useNexora } from '../../context/NexoraContext';
import { MessageSquare, Compass, Bell, User, Server } from 'lucide-react';

export const MobileNavigation: React.FC = () => {
  const {
    activeServerId,
    setActiveServerId,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    openModal,
    currentUser,
  } = useNexora();

  return (
    <nav
      className="md:hidden h-14 bg-[#111318] border-t border-[#1e222e] flex items-center justify-around px-2 z-30 select-none flex-shrink-0"
      aria-label="Mobile bottom navigation"
    >
      <button
        onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        aria-label="Toggle Server Drawer"
        className={`flex flex-col items-center gap-1 p-1.5 rounded-xl ${
          isMobileSidebarOpen ? 'text-[#7667F7]' : 'text-[#9B9EAC]'
        }`}
      >
        <Server className="w-5 h-5" />
        <span className="text-[10px] font-bold">Servers</span>
      </button>

      <button
        onClick={() => setActiveServerId(null)}
        aria-label="Direct Messages"
        className={`flex flex-col items-center gap-1 p-1.5 rounded-xl ${
          activeServerId === null ? 'text-[#7667F7]' : 'text-[#9B9EAC]'
        }`}
      >
        <MessageSquare className="w-5 h-5" />
        <span className="text-[10px] font-bold">Messages</span>
      </button>

      <button
        onClick={() => openModal('discovery')}
        aria-label="Discover Communities"
        className="flex flex-col items-center gap-1 p-1.5 text-[#9B9EAC] hover:text-white"
      >
        <Compass className="w-5 h-5" />
        <span className="text-[10px] font-bold">Discover</span>
      </button>

      <button
        onClick={() => openModal('user-settings')}
        aria-label="My Profile and Settings"
        className="flex flex-col items-center gap-1 p-1.5 text-[#9B9EAC] hover:text-white"
      >
        <img
          src={currentUser.avatar}
          alt={currentUser.displayName}
          className="w-5 h-5 rounded-full object-cover"
        />
        <span className="text-[10px] font-bold">You</span>
      </button>
    </nav>
  );
};
