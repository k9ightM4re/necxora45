import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'auth_accounts.json');

export interface StoredAccount {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  passwordHash: string;
  avatar: string;
  coverPhoto: string;
  bio: string;
  website: string;
  locationLabel: string;
  interests: string[];
  customStatus: string;
  accountPrivacy: 'everyone' | 'requests_only' | 'private';
  createdAtMs: number;
  updatedAtMs: number;
  lastSeenMs: number;
}

interface AccountsStoreFile {
  accounts: Record<string, StoredAccount>;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): AccountsStoreFile {
  ensureDataDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    return { accounts: {} };
  }
  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.accounts && typeof parsed.accounts === 'object') {
      return { accounts: parsed.accounts };
    }
  } catch {}
  return { accounts: {} };
}

function writeStore(store: AccountsStoreFile): void {
  ensureDataDir();
  const tmpFile = `${ACCOUNTS_FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpFile, ACCOUNTS_FILE);
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hashHex] = String(storedHash || '').split(':');
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function sanitizeHandle(raw: string, uid: string): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  if (cleaned.length >= 2) return cleaned.slice(0, 40);
  const seed = String(uid || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return seed.length >= 2 ? `nx_${seed}` : 'nx_member';
}

function getInitials(name: string): string {
  const cleaned = String(name || '').trim();
  if (!cleaned) return 'NX';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase().slice(0, 4) || 'NX';
  }
  return cleaned.slice(0, 2).toUpperCase() || 'NX';
}

export function toPublicProfile(account: StoredAccount) {
  return {
    id: account.uid,
    username: account.username,
    displayName: account.displayName,
    initials: getInitials(account.displayName),
    avatar: account.avatar || '',
    coverPhoto: account.coverPhoto || '',
    bio: account.bio || 'Connect. Create. Share.',
    website: account.website || '',
    locationLabel: account.locationLabel || '',
    interests: Array.isArray(account.interests) ? account.interests : [],
    status: 'online',
    customStatus: account.customStatus || 'Active on NEXORA',
    accountPrivacy: account.accountPrivacy || 'everyone',
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    email: account.email,
    phoneNumber: '',
    emailVerified: true,
    verified: false,
    suspended: false,
    isNexoraAccount: true,
  };
}

export function toAuthUser(account: StoredAccount) {
  return {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    photoUrl: account.avatar || '',
    emailVerified: true,
    phoneNumber: '',
    providers: ['password'],
    isNexoraAccount: true,
  };
}

export function signNexoraAccountToken(account: StoredAccount, serverSecret: string): string {
  const payload = {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', serverSecret).update(encoded).digest('hex');
  return `nx_acct.${encoded}.${sig}`;
}

export function verifyNexoraAccountToken(token: string, serverSecret: string): any | null {
  if (!token || !token.startsWith('nx_acct.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sigHex] = parts;
  if (!encoded || !sigHex) return null;

  const expectedSig = crypto.createHmac('sha256', serverSecret).update(encoded).digest('hex');
  const a = Buffer.from(sigHex, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.uid || typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return null;
    }
    const store = readStore();
    const account = store.accounts[payload.uid];
    if (!account) return null;
    return {
      uid: account.uid,
      email: account.email,
      emailVerified: true,
      phoneNumber: '',
      displayName: account.displayName,
      photoUrl: account.avatar || '',
      providers: ['password'],
      idToken: token,
      account,
    };
  } catch {
    return null;
  }
}

function readTokenFromRequest(req: Request): string {
  const authHeader = String(req.headers['authorization'] || '');
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer.startsWith('nx_acct.')) return bearer;
  }
  const cookieHeader = String(req.headers['cookie'] || '');
  const match = cookieHeader.match(/(?:^|;\s*)nx_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function setSessionCookie(res: Response, token: string, isHttps: boolean): void {
  const flags = isHttps
    ? 'HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=604800'
    : 'HttpOnly; SameSite=Lax; Path=/; Max-Age=604800';
  res.setHeader('Set-Cookie', `nx_session=${encodeURIComponent(token)}; ${flags}`);
}

export function mountLocalAuthRoutes(
  app: Express,
  deps: {
    serverSecret: string;
    checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
    isHttpsRequest: (req: Request) => boolean;
  }
): void {
  const { serverSecret, checkRateLimit, isHttpsRequest } = deps;

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const body = req.body || {};
    const displayName = String(body.displayName || '').trim().slice(0, 50);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (displayName.length < 2) {
      res.status(400).json({ error: 'Display name must be at least 2 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const ip = String(req.socket?.remoteAddress || 'local');
    const rate = checkRateLimit(`register:${ip}`, 15, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many requests. Wait ${rate.retryAfterSec}s.` });
      return;
    }

    const store = readStore();
    const existing = Object.values(store.accounts).find((acc) => acc.email === email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
      return;
    }

    const uid = `nxu_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    const account: StoredAccount = {
      uid,
      email,
      displayName,
      username: sanitizeHandle(email.split('@')[0] || displayName, uid),
      passwordHash: hashPassword(password),
      avatar: '',
      coverPhoto: '',
      bio: 'Connect. Create. Share.',
      website: '',
      locationLabel: '',
      interests: [],
      customStatus: 'Active on NEXORA',
      accountPrivacy: 'everyone',
      createdAtMs: now,
      updatedAtMs: now,
      lastSeenMs: now,
    };

    store.accounts[uid] = account;
    writeStore(store);

    const token = signNexoraAccountToken(account, serverSecret);
    setSessionCookie(res, token, isHttpsRequest(req));
    res.status(201).json({
      ok: true,
      token,
      user: toAuthUser(account),
      profile: toPublicProfile(account),
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      res.status(400).json({ error: 'Please enter a valid email address and password.' });
      return;
    }

    const ip = String(req.socket?.remoteAddress || 'local');
    const rate = checkRateLimit(`login:${ip}:${email}`, 20, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many sign-in attempts. Wait ${rate.retryAfterSec}s.` });
      return;
    }

    const store = readStore();
    const account = Object.values(store.accounts).find((acc) => acc.email === email);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      res.status(401).json({ error: 'Incorrect email or password. Please check your details and try again.' });
      return;
    }

    account.lastSeenMs = Date.now();
    store.accounts[account.uid] = account;
    writeStore(store);

    const token = signNexoraAccountToken(account, serverSecret);
    setSessionCookie(res, token, isHttpsRequest(req));
    res.json({
      ok: true,
      token,
      user: toAuthUser(account),
      profile: toPublicProfile(account),
    });
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const token = readTokenFromRequest(req);
    const verified = verifyNexoraAccountToken(token, serverSecret);
    if (!verified?.account) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      token,
      user: toAuthUser(verified.account),
      profile: toPublicProfile(verified.account),
    });
  });

  app.post('/api/auth/profile', (req: Request, res: Response) => {
    const token = readTokenFromRequest(req);
    const verified = verifyNexoraAccountToken(token, serverSecret);
    if (!verified?.account) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const body = req.body || {};
    const store = readStore();
    const account = store.accounts[verified.uid];
    if (!account) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    if (typeof body.displayName === 'string' && body.displayName.trim().length >= 1) {
      account.displayName = body.displayName.trim().slice(0, 50);
    }
    if (typeof body.username === 'string' && body.username.trim().length >= 2) {
      account.username = sanitizeHandle(body.username, account.uid);
    }
    if (typeof body.bio === 'string') account.bio = body.bio.slice(0, 500);
    if (typeof body.website === 'string') account.website = body.website.slice(0, 200);
    if (typeof body.locationLabel === 'string') account.locationLabel = body.locationLabel.trim().slice(0, 100);
    if (Array.isArray(body.interests)) {
      account.interests = body.interests.map((v: unknown) => String(v || '').trim().slice(0, 40)).filter(Boolean).slice(0, 20);
    }
    if (typeof body.customStatus === 'string') account.customStatus = body.customStatus.slice(0, 200);
    if (['everyone', 'requests_only', 'private'].includes(body.accountPrivacy)) {
      account.accountPrivacy = body.accountPrivacy;
    }
    if (typeof body.avatar === 'string') account.avatar = body.avatar.slice(0, 200000);
    if (typeof body.coverPhoto === 'string') account.coverPhoto = body.coverPhoto.slice(0, 300000);

    account.updatedAtMs = Date.now();
    account.lastSeenMs = Date.now();
    store.accounts[account.uid] = account;
    writeStore(store);

    res.json({
      ok: true,
      user: toAuthUser(account),
      profile: toPublicProfile(account),
    });
  });
}
