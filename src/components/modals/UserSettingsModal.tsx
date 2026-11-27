import React, { useState } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  X,
  User,
  Shield,
  Volume2,
  Palette,
  Bell,
  LogOut,
  Camera,
  Check,
  Mic,
} from 'lucide-react';

export const UserSettingsModal: React.FC = () => {
  const {
    activeModal,
    closeModal,
    currentUser,
    setCurrentUser,
    logoutUser,
  } = useNexora();

  const [activeTab, setActiveTab] = useState<'account' | 'privacy' | 'voice' | 'appearance'>('account');
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [username, setUsername] = useState(currentUser.username);
  const [customStatus, setCustomStatus] = useState(currentUser.customStatus || '');
  const [bio, setBio] = useState(currentUser.bio || '');
  const [safeMessaging, setSafeMessaging] = useState<'safe' | 'friends' | 'edge'>('safe');
  const [micVolume, setMicVolume] = useState(85);
  const [selectedTheme, setSelectedTheme] = useState<'dark' | 'midnight' | 'light'>('dark');
  const [selectedAccent, setSelectedAccent] = useState('#7667F7');

  if (activeModal !== 'user-settings') return null;

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentUser(prev => ({
      ...prev,
      displayName,
      username,
      customStatus,
      bio,
      accentColor: selectedAccent,
    }));
    alert('User profile updated successfully!');
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#191C24] border border-[#2b303d] rounded-3xl w-full max-w-4xl h-[620px] flex overflow-hidden shadow-2xl relative select-none">
        {/* Left Settings Navigation */}
        <aside
          className="w-56 bg-[#111318] p-4 border-r border-[#262A36] flex flex-col justify-between"
          aria-label="User settings navigation"
        >
          <div className="space-y-4">
            <div>
              <h3 className="px-3 mb-1.5 text-[10px] font-extrabold text-[#717585] uppercase tracking-wider">
                USER SETTINGS
              </h3>
              <div className="space-y-0.5">
                <button
                  onClick={() => setActiveTab('account')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                    activeTab === 'account'
                      ? 'bg-[#252936] text-white'
                      : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span>My Account</span>
                </button>
                <button
                  onClick={() => setActiveTab('privacy')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                    activeTab === 'privacy'
                      ? 'bg-[#252936] text-white'
                      : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
                  }`}
                >
                  <Shield className="w-4 h-4 text-[#35C98B]" />
                  <span>Privacy & Safety</span>
                </button>
              </div>
            </div>

            <div>
              <h3 className="px-3 mb-1.5 text-[10px] font-extrabold text-[#717585] uppercase tracking-wider">
                APP SETTINGS
              </h3>
              <div className="space-y-0.5">
                <button
                  onClick={() => setActiveTab('voice')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                    activeTab === 'voice'
                      ? 'bg-[#252936] text-white'
                      : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
                  }`}
                >
                  <Volume2 className="w-4 h-4 text-[#7667F7]" />
                  <span>Voice & Video</span>
                </button>
                <button
                  onClick={() => setActiveTab('appearance')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                    activeTab === 'appearance'
                      ? 'bg-[#252936] text-white'
                      : 'text-[#9B9EAC] hover:bg-[#1a1d26] hover:text-white'
                  }`}
                >
                  <Palette className="w-4 h-4 text-[#F59E0B]" />
                  <span>Appearance</span>
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              logoutUser();
            }}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold text-[#EF4444] bg-[#EF4444]/10 hover:bg-[#EF4444]/20 border border-[#EF4444]/30 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Log Out of NEXORA</span>
          </button>
        </aside>

        {/* Right Content Panel */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#191C24]">
          {/* Top Bar with ESC */}
          <div className="h-14 px-6 border-b border-[#262A36] flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              {activeTab === 'account'
                ? 'My Account & Profiles'
                : activeTab === 'privacy'
                ? 'Privacy & Safety'
                : activeTab === 'voice'
                ? 'Voice & Video Settings'
                : 'Appearance & Themes'}
            </h2>
            <button
              onClick={closeModal}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#303646] text-xs font-semibold text-[#9B9EAC] hover:text-white"
            >
              <span>ESC</span>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'account' && (
              <form onSubmit={handleSaveAccount} className="max-w-lg space-y-4">
                {/* Banner & Avatar Preview Card */}
                <div className="rounded-2xl bg-[#111318] border border-[#262A36] overflow-hidden">
                  <div
                    className="h-24 bg-gradient-to-r from-[#7667F7] to-[#35C98B] relative"
                    style={{ backgroundColor: selectedAccent }}
                  />
                  <div className="p-4 pt-0 relative flex items-end justify-between">
                    <div className="relative -mt-10">
                      <img
                        src={currentUser.avatar}
                        alt={currentUser.displayName}
                        className="w-18 h-18 rounded-full object-cover ring-4 ring-[#111318]"
                      />
                    </div>
                    <span className="text-xs text-[#9B9EAC] font-semibold">
                      Registered: {currentUser.joinedAt}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#9B9EAC] uppercase mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#9B9EAC] uppercase mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#9B9EAC] uppercase mb-1">
                    Custom Status
                  </label>
                  <input
                    type="text"
                    placeholder="What's on your mind?"
                    value={customStatus}
                    onChange={e => setCustomStatus(e.target.value)}
                    className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#9B9EAC] uppercase mb-1">
                    About Me (Bio)
                  </label>
                  <textarea
                    rows={3}
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    className="w-full bg-[#111318] border border-[#262A36] focus:border-[#7667F7] rounded-xl px-3 py-2 text-xs text-white focus:outline-none resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="px-6 py-2 bg-[#7667F7] hover:bg-[#6353f4] text-xs font-bold text-white rounded-xl shadow-lg shadow-[#7667F7]/30 transition-all"
                >
                  Save Profile Changes
                </button>
              </form>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-6 max-w-lg">
                <div>
                  <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-2">
                    SAFE DIRECT MESSAGING
                  </h3>
                  <p className="text-xs text-[#9B9EAC] mb-4">
                    Automatically scan and protect direct messages you receive.
                  </p>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setSafeMessaging('safe')}
                      className={`w-full p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all ${
                        safeMessaging === 'safe'
                          ? 'bg-[#35C98B]/10 border-[#35C98B]'
                          : 'bg-[#111318] border-[#262A36]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full mt-0.5 border flex items-center justify-center ${
                          safeMessaging === 'safe'
                            ? 'border-[#35C98B] bg-[#35C98B]'
                            : 'border-[#9B9EAC]'
                        }`}
                      >
                        {safeMessaging === 'safe' && (
                          <Check className="w-3 h-3 text-white stroke-[3]" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">Keep me safe</p>
                        <p className="text-[11px] text-[#9B9EAC]">
                          Scan direct messages from everyone.
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSafeMessaging('friends')}
                      className={`w-full p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all ${
                        safeMessaging === 'friends'
                          ? 'bg-[#F59E0B]/10 border-[#F59E0B]'
                          : 'bg-[#111318] border-[#262A36]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full mt-0.5 border flex items-center justify-center ${
                          safeMessaging === 'friends'
                            ? 'border-[#F59E0B] bg-[#F59E0B]'
                            : 'border-[#9B9EAC]'
                        }`}
                      >
                        {safeMessaging === 'friends' && (
                          <Check className="w-3 h-3 text-white stroke-[3]" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">My friends are nice</p>
                        <p className="text-[11px] text-[#9B9EAC]">
                          Scan direct messages from everyone unless they are a friend.
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSafeMessaging('edge')}
                      className={`w-full p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all ${
                        safeMessaging === 'edge'
                          ? 'bg-[#EF4444]/10 border-[#EF4444]'
                          : 'bg-[#111318] border-[#262A36]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full mt-0.5 border flex items-center justify-center ${
                          safeMessaging === 'edge'
                            ? 'border-[#EF4444] bg-[#EF4444]'
                            : 'border-[#9B9EAC]'
                        }`}
                      >
                        {safeMessaging === 'edge' && (
                          <Check className="w-3 h-3 text-white stroke-[3]" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">Do not scan</p>
                        <p className="text-[11px] text-[#9B9EAC]">
                          Turn off automated media scanning.
                        </p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'voice' && (
              <div className="space-y-6 max-w-lg">
                <div>
                  <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-2">
                    VOICE SETTINGS
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                        Input Device
                      </label>
                      <select className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                        <option>Default Microphone (Internal / USB)</option>
                        <option>Studio USB Condenser Mic</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#9B9EAC] mb-1">
                        Output Device
                      </label>
                      <select className="w-full bg-[#111318] border border-[#262A36] rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                        <option>Default Output Speakers / Headphones</option>
                        <option>Studio Monitor Headphones</option>
                      </select>
                    </div>

                    <div className="pt-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-white">Mic Volume</span>
                        <span className="text-[#9B9EAC]">{micVolume}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={micVolume}
                        onChange={e => setMicVolume(Number(e.target.value))}
                        className="w-full accent-[#7667F7]"
                      />
                    </div>

                    {/* Mic Test Simulated Volume Meter */}
                    <div className="p-3 bg-[#111318] rounded-xl border border-[#262A36] space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <Mic className="w-3.5 h-3.5 text-[#35C98B]" />
                          Mic Sensitivity Check
                        </span>
                        <span className="text-[10px] text-[#35C98B] font-bold">Good Level</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[#202430] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#35C98B] to-[#EAB308] rounded-full transition-all duration-300"
                          style={{ width: `${micVolume * 0.8}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-6 max-w-lg">
                <div>
                  <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-3">
                    THEME SELECTION
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'dark', name: 'Dark (Default)', bg: '#111318' },
                      { id: 'midnight', name: 'Midnight AMOLED', bg: '#0b0c10' },
                      { id: 'light', name: 'Charcoal Minimal', bg: '#1c1f28' },
                    ].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTheme(t.id as any)}
                        className={`p-3 rounded-2xl border text-center transition-all ${
                          selectedTheme === t.id
                            ? 'border-[#7667F7] ring-2 ring-[#7667F7]/30'
                            : 'border-[#262A36]'
                        }`}
                        style={{ backgroundColor: t.bg }}
                      >
                        <p className="text-xs font-bold text-white">{t.name}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider mb-3">
                    ACCENT COLOR
                  </h3>
                  <div className="flex items-center gap-3">
                    {[
                      { hex: '#7667F7', label: 'Nexora Indigo' },
                      { hex: '#35C98B', label: 'Emerald' },
                      { hex: '#EF4444', label: 'Crimson' },
                      { hex: '#F59E0B', label: 'Amber' },
                      { hex: '#3B82F6', label: 'Cyber Blue' },
                    ].map(c => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setSelectedAccent(c.hex)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform ${
                          selectedAccent === c.hex ? 'scale-110 ring-2 ring-white' : ''
                        }`}
                        style={{ backgroundColor: c.hex }}
                      >
                        {selectedAccent === c.hex && (
                          <Check className="w-4 h-4 text-white stroke-[3]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
