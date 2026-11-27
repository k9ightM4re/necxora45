import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  X,
  Shield,
  Sliders,
  Users,
  Link,
  History,
  Trash2,
  Check,
  Plus,
} from 'lucide-react';
import { Role, RolePermissions } from '../../types';

export const ServerSettingsModal: React.FC = () => {
  const {
    activeModal,
    closeModal,
    activeServer,
    updateServer,
    deleteServer,
    auditLogs,
  } = useNexora();

  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'invites' | 'audit'>('roles');
  const [selectedRoleId, setSelectedRoleId] = useState<string>('role-admin');
  const [localRoles, setLocalRoles] = useState<Role[]>(() => activeServer?.roles || []);
  const [serverNameInput, setServerNameInput] = useState(activeServer?.name || '');
  const [serverDescInput, setServerDescInput] = useState(activeServer?.description || '');
  const [isCopied, setIsCopied] = useState(false);

  if (activeModal !== 'server-settings' || !activeServer) return null;

  const currentRole = localRoles.find(r => r.id === selectedRoleId) || localRoles[0];

  const handleTogglePermission = (key: keyof RolePermissions) => {
    if (!currentRole) return;
    const updatedRoles = localRoles.map(r => {
      if (r.id !== currentRole.id) return r;
      return {
        ...r,
        permissions: {
          ...r.permissions,
          [key]: !r.permissions[key],
        },
      };
    });
    setLocalRoles(updatedRoles);
    updateServer(activeServer.id, { roles: updatedRoles });
  };

  const handleSaveOverview = (e: React.FormEvent) => {
    e.preventDefault();
    updateServer(activeServer.id, {
      name: serverNameInput,
      description: serverDescInput,
    });
    alert('Server settings saved successfully!');
  };

  const permissionItems: { key: keyof RolePermissions; label: string; desc: string }[] = [
    {
      key: 'administrator',
      label: 'Administrator',
      desc: 'Grants all permissions. Members with this role can bypass channel-specific permissions.',
    },
    {
      key: 'viewChannels',
      label: 'View Channels',
      desc: 'Allows members to view channels by default (excluding private channels).',
    },
    {
      key: 'sendMessages',
      label: 'Send Messages',
      desc: 'Allows members to talk in text channels.',
    },
    {
      key: 'manageMessages',
      label: 'Manage Messages',
      desc: 'Allows members to delete messages by other members or pin any message.',
    },
    {
      key: 'manageChannels',
      label: 'Manage Channels',
      desc: 'Allows members to create, edit, or delete channels.',
    },
    {
      key: 'manageRoles',
      label: 'Manage Roles',
      desc: 'Allows members to create new roles and edit or delete roles lower than their own.',
    },
    {
      key: 'kickMembers',
      label: 'Kick Members',
      desc: 'Allows members to remove other members from this server.',
    },
    {
      key: 'banMembers',
      label: 'Ban Members',
      desc: 'Allows members to permanently ban other members from this server.',
    },
    {
      key: 'connectVoice',
      label: 'Connect to Voice',
      desc: 'Allows members to join and listen in voice rooms.',
    },
    {
      key: 'speakVoice',
      label: 'Speak in Voice',
      desc: 'Allows members to talk in voice channels.',
    },
    {
      key: 'manageEvents',
      label: 'Manage Events',
      desc: 'Allows members to create, edit, or cancel scheduled community events.',
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#191C24] border border-[#2b303d] rounded-3xl w-full max-w-4xl h-[600px] flex overflow-hidden shadow-2xl relative select-none">
        {/* Left Sidebar Menu */}
        <aside
          className="w-56 bg-[#111318] p-4 border-r border-[#262A36] flex flex-col justify-between"
          aria-label="Server settings navigation"
        >
          <div className="space-y-1">
            <h3 className="px-3 mb-2 text-xs font-extrabold text-[#717585] uppercase tracking-wider">
              {activeServer.name}
            </h3>

            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                activeTab === 'overview'
                  ? 'bg-[#252936] text-white'
                  : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('roles')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                activeTab === 'roles'
                  ? 'bg-[#252936] text-white'
                  : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4 text-[#7667F7]" />
              <span>Roles & Permissions</span>
            </button>

            <button
              onClick={() => setActiveTab('invites')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                activeTab === 'invites'
                  ? 'bg-[#252936] text-white'
                  : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
              }`}
            >
              <Link className="w-4 h-4" />
              <span>Invites</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                activeTab === 'audit'
                  ? 'bg-[#252936] text-white'
                  : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Audit Log</span>
            </button>
          </div>

          <button
            onClick={() => {
              if (confirm(`Are you sure you want to delete ${activeServer.name}? This action cannot be undone.`)) {
                deleteServer(activeServer.id);
                closeModal();
              }
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Server</span>
          </button>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#191C24]">
          {/* Top Bar with ESC */}
          <div className="h-14 px-6 border-b border-[#262A36] flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              {activeTab === 'roles'
                ? `Edit Role — ${currentRole?.name}`
                : activeTab === 'overview'
                ? 'Server Overview'
                : activeTab === 'invites'
                ? 'Active Invites'
                : 'Moderation Audit Log'}
            </h2>
            <button
              onClick={closeModal}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#303646] text-xs font-semibold text-[#9B9EAC] hover:text-white"
            >
              <span>ESC</span>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'roles' && currentRole && (
              <div className="flex gap-6 h-full">
                {/* Roles Selector Column */}
                <div className="w-44 border-r border-[#262A36] pr-4 space-y-1">
                  <span className="text-[10px] font-bold text-[#717585] uppercase tracking-wider block mb-2">
                    ROLES ({localRoles.length})
                  </span>
                  {localRoles.map(role => (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRoleId(role.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-bold transition-all text-left ${
                        selectedRoleId === role.id
                          ? 'bg-[#252936] text-white'
                          : 'text-[#9B9EAC] hover:bg-[#1e222d] hover:text-white'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: role.color }}
                      />
                      <span className="truncate">{role.name}</span>
                    </button>
                  ))}
                </div>

                {/* Permissions Matrix Column */}
                <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                  <div className="p-3 bg-[#111318] rounded-2xl border border-[#262A36] flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white">Role Name</p>
                      <p className="text-[11px] text-[#9B9EAC]">{currentRole.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#9B9EAC]">Role Color:</span>
                      <span
                        className="w-5 h-5 rounded-md border border-white/20"
                        style={{ backgroundColor: currentRole.color }}
                      />
                    </div>
                  </div>

                  <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider pt-2">
                    GENERAL SERVER PERMISSIONS
                  </h3>

                  <div className="space-y-3">
                    {permissionItems.map(p => {
                      const isEnabled = Boolean(
                        currentRole.permissions.administrator ||
                        currentRole.permissions[p.key]
                      );

                      return (
                        <div
                          key={p.key}
                          className="flex items-center justify-between p-3 rounded-2xl bg-[#111318] border border-[#262A36]"
                        >
                          <div className="space-y-0.5 max-w-md">
                            <p className="text-xs font-bold text-white">{p.label}</p>
                            <p className="text-[11px] text-[#9B9EAC]">{p.desc}</p>
                          </div>

                          {/* Toggle Switch */}
                          <button
                            type="button"
                            onClick={() => handleTogglePermission(p.key)}
                            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 flex-shrink-0 ${
                              isEnabled ? 'bg-[#35C98B]' : 'bg-[#373c4d]'
                            }`}
                          >
                            <span
                              className={`w-5 h-5 rounded-full bg-white shadow-md block transition-transform duration-200 ${
                                isEnabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'overview' && (
              <form onSubmit={handleSaveOverview} className="max-w-lg space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#9B9EAC] uppercase mb-1">
                    SERVER NAME
                  </label>
                  <input
                    type="text"
                    value={serverNameInput}
                    onChange={e => setServerNameInput(e.target.value)}
                    className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#9B9EAC] uppercase mb-1">
                    SERVER DESCRIPTION
                  </label>
                  <textarea
                    rows={3}
                    value={serverDescInput}
                    onChange={e => setServerDescInput(e.target.value)}
                    className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="px-5 py-2 bg-[#7667F7] hover:bg-[#6353f4] text-xs font-bold text-white rounded-xl shadow-lg shadow-[#7667F7]/30 transition-all"
                >
                  Save Changes
                </button>
              </form>
            )}

            {activeTab === 'invites' && (
              <div className="space-y-4">
                <p className="text-xs text-[#9B9EAC]">
                  Here is a list of all active invite links. You can copy or revoke them anytime.
                </p>

                <div className="space-y-2">
                  {activeServer.invites.map(inv => (
                    <div
                      key={inv.code}
                      className="p-3 rounded-2xl bg-[#111318] border border-[#262A36] flex items-center justify-between"
                    >
                      <div>
                        <p className="text-xs font-bold text-[#7667F7] font-mono">
                          https://nexora.app/invite/{inv.code}
                        </p>
                        <p className="text-[10px] text-[#9B9EAC] mt-0.5">
                          {inv.uses} uses • Never expires
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText?.(
                            `https://nexora.app/invite/${inv.code}`
                          );
                          setIsCopied(true);
                          setTimeout(() => setIsCopied(false), 2000);
                        }}
                        className="px-3 py-1.5 bg-[#7667F7] hover:bg-[#6353f4] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : null}
                        <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="space-y-2">
                {auditLogs.map(log => (
                  <div
                    key={log.id}
                    className="p-3 rounded-2xl bg-[#111318] border border-[#262A36] flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-white">{log.actor}</span>{' '}
                      <span className="text-[#9B9EAC]">{log.action}:</span>{' '}
                      <span className="font-semibold text-[#7667F7]">{log.target}</span>
                      {log.details && (
                        <p className="text-[10px] text-[#717585] mt-0.5">{log.details}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-[#9B9EAC] whitespace-nowrap ml-4">
                      {log.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
