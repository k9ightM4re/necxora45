import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User as FirebaseUser,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
function createDb() {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        experimentalLongPollingOptions: { timeoutSeconds: 20 },
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

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Google Auth Provider configured with Workspace Scopes
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Add Gmail, Google Chat, and Contacts scopes
const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/directory.readonly',
  'https://www.googleapis.com/auth/user.emails.read',
];

SCOPES.forEach(scope => googleProvider.addScope(scope));

// In-Memory Token Cache (MANDATORY per Workspace Skill)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const googleSignIn = async (): Promise<{
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || (await result.user.getIdToken());
    if (!token) {
      throw new Error('Failed to retrieve authentication token from Google.');
    }
    cachedAccessToken = token;

    return {
      uid: result.user.uid,
      displayName: result.user.displayName || result.user.email?.split('@')[0] || 'Google User',
      email: result.user.email || '',
      photoURL:
        result.user.photoURL ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      accessToken: token,
    };
  } catch (error: any) {
    console.error('Google Sign-In Error:', error);
    const code = error?.code || '';
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Sign-in popup was closed before completing login.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Sign-in popup was blocked by your browser. Please allow popups for this site.');
    }
    throw new Error(error?.message || 'Google Sign-In failed. Please try again.');
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const getStoredOAuthToken = (): string | null => {
  return cachedAccessToken;
};

export const logoutAuth = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

export const initAuthListener = (
  onAuthSuccess: (user: FirebaseUser, token: string) => void,
  onAuthFailure: () => void
) => {
  return onAuthStateChanged(auth, async (user: FirebaseUser | null) => {
    if (user && cachedAccessToken) {
      onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      onAuthFailure();
    }
  });
};

// Firestore Error Handler helper per SKILL
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path,
  };
  console.error('Firestore Operation Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
