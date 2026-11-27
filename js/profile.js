import { updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase.js';
import { sanitizeSafeUrl } from './social_utils.js';

export function sanitizeHandle(raw, seed = '') {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  if (cleaned.length >= 2) {
    return cleaned.slice(0, 40);
  }
  const cleanSeed = String(seed || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  return cleanSeed.length >= 2 ? `nx_${cleanSeed}` : 'nx_member';
}

export function getInitials(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return 'NX';

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const chars1 = Array.from(parts[0]);
    const chars2 = Array.from(parts[1]);
    const init = ((chars1[0] || '') + (chars2[0] || '')).toUpperCase().trim();
    return init.length >= 1 ? init.slice(0, 4) : 'NX';
  }

  const chars = Array.from(cleaned);
  const init = chars.slice(0, 2).join('').toUpperCase().trim();
  return init.length >= 1 ? init.slice(0, 4) : 'NX';
}

export async function ensureUserProfile(user, extra = {}) {
  if (!user?.uid) return null;
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  const fallbackName =
    extra.displayName ||
    user.displayName ||
    (user.email ? user.email.split('@')[0] : '') ||
    (user.phoneNumber ? `Member ${user.phoneNumber.slice(-4)}` : 'NEXORA Member');

  const rawDisplay = Array.from(String(fallbackName).trim()).slice(0, 50).join('');
  const displayName = rawDisplay || 'NEXORA Member';
  const username = sanitizeHandle(extra.username || user.email?.split('@')[0] || displayName, user.uid);
  const initials = getInitials(displayName);
  const avatar = String(user.photoURL || '').slice(0, 200000);

  let publicProfile = null;

  // 1. Fetch or create public user document
  try {
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      publicProfile = {
        id: user.uid,
        username,
        displayName,
        initials,
        avatar,
        coverPhoto: '',
        bio: String(extra.bio || 'Connect. Create. Share.').slice(0, 500),
        status: 'online',
        customStatus: String(extra.customStatus || 'Active on NEXORA').slice(0, 200),
        accountPrivacy: 'everyone',
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        lastSeenMs: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, publicProfile);
    } else {
      publicProfile = snap.data();
      const patch = { lastSeenMs: Date.now(), updatedAt: serverTimestamp() };
      if (avatar && !publicProfile.avatar) {
        patch.avatar = avatar;
        publicProfile.avatar = avatar;
      }
      if (publicProfile.status === 'offline') {
        patch.status = 'online';
        publicProfile.status = 'online';
      }
      updateDoc(userRef, patch).catch(() => {});
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
    return null;
  }

  // 2. Isolate PII under subcollection /users/{uid}/private/info
  try {
    const privateRef = doc(db, 'users', user.uid, 'private', 'info');
    await setDoc(
      privateRef,
      {
        email: String(user.email || '').slice(0, 200),
        phoneNumber: String(user.phoneNumber || '').slice(0, 40),
        authProvider: String(user.providerData?.[0]?.providerId || 'password').slice(0, 80),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (privateErr) {
    console.warn('Non-fatal: could not synchronize private user info:', privateErr);
  }

  return {
    ...publicProfile,
    id: user.uid,
    displayName: publicProfile?.displayName || displayName,
    username: publicProfile?.username || username,
    initials: publicProfile?.initials || initials,
    avatar: publicProfile?.avatar || avatar,
    coverPhoto: publicProfile?.coverPhoto || '',
    accountPrivacy: publicProfile?.accountPrivacy || 'everyone',
    followersCount: Math.max(0, Number(publicProfile?.followersCount || 0)),
    followingCount: Math.max(0, Number(publicProfile?.followingCount || 0)),
    postsCount: Math.max(0, Number(publicProfile?.postsCount || 0)),
    email: user.email || '',
    phoneNumber: user.phoneNumber || '',
    emailVerified: Boolean(user.emailVerified),
    verified: Boolean(publicProfile?.verified),
    suspended: Boolean(publicProfile?.suspended),
  };
}

export async function loadUserProfile(uid) {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

export async function updateUserProfile(uid, updates) {
  const path = `users/${uid}`;
  try {
    const rawDisplay = Array.from(String(updates.displayName || '').trim()).slice(0, 50).join('');
    const displayName = rawDisplay || 'NEXORA Member';
    const username = sanitizeHandle(updates.username || displayName, uid);
    const initials = getInitials(displayName);
    const privacy = ['everyone', 'requests_only', 'private'].includes(updates.accountPrivacy)
      ? updates.accountPrivacy
      : 'everyone';

    if (auth.currentUser && displayName) {
      await updateProfile(auth.currentUser, { displayName }).catch(() => {});
    }

    const payload = {
      displayName,
      username,
      initials,
      bio: String(updates.bio || '').slice(0, 500),
      status: updates.status || 'online',
      customStatus: String(updates.customStatus || '').slice(0, 200),
      accountPrivacy: privacy,
      lastSeenMs: Date.now(),
      updatedAt: serverTimestamp(),
    };
    if (typeof updates.avatar === 'string') {
      payload.avatar = sanitizeSafeUrl(updates.avatar).slice(0, 200000);
    }
    if (typeof updates.coverPhoto === 'string') {
      payload.coverPhoto = sanitizeSafeUrl(updates.coverPhoto).slice(0, 300000);
    }

    await updateDoc(doc(db, 'users', uid), payload);

    return {
      displayName,
      username,
      initials,
      accountPrivacy: privacy,
      ...(typeof payload.avatar === 'string' ? { avatar: payload.avatar } : {}),
      ...(typeof payload.coverPhoto === 'string' ? { coverPhoto: payload.coverPhoto } : {}),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    return null;
  }
}

export function getCartoonAvatarSvg(userId, displayName, size = 40) {
  const hash = Array.from(String(userId || 'nx')).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const palettes = [
    ['#FF7A2F', '#FFB03A', '#111D33'],
    ['#2563EB', '#38BDF8', '#0B1424'],
    ['#16A34A', '#4ADE80', '#064E3B'],
    ['#3868CE', '#4777DF', '#1D232C'],
    ['#C49A52', '#E0B873', '#242B35'],
  ];
  const palette = palettes[hash % palettes.length];
  const initials = getInitials(displayName || 'Member');
  const monsterType = hash % 3;

  let innerArt = '';
  if (monsterType === 0) {
    innerArt = `<rect x="8" y="8" width="24" height="20" rx="6" fill="${palette[1]}"/><circle cx="16" cy="16" r="3" fill="#ffffff"/><circle cx="24" cy="16" r="3" fill="#ffffff"/><circle cx="16" cy="16" r="1.2" fill="#0b1424"/><circle cx="24" cy="16" r="1.2" fill="#0b1424"/><rect x="15" y="22" width="10" height="3" rx="1.5" fill="#ffffff"/><line x1="20" y1="8" x2="20" y2="4" stroke="${palette[1]}" stroke-width="2"/><circle cx="20" cy="3" r="2" fill="${palette[0]}"/>`;
  } else if (monsterType === 1) {
    innerArt = `<circle cx="20" cy="20" r="14" fill="${palette[1]}"/><circle cx="14" cy="17" r="3.5" fill="#ffffff"/><circle cx="26" cy="17" r="3.5" fill="#ffffff"/><circle cx="14" cy="17" r="1.5" fill="#0b1424"/><circle cx="26" cy="17" r="1.5" fill="#0b1424"/><path d="M15 24 Q20 28 25 24" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round"/><polygon points="10,8 14,13 16,10" fill="${palette[0]}"/><polygon points="30,8 26,13 24,10" fill="${palette[0]}"/>`;
  } else {
    innerArt = `<circle cx="20" cy="20" r="15" fill="${palette[1]}"/><text x="20" y="25" text-anchor="middle" fill="#ffffff" font-weight="800" font-size="14" font-family="system-ui">${initials}</text><circle cx="12" cy="12" r="2" fill="${palette[0]}"/><circle cx="28" cy="28" r="2" fill="${palette[0]}"/>`;
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="cartoon-avatar-svg" style="border-radius:50%;background:linear-gradient(135deg, ${palette[0]}, ${palette[2]});box-shadow:0 2px 8px rgba(0,0,0,0.2);flex-shrink:0;">${innerArt}</svg>`;
}

export function renderUserAvatarHtml(userObj, size = 36) {
  const safeAvatar = sanitizeSafeUrl(userObj?.avatar || '');
  if (safeAvatar) {
    const escaped = safeAvatar.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeSize = Math.max(16, Math.min(240, Number(size) || 36));
    return `<img src="${escaped}" alt="" style="width:${safeSize}px;height:${safeSize}px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`;
  }
  return getCartoonAvatarSvg(userObj?.id || userObj?.userId || 'nx', userObj?.displayName || 'Member', size);
}

