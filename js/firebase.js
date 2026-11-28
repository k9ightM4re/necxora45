import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';
import {
  doc,
  enableNetwork,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { formatFriendlyError, installGlobalErrorShield, notifyUser } from './notifications.js';
import { getCachedLocalSession } from './local_session.js';

installGlobalErrorShield();

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
function createDb() {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId || undefined
    );
  } catch {
    return firebaseConfig.firestoreDatabaseId
      ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
      : getFirestore(app);
  }
}
export const db = createDb();

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path, fallbackOrOptions = '') {
  const opts =
    typeof fallbackOrOptions === 'string'
      ? { fallback: fallbackOrOptions, silent: false, throwError: false }
      : { fallback: '', silent: false, throwError: false, ...(fallbackOrOptions || {}) };
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path: path || null,
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: Boolean(auth.currentUser?.emailVerified),
      isAnonymous: Boolean(auth.currentUser?.isAnonymous),
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: (auth.currentUser?.providerData || []).map((provider) => ({
        providerId: provider.providerId || null,
        email: provider.email || null,
      })),
    },
  };
  if (!auth.currentUser && getCachedLocalSession()) {
    return formatFriendlyError(error, opts.fallback || 'Workspace ready.');
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  const friendly = formatFriendlyError(
    error,
    opts.fallback || 'Site is busy right now. Please try again in a moment.'
  );
  if (!opts.silent) {
    notifyUser(friendly, 'busy');
  }
  if (opts.throwError) {
    throw new Error(JSON.stringify(errInfo));
  }
  return friendly;
}

let isUnloading = false;
let lastTestedUid = '';
let activeConnectionTest = null;

export async function testConnection(retryCount = 0) {
  if (isUnloading) return;
  if (retryCount === 0 && activeConnectionTest) {
    return activeConnectionTest;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (typeof window !== 'undefined') {
      window.addEventListener(
        'online',
        () => {
          if (isUnloading || !auth.currentUser) return;
          enableNetwork(db).catch(() => {});
          void testConnection(0);
        },
        { once: true }
      );
    }
    return;
  }

  const run = (async () => {
    try {
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady().catch(() => {});
      }
      if (isUnloading || !auth.currentUser) return;
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (isUnloading || !auth.currentUser) return;
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        // If document not found or permission denied, the Firestore backend is online and reachable
        if (msg.includes('not-found') || msg.includes('permission-denied') || msg.includes('already exists')) {
          return;
        }
        if (
          msg.includes('the client is offline') ||
          msg.includes('unavailable') ||
          msg.includes('network-request-failed')
        ) {
          if (retryCount < 2 && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
            setTimeout(() => {
              if (!isUnloading && auth.currentUser) {
                void testConnection(retryCount + 1);
              }
            }, (retryCount + 1) * 2000);
            return;
          }
          notifyUser('Site is busy or your connection is unstable. Reconnecting...', 'busy');
        }
      }
    } finally {
      if (retryCount === 0) {
        activeConnectionTest = null;
      }
    }
  })();

  if (retryCount === 0) {
    activeConnectionTest = run;
  }
  return run;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isUnloading = false;
    enableNetwork(db).catch(() => {});
    if (auth.currentUser) {
      void testConnection(0);
    }
  });
  window.addEventListener('pagehide', () => {
    isUnloading = true;
  });
  window.addEventListener('pageshow', (event) => {
    isUnloading = false;
    if (event.persisted && auth.currentUser) {
      enableNetwork(db).catch(() => {});
    }
  });
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    lastTestedUid = '';
    return;
  }
  if (user.uid !== lastTestedUid) {
    lastTestedUid = user.uid;
    void testConnection(0);
  }
});
