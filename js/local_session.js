const LOCAL_SESSION_KEY = 'nx_local_session_v1';
const authListeners = new Set();

function buildCompatUser(token, user, profile) {
  if (!token || !user?.uid) return null;
  const resolvedDisplay = profile?.displayName || user.displayName || 'Nexora Member';
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: resolvedDisplay,
    photoURL: profile?.avatar || user.photoUrl || '',
    phoneNumber: user.phoneNumber || '',
    emailVerified: true,
    isAnonymous: false,
    isNexoraAccount: true,
    providerData: [{ providerId: 'password', email: user.email || '' }],
    getIdToken: async () => token,
    reload: async () => {},
  };
}

function emitLocalAuthChange(user) {
  authListeners.forEach((cb) => {
    try {
      cb(user);
    } catch {}
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nexora:local-auth-change', { detail: { user } }));
  }
}

export function getCachedLocalSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user?.uid) return null;
    return {
      token: parsed.token,
      user: buildCompatUser(parsed.token, parsed.user, parsed.profile),
      profile: parsed.profile || null,
    };
  } catch {
    return null;
  }
}

export function saveLocalSession(token, user, profile = null) {
  if (typeof window === 'undefined' || !token || !user?.uid) return null;
  try {
    window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ token, user, profile }));
  } catch {}
  const compatUser = buildCompatUser(token, user, profile);
  emitLocalAuthChange(compatUser);
  return { token, user: compatUser, profile };
}

export function clearLocalSession() {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(LOCAL_SESSION_KEY);
    } catch {}
  }
  emitLocalAuthChange(null);
}

export function subscribeLocalAuthChange(callback) {
  if (typeof callback !== 'function') return () => {};
  authListeners.add(callback);
  return () => authListeners.delete(callback);
}

export async function restoreLocalSessionFromServer() {
  const cached = getCachedLocalSession();
  try {
    const headers = {};
    if (cached?.token) {
      headers.Authorization = `Bearer ${cached.token}`;
    }
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers,
      credentials: 'same-origin',
    });
    if (!res.ok) return cached;
    const data = await res.json();
    if (data?.authenticated && data?.token && data?.user?.uid) {
      return saveLocalSession(data.token, data.user, data.profile || null);
    }
    if (cached) clearLocalSession();
    return null;
  } catch {
    return cached;
  }
}

export async function registerLocalAccount({ displayName, email, password }) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ displayName, email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token || !data?.user?.uid) {
    throw new Error(data?.error || 'Could not create account right now.');
  }
  return saveLocalSession(data.token, data.user, data.profile || null);
}

export async function loginLocalAccount({ email, password }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token || !data?.user?.uid) {
    throw new Error(data?.error || 'Incorrect email or password.');
  }
  return saveLocalSession(data.token, data.user, data.profile || null);
}

export async function updateLocalProfile(updates) {
  const cached = getCachedLocalSession();
  const headers = { 'Content-Type': 'application/json' };
  if (cached?.token) {
    headers.Authorization = `Bearer ${cached.token}`;
  }
  const res = await fetch('/api/auth/profile', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(updates || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Could not update profile.');
  }
  if (cached?.token && data?.user && data?.profile) {
    saveLocalSession(cached.token, data.user, data.profile);
  }
  return data?.profile || null;
}
