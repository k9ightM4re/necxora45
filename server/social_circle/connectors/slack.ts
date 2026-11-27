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

const SLACK_API = 'https://slack.com/api';

export class SlackConnector implements Connector {
  readonly source = 'slack' as const;

  async authorize(input: ConnectorAuthorizeInput): Promise<ConnectorAuthorizeResult> {
    const clientId = process.env.SLACK_CLIENT_ID || '';
    const clientSecret = process.env.SLACK_CLIENT_SECRET || '';
    const missingEnvVars: string[] = [];
    if (!clientId) missingEnvVars.push('SLACK_CLIENT_ID');
    if (!clientSecret) missingEnvVars.push('SLACK_CLIENT_SECRET');

    // Minimum required scopes by default; channels:history only added when user/admin explicitly consents
    const scopes = ['channels:read', 'users:read'];
    if (input.includeMessageContent || input.scopes.includes('channels:history')) {
      scopes.push('channels:history');
    }

    const params = new URLSearchParams({
      client_id: clientId || 'UNCONFIGURED_SLACK_CLIENT_ID',
      scope: scopes.join(','),
      redirect_uri: input.redirectUri,
      state: input.state,
    });

    return {
      provider: 'slack',
      authUrl: `https://slack.com/oauth/v2/authorize?${params.toString()}`,
      scopes,
      configured: missingEnvVars.length === 0,
      missingEnvVars,
    };
  }

  async exchangeCode(code: string, redirectUri: string, fetchImpl: typeof fetch = fetch) {
    const clientId = process.env.SLACK_CLIENT_ID || '';
    const clientSecret = process.env.SLACK_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) {
      throw new Error('Slack OAuth v2 credentials are not configured.');
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetchImpl(`${SLACK_API}/oauth.v2.access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data: any = await res.json();
    if (!res.ok || !data?.ok || !data?.access_token) {
      throw new Error(data?.error || 'Slack OAuth v2 exchange failed.');
    }
    return {
      accessToken: String(data.access_token),
      scope: String(data.scope || ''),
      externalAccountId: String(data?.authed_user?.id || data?.team?.id || ''),
      externalAccountLabel: String(data?.team?.name || 'Slack Workspace'),
    };
  }

  async sync(cursor: string | null, ctx: ConnectorSyncContext): Promise<ConnectorSyncResult> {
    const fetchImpl = ctx.fetchImpl || fetch;
    const headers = { Authorization: `Bearer ${ctx.tokens.accessToken}` };
    const retentionDays = ctx.consent.retentionDays || 90;

    // 1. Fetch workspace directory (users.list)
    const usersUrl = new URL(`${SLACK_API}/users.list`);
    usersUrl.searchParams.set('limit', '100');
    if (cursor) usersUrl.searchParams.set('cursor', cursor);

    const usersRes = await fetchImpl(usersUrl.toString(), { headers });
    if (usersRes.status === 429) {
      const retrySec = Number(usersRes.headers.get('retry-after') || 5);
      const err: any = new Error('Slack API rate limit reached.');
      err.retryAfterMs = retrySec * 1000;
      throw err;
    }
    const usersData: any = await usersRes.json();
    if (!usersRes.ok || !usersData?.ok) {
      throw new Error(usersData?.error || `Slack users.list failed (${usersRes.status})`);
    }

    const persons: Person[] = [];
    const interactions: Interaction[] = [];
    const contents: Content[] = [];
    const selfId = buildPersonId('slack', ctx.tokens.externalAccountId || ctx.userId);

    for (const member of Array.isArray(usersData.members) ? usersData.members : []) {
      if (member.deleted || member.is_bot) continue;
      const handle = String(member.name || member.id);
      const displayName = String(member.real_name || member.profile?.display_name || handle);
      const bioTopics = extractTopics(String(member.profile?.title || ''));
      persons.push(
        normalizePerson({
          userId: ctx.userId,
          source: 'slack',
          externalId: String(member.id),
          handle,
          displayName,
          interests: bioTopics,
          retentionDays,
        })
      );
    }

    // 2. Fetch public channels (conversations.list)
    const chanRes = await fetchImpl(`${SLACK_API}/conversations.list?types=public_channel&limit=20`, { headers });
    const chanData: any = await chanRes.json();
    const channels = chanData?.ok && Array.isArray(chanData.channels) ? chanData.channels : [];

    // 3. Only read channel history if workspace admin/user explicitly granted channels:history
    const hasHistoryScope =
      ctx.consent.includeMessageContent &&
      (ctx.consent.scopes.includes('channels:history') || String(ctx.tokens.scope || '').includes('channels:history'));

    if (hasHistoryScope) {
      for (const ch of channels.slice(0, 5)) {
        const histRes = await fetchImpl(
          `${SLACK_API}/conversations.history?channel=${encodeURIComponent(ch.id)}&limit=25`,
          { headers }
        );
        const histData: any = await histRes.json();
        if (!histData?.ok || !Array.isArray(histData.messages)) continue;

        for (const msg of histData.messages) {
          if (!msg.user || !msg.text) continue;
          const authorPersonId = buildPersonId('slack', String(msg.user));
          const ts = msg.ts ? Math.round(Number(msg.ts) * 1000) : Date.now();

          contents.push(
            normalizeContent({
              userId: ctx.userId,
              source: 'slack',
              authorPersonId,
              sourceItemId: `${ch.id}:${msg.ts}`,
              text: String(msg.text),
              ts,
              retentionDays,
            })
          );

          // Mentions create directed interactions
          const mentionMatches = String(msg.text).match(/<@([A-Z0-9]+)>/g) || [];
          for (const m of mentionMatches) {
            const dstExt = m.slice(2, -1);
            const dstPersonId = buildPersonId('slack', dstExt);
            if (dstPersonId !== authorPersonId) {
              interactions.push(
                normalizeInteraction({
                  userId: ctx.userId,
                  source: 'slack',
                  srcPersonId: authorPersonId,
                  dstPersonId,
                  type: 'mention',
                  ts,
                  retentionDays,
                  uniqueKey: `${ch.id}:${msg.ts}:${dstExt}`,
                })
              );
            }
          }

          if (msg.thread_ts && msg.thread_ts !== msg.ts) {
            interactions.push(
              normalizeInteraction({
                userId: ctx.userId,
                source: 'slack',
                srcPersonId: authorPersonId,
                dstPersonId: selfId,
                type: 'thread',
                ts,
                retentionDays,
                uniqueKey: `thread:${ch.id}:${msg.ts}`,
              })
            );
          }
        }
      }
    }

    const nextCursor = String(usersData?.response_metadata?.next_cursor || '');
    return {
      nextCursor,
      hasMore: Boolean(nextCursor),
      persons,
      interactions,
      contents,
    };
  }

  async webhook(event: ConnectorWebhookEvent): Promise<ConnectorWebhookResult> {
    const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
    const sig = String(event.headers['x-slack-signature'] || '');
    const tsHeader = String(event.headers['x-slack-request-timestamp'] || '');

    if (!signingSecret) {
      return { verified: false, statusCode: 503, error: 'Slack signing secret not configured.' };
    }
    const tsSec = Number(tsHeader);
    if (!Number.isFinite(tsSec) || Math.abs(Math.floor(Date.now() / 1000) - tsSec) > 300) {
      return { verified: false, statusCode: 401, error: 'Slack timestamp outside 5-minute replay window.' };
    }
    const baseString = `v0:${tsHeader}:${event.rawBody}`;
    const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { verified: false, statusCode: 401, error: 'Invalid X-Slack-Signature.' };
    }

    if (event.body?.type === 'url_verification' && event.body?.challenge) {
      return {
        verified: true,
        statusCode: 200,
        responseBody: { challenge: String(event.body.challenge) },
      };
    }

    return { verified: true, statusCode: 200, responseBody: { ok: true } };
  }

  async revoke(ctx: ConnectorRevokeContext): Promise<{ revokedRemote: boolean }> {
    if (!ctx.tokens?.accessToken) return { revokedRemote: false };
    const fetchImpl = ctx.fetchImpl || fetch;
    try {
      const res = await fetchImpl(`${SLACK_API}/auth.revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.tokens.accessToken}` },
      });
      const data: any = await res.json();
      return { revokedRemote: Boolean(data?.ok) };
    } catch {
      return { revokedRemote: false };
    }
  }
}
