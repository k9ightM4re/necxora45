import React from 'react';
import { useNexora } from '../../context/NexoraContext';
import { Plus, Compass, MessageSquare } from 'lucide-react';

export const ServerSidebar: React.FC = () => {
  const {
    servers,
    activeServerId,
    setActiveServerId,
    openModal,
  } = useNexora();

  return (
    <aside
      className="w-[72px] bg-[#111318] flex flex-col items-center py-3 select-none flex-shrink-0 z-20 border-r border-[#1e222d]"
      aria-label="Server navigation rail"
    >
      {/* Home / Direct Messages button */}
      <div className="relative group flex items-center justify-center w-full mb-2">
        {/* Active Pill Indicator */}
        <div
          className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
            activeServerId === null
              ? 'h-10 opacity-100'
              : 'h-0 group-hover:h-5 opacity-0 group-hover:opacity-100'
          }`}
        />
        <button
          onClick={() => setActiveServerId(null)}
          aria-label="Home and Direct Messages"
          className={`w-12 h-12 flex items-center justify-center transition-all duration-200 relative group-hover:rounded-2xl ${
            activeServerId === null
              ? 'bg-[#7667F7] text-white rounded-2xl shadow-lg shadow-[#7667F7]/30'
              : 'bg-[#191C24] text-[#9B9EAC] hover:bg-[#7667F7] hover:text-white rounded-[24px]'
          }`}
        >
          {/* Nexora stylized logo icon */}
          <div className="flex items-center justify-center">
            <svg
              className="w-7 h-7"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 3.3L18.4 9 12 12.6 5.6 9 12 5.3zm-7 5.2l6 3.5v6.7l-6-3.4V10.5zm8 10.2v-6.7l6-3.5v6.8l-6 3.4z" />
            </svg>
          </div>
          {/* Notification badge */}
          <span className="absolute -top-1 -right-1 bg-[#EF4444] text-white text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-[#111318]">
            1
          </span>
        </button>
      </div>

      {/* Divider */}
      <div className="w-8 h-[2px] bg-[#262A36] rounded my-1.5" />

      {/* Server icons list */}
      <div className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-2 py-1 scrollbar-none">
        {servers.map(server => {
          const isActive = activeServerId === server.id;
          const hasUnread = server.id === 'srv-apex';

          return (
            <div
              key={server.id}
              className="relative group flex items-center justify-center w-full"
            >
              {/* Active / Unread Pill */}
              <div
                className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
                  isActive
                    ? 'h-10 opacity-100'
                    : hasUnread
                    ? 'h-2 opacity-100 group-hover:h-5'
                    : 'h-0 group-hover:h-5 opacity-0 group-hover:opacity-100'
                }`}
              />

              <button
                onClick={() => setActiveServerId(server.id)}
                aria-label={server.name}
                className={`relative w-12 h-12 flex items-center justify-center overflow-hidden transition-all duration-200 ${
                  isActive
                    ? 'rounded-2xl ring-2 ring-[#7667F7] shadow-md shadow-[#7667F7]/20'
                    : 'rounded-[24px] hover:rounded-2xl hover:bg-[#7667F7]'
                } bg-[#191C24]`}
              >
                {server.icon ? (
                  <img
                    src={server.icon}
                    alt={server.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-bold text-white tracking-wider">
                    {server.name
                      .split(' ')
                      .map(w => w[0])
                      .join('')
                      .slice(0, 3)}
                  </span>
                )}

                {hasUnread && !isActive && (
                  <span className="absolute -bottom-1 -right-1 bg-[#7667F7] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-[#111318]">
                    3
                  </span>
                )}
              </button>

              {/* Tooltip */}
              <div className="absolute left-[76px] px-3 py-1.5 bg-[#191C24] text-white text-xs font-semibold rounded-lg shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border border-[#2b303e]">
                {server.name}
              </div>
            </div>
          );
        })}

        {/* Add Server Button */}
        <div className="relative group flex items-center justify-center w-full mt-1">
          <button
            onClick={() => openModal('create-server')}
            aria-label="Add a Server"
            className="w-12 h-12 rounded-[24px] hover:rounded-2xl bg-[#191C24] text-[#35C98B] hover:bg-[#35C98B] hover:text-white flex items-center justify-center transition-all duration-200 group-hover:shadow-md group-hover:shadow-[#35C98B]/20"
          >
            <Plus className="w-6 h-6" />
          </button>
          <div className="absolute left-[76px] px-3 py-1.5 bg-[#191C24] text-white text-xs font-semibold rounded-lg shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border border-[#2b303e]">
            Add a Server
          </div>
        </div>

        {/* Explore / Discover Hubs Button */}
        <div className="relative group flex items-center justify-center w-full">
          <button
            onClick={() => openModal('discovery')}
            aria-label="Discover Communities"
            className="w-12 h-12 rounded-[24px] hover:rounded-2xl bg-[#191C24] text-[#7667F7] hover:bg-[#7667F7] hover:text-white flex items-center justify-center transition-all duration-200 group-hover:shadow-md group-hover:shadow-[#7667F7]/20"
          >
            <Compass className="w-6 h-6" />
          </button>
          <div className="absolute left-[76px] px-3 py-1.5 bg-[#191C24] text-white text-xs font-semibold rounded-lg shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border border-[#2b303e]">
            Discover Communities
          </div>
        </div>
      </div>

      {/* Google Workspace Hub */}
      <div className="pt-2 border-t border-[#262A36] w-full flex flex-col items-center gap-2">
        <div className="relative group flex items-center justify-center">
          <button
            onClick={() => openModal('workspace')}
            aria-label="Google Workspace Hub"
            className="w-11 h-11 rounded-[22px] hover:rounded-xl bg-[#191C24] text-[#4285F4] hover:bg-[#4285F4] hover:text-white flex items-center justify-center transition-all duration-200 shadow-md group-hover:shadow-[#4285F4]/30"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <div className="absolute left-[76px] px-3 py-1.5 bg-[#191C24] text-white text-xs font-semibold rounded-lg shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border border-[#2b303e]">
            Google Workspace (Gmail, Chat, Contacts)
          </div>
        </div>
      </div>
    </aside>
  );
};
