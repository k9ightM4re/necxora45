export type SocialSource = 'instagram' | 'slack' | 'discord';

export interface Person {
  id: string;
  userId: string;
  source: SocialSource;
  displayName: string;
  handles: {
    instagram?: string;
    slack?: string;
    discord?: string;
  };
  interests: string[];
  updatedAtMs: number;
  expiresAtMs: number;
}

export type InteractionType =
  | 'reply'
  | 'mention'
  | 'reaction'
  | 'dm'
  | 'thread'
  | 'co_channel'
  | 'comment';

export interface Interaction {
  id: string;
  userId: string;
  src: string;
  dst: string;
  type: InteractionType;
  weight: number;
  ts: number;
  source: SocialSource;
  expiresAtMs: number;
}

export interface Content {
  id: string;
  userId: string;
  authorPersonId: string;
  sourceItemId: string;
  text: string;
  topics: string[];
  source: SocialSource;
  ts: number;
  expiresAtMs: number;
}

export interface ConsentRecord {
  userId: string;
  source: SocialSource;
  consented: boolean;
  scopes: string[];
  includeMessageContent: boolean;
  retentionDays: number;
  consentedAtMs: number;
  updatedAtMs: number;
  lastSyncedAtMs: number;
  cursor: string;
  accountLabel: string;
  status: 'disconnected' | 'connected' | 'revoked' | 'error';
  lastError?: string;
}

export interface EncryptedTokenBundle {
  userId: string;
  source: SocialSource;
  wrappedDek: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  updatedAtMs: number;
}

export interface OAuthTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  scope?: string;
  botToken?: string;
  externalAccountId?: string;
  externalAccountLabel?: string;
}

export interface ConnectorAuthorizeInput {
  userId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  includeMessageContent?: boolean;
}

export interface ConnectorAuthorizeResult {
  provider: SocialSource;
  authUrl: string;
  scopes: string[];
  configured: boolean;
  missingEnvVars: string[];
}

export interface ConnectorSyncContext {
  userId: string;
  tokens: OAuthTokenPayload;
  consent: ConsentRecord;
  fetchImpl?: typeof fetch;
}

export interface ConnectorSyncResult {
  nextCursor: string;
  hasMore: boolean;
  persons: Person[];
  interactions: Interaction[];
  contents: Content[];
  rateLimitRemaining?: number;
  retryAfterMs?: number;
}

export interface ConnectorWebhookEvent {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  body: any;
}

export interface ConnectorWebhookResult {
  verified: boolean;
  statusCode: number;
  responseBody?: any;
  persons?: Person[];
  interactions?: Interaction[];
  contents?: Content[];
  error?: string;
}

export interface ConnectorRevokeContext {
  userId: string;
  tokens: OAuthTokenPayload | null;
  fetchImpl?: typeof fetch;
}

export interface Connector {
  readonly source: SocialSource;
  authorize(input: ConnectorAuthorizeInput): Promise<ConnectorAuthorizeResult>;
  sync(cursor: string | null, ctx: ConnectorSyncContext): Promise<ConnectorSyncResult>;
  webhook(event: ConnectorWebhookEvent, ctx?: { userId?: string }): Promise<ConnectorWebhookResult>;
  revoke(ctx: ConnectorRevokeContext): Promise<{ revokedRemote: boolean }>;
}

export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dead_letter';

export interface SyncJobRecord {
  id: string;
  idempotencyKey: string;
  userId: string;
  source: SocialSource;
  cursor: string;
  attempt: number;
  maxAttempts: number;
  status: SyncJobStatus;
  nextRunAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  lastError?: string;
  stats?: {
    persons: number;
    interactions: number;
    contents: number;
  };
}
