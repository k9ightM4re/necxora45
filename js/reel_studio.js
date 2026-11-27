/**
 * NEXORA Instagram-Style Reel Studio & Community Invite Utilities.
 * Pure helpers (testable via node:test) + Web Audio soundtrack synth + Canvas/WebM YouTube exporter.
 */

export const REEL_FILTERS = [
  { id: 'none', label: 'Normal', category: 'basic', css: 'none', swatch: 'linear-gradient(135deg, #E2E8F0, #CBD5E1)' },
  { id: 'clarendon', label: 'Clarendon', category: 'instagram', css: 'contrast(1.18) saturate(1.28) brightness(1.04)', swatch: 'linear-gradient(135deg, #38BDF8, #6366F1)' },
  { id: 'juno', label: 'Juno', category: 'instagram', css: 'contrast(1.14) saturate(1.38) sepia(0.08)', swatch: 'linear-gradient(135deg, #F59E0B, #EC4899)' },
  { id: 'vivid', label: 'Vivid', category: 'instagram', css: 'saturate(1.52) contrast(1.1) brightness(1.06)', swatch: 'linear-gradient(135deg, #A855F7, #3B82F6)' },
  { id: 'warm', label: 'Golden Hour', category: 'instagram', css: 'sepia(0.28) saturate(1.28) brightness(1.05)', swatch: 'linear-gradient(135deg, #F97316, #FACC15)' },
  { id: 'valencia', label: 'Valencia', category: 'instagram', css: 'sepia(0.16) contrast(1.08) brightness(1.08) saturate(1.16)', swatch: 'linear-gradient(135deg, #FBBF24, #FB7185)' },
  { id: 'lofi-pop', label: 'Lo-Fi Pop', category: 'instagram', css: 'contrast(1.32) saturate(1.38)', swatch: 'linear-gradient(135deg, #EC4899, #8B5CF6)' },
  { id: 'noir', label: 'Noir B&W', category: 'instagram', css: 'grayscale(1) contrast(1.28) brightness(0.98)', swatch: 'linear-gradient(135deg, #1E293B, #64748B)' },
  { id: 'snap-peach', label: 'Snap Peach', category: 'snapchat', css: 'brightness(1.08) saturate(1.18) sepia(0.14) hue-rotate(-6deg)', swatch: 'linear-gradient(135deg, #FDBA74, #C49A52)' },
  { id: 'snap-tokyo', label: 'Tokyo Neon', category: 'snapchat', css: 'contrast(1.16) saturate(1.45) hue-rotate(12deg)', swatch: 'linear-gradient(135deg, #06B6D4, #701CFF)' },
  { id: 'snap-mint', label: 'Fresh Mint', category: 'snapchat', css: 'brightness(1.06) saturate(1.15) hue-rotate(18deg)', swatch: 'linear-gradient(135deg, #34D399, #38BDF8)' },
  { id: 'retro-vhs', label: 'Retro VHS', category: 'snapchat', css: 'contrast(1.22) sepia(0.22) saturate(1.12) brightness(0.96)', swatch: 'linear-gradient(135deg, #7C3AED, #F59E0B)' },
  { id: 'pastel-dream', label: 'Pastel Glow', category: 'snapchat', css: 'brightness(1.12) contrast(0.94) saturate(1.18)', swatch: 'linear-gradient(135deg, #FBCFE8, #C4B5FD)' },
  { id: 'cinema-teal', label: 'Cinema Teal', category: 'cinema', css: 'contrast(1.2) saturate(1.15) hue-rotate(-14deg) brightness(0.98)', swatch: 'linear-gradient(135deg, #0F766E, #1E3A8A)' },
];

export const SNAP_LENS_STICKERS = [
  { id: 'lens-sparkle', label: '✨ Dreamy Glow', text: '✨ Dreamy Vibes', style: 'modern', bgMode: 'pill', color: '#FFFFFF', x: 50, y: 18, fontSize: 18 },
  { id: 'lens-rec', label: '🔴 REC • HD', text: '🔴 REC  00:15  HD', style: 'typewriter', bgMode: 'dark', color: '#FACC15', x: 34, y: 14, fontSize: 15 },
  { id: 'lens-crown', label: '👑 Main Energy', text: '👑 Main Character', style: 'modern', bgMode: 'pill', color: '#FFFFFF', x: 50, y: 20, fontSize: 18 },
  { id: 'lens-sunny', label: '☀️ Golden Hour', text: '☀️ Golden Hour', style: 'classic', bgMode: 'dark', color: '#FACC15', x: 50, y: 78, fontSize: 18 },
  { id: 'lens-film', label: '📷 35mm Film', text: '📷 KODAK PORTRA 400', style: 'typewriter', bgMode: 'dark', color: '#FFFFFF', x: 50, y: 82, fontSize: 14 },
  { id: 'lens-cool', label: '😎 Cool Mode', text: '😎 ZERO STRESS', style: 'strong', bgMode: 'none', color: '#34D399', x: 50, y: 22, fontSize: 22 },
];

export const REEL_VIDEO_TEMPLATES = [
  {
    id: 'travel-vlog',
    name: 'Travel Vlog',
    category: 'Lifestyle',
    badge: 'IG Reels',
    description: 'Golden filter + warm acoustic pluck + crisp POV overlay.',
    filterName: 'warm',
    playbackSpeed: 1,
    audioTrackId: 'nexora-acoustic',
    musicVolume: 0.75,
    captionSeed: 'Chasing sunsets and new horizons ✨ #TravelVlog #GoldenHour #NexoraReels',
    backdropColors: ['#7C2D12', '#EA580C', '#FACC15'],
    overlays: [
      { id: 'tpl-tv-1', text: 'POV: Weekend Escape ✈️', x: 50, y: 24, color: '#FFFFFF', style: 'modern', bgMode: 'pill', fontSize: 22 },
      { id: 'tpl-tv-2', text: '☀️ Golden Hour Vibes', x: 50, y: 76, color: '#FACC15', style: 'classic', bgMode: 'dark', fontSize: 16 },
    ],
  },
  {
    id: 'beat-drop',
    name: 'Neon Beat Drop',
    category: 'Music & Dance',
    badge: 'Trending',
    description: 'Tokyo Neon lens + 1.5x hype speed + high-energy synth beat.',
    filterName: 'snap-tokyo',
    playbackSpeed: 1.5,
    audioTrackId: 'nexora-hyper',
    musicVolume: 0.85,
    captionSeed: 'Wait for the beat drop ⚡🔥 #BeatDrop #NeonVibes #NexoraStudio',
    backdropColors: ['#101124', '#701CFF', '#06B6D4'],
    overlays: [
      { id: 'tpl-bd-1', text: 'WAIT FOR THE DROP ⚡', x: 50, y: 26, color: '#FFFFFF', style: 'neon', bgMode: 'none', fontSize: 24 },
      { id: 'tpl-bd-2', text: '126 BPM · REEL EDIT', x: 50, y: 78, color: '#FFFFFF', style: 'strong', bgMode: 'dark', fontSize: 15 },
    ],
  },
  {
    id: 'creator-tips',
    name: '3 Quick Tips',
    category: 'Creator',
    badge: 'Tutorial',
    description: 'Clarendon clarity + Midnight Pulse beat + clean headline card.',
    filterName: 'clarendon',
    playbackSpeed: 1,
    audioTrackId: 'nexora-midnight',
    musicVolume: 0.7,
    captionSeed: 'Save this for later! 3 quick creator tips 👇 #CreatorTips #Growth',
    backdropColors: ['#1E1B4B', '#4338CA', '#286BFF'],
    overlays: [
      { id: 'tpl-ct-1', text: '3 TIPS YOU NEED 👇', x: 50, y: 22, color: '#FFFFFF', style: 'strong', bgMode: 'pill', fontSize: 22 },
      { id: 'tpl-ct-2', text: 'Save & Share with a friend', x: 50, y: 75, color: '#FFFFFF', style: 'modern', bgMode: 'dark', fontSize: 16 },
    ],
  },
  {
    id: 'retro-vhs-reel',
    name: '90s Retro VHS',
    category: 'Snapchat',
    badge: 'Throwback',
    description: 'Retro VHS camcorder grade + Lo-Fi chill + REC timestamp.',
    filterName: 'retro-vhs',
    playbackSpeed: 1,
    audioTrackId: 'nexora-lofi',
    musicVolume: 0.8,
    captionSeed: 'Core memories on 90s tape 📷✨ #RetroVHS #Throwback #Vibes',
    backdropColors: ['#18181B', '#7C3AED', '#F59E0B'],
    overlays: [
      { id: 'tpl-vh-1', text: '🔴 REC  98  PLAY ▶', x: 38, y: 16, color: '#FACC15', style: 'typewriter', bgMode: 'dark', fontSize: 15 },
      { id: 'tpl-vh-2', text: 'Core Memories ✨', x: 50, y: 76, color: '#FFFFFF', style: 'classic', bgMode: 'none', fontSize: 22 },
    ],
  },
  {
    id: 'daily-quote-reel',
    name: 'Daily Motivation',
    category: 'Text Card',
    badge: 'No Clip Needed',
    description: 'Pastel Glow aesthetic card + Lo-Fi beats — works without video.',
    filterName: 'pastel-dream',
    playbackSpeed: 1,
    audioTrackId: 'nexora-lofi',
    musicVolume: 0.72,
    captionSeed: 'Consistency beats intensity every single time. 💜 #Mindset #DailyQuote',
    backdropColors: ['#312E81', '#A735FF', '#EC4899'],
    overlays: [
      { id: 'tpl-dq-1', text: 'Small steps daily build empires.', x: 50, y: 46, color: '#FFFFFF', style: 'modern', bgMode: 'dark', fontSize: 22 },
      { id: 'tpl-dq-2', text: '✨ DAILY REMINDER', x: 50, y: 22, color: '#FFFFFF', style: 'classic', bgMode: 'pill', fontSize: 15 },
    ],
  },
  {
    id: 'flash-launch',
    name: 'Hype Spotlight',
    category: 'Promo',
    badge: 'Fast Cut',
    description: 'Vivid punch + 2.0x dynamic speed + electric synth drop.',
    filterName: 'vivid',
    playbackSpeed: 2,
    audioTrackId: 'nexora-hyper',
    musicVolume: 0.8,
    captionSeed: 'Big reveal dropping right here! 🚀🔥 #Launch #NexoraCreators',
    backdropColors: ['#0F172A', '#EC4899', '#701CFF'],
    overlays: [
      { id: 'tpl-fl-1', text: 'OUT NOW 🚀', x: 50, y: 26, color: '#FACC15', style: 'strong', bgMode: 'dark', fontSize: 26 },
      { id: 'tpl-fl-2', text: 'Tap follow for part 2', x: 50, y: 78, color: '#FFFFFF', style: 'modern', bgMode: 'pill', fontSize: 16 },
    ],
  },
];

export const PHOTO_TEMPLATES = [
  { id: 'clean-filter', name: 'Filter Only', description: 'Clean edge-to-edge photo with IG/Snap filter & badge.' },
  { id: 'polaroid-frame', name: 'Polaroid Card', description: 'Classic cream Polaroid frame with handwritten caption.' },
  { id: 'magazine-cover', name: 'Magazine Cover', description: 'Editorial masthead cover with bold headline.' },
  { id: 'neon-poster', name: 'Signal Frame', description: 'Nexora Signal Blue spotlight border & banner.' },
  { id: 'film-strip', name: '35mm Film Strip', description: 'Dark analog sprocket border & camera timestamp.' },
  { id: 'quote-card', name: 'Quote Card', description: 'Works with or without a photo — crisp centered quote.' },
];

export const REEL_TEXT_STYLES = [
  { id: 'classic', label: 'Classic', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 700, letterSpacing: '0em', uppercase: false },
  { id: 'modern', label: 'Modern', fontFamily: 'Manrope, Inter, sans-serif', fontWeight: 800, letterSpacing: '0.02em', uppercase: false },
  { id: 'neon', label: 'Signal', fontFamily: 'Manrope, system-ui, sans-serif', fontWeight: 800, letterSpacing: '0.05em', uppercase: false, neon: true },
  { id: 'typewriter', label: 'Typewriter', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, letterSpacing: '0.01em', uppercase: false },
  { id: 'strong', label: 'Strong', fontFamily: 'Impact, Manrope, sans-serif', fontWeight: 900, letterSpacing: '0.04em', uppercase: true },
];

export const REEL_TEXT_COLORS = [
  '#FFFFFF',
  '#101124',
  '#701CFF',
  '#286BFF',
  '#EC4899',
  '#FACC15',
  '#34D399',
];

export const REEL_SOUNDTRACKS = [
  { id: 'original', title: 'Original Video Audio', artist: 'Clip Audio', bpm: 0, mode: 'none', rootHz: 0 },
  { id: 'nexora-midnight', title: 'Midnight Pulse', artist: 'NEXORA Studio', bpm: 112, mode: 'pulse', rootHz: 220 },
  { id: 'nexora-lofi', title: 'Chill Skyline', artist: 'Lo-Fi Beats', bpm: 84, mode: 'lofi', rootHz: 196 },
  { id: 'nexora-hyper', title: 'Electric Rush', artist: 'Synthwave', bpm: 126, mode: 'synth', rootHz: 261.63 },
  { id: 'nexora-acoustic', title: 'Golden Hour', artist: 'Warm Pluck', bpm: 96, mode: 'pluck', rootHz: 246.94 },
  { id: 'custom', title: 'Custom Uploaded Track', artist: 'My Audio', bpm: 0, mode: 'custom', rootHz: 0 },
];

export function getReelFilterCss(filterId) {
  const found = REEL_FILTERS.find((f) => f.id === filterId);
  return found ? found.css : 'none';
}

export function getReelTemplateMeta(templateId) {
  return REEL_VIDEO_TEMPLATES.find((t) => t.id === templateId) || null;
}

export function getPhotoTemplateMeta(templateId) {
  return PHOTO_TEMPLATES.find((t) => t.id === templateId) || PHOTO_TEMPLATES[0];
}

export function getReelTextStyleMeta(styleId) {
  return REEL_TEXT_STYLES.find((s) => s.id === styleId) || REEL_TEXT_STYLES[0];
}

export function getSoundtrackMeta(trackId) {
  return REEL_SOUNDTRACKS.find((t) => t.id === trackId) || REEL_SOUNDTRACKS[0];
}

/**
 * Extracts a canonical 11-char YouTube video ID from watch, shorts, youtu.be, embed, or live URLs.
 */
export function parseYouTubeVideoId(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return '';
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const url = new URL(withProto);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const validId = /^[a-zA-Z0-9_-]{11}$/;

    if (host === 'youtu.be') {
      const seg = url.pathname.split('/').filter(Boolean)[0] || '';
      return validId.test(seg) ? seg : '';
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const vParam = url.searchParams.get('v') || '';
      if (validId.test(vParam)) return vParam;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
        return validId.test(parts[1]) ? parts[1] : '';
      }
    }
  } catch {
    return '';
  }
  return '';
}

export function getYouTubeEmbedUrl(videoId, { autoplay = true, mute = true, loop = true } = {}) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId || ''))) return '';
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    enablejsapi: '0',
    autoplay: autoplay ? '1' : '0',
    mute: mute ? '1' : '0',
  });
  if (loop) {
    params.set('loop', '1');
    params.set('playlist', videoId);
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function getYouTubeThumbUrl(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId || ''))) return '';
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function sanitizeReelTextOverlays(list) {
  if (!Array.isArray(list)) return [];
  const allowedStyles = new Set(REEL_TEXT_STYLES.map((s) => s.id));
  const allowedBgs = new Set(['pill', 'dark', 'none']);
  const out = [];
  for (const item of list.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const text = String(item.text || '').trim().slice(0, 120);
    if (!text) continue;
    const xNum = Number(item.x);
    const yNum = Number(item.y);
    const sizeNum = Number(item.fontSize);
    const x = Number.isFinite(xNum) ? Math.min(92, Math.max(8, Math.round(xNum))) : 50;
    const y = Number.isFinite(yNum) ? Math.min(90, Math.max(10, Math.round(yNum))) : 50;
    const fontSize = Number.isFinite(sizeNum) ? Math.min(48, Math.max(14, Math.round(sizeNum))) : 24;
    const style = allowedStyles.has(item.style) ? item.style : 'modern';
    const bgMode = allowedBgs.has(item.bgMode) ? item.bgMode : 'pill';
    const rawColor = String(item.color || '#FFFFFF').trim();
    const color = /^#[0-9A-Fa-f]{6}$/.test(rawColor) ? rawColor : '#FFFFFF';
    out.push({
      id: String(item.id || `txt-${out.length + 1}`).slice(0, 40),
      text,
      x,
      y,
      color,
      style,
      bgMode,
      fontSize,
    });
  }
  return out;
}

/**
 * Extracts a NEXORA community invite code from shared invite links or chat messages.
 */
export function extractCommunityInviteCodeFromText(text) {
  const str = String(text || '').trim();
  if (!str) return '';
  const queryMatch = str.match(/[?&]invite=([a-zA-Z0-9_-]{2,32})/i);
  if (queryMatch) return queryMatch[1];
  const protoMatch = str.match(/nexora:\/\/invite\/([a-zA-Z0-9_-]{2,32})/i);
  if (protoMatch) return protoMatch[1];
  const prefixMatch = str.match(/NX-INVITE:([a-zA-Z0-9_-]{2,32})/i);
  if (prefixMatch) return prefixMatch[1];
  return '';
}

export function buildCommunityInviteMessage(server, origin = 'https://myzora.netlify.app') {
  if (!server) return '';
  const code = String(server.inviteCode || server.id || '').trim();
  const name = String(server.name || 'NEXORA Community').trim().slice(0, 60);
  const cleanOrigin = String(origin || 'https://myzora.netlify.app').replace(/\/+$/, '');
  return `Join our NEXORA Community "${name}" — ${cleanOrigin}/welcome.html?invite=${code}`;
}

/**
 * Real-time Web Audio Soundtrack Engine + Custom Audio Player.
 * Powers song preview in Reel Studio, Reel Feed playback, and audio mixing for YouTube export.
 */
export class ReelAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.customAudio = null;
    this.mediaSource = null;
    this.stepTimer = null;
    this.activeTrackId = 'original';
    this.stepIndex = 0;
  }

  _ensureCtx() {
    if (typeof window === 'undefined') return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setVolume(volume = 0.7, muted = false) {
    const level = muted ? 0 : Math.min(1, Math.max(0, Number(volume) || 0));
    if (this.customAudio) {
      this.customAudio.muted = muted;
      this.customAudio.volume = level;
    }
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setTargetAtTime(level * 0.55, this.ctx.currentTime, 0.03);
      } catch {
        this.masterGain.gain.value = level * 0.55;
      }
    }
  }

  stop() {
    if (this.stepTimer) {
      clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
    if (this.customAudio) {
      try {
        this.customAudio.pause();
        this.customAudio.currentTime = 0;
      } catch {}
      this.customAudio = null;
    }
    if (this.mediaSource) {
      try {
        this.mediaSource.disconnect();
      } catch {}
      this.mediaSource = null;
    }
    this.activeTrackId = 'original';
    this.stepIndex = 0;
  }

  play({ trackId = 'original', audioDataUrl = '', volume = 0.75, muted = false, destinationNode = null } = {}) {
    this.stop();
    this.activeTrackId = trackId || 'original';
    if (!trackId || trackId === 'original') return;

    const effectiveVol = muted ? 0 : Math.min(1, Math.max(0, Number(volume) || 0.75));

    if (audioDataUrl && (trackId === 'custom' || audioDataUrl.startsWith('data:audio/'))) {
      try {
        const audio = new Audio(audioDataUrl);
        audio.loop = true;
        audio.volume = effectiveVol;
        audio.muted = muted;
        this.customAudio = audio;
        if (destinationNode && this._ensureCtx()) {
          try {
            const src = this.ctx.createMediaElementSource(audio);
            src.connect(this.masterGain);
            src.connect(destinationNode);
            this.mediaSource = src;
          } catch {}
        }
        audio.play().catch(() => {});
      } catch {}
      return;
    }

    const meta = getSoundtrackMeta(trackId);
    if (!meta || meta.bpm <= 0) return;

    const ctx = this._ensureCtx();
    if (!ctx || !this.masterGain) return;

    if (destinationNode) {
      try {
        this.masterGain.connect(destinationNode);
      } catch {}
    }

    this.setVolume(effectiveVol, muted);
    const stepMs = Math.max(140, Math.round((60_000 / meta.bpm) / 2));
    const scales = {
      pulse: [1, 1.25, 1.5, 1.875, 1.5, 1.25, 1.125, 1.5],
      lofi: [1, 1.189, 1.498, 1.781, 1.498, 1.334, 1.189, 1],
      synth: [1, 1.5, 2, 1.5, 1.25, 1.5, 1.875, 2],
      pluck: [1, 1.25, 1.5, 2, 1.5, 1.25, 1.334, 1.5],
    };
    const pattern = scales[meta.mode] || scales.pulse;

    const triggerNote = () => {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const mult = pattern[this.stepIndex % pattern.length];
      const freq = meta.rootHz * mult;

      const osc = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();
      osc.type = meta.mode === 'synth' ? 'sawtooth' : meta.mode === 'lofi' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(meta.mode === 'lofi' ? 950 : 2200, now);

      noteGain.gain.setValueAtTime(0.0001, now);
      noteGain.gain.exponentialRampToValueAtTime(0.24, now + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.001, now + stepMs / 1000 * 0.92);

      osc.connect(filter);
      filter.connect(noteGain);
      noteGain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + stepMs / 1000);

      // Kick pulse every 2 steps
      if (this.stepIndex % 2 === 0) {
        const kick = this.ctx.createOscillator();
        const kGain = this.ctx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(125, now);
        kick.frequency.exponentialRampToValueAtTime(42, now + 0.12);
        kGain.gain.setValueAtTime(0.32, now);
        kGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        kick.connect(kGain);
        kGain.connect(this.masterGain);
        kick.start(now);
        kick.stop(now + 0.15);
      }

      this.stepIndex += 1;
    };

    triggerNote();
    this.stepTimer = setInterval(triggerNote, stepMs);
  }
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Renders edited 9:16 Reel (Video/Backdrop + Filter + Instagram Text Overlays + Soundtrack)
 * into a downloadable WebM video ready to upload to YouTube Studio.
 */
export async function exportEditedReelForYouTube({
  videoEl = null,
  youtubeTitle = '',
  filterId = 'none',
  textOverlays = [],
  audioTrackId = 'original',
  audioDataUrl = '',
  musicVolume = 0.75,
  backdropColors = ['#101124', '#4C1D95', '#286BFF'],
  durationSec = 5,
  onProgress = null,
} = {}) {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('Video export is not supported in this browser.');
  }

  const width = 720;
  const height = 1280;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const safeOverlays = sanitizeReelTextOverlays(textOverlays);
  const filterCss = getReelFilterCss(filterId);
  const trackMeta = getSoundtrackMeta(audioTrackId);
  const [c0, c1, c2] = Array.isArray(backdropColors) && backdropColors.length >= 3
    ? backdropColors
    : ['#101124', '#4C1D95', '#286BFF'];

  const canvasStream = canvas.captureStream(30);
  const exportAudio = new ReelAudioEngine();
  let audioDest = null;

  try {
    const audioCtx = exportAudio._ensureCtx();
    if (audioCtx && audioTrackId && audioTrackId !== 'original') {
      audioDest = audioCtx.createMediaStreamDestination();
      exportAudio.play({
        trackId: audioTrackId,
        audioDataUrl,
        volume: musicVolume,
        muted: false,
        destinationNode: audioDest,
      });
      audioDest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
    }
  } catch {
    // Proceed cleanly with silent video stream if Web Audio is unavailable
  }

  const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const chosenMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const recorder = new MediaRecorder(canvasStream, { mimeType: chosenMime });
  const chunks = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  let usedPosterFallback = !(videoEl && videoEl.readyState >= 2);
  const exportMs = Math.min(12000, Math.max(2500, Math.round(Number(durationSec || 5) * 1000)));
  const startTime = performance.now();
  let rafId = 0;

  return new Promise((resolve, reject) => {
    recorder.onerror = () => {
      cancelAnimationFrame(rafId);
      exportAudio.stop();
      reject(new Error('Could not encode video stream.'));
    };

    recorder.onstop = () => {
      cancelAnimationFrame(rafId);
      exportAudio.stop();
      const blob = new Blob(chunks, { type: chosenMime });
      const filename = `nexora-reel-${Date.now()}.webm`;
      resolve({ blob, filename, usedPosterFallback });
    };

    const drawFrame = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / exportMs);
      if (typeof onProgress === 'function') onProgress(Math.round(progress * 100));

      ctx.save();
      ctx.filter = filterCss === 'none' ? 'none' : filterCss;

      let drewVideo = false;
      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        try {
          const vw = videoEl.videoWidth;
          const vh = videoEl.videoHeight;
          const scale = Math.max(width / vw, height / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          ctx.drawImage(videoEl, (width - dw) / 2, (height - dh) / 2, dw, dh);
          drewVideo = true;
          usedPosterFallback = false;
        } catch {
          drewVideo = false;
        }
      }

      if (!drewVideo) {
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, c0);
        grad.addColorStop(0.55, c1);
        grad.addColorStop(1, c2);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        const pulseR = 130 + Math.sin(elapsed / 260) * 20;
        ctx.beginPath();
        ctx.arc(width / 2, height / 2 - 40, pulseR, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 3;
        const ringR = 185 + Math.cos(elapsed / 320) * 16;
        ctx.beginPath();
        ctx.arc(width / 2, height / 2 - 40, ringR, 0, Math.PI * 2);
        ctx.stroke();

        if (youtubeTitle) {
          ctx.fillStyle = 'rgba(255,255,255,0.88)';
          ctx.font = '700 28px Plus Jakarta Sans, Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(youtubeTitle.slice(0, 42), width / 2, height - 130);
        }
      }
      ctx.restore();

      // Burn in Instagram-style text overlays
      for (const ov of safeOverlays) {
        const styleMeta = getReelTextStyleMeta(ov.style);
        const scaledSize = Math.round(ov.fontSize * 1.9);
        const cx = (ov.x / 100) * width;
        const cy = (ov.y / 100) * height;
        const textValue = styleMeta.uppercase ? ov.text.toUpperCase() : ov.text;

        ctx.save();
        ctx.font = `${styleMeta.fontWeight} ${scaledSize}px ${styleMeta.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const metrics = ctx.measureText(textValue);
        const padX = 24;
        const padY = 14;
        const boxW = Math.min(width - 48, metrics.width + padX * 2);
        const boxH = scaledSize + padY * 2;

        if (ov.bgMode === 'pill' || ov.bgMode === 'dark') {
          ctx.fillStyle = ov.bgMode === 'dark' ? 'rgba(16, 17, 36, 0.86)' : 'rgba(255, 255, 255, 0.94)';
          drawRoundedRectPath(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, 20);
          ctx.fill();
        }

        if (styleMeta.neon) {
          ctx.shadowColor = '#A735FF';
          ctx.shadowBlur = 18;
        } else if (ov.bgMode === 'none') {
          ctx.shadowColor = 'rgba(0,0,0,0.75)';
          ctx.shadowBlur = 10;
        }

        if (ov.bgMode === 'pill' && ov.color.toUpperCase() === '#FFFFFF') {
          ctx.fillStyle = '#101124';
        } else {
          ctx.fillStyle = ov.color;
        }
        ctx.fillText(textValue, cx, cy, width - 80);
        ctx.restore();
      }

      // Subtle music credit footer
      if (trackMeta && trackMeta.id !== 'original') {
        ctx.save();
        ctx.fillStyle = 'rgba(16, 17, 36, 0.72)';
        drawRoundedRectPath(ctx, 28, height - 72, 360, 42, 21);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 20px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`♪ ${trackMeta.title} — ${trackMeta.artist}`, 48, height - 51, 320);
        ctx.restore();
      }

      if (elapsed < exportMs) {
        rafId = requestAnimationFrame(drawFrame);
      } else if (recorder.state === 'recording') {
        recorder.stop();
      }
    };

    recorder.start(100);
    drawFrame();
  });
}

export async function blobToBoundedDataUrl(blob, maxBytes = 600000) {
  if (!(blob instanceof Blob)) throw new Error('Invalid video clip.');
  if (blob.size > maxBytes) {
    throw new Error(`Rendered clip is ${Math.round(blob.size / 1024)} KB (limit ${Math.round(maxBytes / 1024)} KB).`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read rendered video clip.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = src;
  });
}

function drawCoverImage(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Renders a Photo Template + Instagram/Snapchat Filter + Sticker Badge into a compressed JPEG DataURL.
 */
export async function renderPhotoTemplateToDataUrl({
  imageDataUrl = '',
  templateId = 'clean-filter',
  filterId = 'none',
  stickerText = '',
  headline = '',
  subline = '',
  authorHandle = 'nexora',
  maxBytes = 215000,
} = {}) {
  if (typeof document === 'undefined') {
    throw new Error('Canvas rendering unavailable.');
  }

  const W = 900;
  const H = templateId === 'polaroid-frame' || templateId === 'magazine-cover' ? 1040 : 900;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable.');

  const filterCss = getReelFilterCss(filterId);
  let loadedImg = null;
  if (imageDataUrl) {
    loadedImg = await loadImageElement(imageDataUrl);
  }

  const drawSubjectArea = (x, y, w, h, radius = 0) => {
    ctx.save();
    if (radius > 0) {
      drawRoundedRectPath(ctx, x, y, w, h, radius);
      ctx.clip();
    } else {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.filter = filterCss === 'none' ? 'none' : filterCss;
    if (loadedImg) {
      drawCoverImage(ctx, loadedImg, x, y, w, h);
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#101124');
      g.addColorStop(0.5, '#701CFF');
      g.addColorStop(1, '#286BFF');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(x + w * 0.25, y + h * 0.3, 180, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + w * 0.78, y + h * 0.72, 220, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  if (templateId === 'polaroid-frame') {
    ctx.fillStyle = '#F8F7F4';
    ctx.fillRect(0, 0, W, H);
    drawSubjectArea(56, 56, W - 112, W - 112, 8);
    ctx.fillStyle = '#1E293B';
    ctx.font = '800 36px "Plus Jakarta Sans", Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((headline || 'Captured Moment ✨').slice(0, 38), W / 2, H - 102);
    ctx.fillStyle = '#64748B';
    ctx.font = '600 22px ui-monospace, Menlo, monospace';
    ctx.fillText((subline || `@${authorHandle} · NEXORA`).slice(0, 48), W / 2, H - 56);
  } else if (templateId === 'magazine-cover') {
    drawSubjectArea(0, 0, W, H, 0);
    const topScrim = ctx.createLinearGradient(0, 0, 0, 260);
    topScrim.addColorStop(0, 'rgba(16,17,36,0.72)');
    topScrim.addColorStop(1, 'rgba(16,17,36,0)');
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, W, 260);

    const botScrim = ctx.createLinearGradient(0, H - 360, 0, H);
    botScrim.addColorStop(0, 'rgba(16,17,36,0)');
    botScrim.addColorStop(1, 'rgba(16,17,36,0.88)');
    ctx.fillStyle = botScrim;
    ctx.fillRect(0, H - 360, W, 360);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 104px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXORA', W / 2, 132);
    ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText('CREATOR EDITION · SPECIAL ISSUE', W / 2, 174);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FACC15';
    ctx.font = '800 26px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`FEATURED · @${String(authorHandle || 'creator').toUpperCase()}`, 54, H - 180);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 50px "Plus Jakarta Sans", sans-serif';
    ctx.fillText((headline || 'Create. Inspire. Share.').slice(0, 28), 54, H - 115);
    if (subline) {
      ctx.fillStyle = '#CBD5E1';
      ctx.font = '600 26px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(subline.slice(0, 44), 54, H - 64);
    }
  } else if (templateId === 'neon-poster') {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#101124');
    bg.addColorStop(0.5, '#701CFF');
    bg.addColorStop(1, '#286BFF');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawSubjectArea(48, 48, W - 96, H - 200, 28);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 4;
    drawRoundedRectPath(ctx, 48, 48, W - 96, H - 200, 28);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 38px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((headline || 'Spotlight Moment ⚡').slice(0, 34), W / 2, H - 92);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText((subline || `@${authorHandle} · NEXORA Studio`).slice(0, 46), W / 2, H - 48);
  } else if (templateId === 'film-strip') {
    ctx.fillStyle = '#0D0E14';
    ctx.fillRect(0, 0, W, H);
    drawSubjectArea(36, 98, W - 72, H - 196, 10);

    ctx.fillStyle = '#F3F4F6';
    for (let x = 28; x < W - 40; x += 64) {
      drawRoundedRectPath(ctx, x, 28, 34, 42, 6);
      ctx.fill();
      drawRoundedRectPath(ctx, x, H - 70, 34, 42, 6);
      ctx.fill();
    }
    ctx.fillStyle = '#F59E0B';
    ctx.font = '700 22px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText((headline || '35MM FILM · PORTRA 400').slice(0, 32), W - 48, H - 122);
  } else if (templateId === 'quote-card') {
    drawSubjectArea(0, 0, W, H, 0);
    ctx.fillStyle = 'rgba(16, 17, 36, 0.56)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 2;
    drawRoundedRectPath(ctx, 84, 150, W - 168, H - 300, 36);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FACC15';
    ctx.font = '900 84px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('“', W / 2, 275);

    const words = (headline || 'Create things that inspire people every day.').slice(0, 90).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (test.length > 22 && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 44px "Plus Jakarta Sans", sans-serif';
    const startY = H / 2 - ((lines.length - 1) * 56) / 2;
    lines.slice(0, 4).forEach((ln, idx) => {
      ctx.fillText(ln, W / 2, startY + idx * 58);
    });

    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText((subline || `@${authorHandle}`).slice(0, 40), W / 2, H - 205);
  } else {
    // clean-filter
    drawSubjectArea(0, 0, W, H, 0);
    if (headline) {
      const grad = ctx.createLinearGradient(0, H - 240, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(16,17,36,0.75)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H - 240, W, 240);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 38px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(headline.slice(0, 38), W / 2, H - 64);
    }
  }

  // Optional Snapchat/IG Sticker Overlay Pill
  if (stickerText) {
    ctx.save();
    ctx.font = '800 26px "Plus Jakarta Sans", Inter, sans-serif';
    const txt = String(stickerText).slice(0, 30);
    const tw = ctx.measureText(txt).width + 44;
    const bx = (W - tw) / 2;
    const by = templateId === 'magazine-cover' ? 205 : 44;
    ctx.fillStyle = 'rgba(16, 17, 36, 0.82)';
    drawRoundedRectPath(ctx, bx, by, tw, 52, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, W / 2, by + 27);
    ctx.restore();
  }

  for (let q = 0.88; q >= 0.45; q -= 0.1) {
    const out = canvas.toDataURL('image/jpeg', q);
    if (out.length <= maxBytes) return out;
  }
  return canvas.toDataURL('image/jpeg', 0.42);
}

