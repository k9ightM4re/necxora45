import React, { useState, useRef, useEffect } from 'react';
import { useNexora } from '../../context/NexoraContext';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  PhoneOff,
  Radio,
  RadioTower,
  Volume2,
  Users,
  Hand,
  Sparkles,
  Music,
  Share2,
  Maximize2,
  Settings,
} from 'lucide-react';
import { VoiceParticipant } from '../../types';

export const VoiceRoomView: React.FC = () => {
  const {
    activeChannel,
    activeServer,
    voiceSession,
    voiceParticipants,
    leaveVoiceChannel,
    isMuted,
    isDeafened,
    isVideoOn,
    isScreenSharing,
    toggleMute,
    toggleDeafen,
    toggleVideo,
    toggleScreenShare,
    setSelectedUserProfile,
    currentUser,
  } = useNexora();

  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isSoundboardOpen, setIsSoundboardOpen] = useState(false);
  const [soundboardAlert, setSoundboardAlert] = useState<string | null>(null);
  const [activeLayout, setActiveLayout] = useState<'grid' | 'focus'>('grid');

  const videoRef = useRef<HTMLVideoElement>(null);

  // If user toggles camera, attempt webcam stream or fallback to visual avatar animation
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (isVideoOn && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: false })
        .then(s => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(() => {
          // Fallback handled gracefully in UI
        });
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isVideoOn]);

  // Web Audio Synthesizer for instant soundboard effects!
  const playSoundEffect = (type: 'airhorn' | 'applause' | 'fanfare' | 'gg') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (type === 'airhorn') {
        const freqs = [340, 360, 340, 420];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
          gain.gain.setValueAtTime(0.2, ctx.currentTime + idx * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (idx + 1) * 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + idx * 0.1);
          osc.stop(ctx.currentTime + (idx + 1) * 0.15);
        });
        setSoundboardAlert('📯 Airhorn sounded in voice!');
      } else if (type === 'fanfare' || type === 'gg') {
        const notes = [261.63, 329.63, 392.0, 523.25];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
          gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.12 + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + idx * 0.12);
          osc.stop(ctx.currentTime + idx * 0.12 + 0.3);
        });
        setSoundboardAlert('🎮 GG Fanfare played!');
      } else {
        setSoundboardAlert('👏 Applause soundboard!');
      }

      setTimeout(() => setSoundboardAlert(null), 2500);
    } catch {
      // Audio context fallback
    }
  };

  const isStageMode = activeChannel?.type === 'stage' || voiceSession?.isStage;

  const speakers = voiceParticipants.filter(p => p.role === 'Speaker');
  const audience = voiceParticipants.filter(p => p.role !== 'Speaker');

  return (
    <div
      className="flex-1 flex flex-col h-full bg-[#111318] overflow-hidden relative select-none"
      aria-label="Voice & Video Room"
    >
      {/* Voice Header Bar */}
      <header className="h-12 border-b border-[#1f232f] px-4 flex items-center justify-between flex-shrink-0 bg-[#111318] z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-white font-bold text-sm">
            {isStageMode ? (
              <Radio className="w-5 h-5 text-[#EF4444] animate-pulse" />
            ) : (
              <Volume2 className="w-5 h-5 text-[#35C98B]" />
            )}
            <span>{activeChannel?.name || 'Voice Channel'}</span>
          </div>
          <span className="text-xs text-[#9B9EAC] hidden sm:inline">
            {voiceParticipants.length} Connected
          </span>
          {isStageMode && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40 uppercase tracking-wide">
              Live Stage
            </span>
          )}
        </div>

        {/* Top Controls */}
        <div className="flex items-center gap-2">
          {soundboardAlert && (
            <div className="text-xs font-semibold px-2.5 py-1 bg-[#7667F7]/20 text-[#7667F7] border border-[#7667F7]/40 rounded-lg animate-fade-in">
              {soundboardAlert}
            </div>
          )}

          <button
            onClick={() => setActiveLayout(activeLayout === 'grid' ? 'focus' : 'grid')}
            aria-label="Toggle Layout"
            className="p-1.5 rounded-lg text-[#9B9EAC] hover:text-white hover:bg-[#1a1d26] text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
            <span className="hidden sm:inline">
              {activeLayout === 'grid' ? 'Speaker Focus' : 'Grid'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Room View Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col justify-center">
        {/* Stage Channel Mode (Speakers vs Audience) */}
        {isStageMode ? (
          <div className="space-y-6 max-w-5xl mx-auto w-full">
            {/* Speakers Row */}
            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
                  Speakers on Stage — {speakers.length}
                </h3>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {speakers.map(participant => (
                  <div
                    key={participant.user.id}
                    onClick={() => setSelectedUserProfile(participant.user)}
                    className={`relative aspect-video rounded-2xl bg-[#191C24] border border-[#2b303d] flex flex-col items-center justify-center p-4 cursor-pointer transition-all hover:scale-[1.02] ${
                      participant.isSpeaking
                        ? 'ring-2 ring-[#35C98B] shadow-lg shadow-[#35C98B]/20'
                        : ''
                    }`}
                  >
                    <div className="relative mb-2">
                      <img
                        src={participant.user.avatar}
                        alt={participant.user.displayName}
                        className="w-14 h-14 rounded-full object-cover shadow-md"
                      />
                      {participant.isSpeaking && (
                        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#35C98B] flex items-center justify-center text-[10px] text-white">
                          <Volume2 className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-white truncate max-w-full">
                      {participant.user.displayName}
                    </p>
                    <span className="text-[10px] text-[#7667F7] font-semibold mt-0.5">
                      Speaker
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Audience Section */}
            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-xs font-bold text-[#9B9EAC] uppercase tracking-wider">
                  Audience — {audience.length + 24} listening
                </h3>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                {audience.map(participant => (
                  <div
                    key={participant.user.id}
                    onClick={() => setSelectedUserProfile(participant.user)}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-[#191C24] cursor-pointer transition-colors"
                  >
                    <img
                      src={participant.user.avatar}
                      alt={participant.user.displayName}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    <p className="text-[11px] font-medium text-[#9B9EAC] truncate w-full text-center">
                      {participant.user.displayName}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Normal Voice & Video Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-w-5xl mx-auto w-full">
            {voiceParticipants.map(participant => {
              const isMe = participant.user.id === currentUser.id;

              return (
                <div
                  key={participant.user.id}
                  onClick={() => setSelectedUserProfile(participant.user)}
                  className={`relative aspect-video rounded-2xl bg-[#191C24] border border-[#262A36] overflow-hidden flex items-center justify-center cursor-pointer transition-all ${
                    participant.isSpeaking
                      ? 'ring-2 ring-[#35C98B] shadow-xl shadow-[#35C98B]/20'
                      : ''
                  }`}
                >
                  {/* Real video if camera is on for me, or simulated video stream for others */}
                  {isMe && isVideoOn ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover transform scale-x-[-1]"
                    />
                  ) : participant.isVideoOn ? (
                    <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-[#191C24] to-[#252a38]">
                      <img
                        src={participant.user.avatar}
                        alt={participant.user.displayName}
                        className="w-20 h-20 rounded-full object-cover shadow-2xl ring-4 ring-[#7667F7]/40 animate-pulse-subtle"
                      />
                      <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] text-[#35C98B] font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#35C98B] animate-pulse" />
                        HD 1080p
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="relative">
                        <img
                          src={participant.user.avatar}
                          alt={participant.user.displayName}
                          className="w-16 h-16 rounded-full object-cover shadow-lg"
                        />
                        {participant.isSpeaking && (
                          <div className="absolute inset-0 rounded-full ring-2 ring-[#35C98B] animate-ping opacity-60" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Participant Name Overlay at Bottom Left */}
                  <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-2">
                    <span className="truncate max-w-[120px]">
                      {participant.user.displayName} {isMe ? '(You)' : ''}
                    </span>
                    {participant.isMuted && (
                      <MicOff className="w-3.5 h-3.5 text-[#EF4444]" />
                    )}
                  </div>

                  {/* Badges Overlay at Top Left */}
                  {participant.isScreenSharing && (
                    <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-[#7667F7] text-white text-[10px] font-bold flex items-center gap-1 shadow-md">
                      <ScreenShare className="w-3 h-3" />
                      LIVE
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating In-Room Bottom Control Dock */}
      <footer className="p-4 flex items-center justify-center relative z-20">
        <div className="bg-[#191C24]/90 backdrop-blur-xl border border-[#2b303d] rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-3">
          {/* Microphone Toggle */}
          <button
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute Mic' : 'Mute Mic'}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
              isMuted
                ? 'bg-[#EF4444] text-white shadow-lg shadow-[#EF4444]/30'
                : 'bg-[#252936] text-white hover:bg-[#2f3546]'
            }`}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Camera Toggle */}
          <button
            onClick={toggleVideo}
            aria-label={isVideoOn ? 'Turn Camera Off' : 'Turn Camera On'}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
              isVideoOn
                ? 'bg-[#35C98B] text-white shadow-lg shadow-[#35C98B]/30'
                : 'bg-[#252936] text-white hover:bg-[#2f3546]'
            }`}
          >
            {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Screen Share Toggle */}
          <button
            onClick={toggleScreenShare}
            aria-label={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
              isScreenSharing
                ? 'bg-[#7667F7] text-white shadow-lg shadow-[#7667F7]/30'
                : 'bg-[#252936] text-white hover:bg-[#2f3546]'
            }`}
          >
            <ScreenShare className="w-5 h-5" />
          </button>

          {/* Soundboard Popover Toggle */}
          <div className="relative">
            <button
              onClick={() => setIsSoundboardOpen(!isSoundboardOpen)}
              aria-label="Soundboard"
              className="w-11 h-11 rounded-xl bg-[#252936] text-white hover:bg-[#2f3546] flex items-center justify-center transition-all"
            >
              <Music className="w-5 h-5 text-[#F59E0B]" />
            </button>

            {isSoundboardOpen && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-[#191C24] border border-[#2b303d] rounded-2xl p-3 shadow-2xl w-56 space-y-2 z-30">
                <p className="text-[11px] font-bold text-[#9B9EAC] uppercase tracking-wider">
                  Soundboard
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => playSoundEffect('airhorn')}
                    className="p-2 bg-[#252936] hover:bg-[#7667F7] rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
                  >
                    📯 Airhorn
                  </button>
                  <button
                    onClick={() => playSoundEffect('fanfare')}
                    className="p-2 bg-[#252936] hover:bg-[#7667F7] rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
                  >
                    🎺 Fanfare
                  </button>
                  <button
                    onClick={() => playSoundEffect('gg')}
                    className="p-2 bg-[#252936] hover:bg-[#7667F7] rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
                  >
                    🎮 GG!
                  </button>
                  <button
                    onClick={() => playSoundEffect('applause')}
                    className="p-2 bg-[#252936] hover:bg-[#7667F7] rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
                  >
                    👏 Claps
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Raise Hand on Stage */}
          {isStageMode && (
            <button
              onClick={() => setIsHandRaised(!isHandRaised)}
              aria-label="Raise Hand"
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                isHandRaised
                  ? 'bg-[#EAB308] text-white shadow-lg shadow-[#EAB308]/30'
                  : 'bg-[#252936] text-white hover:bg-[#2f3546]'
              }`}
            >
              <Hand className="w-5 h-5" />
            </button>
          )}

          <div className="w-[1px] h-6 bg-[#2b303d] mx-1" />

          {/* Disconnect Call Button */}
          <button
            onClick={leaveVoiceChannel}
            aria-label="Disconnect Voice Channel"
            className="w-11 h-11 rounded-xl bg-[#EF4444] text-white hover:bg-[#dc2626] flex items-center justify-center transition-all shadow-lg shadow-[#EF4444]/30"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </footer>
    </div>
  );
};
