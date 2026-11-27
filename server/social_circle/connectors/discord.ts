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

const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordConnector implements Connector {
  readonly source = 'discord' as const;

  async authorize(input: ConnectorAuthorizeInput): Promise<ConnectorAuthorizeResult> {
    const clientId = process.env.DISCORD_CLIENT_ID || '';
    const clientSecret = process.env.DISCORD_CLIENT_SECRET || '';
    const missingEnvVars: string[] = [];
    if (!clientId) missingEnvVars.push('DISCORD_CLIENT_ID');
    if (!clientSecret) missingEnvVars.push('DISCORD_CLIENT_SECRET');

    // Official bot application OAuth2 install + identity scope; MESSAGE_CONTENT intent only requested if consented
    const scopes = ['identify', 'guilds', 'bot', 'applications.commands'];
    const params = new URLSearchParams({
      client_id: clientId || 'UNCONFIGURED_DISCORD_CLIENT_ID',
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      permissions: '66560', // View Channels + Read Message History only
      state: input.state,
    });

    return {
      provider: 'discord',
      authUrl: `https://discord.com/oauth2/authorize?${params.toString()}`,
      scopes,
      configured: missingEnvVars.length === 0,
      missingEnvVars,
    };
  }

  async exchangeCode(code: string, redirectUri: string, fetchImpl: typeof fetch = fetch) {
    const clientId = process.env.DISCORD_CLIENT_ID || '';
    const clientSecret = process.env.DISCORD_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) {
      throw new Error('Discord OAuth2 credentials are not configured.');
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data: any = await res.json();
    if (!res.ok || !data?.access_token) {
      throw new Error(data?.error_description || data?.error || 'Discord token exchange failed.');
    }
    return {
      accessToken: String(data.access_token),
      refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
      expiresAtMs: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
      scope: String(data.scope || ''),
      externalAccountId: data?.guild?.id ? String(data.guild.id) : undefined,
      externalAccountLabel: data?.guild?.name ? String(data.guild.name) : 'Discord Server',
    };
  }

  async sync(cursor: string | null, ctx: ConnectorSyncContext): Promise<ConnectorSyncResult> {
    const fetchImpl = ctx.fetchImpl || fetch;
    const botToken = ctx.tokens.botToken || process.env.DISCORD_BOT_TOKEN || '';
    const retentionDays = ctx.consent.retentionDays || 90;

    // Only sync guilds where the bot was invited
    const guildsRes = await fetchImpl(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${ctx.tokens.accessToken}` },
    });
    if (guildsRes.status === 429) {
      const retrySec = Number(guildsRes.headers.get('retry-after') || 5);
      const err: any = new Error('Discord API rate limit reached.');
      err.retryAfterMs = retrySec * 1000;
      throw err;
    }
    const guilds: any = await guildsRes.json();
    if (!guildsRes.ok || !Array.isArray(guilds)) {
      throw new Error(guilds?.message || `Discord guilds fetch failed (${guildsRes.status})`);
    }

    const personsMap = new Map<string, Person>();
    const interactions: Interaction[] = [];
    const contents: Content[] = [];
    const selfId = buildPersonId('discord', ctx.tokens.externalAccountId || ctx.userId);

    const targetGuild = guilds.find((g: any) => !ctx.tokens.externalAccountId || g.id === ctx.tokens.externalAccountId) || guilds[0];
    if (targetGuild && botToken) {
      const membersUrl = new URL(`${DISCORD_API}/guilds/${encodeURIComponent(targetGuild.id)}/members`);
      membersUrl.searchParams.set('limit', '50');
      if (cursor) membersUrl.searchParams.set('after', cursor);

      const memRes = await fetchImpl(membersUrl.toString(), {
        headers: { Authorization: `Bot ${botToken}` },
      });
      const memData: any = await memRes.json();
      if (memRes.ok && Array.isArray(memData)) {
        for (const m of memData) {
          const u = m.user;
          if (!u || u.bot) continue;
          const pid = buildPersonId('discord', String(u.id));
          personsMap.set(
            pid,
            normalizePerson({
              userId: ctx.userId,
              source: 'discord',
              externalId: String(u.id),
              handle: String(u.username || u.id),
              displayName: String(m.nick || u.global_name || u.username),
              retentionDays,
            })
          );
        }
      }

      if (ctx.consent.includeMessageContent) {
        const chRes = await fetchImpl(`${DISCORD_API}/guilds/${encodeURIComponent(targetGuild.id)}/channels`, {
          headers: { Authorization: `Bot ${botToken}` },
        });
        const channels: any = await chRes.json();
        if (chRes.ok && Array.isArray(channels)) {
          for (const ch of channels.filter((c: any) => c.type === 0).slice(0, 3)) {
            const msgRes = await fetchImpl(
              `${DISCORD_API}/channels/${encodeURIComponent(ch.id)}/messages?limit=25`,
              { headers: { Authorization: `Bot ${botToken}` } }
            );
            const msgs: any = await msgRes.json();
            if (!msgRes.ok || !Array.isArray(msgs)) continue;
            for (const msg of msgs) {
              const authorId = msg?.author?.id;
              if (!authorId || msg.author?.bot || !msg.content) continue;
              const authorPersonId = buildPersonId('discord', String(authorId));
              const ts = msg.timestamp ? Date.parse(msg.timestamp) || Date.now() : Date.now();
              if (!personsMap.has(authorPersonId)) {
                personsMap.set(
                  authorPersonId,
                  normalizePerson({
                    userId: ctx.userId,
                    source: 'discord',
                    externalId: String(authorId),
                    handle: String(msg.author.username || authorId),
                    displayName: String(msg.author.global_name || msg.author.username),
                    interests: extractTopics(String(msg.content)),
                    retentionDays,
                    nowMs: ts,
                  })
                );
              }
              contents.push(
                normalizeContent({
                  userId: ctx.userId,
                  source: 'discord',
                  authorPersonId,
                  sourceItemId: String(msg.id),
                  text: String(msg.content),
                  ts,
                  retentionDays,
                })
              );
              for (const mentioned of Array.isArray(msg.mentions) ? msg.mentions : []) {
                const dstId = buildPersonId('discord', String(mentioned.id));
                if (dstId !== authorPersonId) {
                  interactions.push(
                    normalizeInteraction({
                      userId: ctx.userId,
                      source: 'discord',
                      srcPersonId: authorPersonId,
                      dstPersonId: dstId,
                      type: 'mention',
                      ts,
                      retentionDays,
                      uniqueKey: `dc-${msg.id}-${mentioned.id}`,
                    })
                  );
                }
              }
              if (msg.referenced_message?.author?.id) {
                const refDst = buildPersonId('discord', String(msg.referenced_message.author.id));
                interactions.push(
                  normalizeInteraction({
                    userId: ctx.userId,
                    source: 'discord',
                    srcPersonId: authorPersonId,
                    dstPersonId: refDst || selfId,
                    type: 'reply',
                    ts,
                    retentionDays,
                    uniqueKey: `dc-rep-${msg.id}`,
                  })
                );
              }
            }
          }
        }
      }
    }

    const persons = Array.from(personsMap.values());
    const lastPerson = persons.length ? persons[persons.length - 1].handles.discord || '' : '';
    return {
      nextCursor: persons.length >= 50 ? lastPerson : '',
      hasMore: persons.length >= 50,
      persons,
      interactions,
      contents,
    };
  }

  async webhook(event: ConnectorWebhookEvent): Promise<ConnectorWebhookResult> {
    const publicKeyHex = process.env.DISCORD_PUBLIC_KEY || '';
    const sigHex = String(event.headers['x-signature-ed25519'] || '');
    const timestamp = String(event.headers['x-signature-timestamp'] || '');

    if (!publicKeyHex) {
      return { verified: false, statusCode: 503, error: 'Discord public key not configured.' };
    }
    if (!sigHex || !timestamp) {
      return { verified: false, statusCode: 401, error: 'Missing Discord Ed25519 signature headers.' };
    }

    try {
      // Wrap raw 32-byte Ed25519 public key in SPKI DER header (12 bytes)
      const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const keyObj = crypto.createPublicKey({
        key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, 'hex')]),
        format: 'der',
        type: 'spki',
      });
      const verified = crypto.verify(
        null,
        Buffer.from(timestamp + event.rawBody, 'utf8'),
        keyObj,
        Buffer.from(sigHex, 'hex')
      );
      if (!verified) {
        return { verified: false, statusCode: 401, error: 'Invalid Discord Ed25519 signature.' };
      }
    } catch {
      return { verified: false, statusCode: 401, error: 'Discord Ed25519 verification failed.' };
    }

    // Discord PING interaction
    if (event.body?.type === 1) {
      return { verified: true, statusCode: 200, responseBody: { type: 1 } };
    }

    return {
      verified: true,
      statusCode: 200,
      responseBody: {
        type: 4,
        data: { content: 'Nexora Social Circle command received.' },
      },
    };
  }

  async revoke(ctx: ConnectorRevokeContext): Promise<{ revokedRemote: boolean }> {
    const clientId = process.env.DISCORD_CLIENT_ID || '';
    const clientSecret = process.env.DISCORD_CLIENT_SECRET || '';
    if (!ctx.tokens?.accessToken || !clientId || !clientSecret) {
      return { revokedRemote: false };
    }
    const fetchImpl = ctx.fetchImpl || fetch;
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: ctx.tokens.accessToken,
      });
      const res = await fetchImpl(`${DISCORD_API}/oauth2/token/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      return { revokedRemote: res.ok };
    } catch {
      return { revokedRemote: false };
    }
  }
}
