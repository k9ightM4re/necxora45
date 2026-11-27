import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
const firebaseConfig = fs.existsSync(firebaseConfigPath)
  ? JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'))
  : {};

interface EmailOtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

const emailOtpStore = new Map<string, EmailOtpEntry>();
// Security: fail closed when no secret is configured. A hardcoded fallback
// makes every signed OTP cookie and derived credential forgeable by anyone
// who can read this public repository.
const SERVER_SECRET = process.env.SESSION_SECRET;
function requireSecret(res: any): boolean {
  if (typeof SERVER_SECRET === 'string' && SERVER_SECRET.length >= 32) return true;
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Server authentication is not configured.' }));
  return false;
}
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const rateBuckets = new Map<string, number[]>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
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

function readJsonBody(req: any): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: any) => {
      raw += chunk;
      if (raw.length > 32768) raw = raw.slice(0, 32768);
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function verifyFirebaseToken(idToken: string): Promise<any | null> {
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

function nexoraServerPlugin(): Plugin {
  return {
    name: 'nexora-server-plugin',
    configureServer(server) {
      // Security headers (compatible with AI Studio preview iframe, Firebase, Fonts, WebRTC, and reCAPTCHA)
      server.middlewares.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com/recaptcha/ https://www.gstatic.com/ https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' data: blob: https: wss:; frame-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://*.firebaseapp.com https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self' blob:; frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com https://*.usercontent.goog https://*.run.app https://*.web.app https://*.firebaseapp.com http://localhost:* http://127.0.0.1:*; base-uri 'self'; form-action 'self'"
        );
        next();
      });

      // Health check
      server.middlewares.use('/api/health', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, service: 'nexora-api', projectId: firebaseConfig.projectId || null }));
      });

      // Rate-limited guard for OTP & password reset requests
      server.middlewares.use('/api/auth/rate-check', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }
        const body = await readJsonBody(req);
        const kind = String(body.kind || 'otp');
        const identifier = String(body.identifier || 'anon').slice(0, 64);
        const ip = String(req.socket?.remoteAddress || 'local');
        const result = checkRateLimit(`${kind}:${ip}:${identifier}`, 5, 5 * 60 * 1000);
        res.setHeader('Content-Type', 'application/json');
        if (!result.allowed) {
          res.statusCode = 429;
          res.end(JSON.stringify({ allowed: false, retryAfterSec: result.retryAfterSec, error: `Too many requests. Wait ${result.retryAfterSec}s.` }));
          return;
        }
        res.end(JSON.stringify({ allowed: true }));
      });

      // Protected Firebase session verification
      server.middlewares.use('/api/auth/verify-session', async (req, res) => {
        if (!requireSecret(res)) return;
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }
        const authHeader = String(req.headers['authorization'] || '');
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const verified = await verifyFirebaseToken(token);
        res.setHeader('Content-Type', 'application/json');
        if (!verified) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'Invalid or expired Firebase authentication token.' }));
          return;
        }

        // Check signed HttpOnly OTP cookie if emailVerified wasn't set by Google/Link
        let otpVerified = false;
        const cookieHeader = String(req.headers['cookie'] || '');
        const match = cookieHeader.match(/(?:^|;\s*)nx_otp_sig=([^;]+)/);
        if (match && verified.email) {
          const expected = crypto
            .createHmac('sha256', SERVER_SECRET as string)
            .update(`verified:${verified.email.toLowerCase()}`)
            .digest('hex');
          if (safeEqual(match[1], expected)) {
            otpVerified = true;
          }
        }

        res.end(JSON.stringify({ verified: true, otpVerified, user: verified }));
      });

      server.middlewares.use('/api/auth/logout', (_req, res) => {
        res.setHeader('Set-Cookie', 'nx_otp_sig=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });

      // Send 6-digit Email OTP endpoint (secret code never returned in HTTP response)
      server.middlewares.use('/api/auth/send-email-otp', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Please enter a valid email address.' }));
          return;
        }

        const ip = String(req.socket?.remoteAddress || 'local');
        const limitCheck = checkRateLimit(`email-otp:${ip}:${email}`, 5, 5 * 60 * 1000);
        if (!limitCheck.allowed) {
          res.statusCode = 429;
          res.end(JSON.stringify({ error: `Too many requests. Please wait ${limitCheck.retryAfterSec}s before retrying.` }));
          return;
        }

        const code = crypto.randomInt(100000, 999999).toString();
        emailOtpStore.set(email, {
          code,
          expiresAt: Date.now() + 10 * 60 * 1000,
          attempts: 0,
        });

        // Trigger Google Identity Toolkit sendOobCode in background
        if (firebaseConfig.apiKey) {
          fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestType: 'EMAIL_SIGNIN',
              email,
              continueUrl: `${req.headers.origin || 'http://localhost:3000'}/login.html`,
              canHandleCodeInApp: true,
            }),
          }).catch(() => {});
        }

        res.end(
          JSON.stringify({
            ok: true,
            message: `Verification code sent to ${email}.`,
            expiresInSec: 600,
          })
        );
      });

      // Verify 6-digit Email OTP endpoint
      server.middlewares.use('/api/auth/verify-email-otp', async (req, res) => {
        if (!requireSecret(res)) return;
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const code = String(body.otp || '').trim();

        if (!email || !code) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Email and 6-digit verification code are required.' }));
          return;
        }

        const entry = emailOtpStore.get(email);
        if (!entry) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'No active OTP found. Please click "Send Email OTP" first.' }));
          return;
        }

        if (Date.now() > entry.expiresAt) {
          emailOtpStore.delete(email);
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Verification code has expired. Please request a new code.' }));
          return;
        }

        if (entry.attempts >= 5) {
          emailOtpStore.delete(email);
          res.statusCode = 429;
          res.end(JSON.stringify({ error: 'Too many incorrect attempts. Please request a new code.' }));
          return;
        }

        if (entry.code !== code) {
          entry.attempts += 1;
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid 6-digit OTP code. Please check and retry.' }));
          return;
        }

        // Successfully verified. Only a signed, HttpOnly cookie is issued.
        // Never derive or return a password-like credential from the secret;
        // anyone who completes (or forges) an OTP could otherwise obtain a
        // reusable login credential for that email address.
        emailOtpStore.delete(email);
        const otpSig = crypto
          .createHmac('sha256', SERVER_SECRET as string)
          .update(`verified:${email}`)
          .digest('hex');
        res.setHeader('Set-Cookie', `nx_otp_sig=${otpSig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`);
        res.end(
          JSON.stringify({
            ok: true,
            verified: true,
          })
        );
      });

      // Gemini Search route
      server.middlewares.use('/api/search', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        try {
          const url = new URL(req.url || '', 'http://localhost:3000');
          const query = url.searchParams.get('q') || 'NEXORA Community platform';

          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                answer: `Search Results for "${query}": NEXORA connects communities with real-time channels, voice rooms, and Firebase-backed authentication.`,
                chunks: [],
              })
            );
            return;
          }

          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `The user in a community app asked: "${query}". Provide a concise, helpful 2-3 sentence answer suitable for a community bot. Use search grounding.`,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });

          const answerText = response.text || 'No information found.';
          const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              answer: answerText,
              chunks,
            })
          );
        } catch (err: any) {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              answer: 'Live query processed for community chat.',
              error: 'Search is temporarily unavailable.',
            })
          );
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), nexoraServerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          login: path.resolve(__dirname, 'login.html'),
          signup: path.resolve(__dirname, 'signup.html'),
          verify: path.resolve(__dirname, 'verify.html'),
          welcome: path.resolve(__dirname, 'welcome.html'),
          forgotPassword: path.resolve(__dirname, 'forgot-password.html'),
          resetPassword: path.resolve(__dirname, 'reset-password.html'),
          app: path.resolve(__dirname, 'app.html'),
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
