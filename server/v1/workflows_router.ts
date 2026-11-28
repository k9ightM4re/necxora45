import crypto from 'crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  parseWithSchema,
  sendApiError,
  sendApiOk,
  type AuthedRequest,
  type VerifiedUser,
} from './context.ts';
import {
  fsGetDoc,
  fsListCollection,
  fsSetDoc,
  serverTimestampSentinel,
} from './firestore_rest.ts';

export type WorkflowJobType =
  | 'visual_analysis'
  | 'multi_item_detection'
  | 'catalog_match'
  | 'stylist_recommend'
  | 'virtual_tryon'
  | 'runway_generate'
  | 'media_process'
  | 'catalog_sync';

export type WorkflowJobStatus = 'queued' | 'running' | 'completed' | 'unconfigured' | 'failed';

export interface WorkflowAuditStep {
  toolName: string;
  status: 'ok' | 'skipped' | 'error';
  atMs: number;
  note: string;
}

export interface WorkflowJobRecord {
  id: string;
  userId: string;
  jobType: WorkflowJobType;
  status: WorkflowJobStatus;
  idempotencyKey?: string;
  retries: number;
  inputSummary: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  steps: WorkflowAuditStep[];
  createdAtMs: number;
  updatedAtMs: number;
}

export const INTERNAL_TOOL_ALLOWLIST = new Set<string>([
  'visual_analysis',
  'multi_item_detection',
  'catalog_match',
  'stylist_recommend',
  'virtual_tryon',
  'runway_generate',
  'media_process',
  'catalog_sync',
  'gemini_vision_extract',
  'gemini_stylist_explain',
  'firestore_catalog_query',
  'vton_provider_dispatch',
  'video_runway_dispatch',
  'connector_sync_check',
]);

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const jobMemoryStore = new Map<string, WorkflowJobRecord>();
const idempotencyIndex = new Map<string, string>();

export function resetWorkflowJobsForTests(): void {
  jobMemoryStore.clear();
  idempotencyIndex.clear();
}

export async function recordWorkflowJob(args: {
  userId: string;
  idToken?: string;
  jobType: WorkflowJobType;
  status: WorkflowJobStatus;
  idempotencyKey?: string;
  retries?: number;
  inputSummary?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  steps?: WorkflowAuditStep[];
}): Promise<WorkflowJobRecord> {
  const idemKey = args.idempotencyKey ? `${args.userId}:${args.jobType}:${args.idempotencyKey}` : '';
  if (idemKey) {
    const existingId = idempotencyIndex.get(idemKey);
    if (existingId && jobMemoryStore.has(existingId)) {
      return jobMemoryStore.get(existingId)!;
    }
  }

  const now = Date.now();
  const jobId = `wfj-${now}-${crypto.randomBytes(3).toString('hex')}`;
  const cleanSteps = (args.steps || [])
    .filter((s) => INTERNAL_TOOL_ALLOWLIST.has(s.toolName))
    .slice(0, 20);

  const record: WorkflowJobRecord = {
    id: jobId,
    userId: args.userId,
    jobType: args.jobType,
    status: args.status,
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey.slice(0, 128) } : {}),
    retries: Math.max(0, Number(args.retries || 0)),
    inputSummary: args.inputSummary || {},
    ...(args.resultSummary ? { resultSummary: args.resultSummary } : {}),
    ...(args.errorCode ? { errorCode: args.errorCode } : {}),
    ...(args.errorMessage ? { errorMessage: args.errorMessage.slice(0, 300) } : {}),
    steps: cleanSteps,
    createdAtMs: now,
    updatedAtMs: now,
  };

  if (jobMemoryStore.size >= 2000) {
    const firstKey = jobMemoryStore.keys().next().value;
    if (firstKey) jobMemoryStore.delete(firstKey);
  }
  jobMemoryStore.set(jobId, record);
  if (idemKey) idempotencyIndex.set(idemKey, jobId);

  if (args.idToken) {
    fsSetDoc(
      `users/${args.userId}/workflow_jobs/${jobId}`,
      {
        id: jobId,
        userId: args.userId,
        jobType: record.jobType,
        status: record.status,
        ...(record.idempotencyKey ? { idempotencyKey: record.idempotencyKey } : {}),
        retries: record.retries,
        inputSummary: record.inputSummary,
        ...(record.resultSummary ? { resultSummary: record.resultSummary } : {}),
        ...(record.errorCode ? { errorCode: record.errorCode } : {}),
        ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
        steps: record.steps,
        createdAtMs: record.createdAtMs,
        updatedAtMs: record.updatedAtMs,
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      args.idToken
    ).catch(() => {});
  }

  return record;
}

export function listMemoryWorkflowJobsForUser(uid: string): WorkflowJobRecord[] {
  return Array.from(jobMemoryStore.values())
    .filter((j) => j.userId === uid)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 50);
}

const DispatchWorkflowSchema = z.object({
  jobType: z.enum([
    'visual_analysis',
    'multi_item_detection',
    'catalog_match',
    'stylist_recommend',
    'virtual_tryon',
    'runway_generate',
    'media_process',
    'catalog_sync',
  ]),
  idempotencyKey: z.string().trim().min(4).max(128).optional(),
  inputSummary: z.record(z.string(), z.unknown()).optional().default({}),
});

export interface WorkflowsDeps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
}

export function createWorkflowsV1Router(deps: WorkflowsDeps): Router {
  const router = Router();

  router.get('/workflows/jobs', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const persisted = await fsListCollection(`users/${user.uid}/workflow_jobs`, user.idToken, 40).catch(() => []);
    const byId = new Map<string, any>();
    for (const item of listMemoryWorkflowJobsForUser(user.uid)) {
      byId.set(item.id, item);
    }
    for (const doc of persisted) {
      if (doc?.id && !byId.has(doc.id)) byId.set(doc.id, doc);
    }
    const jobs = Array.from(byId.values())
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
      .slice(0, 50);

    sendApiOk(req, res, {
      jobs,
      allowedTools: Array.from(INTERNAL_TOOL_ALLOWLIST),
    });
  });

  router.get('/workflows/jobs/:jobId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const jobId = String(req.params.jobId || '').trim();
    if (!VALID_ID_RE.test(jobId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid workflow job identifier.');
      return;
    }

    const mem = jobMemoryStore.get(jobId);
    if (mem && mem.userId === user.uid) {
      sendApiOk(req, res, { job: mem });
      return;
    }

    const persisted = await fsGetDoc(`users/${user.uid}/workflow_jobs/${jobId}`, user.idToken).catch(() => null);
    if (!persisted) {
      sendApiError(req, res, 404, 'JOB_NOT_FOUND', 'Workflow job not found.');
      return;
    }
    sendApiOk(req, res, { job: persisted });
  });

  router.post('/workflows/jobs', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const rate = deps.checkRateLimit(`wf:${user.uid}`, 30, 60_000);
    if (!rate.allowed) {
      sendApiError(req, res, 429, 'RATE_LIMIT', `Retry in ${rate.retryAfterSec}s.`);
      return;
    }

    const body = parseWithSchema(req, res, DispatchWorkflowSchema, req.body || {});
    if (!body) return;

    const job = await recordWorkflowJob({
      userId: user.uid,
      idToken: user.idToken,
      jobType: body.jobType,
      status: 'queued',
      idempotencyKey: body.idempotencyKey,
      inputSummary: body.inputSummary,
      steps: [
        {
          toolName: body.jobType,
          status: 'ok',
          atMs: Date.now(),
          note: 'Workflow queued via internal orchestrator.',
        },
      ],
    });

    sendApiOk(req, res, { job }, 202);
  });

  return router;
}
