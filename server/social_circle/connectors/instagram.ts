import crypto from 'crypto';
import {
  buildPersonId,
  extractTopics,
  normalizeContent,
  normalizeInteraction,
  normalizePerson,
} from '../normalizer.ts';
import type {
  Connector,
  ConnectorAuthorizeInput,
  ConnectorAuthorizeResult,
  ConnectorRevokeContext,
  ConnectorSyncContext,
  ConnectorSyncResult,
  ConnectorWebhookEvent,
  ConnectorWebhookResult,
  Content,
  Interaction,
  Person,
} from '../types.ts';

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

function parseUsageThrottle(headers: Headers): number | undefined {
  try {
    const raw = headers.get('x-app-usage') || headers.get('x-business-use-case-usage');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const callPct = Number(parsed?.call_count || 0);
    if (callPct >= 90) return 5000;
    if (callPct >= 75) return 1500;
  } catch {}
  return undefined;
}

export class InstagramConnector implements Connector {
  readonly source = 'instagram' as const;

  async authorize(input: ConnectorAuthorizeInput): Promise<ConnectorAuthorizeResult> {
    const clientId = process.env.INSTAGRAM_CLIENT_ID || '';
    const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET || '';
    const missingEnvVars: string[] = [];
    if (!clientId) missingEnvVars.push('INSTAGRAM_CLIENT_ID');
    if (!clientSecret) missingEnvVars.push('INSTAGRAM_CLIENT_SECRET');

    const defaultScopes = ['instagram_basic', 'pages_show_list'];
    const scopes = Array.from(
      new Set(
        (input.scopes.length ? input.scopes : defaultScopes).filter((s) =>
          ['instagram_basic', 'instagram_manage_comments', 'instagram_manage_insights', 'pages_show_list'].includes(s)
        )
      )
    );

    const params = new URLSearchParams({
      client_id: clientId || 'UNCONFIGURED_INSTAGRAM_CLIENT_ID',
      redirect_uri: input.redirectUri,
      state: input.state,
      response_type: 'code',
      scope: scopes.join(','),
    });

    return {
      provider: 'instagram',
      authUrl: `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`,
      scopes,
      configured: missingEnvVars.length === 0,
      missingEnvVars,
    };
  }

  async exchangeCode(code: string, redirectUri: string, fetchImpl: typeof fetch = fetch) {
    const clientId = process.env.INSTAGRAM_CLIENT_ID || '';
    const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) {
      throw new Error('Instagram Graph API credentials are not configured.');
    }
    const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code', code);

    const res = await fetchImpl(url.toString(), { method: 'GET' });
    const data: any = await res.json();
    if (!res.ok || !data?.access_token) {
      throw new Error(data?.error?.message || 'Instagram token exchange failed.');
    }
    return {
      accessToken: String(data.access_token),
      expiresAtMs: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    };
  }

  async sync(cursor: string | null, ctx: ConnectorSyncContext): Promise<ConnectorSyncResult> {
    const fetchImpl = ctx.fetchImpl || fetch;
    const accountId = ctx.tokens.externalAccountId || 'me';
    const retentionDays = ctx.consent.retentionDays || 90;

    const url = new URL(`${GRAPH_BASE}/${encodeURIComponent(accountId)}/media`);
    url.searchParams.set('fields', 'id,caption,timestamp,username,comments.limit(10){id,text,username,timestamp}');
    url.searchParams.set('limit', '20');
    url.searchParams.set('access_token', ctx.tokens.accessToken);
    if (cursor) url.searchParams.set('after', cursor);

    const res = await fetchImpl(url.toString(), { method: 'GET' });
    if (res.status === 429) {
      const err: any = new Error('Instagram Graph API rate limit reached.');
      err.retryAfterMs = 5000;
      throw err;
    }
    const payload: any = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error?.message || `Instagram Graph API error (${res.status})`);
    }

    const personsMap = new Map<string, Person>();
    const interactions: Interaction[] = [];
    const contents: Content[] = [];

    const selfPersonId = buildPersonId('instagram', accountId);
    const selfHandle = ctx.tokens.externalAccountLabel || accountId;
    personsMap.set(
      selfPersonId,
      normalizePerson({
        userId: ctx.userId,
        source: 'instagram',
        externalId: accountId,
        handle: selfHandle,
        displayName: selfHandle,
        retentionDays,
      })
    );

    const items = Array.isArray(payload?.data) ? payload.data : [];
    for (const media of items) {
      const ts = media.timestamp ? Date.parse(media.timestamp) || Date.now() : Date.now();
      const caption = String(media.caption || '');
      const ownerHandle = String(media.username || selfHandle);
      const ownerId = buildPersonId('instagram', ownerHandle);

      if (!personsMap.has(ownerId)) {
        personsMap.set(
          ownerId,
          normalizePerson({
            userId: ctx.userId,
            source: 'instagram',
            externalId: ownerHandle,
            handle: ownerHandle,
            interests: extractTopics(caption),
            retentionDays,
            nowMs: ts,
          })
        );
      }

      if (ctx.consent.includeMessageContent && caption.trim()) {
        contents.push(
          normalizeContent({
            userId: ctx.userId,
            source: 'instagram',
            authorPersonId: ownerId,
            sourceItemId: String(media.id),
            text: caption,
            ts,
            retentionDays,
          })
        );
      }

      const comments = Array.isArray(media?.comments?.data) ? media.comments.data : [];
      for (const c of comments) {
        const cUser = String(c.username || '');
        if (!cUser) continue;
        const cPersonId = buildPersonId('instagram', cUser);
        const cTs = c.timestamp ? Date.parse(c.timestamp) || ts : ts;

        if (!personsMap.has(cPersonId)) {
          personsMap.set(
            cPersonId,
            normalizePerson({
              userId: ctx.userId,
              source: 'instagram',
              externalId: cUser,
              handle: cUser,
              interests: extractTopics(String(c.text || '')),
              retentionDays,
              nowMs: cTs,
            })
          );
        }

        interactions.push(
          normalizeInteraction({
            userId: ctx.userId,
            source: 'instagram',
            srcPersonId: cPersonId,
            dstPersonId: ownerId,
            type: 'comment',
            ts: cTs,
            retentionDays,
            uniqueKey: `ig-cmt-${c.id}`,
          })
        );

        if (ctx.consent.includeMessageContent && c.text) {
          contents.push(
            normalizeContent({
              userId: ctx.userId,
              source: 'instagram',
              authorPersonId: cPersonId,
              sourceItemId: `cmt_${c.id}`,
              text: String(c.text),
              ts: cTs,
              retentionDays,
            })
          );
        }
      }
    }

    const nextCursor = String(payload?.paging?.cursors?.after || '');
    const hasMore = Boolean(payload?.paging?.next && nextCursor);
    const retryAfterMs = parseUsageThrottle(res.headers);

    return {
      nextCursor,
      hasMore,
      persons: Array.from(personsMap.values()),
      interactions,
      contents,
      retryAfterMs,
    };
  }

  async webhook(event: ConnectorWebhookEvent): Promise<ConnectorWebhookResult> {
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.INSTAGRAM_CLIENT_SECRET || '';
    const sigHeader = String(event.headers['x-hub-signature-256'] || '');
    if (!appSecret) {
      return { verified: false, statusCode: 503, error: 'Instagram webhook secret not configured.' };
    }
    if (!sigHeader.startsWith('sha256=')) {
      return { verified: false, statusCode: 401, error: 'Missing X-Hub-Signature-256 header.' };
    }
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(event.rawBody).digest('hex');
    const a = Buffer.from(sigHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { verified: false, statusCode: 401, error: 'Invalid Meta webhook signature.' };
    }
    return { verified: true, statusCode: 200, responseBody: { ok: true } };
  }

  async revoke(ctx: ConnectorRevokeContext): Promise<{ revokedRemote: boolean }> {
    if (!ctx.tokens?.accessToken) return { revokedRemote: false };
    const fetchImpl = ctx.fetchImpl || fetch;
    try {
      const url = new URL(`${GRAPH_BASE}/me/permissions`);
      url.searchParams.set('access_token', ctx.tokens.accessToken);
      const res = await fetchImpl(url.toString(), { method: 'DELETE' });
      return { revokedRemote: res.ok };
    } catch {
      return { revokedRemote: false };
    }
  }
}
