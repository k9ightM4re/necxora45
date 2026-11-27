import crypto from 'crypto';
import { redactForLog } from './crypto_vault.ts';
import type { SocialCircleStore } from './store.ts';
import type { Connector, SocialSource, SyncJobRecord } from './types.ts';

export interface SyncQueueOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Idempotent queue-based sync engine with exponential backoff, jitter, and dead-letter handling.
 * Designed with BullMQ-compatible job semantics while running zero-external-broker in single-node Express.
 */
export class SyncQueue {
  private store: SocialCircleStore;
  private connectors: Map<SocialSource, Connector>;
  private maxAttempts: number;
  private baseBackoffMs: number;
  private maxBackoffMs: number;
  private sleepFn: (ms: number) => Promise<void>;
  private activeLocks = new Set<string>();

  constructor(
    store: SocialCircleStore,
    connectors: Map<SocialSource, Connector>,
    opts: SyncQueueOptions = {}
  ) {
    this.store = store;
    this.connectors = connectors;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseBackoffMs = opts.baseBackoffMs ?? 250;
    this.maxBackoffMs = opts.maxBackoffMs ?? 8000;
    this.sleepFn = opts.sleepFn ?? defaultSleep;
  }

  computeBackoffMs(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs && retryAfterMs > 0) {
      return Math.min(this.maxBackoffMs, retryAfterMs);
    }
    const exp = this.baseBackoffMs * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * Math.max(10, Math.round(exp * 0.2)));
    return Math.min(this.maxBackoffMs, exp + jitter);
  }

  async enqueueAndRun(params: {
    userId: string;
    source: SocialSource;
    cursor?: string;
    idempotencyKey?: string;
    fetchImpl?: typeof fetch;
  }): Promise<SyncJobRecord> {
    const { userId, source } = params;
    const consent = this.store.getConsent(userId, source);
    const cursor = params.cursor ?? consent.cursor ?? '';
    const idempotencyKey =
      params.idempotencyKey || `${userId}:${source}:${cursor || 'initial'}:${Math.floor(Date.now() / 15000)}`;

    const existing = this.store.findJobByIdempotencyKey(userId, idempotencyKey);
    if (existing && (existing.status === 'completed' || existing.status === 'running')) {
      return existing;
    }

    if (this.activeLocks.has(idempotencyKey)) {
      return (
        existing || {
          id: `job-${crypto.randomUUID().slice(0, 10)}`,
          idempotencyKey,
          userId,
          source,
          cursor,
          attempt: 1,
          maxAttempts: this.maxAttempts,
          status: 'running',
          nextRunAtMs: Date.now(),
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        }
      );
    }

    const connector = this.connectors.get(source);
    if (!connector) {
      throw new Error(`Unsupported connector source: ${source}`);
    }
    if (!consent.consented || consent.status !== 'connected') {
      throw new Error(`Explicit user consent required before syncing ${source}.`);
    }
    const tokens = this.store.getTokens(userId, source);
    if (!tokens) {
      throw new Error(`No encrypted credentials stored for ${source}. Please reconnect.`);
    }

    const now = Date.now();
    const job: SyncJobRecord = existing || {
      id: `job-${crypto.randomUUID().slice(0, 10)}`,
      idempotencyKey,
      userId,
      source,
      cursor,
      attempt: 0,
      maxAttempts: this.maxAttempts,
      status: 'queued',
      nextRunAtMs: now,
      createdAtMs: now,
      updatedAtMs: now,
    };

    this.activeLocks.add(idempotencyKey);
    try {
      let currentCursor = cursor;
      let totalStats = { persons: 0, interactions: 0, contents: 0 };

      for (let attempt = job.attempt + 1; attempt <= this.maxAttempts; attempt++) {
        job.attempt = attempt;
        job.status = 'running';
        job.updatedAtMs = Date.now();
        this.store.saveJob(job);

        try {
          let hasMore = true;
          let pages = 0;
          while (hasMore && pages < 5) {
            pages++;
            const result = await connector.sync(currentCursor || null, {
              userId,
              tokens,
              consent,
              fetchImpl: params.fetchImpl,
            });
            const counts = this.store.upsertNormalizedBatch(userId, {
              persons: result.persons,
              interactions: result.interactions,
              contents: result.contents,
            });
            totalStats.persons += counts.persons;
            totalStats.interactions += counts.interactions;
            totalStats.contents += counts.contents;
            currentCursor = result.nextCursor || currentCursor;
            hasMore = Boolean(result.hasMore && result.nextCursor);

            if (result.retryAfterMs && result.retryAfterMs > 0) {
              await this.sleepFn(this.computeBackoffMs(attempt, result.retryAfterMs));
            }
          }

          this.store.setConsent({
            ...consent,
            cursor: currentCursor,
            lastSyncedAtMs: Date.now(),
            lastError: '',
          });

          job.status = 'completed';
          job.cursor = currentCursor;
          job.stats = totalStats;
          job.lastError = undefined;
          job.updatedAtMs = Date.now();
          this.store.saveJob(job);
          return job;
        } catch (err: any) {
          const msg = String(err?.message || 'Sync attempt failed').slice(0, 240);
          job.lastError = msg;
          job.updatedAtMs = Date.now();
          console.warn('SocialCircle sync retry:', JSON.stringify(redactForLog({ userId, source, attempt, error: msg })));

          if (attempt >= this.maxAttempts) {
            job.status = 'dead_letter';
            this.store.saveJob(job);
            this.store.setConsent({ ...consent, lastError: msg });
            return job;
          }

          const delay = this.computeBackoffMs(attempt, err?.retryAfterMs);
          job.status = 'failed';
          job.nextRunAtMs = Date.now() + delay;
          this.store.saveJob(job);
          await this.sleepFn(delay);
        }
      }
      return job;
    } finally {
      this.activeLocks.delete(idempotencyKey);
    }
  }
}
