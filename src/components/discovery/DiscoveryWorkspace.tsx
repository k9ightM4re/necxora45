import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  Compass,
  Search,
  Users,
  Sparkles,
  ArrowRight,
  Gamepad2,
  Music,
  GraduationCap,
  Cpu,
  Palette,
  Film,
  Check,
} from 'lucide-react';
import { filterDiscoveryServers } from '../../utils/rules';
import { Server } from '../../types';

export const DiscoveryWorkspace: React.FC = () => {
  const { discoveryServers, joinDiscoveryServer, servers } = useNexora();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const categories = [
    { name: 'All', icon: <Compass className="w-4 h-4" /> },
    { name: 'Gaming', icon: <Gamepad2 className="w-4 h-4" /> },
    { name: 'Music', icon: <Music className="w-4 h-4" /> },
    { name: 'Education', icon: <GraduationCap className="w-4 h-4" /> },
    { name: 'Science & Tech', icon: <Cpu className="w-4 h-4" /> },
    { name: 'Creative', icon: <Palette className="w-4 h-4" /> },
    { name: 'Entertainment', icon: <Film className="w-4 h-4" /> },
  ];

  const filteredServers = filterDiscoveryServers(
    discoveryServers,
    searchQuery,
    selectedCategory
  );

  return (
    <div
      className="flex-1 flex flex-col h-full bg-[#111318] overflow-y-auto select-none"
      aria-label="Community Discovery Hub"
    >
      {/* Top Hero Banner */}
      <div className="relative mx-4 md:mx-8 mt-6 rounded-3xl overflow-hidden p-6 md:p-12 bg-gradient-to-br from-[#7667F7]/40 via-[#191C24] to-[#35C98B]/20 border border-[#2b303e] shadow-2xl flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7667F7]/20 border border-[#7667F7]/40 text-[#7667F7] text-xs font-bold uppercase tracking-wider mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          Discover Hubs
        </div>

        <h1 className="text-2xl md:text-4xl font-extrabold text-white max-w-xl mb-3 tracking-tight">
          Find your community on NEXORA
        </h1>
        <p className="text-xs md:text-sm text-[#9B9EAC] max-w-md mb-6">
          From gaming, to music, to coding, to learning—there is a place for you to connect and belong.
        </p>

        {/* Central Search Bar */}
        <div className="relative w-full max-w-lg">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Explore communities by name, topic, or tags..."
            className="w-full h-12 bg-[#111318]/90 backdrop-blur-md border border-[#262A36] focus:border-[#7667F7] rounded-2xl px-4 pl-11 text-xs md:text-sm text-white placeholder-[#717585] focus:outline-none shadow-xl transition-all"
          />
          <Search className="w-5 h-5 text-[#717585] absolute left-3.5 top-3.5" />
        </div>
      </div>

      {/* Category Pills Bar */}
      <div className="px-4 md:px-8 mt-6 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {categories.map(cat => (
          <button
            key={cat.name}
            onClick={() => setSelectedCategory(cat.name)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              selectedCategory === cat.name
                ? 'bg-[#7667F7] text-white shadow-lg shadow-[#7667F7]/30'
                : 'bg-[#191C24] text-[#9B9EAC] hover:bg-[#20242f] hover:text-white border border-[#262A36]'
            }`}
          >
            {cat.icon}
            <span>{cat.name}</span>
          </button>
        ))}
      </div>

      {/* Communities Grid */}
      <div className="px-4 md:px-8 py-6">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
          Popular Communities ({filteredServers.length})
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredServers.map(server => {
            const isAlreadyMember = servers.some(s => s.id === server.id);

            return (
              <div
                key={server.id}
                className="group flex flex-col rounded-2xl bg-[#191C24] border border-[#262A36] hover:border-[#7667F7] overflow-hidden transition-all duration-200 hover:-translate-y-1 shadow-xl"
              >
                {/* Server Banner */}
                <div className="h-28 relative overflow-hidden bg-[#252936]">
                  {server.banner && (
                    <img
                      src={server.banner}
                      alt={server.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  )}
                  {/* Floating Icon */}
                  <div className="absolute -bottom-3 left-4">
                    <img
                      src={server.icon}
                      alt={server.name}
                      className="w-12 h-12 rounded-2xl object-cover ring-4 ring-[#191C24] shadow-md"
                    />
                  </div>
                </div>

                {/* Card Details */}
                <div className="p-4 pt-5 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <h3 className="text-sm font-bold text-white truncate">
                        {server.name}
                      </h3>
                      {server.verified && (
                        <span className="text-[#35C98B] flex-shrink-0">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#9B9EAC] line-clamp-2 mb-3">
                      {server.description}
                    </p>
                  </div>

                  <div>
                    {/* Member Stats */}
                    <div className="flex items-center gap-3 text-[11px] text-[#9B9EAC] mb-3">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#35C98B]" />
                        {Math.floor(server.membersCount * 0.28).toLocaleString()} Online
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#6B7280]" />
                        {server.membersCount.toLocaleString()} Members
                      </span>
                    </div>

                    {/* Join / Visit Button */}
                    <button
                      onClick={() => joinDiscoveryServer(server)}
                      className={`w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        isAlreadyMember
                          ? 'bg-[#252936] text-[#35C98B] hover:bg-[#35C98B] hover:text-white'
                          : 'bg-[#7667F7] text-white hover:bg-[#6252f5] shadow-md shadow-[#7667F7]/20'
                      }`}
                    >
                      <span>{isAlreadyMember ? 'Joined (Open Server)' : 'Join Community'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
