import {
  onAuthStateChanged,
  signOut,
  deleteUser,
  verifyBeforeUpdateEmail,
  updatePassword,
} from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { ensureUserProfile } from './profile.js';
import { formatFriendlyError, installGlobalErrorShield, notifyUser } from './notifications.js';

installGlobalErrorShield();

export function isUserVerified(user) {
  if (!user) return false;
  const usesPhone = Boolean(user.phoneNumber) || user.providerData?.some((p) => p.providerId === 'phone');
  const usesGoogle = user.providerData?.some((p) => p.providerId === 'google.com');
  return Boolean(user.emailVerified || usesPhone || usesGoogle);
}

export async function verifySessionWithServer(user) {
  if (!user) return null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/auth/verify-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function resolveVerifiedSession(user) {
  if (!user) return false;
  if (isUserVerified(user)) return true;
  const serverInfo = await verifySessionWithServer(user);
  return Boolean(serverInfo?.otpVerified);
}

export function getPostAuthDestination(defaultTarget = '/app.html') {
  try {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
      return `/welcome.html?invite=${encodeURIComponent(invite)}`;
    }
    const next = params.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('login') && !next.includes('signup')) {
      return next;
    }
  } catch {}
  return defaultTarget;
}

export function requireAuth({ onAuthenticated, redirectUnauthenticated = '/login.html', requireVerified = false } = {}) {
  let isResolved = false;
  let activeUid = '';

  const busyRedirectUrl = redirectUnauthenticated.includes('?')
    ? `${redirectUnauthenticated}&reason=busy`
    : `${redirectUnauthenticated}?reason=busy`;

  // Fail closed if auth fails to resolve within timeout — never bypass authentication
  const timeoutGuard = setTimeout(() => {
    if (!isResolved) {
      isResolved = true;
      window.location.replace(busyRedirectUrl);
    }
  }, 8000);

  // Guard browser Back/Forward cache (bfcache) restoration after sign-out
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && !auth.currentUser) {
      window.location.replace(redirectUnauthenticated);
    }
  });

  return onAuthStateChanged(
    auth,
    async (user) => {
      if (!user) {
        isResolved = true;
        activeUid = '';
        clearTimeout(timeoutGuard);
        window.location.replace(redirectUnauthenticated);
        return;
      }

      if (isResolved && activeUid === user.uid) return;
      isResolved = true;
      activeUid = user.uid;
      clearTimeout(timeoutGuard);

      if (requireVerified) {
        const verified = await resolveVerifiedSession(user);
        if (!verified) {
          window.location.replace('/verify.html');
          return;
        }
      }

      let profile = null;
      try {
        profile = await ensureUserProfile(user);
      } catch {
        notifyUser('Site is busy right now. Profile details will sync shortly.', 'busy');
      }

      const shell = document.getElementById('app-shell');
      if (shell) shell.hidden = false;
      const gate = document.getElementById('auth-loading-gate');
      if (gate) gate.hidden = true;

      if (typeof onAuthenticated === 'function') {
        onAuthenticated(user, profile);
      }
    },
    (error) => {
      isResolved = true;
      clearTimeout(timeoutGuard);
      notifyUser(formatFriendlyError(error, 'You cannot enter right now. Site is busy.'), 'busy');
      window.location.replace(busyRedirectUrl);
    }
  );
}

export function redirectIfAuthenticated({ defaultTarget = '/app.html', respectLandingParam = false, shouldRedirect = null } = {}) {
  if (respectLandingParam) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('landing') === '1') {
        const authGate = document.getElementById('auth-session-gate');
        const mainContent = document.getElementById('auth-page-content');
        if (authGate) authGate.hidden = true;
        if (mainContent) mainContent.hidden = false;
        return () => {};
      }
    } catch {}
  }

  const revealPage = () => {
    const authGate = document.getElementById('auth-session-gate');
    const mainContent = document.getElementById('auth-page-content');
    if (authGate) authGate.hidden = true;
    if (mainContent) mainContent.hidden = false;
  };

  const handleUser = async (user) => {
    if (typeof shouldRedirect === 'function' && !shouldRedirect()) {
      return;
    }
    if (!user) {
      revealPage();
      return;
    }
    if (typeof shouldRedirect === 'function' && !shouldRedirect()) {
      return;
    }
    window.location.replace(getPostAuthDestination(defaultTarget));
  };

  window.addEventListener('pageshow', (event) => {
    if (event.persisted && auth.currentUser) {
      handleUser(auth.currentUser);
    }
  });

  return onAuthStateChanged(auth, handleUser);
}

export async function signOutSession(redirectTo = '/login.html') {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  } catch {}
  await signOut(auth);
  window.location.replace(redirectTo);
}

export async function changeAccountEmail(newEmail) {
  if (!auth.currentUser) throw new Error('You are not signed in right now.');
  try {
    await verifyBeforeUpdateEmail(auth.currentUser, newEmail);
  } catch (err) {
    throw new Error(
      formatFriendlyError(err, 'Please sign out and sign back in before changing your email.')
    );
  }
}

export async function changeAccountPassword(newPassword) {
  if (!auth.currentUser) throw new Error('You are not signed in right now.');
  try {
    await updatePassword(auth.currentUser, newPassword);
  } catch (err) {
    throw new Error(
      formatFriendlyError(err, 'Please sign out and sign back in before updating your password.')
    );
  }
}

export async function deleteCurrentAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error('You are not signed in right now.');
  const uid = user.uid;

  try {
    await deleteDoc(doc(db, 'users', uid, 'private', 'info')).catch(() => {});
    await deleteDoc(doc(db, 'users', uid)).catch(() => {});
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    await deleteUser(user);
    window.location.replace('/index.html?landing=1');
  } catch (error) {
    throw new Error(
      formatFriendlyError(error, 'Site is busy right now. Could not delete account at this time.')
    );
  }
}
