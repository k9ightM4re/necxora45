import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { InstagramConnector } from './connectors/instagram.ts';
import { SlackConnector } from './connectors/slack.ts';
import { DiscordConnector } from './connectors/discord.ts';
import { redactForLog } from './crypto_vault.ts';
import { SyncQueue } from './queue.ts';
import { answerWithRag, hybridRetrieve } from './rag.ts';
import { sharedSocialCircleStore } from './store.ts';
import type { Connector, SocialSource } from './types.ts';

const VALID_SOURCES = new Set<SocialSource>(['instagram', 'slack', 'discord']);
const EPHEMERAL_OAUTH_SECRET = crypto.randomBytes(32).toString('hex');
const OAUTH_STATE_SECRET =
  process.env.SESSION_SECRET ||
  process.env.SOCIAL_CIRCLE_KEK ||
  EPHEMERAL_OAUTH_SECRET;

export interface SocialCircleDeps {
  verifyFirebaseToken: (idToken: string) => Promise<any | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
}

function getAppBaseUrl(req: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`;
}

function signOAuthState(payload: { uid: string; source: SocialSource; includeMessageContent: boolean; scopes: string[]; iat: number }): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyOAuthState(token: string): { uid: string; source: SocialSource; includeMessageContent: boolean; scopes: string[]; iat: number } | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed?.uid || !VALID_SOURCES.has(parsed.source)) return null;
    if (Date.now() - Number(parsed.iat || 0) > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildPopupCallbackHtml(
  payload: { ok: boolean; provider: string; error?: string },
  targetOrigin: string
): string {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const safeOriginJson = JSON.stringify(targetOrigin || '*').replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Nexora Connector Authorization</title></head>
<body style="font-family:system-ui,sans-serif;background:#101318;color:#F2F4F7;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
  <div style="max-width:380px;padding:24px;border:1px solid rgba(255,255,255,0.14);border-radius:16px;background:#1D232C;">
    <h1 style="font-size:1.1rem;margin:0 0 8px;">${payload.ok ? 'Authorization complete' : 'Authorization issue'}</h1>
    <p style="font-size:0.88rem;color:#A8B0BB;margin:0 0 16px;">${
      payload.ok
        ? `Your ${payload.provider} connection succeeded. Returning to Nexora...`
        : String(payload.error || 'Could not finish authorization.')
    }</p>
    <button type="button" onclick="window.close()" style="padding:8px 16px;border-radius:8px;border:0;background:#3868CE;color:#fff;font-weight:600;cursor:pointer;">Close window</button>
  </div>
  <script>
    (function () {
      var data = ${safeJson};
      var originTarget = ${safeOriginJson};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type: data.ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR',
            provider: data.provider,
            error: data.error || ''
          }, originTarget);
        }
      } catch (e) {}
      setTimeout(function () { window.close(); }, 600);
    })();
  </script>
</body>
</html>`;
}

export function mountSocialCircleRoutes(app: Express, deps: SocialCircleDeps): void {
  const instagram = new InstagramConnector();
  const slack = new SlackConnector();
  const discord = new DiscordConnector();
  const connectors = new Map<SocialSource, Connector>([
    ['instagram', instagram],
    ['slack', slack],
    ['discord', discord],
  ]);
  const syncQueue = new SyncQueue(sharedSocialCircleStore, connectors);

  // Schedule 90-day data retention sweep every 6 hours
  const retentionTimer = setInterval(() => {
    try {
      sharedSocialCircleStore.sweepExpired(Date.now());
    } catch {}
  }, 6 * 3600 * 1000);
  if (typeof retentionTimer.unref === 'function') retentionTimer.unref();

  async function extractOptionalUser(req: Request): Promise<any | null> {
    const authHeader = String(req.headers['authorization'] || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    return deps.verifyFirebaseToken(token);
  }

  async function requireAuthUser(req: Request, res: Response): Promise<any | null> {
    const user = await extractOptionalUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Please sign in to NEXORA.' });
      return null;
    }
    return user;
  }

  /* ---------------- RAG Search & Streaming Q&A ---------------- */

  app.get('/api/rag/search', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').trim().slice(0, 280);
      const topK = Number(req.query.topK || 4);
      const user = await extractOptionalUser(req);
      if (!q) {
        res.json({ results: [], related: [] });
        return;
      }
      const results = await hybridRetrieve({
        query: q,
        userId: user?.uid || null,
        topK,
      });
      res.json({
        query: q,
        results,
        related: results.slice(1),
      });
    } catch {
      res.status(500).json({ error: 'Search temporarily unavailable.', results: [], related: [] });
    }
  });

  app.post('/api/rag/query', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const query = String(body.query || '').trim().slice(0, 600);
      if (!query) {
        res.status(400).json({ error: 'Query text is required.' });
        return;
      }

      const user = await extractOptionalUser(req);
      const ip = String(req.socket?.remoteAddress || 'local');
      const rate = deps.checkRateLimit(`rag:${user?.uid || ip}`, 24, 60 * 1000);
      if (!rate.allowed) {
        res.status(429).json({ error: `Rate limit reached. Retry in ${rate.retryAfterSec}s.` });
        return;
      }

      const streamMode = Boolean(body.stream);
      const result = await answerWithRag({
        query,
        userId: user?.uid || null,
        includePublicDocs: body.includePublicDocs !== false,
      });

      if (!streamMode) {
        res.json(result);
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      const words = result.answer.split(/(\s+)/);
      for (let i = 0; i < words.length; i += 3) {
        const chunkText = words.slice(i, i + 3).join('');
        res.write(`data: ${JSON.stringify({ type: 'delta', text: chunkText })}\n\n`);
      }
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          citations: result.citations,
          model: result.model,
          aiGenerated: true,
          grounded: result.grounded,
        })}\n\n`
      );
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Unable to process RAG query right now.' });
      } else {
        res.end();
      }
    }
  });

  /* ---------------- Social Circle M1 Consent & Connector Framework ---------------- */

  app.get('/api/social-circle/status', async (req: Request, res: Response) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;

    const sources: SocialSource[] = ['instagram', 'slack', 'discord'];
    const consents = Object.fromEntries(
      sources.map((src) => {
        const consent = sharedSocialCircleStore.getConsent(user.uid, src);
        return [
          src,
          {
            ...consent,
            hasEncryptedToken: sharedSocialCircleStore.hasTokens(user.uid, src),
          },
        ];
      })
    );
    const data = sharedSocialCircleStore.getUserGraphData(user.uid);
    res.json({
      ok: true,
      consents,
      counts: {
        persons: data.persons.length,
        interactions: data.interactions.length,
        contents: data.contents.length,
      },
      jobs: data.jobs.slice(0, 15),
    });
  });

  app.post('/api/social-circle/consent', async (req: Request, res: Response) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;

    const body = req.body || {};
    const source = String(body.source || '') as SocialSource;
    if (!VALID_SOURCES.has(source)) {
      res.status(400).json({ error: 'Unsupported connector source.' });
      return;
    }

    const consented = Boolean(body.consented);
    const includeMessageContent = Boolean(body.includeMessageContent);
    const retentionDays = Math.min(365, Math.max(1, Number(body.retentionDays || 90)));
    const requestedScopes = Array.isArray(body.scopes) ? body.scopes.map((s: any) => String(s)) : [];

    const connector = connectors.get(source)!;
    const redirectUri = `${getAppBaseUrl(req)}/api/social-circle/oauth/${source}/callback`;
    const state = signOAuthState({
      uid: user.uid,
      source,
      includeMessageContent,
      scopes: requestedScopes,
      iat: Date.now(),
    });

    const authInfo = await connector.authorize({
      userId: user.uid,
      redirectUri,
      state,
      scopes: requestedScopes,
      includeMessageContent,
    });

    const prev = sharedSocialCircleStore.getConsent(user.uid, source);
    const consent = sharedSocialCircleStore.setConsent({
      ...prev,
      userId: user.uid,
      source,
      consented,
      scopes: authInfo.scopes,
      includeMessageContent,
      retentionDays,
      consentedAtMs: consented ? Date.now() : prev.consentedAtMs,
      status: prev.status === 'connected' ? 'connected' : 'disconnected',
    });

    res.json({
      ok: true,
      consent,
      ...authInfo,
      redirectUri,
    });
  });

  app.get(
    ['/api/social-circle/oauth/:provider/callback', '/api/social-circle/oauth/:provider/callback/'],
    async (req: Request, res: Response) => {
      const provider = String(req.params.provider || '') as SocialSource;
      const appOrigin = getAppBaseUrl(req);
      if (!VALID_SOURCES.has(provider)) {
        res.status(400).send(buildPopupCallbackHtml({ ok: false, provider: 'unknown', error: 'Unknown provider.' }, appOrigin));
        return;
      }

      const errorParam = String(req.query.error_description || req.query.error || '');
      if (errorParam) {
        res.status(400).send(buildPopupCallbackHtml({ ok: false, provider, error: errorParam }, appOrigin));
        return;
      }

      const code = String(req.query.code || '');
      const stateToken = String(req.query.state || '');
      const verifiedState = verifyOAuthState(stateToken);
      if (!verifiedState || verifiedState.source !== provider || !code) {
        res.status(400).send(buildPopupCallbackHtml({ ok: false, provider, error: 'Invalid or expired OAuth state.' }, appOrigin));
        return;
      }

      const redirectUri = `${appOrigin}/api/social-circle/oauth/${provider}/callback`;
      try {
        let tokenPayload: any;
        if (provider === 'instagram') {
          tokenPayload = await instagram.exchangeCode(code, redirectUri);
        } else if (provider === 'slack') {
          tokenPayload = await slack.exchangeCode(code, redirectUri);
        } else {
          tokenPayload = await discord.exchangeCode(code, redirectUri);
        }

        sharedSocialCircleStore.saveTokens(verifiedState.uid, provider, tokenPayload);
        const prev = sharedSocialCircleStore.getConsent(verifiedState.uid, provider);
        sharedSocialCircleStore.setConsent({
          ...prev,
          userId: verifiedState.uid,
          source: provider,
          consented: true,
          scopes: verifiedState.scopes.length ? verifiedState.scopes : prev.scopes,
          includeMessageContent: verifiedState.includeMessageContent,
          consentedAtMs: prev.consentedAtMs || Date.now(),
          accountLabel: String(tokenPayload.externalAccountLabel || `${provider} connected`),
          status: 'connected',
          lastError: '',
        });

        res.status(200).send(buildPopupCallbackHtml({ ok: true, provider }, appOrigin));
      } catch (err: any) {
        console.warn('SocialCircle OAuth callback failed:', JSON.stringify(redactForLog({ provider, error: err?.message })));
        res.status(502).send(buildPopupCallbackHtml({ ok: false, provider, error: err?.message || 'OAuth exchange failed.' }, appOrigin));
      }
    }
  );

  app.post('/api/social-circle/sync/:provider', async (req: Request, res: Response) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;

    const provider = String(req.params.provider || '') as SocialSource;
    if (!VALID_SOURCES.has(provider)) {
      res.status(400).json({ error: 'Unsupported connector source.' });
      return;
    }

    const rate = deps.checkRateLimit(`sc-sync:${user.uid}:${provider}`, 8, 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({ error: `Sync rate limit reached. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    try {
      const job = await syncQueue.enqueueAndRun({
        userId: user.uid,
        source: provider,
        cursor: req.body?.cursor ? String(req.body.cursor) : undefined,
        idempotencyKey: req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined,
      });
      res.json({ ok: true, job });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Sync could not start.' });
    }
  });

  app.post('/api/social-circle/disconnect/:provider', async (req: Request, res: Response) => {
    try {
      const user = await requireAuthUser(req, res);
      if (!user) return;

      const provider = String(req.params.provider || '') as SocialSource;
      if (!VALID_SOURCES.has(provider)) {
        res.status(400).json({ error: 'Unsupported connector source.' });
        return;
      }

      const connector = connectors.get(provider)!;
      const tokens = sharedSocialCircleStore.getTokens(user.uid, provider);
      const revokeResult = await connector.revoke({ userId: user.uid, tokens });
      const deleted = sharedSocialCircleStore.deleteSourceData(user.uid, provider);

      res.json({
        ok: true,
        provider,
        revokedRemote: revokeResult.revokedRemote,
        deleted,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to disconnect connector.' });
    }
  });

  app.post('/api/social-circle/retention', async (req: Request, res: Response) => {
    try {
      const user = await requireAuthUser(req, res);
      if (!user) return;

      const source = String(req.body?.source || '') as SocialSource;
      const days = Number(req.body?.retentionDays || 90);
      if (!VALID_SOURCES.has(source)) {
        res.status(400).json({ error: 'Unsupported connector source.' });
        return;
      }

      const updated = sharedSocialCircleStore.updateRetentionDays(user.uid, source, days);
      const purged = sharedSocialCircleStore.sweepExpired(Date.now());
      res.json({ ok: true, consent: updated, purged });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to update retention setting.' });
    }
  });

  app.post('/api/social-circle/webhooks/:provider', async (req: Request, res: Response) => {
    try {
      const provider = String(req.params.provider || '') as SocialSource;
      const connector = connectors.get(provider);
      if (!connector) {
        res.status(404).json({ error: 'Unknown webhook provider.' });
        return;
      }

      const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body || {});
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = v;
      }

      const result = await connector.webhook({
        headers,
        rawBody,
        body: req.body,
      });

      if (!result.verified) {
        res.status(result.statusCode || 401).json({ error: result.error || 'Webhook verification failed.' });
        return;
      }
      res.status(result.statusCode || 200).json(result.responseBody || { ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Webhook processing error.' });
    }
  });
}
