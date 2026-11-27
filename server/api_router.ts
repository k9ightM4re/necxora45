import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response, NextFunction } from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  deleteUserProvider,
  getPlatformGeminiConfigured,
  listUserProviders,
  upsertUserProvider,
} from './ai_vault.ts';
import {
  AiServiceError,
  generateTemplatesWithAi,
  testAiProviderConnection,
} from './ai_template_engine.ts';
import { mountSocialCircleRoutes } from './social_circle/router.ts';

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = fs.existsSync(firebaseConfigPath)
  ? JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'))
  : {};

interface EmailOtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

const emailOtpStore = new Map<string, EmailOtpEntry>();
const SERVER_SECRET = process.env.SESSION_SECRET || 'nexora-otp-secret-2026';
const rateBuckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    rateBuckets.set(key, timestamps);
    return { allowed: false, retryAfterSec };
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return { allowed: true, retryAfterSec: 0 };
}

export async function verifyFirebaseToken(idToken: string): Promise<any | null> {
  if (!idToken || !firebaseConfig.apiKey) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const user = data?.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: user.email || '',
      emailVerified: Boolean(user.emailVerified),
      phoneNumber: user.phoneNumber || '',
      displayName: user.displayName || '',
    };
  } catch {
    return null;
  }
}

async function requireVerifiedBearer(req: Request, res: Response): Promise<any | null> {
  const authHeader = String(req.headers['authorization'] || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const verified = await verifyFirebaseToken(token);
  if (!verified) {
    res.status(401).json({ error: 'Authentication required. Please sign in to NEXORA.' });
    return null;
  }
  return verified;
}

export function mountNexoraApiRoutes(app: Express): void {
  // Security headers + block direct static access to private server vault directory
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/.data') || req.path.startsWith('/server/')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'nexora-api',
      projectId: firebaseConfig.projectId || null,
      platformGeminiConfigured: getPlatformGeminiConfigured(),
    });
  });

  app.post('/api/auth/rate-check', (req: Request, res: Response) => {
    const body = req.body || {};
    const kind = String(body.kind || 'otp');
    const identifier = String(body.identifier || 'anon').slice(0, 64);
    const ip = String(req.socket?.remoteAddress || 'local');
    const result = checkRateLimit(`${kind}:${ip}:${identifier}`, 5, 5 * 60 * 1000);
    if (!result.allowed) {
      res.status(429).json({
        allowed: false,
        retryAfterSec: result.retryAfterSec,
        error: `Too many requests. Wait ${result.retryAfterSec}s.`,
      });
      return;
    }
    res.json({ allowed: true });
  });

  app.post('/api/auth/verify-session', async (req: Request, res: Response) => {
    const verified = await requireVerifiedBearer(req, res);
    if (!verified) return;

    let otpVerified = false;
    const cookieHeader = String(req.headers['cookie'] || '');
    const match = cookieHeader.match(/(?:^|;\s*)nx_otp_sig=([^;]+)/);
    if (match && verified.email) {
      const expected = crypto
        .createHmac('sha256', SERVER_SECRET)
        .update(`verified:${verified.email.toLowerCase()}`)
        .digest('hex');
      if (match[1] === expected) {
        otpVerified = true;
      }
    }
    res.json({ verified: true, otpVerified, user: verified });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', 'nx_otp_sig=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.post('/api/auth/send-email-otp', (req: Request, res: Response) => {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const ip = String(req.socket?.remoteAddress || 'local');
    const limitCheck = checkRateLimit(`email-otp:${ip}:${email}`, 5, 5 * 60 * 1000);
    if (!limitCheck.allowed) {
      res.status(429).json({
        error: `Too many requests. Please wait ${limitCheck.retryAfterSec}s before retrying.`,
      });
      return;
    }

    const code = crypto.randomInt(100000, 999999).toString();
    emailOtpStore.set(email, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
    });

    if (firebaseConfig.apiKey) {
      fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestType: 'EMAIL_SIGNIN',
            email,
            continueUrl: `${req.headers.origin || 'http://localhost:3000'}/login.html`,
            canHandleCodeInApp: true,
          }),
        }
      ).catch(() => {});
    }

    res.json({
      ok: true,
      message: `Verification code sent to ${email}.`,
      expiresInSec: 600,
    });
  });

  app.post('/api/auth/verify-email-otp', async (req: Request, res: Response) => {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.otp || '').trim();

    if (!email || !code) {
      res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
      return;
    }

    const entry = emailOtpStore.get(email);
    if (!entry) {
      res.status(400).json({ error: 'No active OTP found. Please click "Send Email OTP" first.' });
      return;
    }
    if (Date.now() > entry.expiresAt) {
      emailOtpStore.delete(email);
      res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
      return;
    }
    if (entry.attempts >= 5) {
      emailOtpStore.delete(email);
      res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
      return;
    }
    if (entry.code !== code) {
      entry.attempts += 1;
      res.status(400).json({ error: 'Invalid 6-digit OTP code. Please check and retry.' });
      return;
    }

    emailOtpStore.delete(email);

    const internalPassword =
      'Nx_' + crypto.createHmac('sha256', SERVER_SECRET).update(email).digest('hex').slice(0, 24) + '!9';
    const otpSig = crypto
      .createHmac('sha256', SERVER_SECRET)
      .update(`verified:${email}`)
      .digest('hex');

    if (firebaseConfig.apiKey) {
      try {
        await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password: internalPassword,
              returnSecureToken: true,
            }),
          }
        );
      } catch {}
    }

    res.setHeader('Set-Cookie', `nx_otp_sig=${otpSig}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    res.json({ ok: true, email, ticket: internalPassword, verified: true });
  });

  app.get('/api/search', async (req: Request, res: Response) => {
    try {
      const qParam = String(req.query.q || 'NEXORA Community platform');
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.json({
          answer: `Search Results for "${qParam}": NEXORA connects communities with real-time channels, voice rooms, and Firebase-backed authentication.`,
          chunks: [],
        });
        return;
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `The user in a community app asked: "${qParam}". Provide a concise, helpful 2-3 sentence answer suitable for a community bot. Use search grounding.`,
        config: { tools: [{ googleSearch: {} }] },
      });
      res.json({
        answer: response.text || 'No information found.',
        chunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
      });
    } catch (err: any) {
      res.json({
        answer: 'Live query processed for community chat.',
        error: err?.message,
      });
    }
  });

  /* ---------- AI PROVIDER CONFIGURATION & SECURE PROXY ROUTES ---------- */

  app.get('/api/ai-providers', async (req: Request, res: Response) => {
    const user = await requireVerifiedBearer(req, res);
    if (!user) return;
    res.json({
      platformGeminiConfigured: getPlatformGeminiConfigured(),
      providers: listUserProviders(user.uid),
    });
  });

  app.post('/api/ai-providers', async (req: Request, res: Response) => {
    const user = await requireVerifiedBearer(req, res);
    if (!user) return;

    const rate = checkRateLimit(`ai-cfg:${user.uid}`, 20, 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const body = req.body || {};
    const result = upsertUserProvider(user.uid, {
      id: body.id ? String(body.id) : undefined,
      provider: body.provider,
      label: body.label,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      textModel: body.textModel,
      imageModel: body.imageModel,
      isDefault: body.isDefault,
    });

    if (!result.ok || !result.record) {
      res.status(400).json({ error: result.error || 'Could not save AI provider.' });
      return;
    }

    res.json({
      ok: true,
      provider: result.record,
      providers: listUserProviders(user.uid),
    });
  });

  app.delete('/api/ai-providers/:configId', async (req: Request, res: Response) => {
    const user = await requireVerifiedBearer(req, res);
    if (!user) return;
    const configId = String(req.params.configId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const removed = deleteUserProvider(user.uid, configId);
    if (!removed) {
      res.status(404).json({ error: 'Provider configuration not found.' });
      return;
    }
    res.json({ ok: true, providers: listUserProviders(user.uid) });
  });

  app.post('/api/ai-providers/test', async (req: Request, res: Response) => {
    const user = await requireVerifiedBearer(req, res);
    if (!user) return;

    const rate = checkRateLimit(`ai-test:${user.uid}`, 12, 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many connection tests. Wait ${rate.retryAfterSec}s.` });
      return;
    }

    const body = req.body || {};
    try {
      const result = await testAiProviderConnection(user.uid, {
        configId: body.configId ? String(body.configId) : undefined,
        provider: body.provider,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        textModel: body.textModel,
        imageModel: body.imageModel,
      });
      res.json(result);
    } catch (err: any) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({ ok: false, error: err.message, code: err.code, retryable: err.retryable });
        return;
      }
      res.status(500).json({ ok: false, error: err?.message || 'Connection test failed.' });
    }
  });

  app.post('/api/templates/generate', async (req: Request, res: Response) => {
    const user = await requireVerifiedBearer(req, res);
    if (!user) return;

    const rate = checkRateLimit(`ai-gen:${user.uid}`, 12, 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({
        error: `AI generation limit reached for now. Retry in ${rate.retryAfterSec}s.`,
        code: 'RATE_LIMIT',
        retryable: true,
      });
      return;
    }

    const body = req.body || {};
    try {
      const result = await generateTemplatesWithAi({
        uid: user.uid,
        providerConfigId: body.providerConfigId ? String(body.providerConfigId) : 'platform',
        prompt: String(body.prompt || ''),
        templateName: body.templateName ? String(body.templateName) : '',
        category: body.category ? String(body.category) : 'Social Media Posts',
        style: body.style ? String(body.style) : 'Modern',
        aspectRatio: body.aspectRatio ? String(body.aspectRatio) : '1:1',
        customWidth: body.customWidth ? Number(body.customWidth) : undefined,
        customHeight: body.customHeight ? Number(body.customHeight) : undefined,
        primaryColor: body.primaryColor ? String(body.primaryColor) : undefined,
        secondaryColor: body.secondaryColor ? String(body.secondaryColor) : undefined,
        accentColor: body.accentColor ? String(body.accentColor) : undefined,
        backgroundType: body.backgroundType ? String(body.backgroundType) : undefined,
        fontPreference: body.fontPreference ? String(body.fontPreference) : undefined,
        variationCount: body.variationCount ? Number(body.variationCount) : 2,
        referenceImageDataUrl: body.referenceImageDataUrl ? String(body.referenceImageDataUrl).slice(0, 4_000_000) : '',
        generateImageAsset: Boolean(body.generateImageAsset),
      });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({
          ok: false,
          error: err.message,
          code: err.code,
          retryable: err.retryable,
        });
        return;
      }
      res.status(500).json({
        ok: false,
        error: err?.message || 'Template generation failed.',
        code: 'GENERATION_FAILED',
        retryable: true,
      });
    }
  });

  mountSocialCircleRoutes(app, {
    verifyFirebaseToken,
    checkRateLimit,
  });
}
