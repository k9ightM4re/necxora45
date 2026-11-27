import crypto from 'crypto';
import { computeExpiresAtMs } from './crypto_vault.ts';
import type { Content, Interaction, InteractionType, Person, SocialSource } from './types.ts';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your', 'just',
  'about', 'into', 'what', 'when', 'where', 'will', 'they', 'them', 'there',
  'here', 'were', 'been', 'also', 'more', 'some', 'like', 'than', 'very',
]);

export function extractTopics(text: string, maxTopics = 8): string[] {
  const clean = String(text || '');
  const hashtags = (clean.match(/#([a-zA-Z0-9_-]{2,32})/g) || []).map((t) =>
    t.slice(1).toLowerCase()
  );
  const words = (clean.toLowerCase().match(/\b[a-z][a-z0-9-]{3,24}\b/g) || []).filter(
    (w) => !STOP_WORDS.has(w)
  );
  const counts = new Map<string, number>();
  for (const h of hashtags) counts.set(h, (counts.get(h) || 0) + 3);
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTopics)
    .map(([topic]) => topic);
}

export function buildPersonId(source: SocialSource, externalId: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${source}:${externalId}`)
    .digest('hex')
    .slice(0, 16);
  return `prs_${source.slice(0, 2)}_${hash}`;
}

export function normalizePerson(params: {
  userId: string;
  source: SocialSource;
  externalId: string;
  handle: string;
  displayName?: string;
  interests?: string[];
  retentionDays?: number;
  nowMs?: number;
}): Person {
  const nowMs = params.nowMs ?? Date.now();
  const id = buildPersonId(params.source, params.externalId || params.handle);
  return {
    id,
    userId: params.userId,
    source: params.source,
    displayName: String(params.displayName || params.handle || 'Member').slice(0, 120),
    handles: {
      [params.source]: String(params.handle || params.externalId).slice(0, 100),
    },
    interests: Array.from(new Set((params.interests || []).map((i) => i.toLowerCase()))).slice(0, 16),
    updatedAtMs: nowMs,
    expiresAtMs: computeExpiresAtMs(nowMs, params.retentionDays ?? 90),
  };
}

export function normalizeInteraction(params: {
  userId: string;
  source: SocialSource;
  srcPersonId: string;
  dstPersonId: string;
  type: InteractionType;
  weight?: number;
  ts?: number;
  retentionDays?: number;
  uniqueKey?: string;
}): Interaction {
  const ts = params.ts ?? Date.now();
  const baseWeight: Record<InteractionType, number> = {
    dm: 3.0,
    reply: 2.5,
    thread: 2.2,
    mention: 2.0,
    comment: 1.8,
    reaction: 1.2,
    co_channel: 0.7,
  };
  const key = params.uniqueKey || `${params.srcPersonId}:${params.dstPersonId}:${params.type}:${ts}`;
  const id = `int_${crypto.createHash('sha256').update(`${params.userId}:${params.source}:${key}`).digest('hex').slice(0, 18)}`;
  return {
    id,
    userId: params.userId,
    src: params.srcPersonId,
    dst: params.dstPersonId,
    type: params.type,
    weight: params.weight ?? baseWeight[params.type] ?? 1.0,
    ts,
    source: params.source,
    expiresAtMs: computeExpiresAtMs(ts, params.retentionDays ?? 90),
  };
}

export function normalizeContent(params: {
  userId: string;
  source: SocialSource;
  authorPersonId: string;
  sourceItemId: string;
  text: string;
  ts?: number;
  retentionDays?: number;
}): Content {
  const ts = params.ts ?? Date.now();
  const cleanText = String(params.text || '').trim().slice(0, 4000);
  const id = `cnt_${crypto.createHash('sha256').update(`${params.userId}:${params.source}:${params.sourceItemId}`).digest('hex').slice(0, 18)}`;
  return {
    id,
    userId: params.userId,
    authorPersonId: params.authorPersonId,
    sourceItemId: String(params.sourceItemId).slice(0, 128),
    text: cleanText,
    topics: extractTopics(cleanText),
    source: params.source,
    ts,
    expiresAtMs: computeExpiresAtMs(ts, params.retentionDays ?? 90),
  };
}
