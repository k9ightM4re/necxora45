/**
 * Pure social media logic, formatting, search scoring, media sizing, and admin validation helpers.
 */

export const PRIMARY_ADMIN_EMAIL = 'kj74647688@gmail.com';
export const PRIMARY_ADMIN_EMAILS = new Set([
  'kj74647688@gmail.com',
  'shrevansh7@gmail.com',
]);

export function sanitizeSafeUrl(rawUrl, fallback = '') {
  const val = String(rawUrl || '').trim();
  if (!val) return fallback;
  if (/^(javascript|vbscript|file):/i.test(val)) return fallback;
  if (val.startsWith('/api/media/') || val.startsWith('/assets/')) return val;
  if (/^blob:/i.test(val)) return val;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/i.test(val)) return val;
  if (/^data:audio\/(webm|ogg|mp4|mpeg|wav);base64,[a-zA-Z0-9+/=]+$/i.test(val)) return val;
  if (/^data:video\/(mp4|webm|ogg);base64,[a-zA-Z0-9+/=]+$/i.test(val)) return val;
  try {
    const parsed = new URL(val, typeof window !== 'undefined' ? window.location.origin : 'https://nexora.app');
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return val;
    }
  } catch {}
  return fallback;
}

export async function uploadMediaFileToServer(file, { kind = 'general', token = '' } = {}) {
  if (!file) throw new Error('No file provided');
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('File must be 10 MB or smaller.');
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });

  if (token) {
    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: String(file.name || 'upload').slice(0, 120),
          mimeType: String(file.type || 'application/octet-stream').slice(0, 80),
          kind,
          dataUrl,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.url) {
          return {
            url: json.url,
            mediaId: json.id,
            mimeType: json.mimeType || file.type,
            size: Number(json.size || file.size),
            storedOnServer: true,
          };
        }
      }
    } catch {}
  }

  return {
    url: dataUrl,
    mediaId: '',
    mimeType: file.type,
    size: file.size,
    storedOnServer: false,
  };
}

export function extractHashtags(text, maxTags = 20) {
  const matches = String(text || '').match(/#([a-zA-Z0-9_]{2,40})/g) || [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const clean = `#${m.slice(1).toLowerCase()}`;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxTags) break;
  }
  return out;
}

export function extractMentions(text, maxMentions = 20) {
  const matches = String(text || '').match(/@([a-zA-Z0-9._-]{2,40})/g) || [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const clean = m.slice(1).toLowerCase();
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxMentions) break;
  }
  return out;
}

export function formatRelativeTime(tsMs, nowMs = Date.now()) {
  const ms = Number(tsMs || 0);
  if (!ms || Number.isNaN(ms)) return 'Just now';
  const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Earlier';
  }
}

export function formatCompactCount(num) {
  const n = Math.max(0, Number(num || 0));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.floor(n));
}

export function rankTrendingHashtags(posts = [], limit = 6) {
  const counts = new Map();
  for (const post of posts || []) {
    if (!post) continue;
    const tags = Array.isArray(post.hashtags) && post.hashtags.length
      ? post.hashtags
      : extractHashtags(post.content || '');
    for (const raw of tags) {
      const normalized = raw.startsWith('#') ? raw.toLowerCase() : `#${String(raw).toLowerCase()}`;
      if (normalized.length < 3) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

export function filterActiveStories(stories = [], nowMs = Date.now()) {
  return (stories || [])
    .filter((s) => s && Number(s.expiresAtMs || 0) > nowMs)
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
}

export function groupStoriesByUser(stories = [], currentUid = '', nowMs = Date.now()) {
  const active = filterActiveStories(stories, nowMs);
  const byUser = new Map();
  for (const st of active) {
    const uid = st.userId || '';
    if (!uid) continue;
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        userId: uid,
        userName: st.userName || 'Member',
        userAvatar: st.userAvatar || '',
        userInitials: st.userInitials || 'NX',
        items: [],
      });
    }
    byUser.get(uid).items.push(st);
  }
  const groups = Array.from(byUser.values());
  groups.sort((a, b) => {
    if (a.userId === currentUid) return -1;
    if (b.userId === currentUid) return 1;
    return Number(b.items[0]?.createdAtMs || 0) - Number(a.items[0]?.createdAtMs || 0);
  });
  return groups;
}

export function isAdminUser(authUser, adminUidSet = new Set()) {
  if (!authUser) return false;
  const uid = authUser.uid || authUser.id || '';
  if (uid && adminUidSet instanceof Set && adminUidSet.has(uid)) return true;
  const email = String(authUser.email || '').trim().toLowerCase();
  return PRIMARY_ADMIN_EMAILS.has(email) && Boolean(authUser.emailVerified);
}

export function scoreSearchMatches(queryText, { posts = [], users = [], reels = [], communities = [] } = {}) {
  const q = String(queryText || '').trim().toLowerCase();
  if (!q) {
    return {
      users: users.slice(0, 12),
      posts: posts.slice(0, 12),
      reels: reels.slice(0, 12),
      communities: communities.slice(0, 12),
      hashtags: rankTrendingHashtags(posts, 10),
    };
  }
  const qTag = q.startsWith('#') ? q : `#${q}`;
  const matchedUsers = (users || []).filter(
    (u) =>
      String(u.displayName || '').toLowerCase().includes(q) ||
      String(u.username || '').toLowerCase().includes(q) ||
      String(u.bio || '').toLowerCase().includes(q)
  );
  const matchedPosts = (posts || []).filter(
    (p) =>
      String(p.content || '').toLowerCase().includes(q) ||
      String(p.authorName || '').toLowerCase().includes(q) ||
      (Array.isArray(p.hashtags) && p.hashtags.some((t) => String(t).toLowerCase().includes(qTag) || String(t).toLowerCase().includes(q)))
  );
  const matchedReels = (reels || []).filter(
    (r) =>
      String(r.caption || '').toLowerCase().includes(q) ||
      String(r.authorName || '').toLowerCase().includes(q) ||
      String(r.audioTitle || '').toLowerCase().includes(q)
  );
  const matchedCommunities = (communities || []).filter(
    (c) =>
      String(c.name || '').toLowerCase().includes(q) ||
      String(c.category || '').toLowerCase().includes(q) ||
      String(c.description || '').toLowerCase().includes(q)
  );
  const hashtags = rankTrendingHashtags(posts, 20).filter((h) => h.tag.includes(q.replace(/^#/, '')));
  return {
    users: matchedUsers.slice(0, 20),
    posts: matchedPosts.slice(0, 25),
    reels: matchedReels.slice(0, 20),
    communities: matchedCommunities.slice(0, 20),
    hashtags,
  };
}

export function formatFileSize(bytes) {
  const b = Math.max(0, Number(bytes || 0));
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateMeetingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let partA = '';
  let partB = '';
  for (let i = 0; i < 4; i++) {
    partA += chars[Math.floor(Math.random() * chars.length)];
    partB += chars[Math.floor(Math.random() * chars.length)];
  }
  return `NX-${partA}-${partB}`;
}

export const NEXORA_THEMES = ['dark', 'light'];

export function normalizeThemePreference(raw) {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'light') return 'light';
  if (val === 'dark' || val === 'navy-dark' || val === 'midnight-cyan' || val === 'ember') return 'dark';
  return 'dark';
}

export async function compressImageFile(file, { maxW = 1080, maxH = 1080, quality = 0.78, maxBytes = 240000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No image selected.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format.'));
      img.onload = () => {
        let width = img.naturalWidth || img.width || 800;
        let height = img.naturalHeight || img.height || 800;
        const ratio = Math.min(1, maxW / width, maxH / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Image processing unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        let q = quality;
        let dataUrl = canvas.toDataURL('image/jpeg', q);
        while (dataUrl.length > maxBytes && q > 0.35) {
          q -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', q);
        }
        if (dataUrl.length > maxBytes * 1.45) {
          canvas.width = Math.max(160, Math.round(width * 0.7));
          canvas.height = Math.max(160, Math.round(height * 0.7));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export async function readMediaFileBounded(file, maxBytes = 550000) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected.'));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error(`Please choose a file under ${formatFileSize(maxBytes)} for instant real-time sync.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export function estimateJsonByteSize(obj) {
  try {
    const str = JSON.stringify(obj);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str).length;
    }
    return str.length * 2;
  } catch {
    return 0;
  }
}

export function canUserViewPost(post, viewerUid, followingIds = new Set(), blockedSet = new Set()) {
  if (!post || !post.authorId) return false;
  if (blockedSet instanceof Set && blockedSet.has(post.authorId)) return false;
  if (post.authorId === viewerUid) return true;
  if (post.visibility === 'public') return true;
  if (post.visibility === 'followers') {
    if (followingIds instanceof Set && followingIds.has(post.authorId)) return true;
    if (Array.isArray(post.allowedViewerUids) && post.allowedViewerUids.includes(viewerUid)) return true;
  }
  return false;
}

export function filterAndSortFeedPosts(
  posts = [],
  {
    viewerUid = '',
    followingIds = new Set(),
    blockedSet = new Set(),
    feedTab = 'for-you',
    hashtag = '',
  } = {}
) {
  const tagFilter = String(hashtag || '').trim().toLowerCase();
  const visible = (posts || []).filter((p) => {
    if (!canUserViewPost(p, viewerUid, followingIds, blockedSet)) return false;
    if (tagFilter) {
      const hasTag =
        (Array.isArray(p.hashtags) && p.hashtags.some((t) => String(t).toLowerCase() === tagFilter)) ||
        String(p.content || '').toLowerCase().includes(tagFilter);
      if (!hasTag) return false;
    }
    if (feedTab === 'following') {
      const isFollowing = followingIds instanceof Set ? followingIds.has(p.authorId) : false;
      return p.authorId === viewerUid || isFollowing;
    }
    return true;
  });

  if (feedTab === 'for-you') {
    return [...visible].sort((a, b) => {
      const scoreA = (Number(a.likesCount || 0) * 2) + (Number(a.commentsCount || 0) * 3) + (Number(a.createdAtMs || 0) / 3600000);
      const scoreB = (Number(b.likesCount || 0) * 2) + (Number(b.commentsCount || 0) * 3) + (Number(b.createdAtMs || 0) / 3600000);
      return scoreB - scoreA;
    });
  }

  return [...visible].sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
}

export function buildCommentThreads(comments = []) {
  const sorted = [...(comments || [])].sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
  const byId = new Map();
  const roots = [];
  for (const c of sorted) {
    if (!c || !c.id) continue;
    byId.set(c.id, { ...c, replies: [] });
  }
  for (const c of sorted) {
    if (!c || !c.id) continue;
    const node = byId.get(c.id);
    if (c.replyToId && byId.has(c.replyToId) && c.replyToId !== c.id) {
      byId.get(c.replyToId).replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function selectSuggestedUsers(
  directoryUsers = [],
  { viewerUid = '', followingIds = new Set(), blockedSet = new Set(), limit = 4 } = {}
) {
  return (directoryUsers || [])
    .filter((u) => {
      if (!u || !u.id) return false;
      if (u.id === viewerUid) return false;
      if (blockedSet instanceof Set && blockedSet.has(u.id)) return false;
      if (followingIds instanceof Set && followingIds.has(u.id)) return false;
      if (u.accountPrivacy === 'private') return false;
      if (u.suspended) return false;
      return true;
    })
    .sort((a, b) => Number(b.followersCount || 0) - Number(a.followersCount || 0))
    .slice(0, limit);
}

