/**
 * Structured template data schema, constants, validation, history stack,
 * cloning helpers, and search/filter logic for NEXORA AI Template Studio.
 */

export const TEMPLATE_CATEGORIES = [
  'Social Media Posts',
  'Instagram-style Posts',
  'Stories',
  'Reels Covers',
  'YouTube Thumbnails',
  'Posters',
  'Event Posters',
  'Announcements',
  'Quotes',
  'Education',
  'Business',
  'Marketing',
  'Product Promotion',
  'Personal Branding',
  'Gaming',
  'Technology',
  'News',
  'Festivals',
  'Birthday',
  'Travel',
  'Photography',
  'Minimalist',
  'AI Art',
  'Custom',
];

export const TEMPLATE_STYLES = [
  'Modern',
  'Minimalist',
  'Premium',
  'Neon',
  'Dark',
  'Light',
  'Futuristic',
  'Professional',
  'Cinematic',
  'Artistic',
  'Editorial',
  'Gaming',
  'Corporate',
  'Education',
  'Luxury',
  'Retro',
  'Custom',
];

export const TEMPLATE_ASPECT_RATIOS = {
  '1:1': { label: '1:1 Square Post', width: 1080, height: 1080 },
  '4:5': { label: '4:5 IG Portrait', width: 1080, height: 1350 },
  '9:16': { label: '9:16 Story / Reel', width: 1080, height: 1920 },
  '16:9': { label: '16:9 YouTube / Wide', width: 1920, height: 1080 },
  '3:2': { label: '3:2 Editorial', width: 1500, height: 1000 },
  Custom: { label: 'Custom Dimensions', width: 1080, height: 1080 },
};

export const TEMPLATE_FONT_FAMILIES = [
  'Plus Jakarta Sans',
  'Outfit',
  'Manrope',
  'Bricolage Grotesque',
  'Playfair Display',
  'Space Grotesk',
  'Bebas Neue',
  'JetBrains Mono',
  'Georgia',
  'Arial',
];

export const TEMPLATE_STICKERS = [
  { emoji: '⚡', text: 'FEATURED' },
  { emoji: '🔥', text: 'TRENDING' },
  { emoji: '✨', text: 'NEW DROP' },
  { emoji: '🎯', text: 'LIMITED' },
  { emoji: '📢', text: 'LIVE NOW' },
  { emoji: '🏆', text: 'TOP PICK' },
  { emoji: '🚀', text: 'LAUNCH' },
  { emoji: '💡', text: 'PRO TIP' },
  { emoji: '🎟️', text: 'SAVE THE DATE' },
  { emoji: '💎', text: 'EXCLUSIVE' },
];

export function clampNumber(val, min, max, fallback = 0) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeHexColor(raw, fallback = '#701CFF') {
  const s = String(raw || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^rgba?\([\d.,\s%]+\)$/.test(s)) return s;
  return fallback;
}

export function deepCloneTemplateData(data) {
  return JSON.parse(JSON.stringify(data || createBlankTemplateData()));
}

export function resolveDimensionsForRatio(aspectRatio = '1:1', customWidth = 1080, customHeight = 1080) {
  if (aspectRatio === 'Custom') {
    return {
      width: Math.round(clampNumber(customWidth, 320, 2400, 1080)),
      height: Math.round(clampNumber(customHeight, 320, 2400, 1080)),
      aspectRatio: 'Custom',
    };
  }
  const entry = TEMPLATE_ASPECT_RATIOS[aspectRatio] || TEMPLATE_ASPECT_RATIOS['1:1'];
  return {
    width: entry.width,
    height: entry.height,
    aspectRatio: TEMPLATE_ASPECT_RATIOS[aspectRatio] ? aspectRatio : '1:1',
  };
}

export function createBlankTemplateData({
  aspectRatio = '1:1',
  customWidth = 1080,
  customHeight = 1080,
  primaryColor = '#701CFF',
  secondaryColor = '#286BFF',
  accentColor = '#F43F5E',
  fontFamily = 'Plus Jakarta Sans',
} = {}) {
  const dims = resolveDimensionsForRatio(aspectRatio, customWidth, customHeight);
  return {
    version: 1,
    width: dims.width,
    height: dims.height,
    aspectRatio: dims.aspectRatio,
    background: {
      type: 'gradient',
      color: '#0D0E20',
      gradientFrom: '#12102C',
      gradientTo: '#241454',
      gradientAngle: 145,
      pattern: 'glow',
      patternOpacity: 0.2,
      imageUrl: '',
      overlayColor: '#090915',
      overlayOpacity: 0.25,
    },
    palette: {
      primary: primaryColor,
      secondary: secondaryColor,
      accent: accentColor,
      text: '#FFFFFF',
    },
    layers: [
      {
        id: 'lyr-bg-frame',
        type: 'shape',
        name: 'Outer Frame',
        x: Math.round(dims.width * 0.055),
        y: Math.round(dims.height * 0.055),
        width: Math.round(dims.width * 0.89),
        height: Math.round(dims.height * 0.89),
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        visible: true,
        locked: false,
        shapeKind: 'rounded',
        fill: 'rgba(255,255,255,0.03)',
        borderColor: primaryColor,
        borderWidth: 2,
        borderRadius: 32,
        shadow: false,
      },
      {
        id: 'lyr-badge',
        type: 'sticker',
        name: 'Top Badge',
        x: Math.round(dims.width * 0.09),
        y: Math.round(dims.height * 0.1),
        width: 240,
        height: 54,
        rotation: 0,
        opacity: 1,
        zIndex: 2,
        visible: true,
        locked: false,
        emoji: '✨',
        text: 'NEXORA STUDIO',
        fontSize: 20,
        color: '#FFFFFF',
        bgColor: primaryColor,
        borderRadius: 999,
      },
      {
        id: 'lyr-headline',
        type: 'text',
        name: 'Headline',
        x: Math.round(dims.width * 0.09),
        y: Math.round(dims.height * 0.38),
        width: Math.round(dims.width * 0.82),
        height: Math.round(dims.height * 0.22),
        rotation: 0,
        opacity: 1,
        zIndex: 3,
        visible: true,
        locked: false,
        text: 'Create Something Unforgettable',
        fontFamily,
        fontSize: Math.round(Math.min(dims.width, dims.height) * 0.068),
        fontWeight: '800',
        color: '#FFFFFF',
        align: 'left',
        lineHeight: 1.12,
        letterSpacing: -1,
        bgColor: '',
        bgPadding: 0,
        borderRadius: 12,
        shadow: true,
      },
      {
        id: 'lyr-sub',
        type: 'text',
        name: 'Subheading',
        x: Math.round(dims.width * 0.09),
        y: Math.round(dims.height * 0.63),
        width: Math.round(dims.width * 0.78),
        height: 110,
        rotation: 0,
        opacity: 0.9,
        zIndex: 4,
        visible: true,
        locked: false,
        text: 'Customize colors, fonts, photos & layers effortlessly.',
        fontFamily,
        fontSize: Math.round(Math.min(dims.width, dims.height) * 0.03),
        fontWeight: '500',
        color: '#CBD5E1',
        align: 'left',
        lineHeight: 1.35,
        letterSpacing: 0,
        bgColor: '',
        bgPadding: 0,
        borderRadius: 8,
        shadow: false,
      },
    ],
  };
}

export function normalizeTemplateData(rawData) {
  const base = createBlankTemplateData();
  if (!rawData || typeof rawData !== 'object') return base;
  const width = Math.round(clampNumber(rawData.width, 320, 2400, 1080));
  const height = Math.round(clampNumber(rawData.height, 320, 2400, 1080));
  const aspectRatio = String(rawData.aspectRatio || '1:1').slice(0, 20);
  const bg = rawData.background && typeof rawData.background === 'object' ? rawData.background : {};
  const palette = rawData.palette && typeof rawData.palette === 'object' ? rawData.palette : {};

  const layers = (Array.isArray(rawData.layers) ? rawData.layers : [])
    .slice(0, 60)
    .map((l, idx) => {
      const type = ['text', 'image', 'shape', 'sticker'].includes(l?.type) ? l.type : 'text';
      const common = {
        id: String(l?.id || `lyr-${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `lyr-${idx + 1}`,
        type,
        name: String(l?.name || `${type[0].toUpperCase() + type.slice(1)} ${idx + 1}`).slice(0, 60),
        x: Math.round(clampNumber(l?.x, -width, width * 2, 80)),
        y: Math.round(clampNumber(l?.y, -height, height * 2, 80)),
        width: Math.round(clampNumber(l?.width, 20, width * 2, 400)),
        height: Math.round(clampNumber(l?.height, 16, height * 2, 120)),
        rotation: Math.round(clampNumber(l?.rotation, -180, 180, 0)),
        opacity: clampNumber(l?.opacity, 0, 1, 1),
        zIndex: Number.isFinite(Number(l?.zIndex)) ? Number(l.zIndex) : idx + 1,
        visible: l?.visible !== false,
        locked: Boolean(l?.locked),
      };

      if (type === 'text') {
        return {
          ...common,
          text: String(l?.text ?? 'Double-click to edit text').slice(0, 500),
          fontFamily: String(l?.fontFamily || 'Plus Jakarta Sans').slice(0, 60),
          fontSize: Math.round(clampNumber(l?.fontSize, 10, 240, 48)),
          fontWeight: ['400', '500', '600', '700', '800', '900'].includes(String(l?.fontWeight))
            ? String(l.fontWeight)
            : '700',
          color: sanitizeHexColor(l?.color, '#FFFFFF'),
          align: ['left', 'center', 'right'].includes(l?.align) ? l.align : 'left',
          lineHeight: clampNumber(l?.lineHeight, 0.8, 2.5, 1.18),
          letterSpacing: clampNumber(l?.letterSpacing, -6, 20, 0),
          bgColor: l?.bgColor ? sanitizeHexColor(l.bgColor, '') : '',
          bgPadding: Math.round(clampNumber(l?.bgPadding, 0, 64, 0)),
          borderRadius: Math.round(clampNumber(l?.borderRadius, 0, 999, 12)),
          shadow: Boolean(l?.shadow),
        };
      }

      if (type === 'image') {
        return {
          ...common,
          src: typeof l?.src === 'string' ? l.src.slice(0, 380000) : '',
          placeholderLabel: String(l?.placeholderLabel || 'Upload Image').slice(0, 60),
          objectFit: l?.objectFit === 'contain' ? 'contain' : 'cover',
          cropX: clampNumber(l?.cropX, -1, 1, 0),
          cropY: clampNumber(l?.cropY, -1, 1, 0),
          cropZoom: clampNumber(l?.cropZoom, 1, 3, 1),
          borderRadius: Math.round(clampNumber(l?.borderRadius, 0, 999, 20)),
          borderColor: sanitizeHexColor(l?.borderColor, '#FFFFFF'),
          borderWidth: Math.round(clampNumber(l?.borderWidth, 0, 32, 0)),
          frameStyle: ['none', 'polaroid', 'glass', 'neon'].includes(l?.frameStyle) ? l.frameStyle : 'none',
          shadow: Boolean(l?.shadow),
        };
      }

      if (type === 'sticker') {
        return {
          ...common,
          emoji: String(l?.emoji || '✨').slice(0, 10),
          text: String(l?.text || 'BADGE').slice(0, 48),
          fontSize: Math.round(clampNumber(l?.fontSize, 12, 96, 22)),
          color: sanitizeHexColor(l?.color, '#FFFFFF'),
          bgColor: sanitizeHexColor(l?.bgColor, '#701CFF'),
          borderRadius: Math.round(clampNumber(l?.borderRadius, 0, 999, 999)),
        };
      }

      return {
        ...common,
        shapeKind: ['rect', 'rounded', 'circle', 'pill', 'line', 'ring'].includes(l?.shapeKind)
          ? l.shapeKind
          : 'rounded',
        fill: sanitizeHexColor(l?.fill, 'rgba(255,255,255,0.08)'),
        borderColor: sanitizeHexColor(l?.borderColor, '#701CFF'),
        borderWidth: Math.round(clampNumber(l?.borderWidth, 0, 32, 2)),
        borderRadius: Math.round(clampNumber(l?.borderRadius, 0, 999, 24)),
        shadow: Boolean(l?.shadow),
      };
    })
    .sort((a, b) => a.zIndex - b.zIndex);

  return {
    version: 1,
    width,
    height,
    aspectRatio,
    background: {
      type: ['solid', 'gradient', 'image', 'pattern'].includes(bg.type) ? bg.type : 'gradient',
      color: sanitizeHexColor(bg.color, '#0D0E20'),
      gradientFrom: sanitizeHexColor(bg.gradientFrom, '#12102C'),
      gradientTo: sanitizeHexColor(bg.gradientTo, '#286BFF'),
      gradientAngle: Math.round(clampNumber(bg.gradientAngle, 0, 360, 145)),
      pattern: ['none', 'grid', 'dots', 'diagonal', 'glow'].includes(bg.pattern) ? bg.pattern : 'none',
      patternOpacity: clampNumber(bg.patternOpacity, 0, 0.85, 0.18),
      imageUrl: typeof bg.imageUrl === 'string' ? bg.imageUrl.slice(0, 380000) : '',
      overlayColor: sanitizeHexColor(bg.overlayColor, '#090915'),
      overlayOpacity: clampNumber(bg.overlayOpacity, 0, 0.9, 0.25),
    },
    palette: {
      primary: sanitizeHexColor(palette.primary, '#701CFF'),
      secondary: sanitizeHexColor(palette.secondary, '#286BFF'),
      accent: sanitizeHexColor(palette.accent, '#F43F5E'),
      text: sanitizeHexColor(palette.text, '#FFFFFF'),
    },
    layers,
  };
}

export function createNewLayer(type, templateData, extras = {}) {
  const w = Number(templateData?.width || 1080);
  const h = Number(templateData?.height || 1080);
  const maxZ = (templateData?.layers || []).reduce((m, l) => Math.max(m, Number(l.zIndex || 0)), 0);
  const id = `lyr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  if (type === 'text') {
    return {
      id,
      type: 'text',
      name: extras.name || 'Text Layer',
      x: Math.round(w * 0.14),
      y: Math.round(h * 0.42),
      width: Math.round(w * 0.72),
      height: 130,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
      text: extras.text || 'New Headline Text',
      fontFamily: extras.fontFamily || 'Plus Jakarta Sans',
      fontSize: extras.fontSize || Math.round(Math.min(w, h) * 0.055),
      fontWeight: extras.fontWeight || '800',
      color: extras.color || templateData?.palette?.text || '#FFFFFF',
      align: 'center',
      lineHeight: 1.15,
      letterSpacing: 0,
      bgColor: '',
      bgPadding: 0,
      borderRadius: 12,
      shadow: true,
    };
  }

  if (type === 'image') {
    return {
      id,
      type: 'image',
      name: extras.name || 'Image Layer',
      x: Math.round(w * 0.15),
      y: Math.round(h * 0.2),
      width: Math.round(w * 0.7),
      height: Math.round(h * 0.45),
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
      src: extras.src || '',
      placeholderLabel: extras.placeholderLabel || 'Upload Photo',
      objectFit: 'cover',
      cropX: 0,
      cropY: 0,
      cropZoom: 1,
      borderRadius: 24,
      borderColor: '#FFFFFF',
      borderWidth: 0,
      frameStyle: 'none',
      shadow: true,
    };
  }

  if (type === 'sticker') {
    return {
      id,
      type: 'sticker',
      name: extras.name || 'Badge Sticker',
      x: Math.round(w * 0.32),
      y: Math.round(h * 0.12),
      width: 240,
      height: 54,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
      emoji: extras.emoji || '⚡',
      text: extras.text || 'FEATURED',
      fontSize: 22,
      color: '#FFFFFF',
      bgColor: extras.bgColor || templateData?.palette?.accent || '#F43F5E',
      borderRadius: 999,
    };
  }

  return {
    id,
    type: 'shape',
    name: extras.name || 'Shape Layer',
    x: Math.round(w * 0.2),
    y: Math.round(h * 0.25),
    width: Math.round(w * 0.6),
    height: extras.shapeKind === 'line' ? 8 : Math.round(h * 0.35),
    rotation: 0,
    opacity: 1,
    zIndex: maxZ + 1,
    visible: true,
    locked: false,
    shapeKind: extras.shapeKind || 'rounded',
    fill: extras.fill || 'rgba(112, 28, 255, 0.24)',
    borderColor: extras.borderColor || '#701CFF',
    borderWidth: extras.shapeKind === 'line' ? 0 : 2,
    borderRadius: 28,
    shadow: false,
  };
}

export function cloneTemplateForUser(sourceTemplate, userProfile = {}) {
  const normalizedData = normalizeTemplateData(sourceTemplate?.templateData);
  return {
    id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: `${String(sourceTemplate?.title || 'Template').slice(0, 96)} Remix`,
    description: String(sourceTemplate?.description || '').slice(0, 500),
    category: String(sourceTemplate?.category || 'Social Media Posts'),
    style: String(sourceTemplate?.style || 'Modern'),
    aspectRatio: normalizedData.aspectRatio || String(sourceTemplate?.aspectRatio || '1:1'),
    tags: Array.isArray(sourceTemplate?.tags) ? [...sourceTemplate.tags].slice(0, 10) : [],
    previewImageUrl: String(sourceTemplate?.previewImageUrl || ''),
    templateData: deepCloneTemplateData(normalizedData),
    creatorId: String(userProfile?.id || ''),
    creatorName: String(userProfile?.displayName || 'Creator'),
    creatorUsername: String(userProfile?.username || 'creator'),
    creatorAvatar: String(userProfile?.avatar || ''),
    creatorVerified: Boolean(userProfile?.verified),
    visibility: 'private',
    status: 'active',
    isFeatured: false,
    allowRemix: true,
    usagePermission: 'public_remix',
    aiGenerated: Boolean(sourceTemplate?.aiGenerated),
    aiProvider: String(sourceTemplate?.aiProvider || ''),
    sourceTemplateId: String(sourceTemplate?.id || ''),
    likesCount: 0,
    savesCount: 0,
    usesCount: 0,
  };
}

export function createHistoryStack(initialState, maxEntries = 50) {
  let past = [];
  let present = deepCloneTemplateData(initialState);
  let future = [];

  return {
    current: () => deepCloneTemplateData(present),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    push: (nextState) => {
      const nextSerialized = JSON.stringify(nextState);
      if (nextSerialized === JSON.stringify(present)) return false;
      past.push(present);
      if (past.length > maxEntries) past = past.slice(past.length - maxEntries);
      present = JSON.parse(nextSerialized);
      future = [];
      return true;
    },
    undo: () => {
      if (past.length === 0) return null;
      future.unshift(present);
      present = past.pop();
      return deepCloneTemplateData(present);
    },
    redo: () => {
      if (future.length === 0) return null;
      past.push(present);
      present = future.shift();
      return deepCloneTemplateData(present);
    },
    reset: (nextInitial) => {
      past = [];
      future = [];
      present = deepCloneTemplateData(nextInitial);
    },
  };
}

export function filterAndSortTemplates(
  templates = [],
  {
    searchQuery = '',
    category = 'All',
    style = 'All',
    aspectRatio = 'All',
    sortBy = 'trending',
    onlyPublic = false,
  } = {}
) {
  const q = String(searchQuery || '').trim().toLowerCase();
  const filtered = (templates || []).filter((t) => {
    if (!t) return false;
    if (onlyPublic && (t.visibility !== 'public' || t.status !== 'active')) return false;
    if (category && category !== 'All' && t.category !== category) return false;
    if (style && style !== 'All' && t.style !== style) return false;
    if (aspectRatio && aspectRatio !== 'All' && t.aspectRatio !== aspectRatio) return false;
    if (!q) return true;
    const haystack = [
      t.title,
      t.description,
      t.category,
      t.style,
      t.creatorName,
      t.creatorUsername,
      ...(Array.isArray(t.tags) ? t.tags : []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  return filtered.sort((a, b) => {
    if (sortBy === 'newest') return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
    if (sortBy === 'most_used') return Number(b.usesCount || 0) - Number(a.usesCount || 0);
    if (sortBy === 'most_liked') return Number(b.likesCount || 0) - Number(a.likesCount || 0);
    // Trending score combines likes, saves, uses, featured weight, and recency
    const scoreA =
      Number(a.likesCount || 0) * 3 +
      Number(a.savesCount || 0) * 4 +
      Number(a.usesCount || 0) * 5 +
      (a.isFeatured ? 25 : 0);
    const scoreB =
      Number(b.likesCount || 0) * 3 +
      Number(b.savesCount || 0) * 4 +
      Number(b.usesCount || 0) * 5 +
      (b.isFeatured ? 25 : 0);
    return scoreB - scoreA || Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
  });
}
