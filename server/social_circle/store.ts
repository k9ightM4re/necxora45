import fs from 'fs';
import path from 'path';
import {
  envelopeDecryptTokens,
  envelopeEncryptTokens,
} from './crypto_vault.ts';
import type {
  ConsentRecord,
  Content,
  EncryptedTokenBundle,
  Interaction,
  OAuthTokenPayload,
  Person,
  SocialSource,
  SyncJobRecord,
} from './types.ts';

export interface SocialCircleUserData {
  consents: Partial<Record<SocialSource, ConsentRecord>>;
  tokens: Partial<Record<SocialSource, EncryptedTokenBundle>>;
  persons: Person[];
  interactions: Interaction[];
  contents: Content[];
  jobs: SyncJobRecord[];
}

type StoreRoot = Record<string, SocialCircleUserData>;

const DEFAULT_STORE_PATH = path.resolve(process.cwd(), '.data', 'social_circle_store.json');

export class SocialCircleStore {
  private filePath: string | null;
  private memory: StoreRoot = {};

  constructor(filePath: string | null = DEFAULT_STORE_PATH) {
    this.filePath = filePath;
    if (this.filePath) {
      this.memory = this.readFromDisk();
    }
  }

  private readFromDisk(): StoreRoot {
    if (!this.filePath) return this.memory;
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.memory, null, 2), { mode: 0o600 });
  }

  private ensureUser(userId: string): SocialCircleUserData {
    if (!this.memory[userId]) {
      this.memory[userId] = {
        consents: {},
        tokens: {},
        persons: [],
        interactions: [],
        contents: [],
        jobs: [],
      };
    }
    return this.memory[userId];
  }

  getConsent(userId: string, source: SocialSource): ConsentRecord {
    const u = this.ensureUser(userId);
    const existing = u.consents[source];
    if (existing) return existing;
    return {
      userId,
      source,
      consented: false,
      scopes: [],
      includeMessageContent: false,
      retentionDays: 90,
      consentedAtMs: 0,
      updatedAtMs: 0,
      lastSyncedAtMs: 0,
      cursor: '',
      accountLabel: '',
      status: 'disconnected',
    };
  }

  setConsent(record: ConsentRecord): ConsentRecord {
    const u = this.ensureUser(record.userId);
    u.consents[record.source] = { ...record, updatedAtMs: Date.now() };
    this.persist();
    return u.consents[record.source]!;
  }

  saveTokens(userId: string, source: SocialSource, tokens: OAuthTokenPayload): void {
    const u = this.ensureUser(userId);
    u.tokens[source] = envelopeEncryptTokens(userId, source, tokens);
    this.persist();
  }

  getTokens(userId: string, source: SocialSource): OAuthTokenPayload | null {
    const u = this.ensureUser(userId);
    const bundle = u.tokens[source];
    if (!bundle) return null;
    return envelopeDecryptTokens(bundle);
  }

  hasTokens(userId: string, source: SocialSource): boolean {
    const u = this.ensureUser(userId);
    return Boolean(u.tokens[source]);
  }

  upsertNormalizedBatch(
    userId: string,
    batch: { persons: Person[]; interactions: Interaction[]; contents: Content[] }
  ): { persons: number; interactions: number; contents: number } {
    const u = this.ensureUser(userId);

    const personMap = new Map(u.persons.map((p) => [p.id, p]));
    for (const p of batch.persons) {
      if (p.userId !== userId) continue;
      const prev = personMap.get(p.id);
      personMap.set(
        p.id,
        prev
          ? {
              ...prev,
              ...p,
              handles: { ...prev.handles, ...p.handles },
              interests: Array.from(new Set([...(prev.interests || []), ...(p.interests || [])])).slice(0, 24),
            }
          : p
      );
    }
    u.persons = Array.from(personMap.values());

    const interMap = new Map(u.interactions.map((i) => [i.id, i]));
    for (const inter of batch.interactions) {
      if (inter.userId !== userId) continue;
      interMap.set(inter.id, inter);
    }
    u.interactions = Array.from(interMap.values());

    const contentMap = new Map(u.contents.map((c) => [c.id, c]));
    for (const c of batch.contents) {
      if (c.userId !== userId) continue;
      contentMap.set(c.id, c);
    }
    u.contents = Array.from(contentMap.values());

    this.persist();
    return {
      persons: batch.persons.length,
      interactions: batch.interactions.length,
      contents: batch.contents.length,
    };
  }

  getUserGraphData(userId: string): {
    persons: Person[];
    interactions: Interaction[];
    contents: Content[];
    jobs: SyncJobRecord[];
  } {
    const u = this.ensureUser(userId);
    return {
      persons: u.persons.filter((p) => p.userId === userId),
      interactions: u.interactions.filter((i) => i.userId === userId),
      contents: u.contents.filter((c) => c.userId === userId),
      jobs: u.jobs.filter((j) => j.userId === userId),
    };
  }

  saveJob(job: SyncJobRecord): void {
    const u = this.ensureUser(job.userId);
    const idx = u.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) {
      u.jobs[idx] = { ...job };
    } else {
      u.jobs.unshift({ ...job });
      if (u.jobs.length > 50) u.jobs = u.jobs.slice(0, 50);
    }
    this.persist();
  }

  findJobByIdempotencyKey(userId: string, idempotencyKey: string): SyncJobRecord | null {
    const u = this.ensureUser(userId);
    return u.jobs.find((j) => j.idempotencyKey === idempotencyKey) || null;
  }

  /**
   * One-click disconnect + full deletion of all tokens & normalized data for a source.
   */
  deleteSourceData(userId: string, source: SocialSource): {
    deletedPersons: number;
    deletedInteractions: number;
    deletedContents: number;
  } {
    const u = this.ensureUser(userId);
    delete u.tokens[source];
    delete u.consents[source];

    const prevPersons = u.persons.length;
    const prevInteractions = u.interactions.length;
    const prevContents = u.contents.length;

    u.persons = u.persons.filter((p) => p.source !== source);
    u.interactions = u.interactions.filter((i) => i.source !== source);
    u.contents = u.contents.filter((c) => c.source !== source);
    u.jobs = u.jobs.filter((j) => j.source !== source);

    this.persist();
    return {
      deletedPersons: prevPersons - u.persons.length,
      deletedInteractions: prevInteractions - u.interactions.length,
      deletedContents: prevContents - u.contents.length,
    };
  }

  /**
   * Updates retention window for a user's source and enforces expiration immediately.
   */
  updateRetentionDays(userId: string, source: SocialSource, retentionDays: number): ConsentRecord {
    const clamped = Math.min(365, Math.max(1, Math.round(Number(retentionDays) || 90)));
    const consent = this.getConsent(userId, source);
    const updated = this.setConsent({ ...consent, retentionDays: clamped });
    this.sweepExpired(Date.now());
    return updated;
  }

  /**
   * Data-retention sweep (default 90 days): purges expired Persons, Interactions, and Contents across all users.
   */
  sweepExpired(nowMs = Date.now()): { purgedPersons: number; purgedInteractions: number; purgedContents: number } {
    let purgedPersons = 0;
    let purgedInteractions = 0;
    let purgedContents = 0;

    for (const u of Object.values(this.memory)) {
      const pBefore = u.persons.length;
      const iBefore = u.interactions.length;
      const cBefore = u.contents.length;

      u.persons = u.persons.filter((p) => !p.expiresAtMs || p.expiresAtMs > nowMs);
      u.interactions = u.interactions.filter((i) => !i.expiresAtMs || i.expiresAtMs > nowMs);
      u.contents = u.contents.filter((c) => !c.expiresAtMs || c.expiresAtMs > nowMs);

      purgedPersons += pBefore - u.persons.length;
      purgedInteractions += iBefore - u.interactions.length;
      purgedContents += cBefore - u.contents.length;
    }

    if (purgedPersons || purgedInteractions || purgedContents) {
      this.persist();
    }
    return { purgedPersons, purgedInteractions, purgedContents };
  }
}

export const sharedSocialCircleStore = new SocialCircleStore();
