import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { nexoraStore } from '../nexora_store.ts';
import {
  getAdapterConfigStatus,
  logEvent,
  parseWithSchema,
  sendApiError,
  sendApiOk,
  type AuthedRequest,
  type VerifiedUser,
} from './context.ts';
import { fsGetDoc, fsSetDoc, isFirestoreConfigured, serverTimestampSentinel } from './firestore_rest.ts';

export interface AuthRouterDeps {
  projectId: string | null;
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
  isAdminUserServer: (user: any) => boolean;
}

const DeactivateSchema = z.object({
  reason: z.string().max(300).optional().default('user_requested'),
});

const DeleteAccountSchema = z.object({
  confirmText: z.literal('DELETE'),
});

export function createV1FoundationRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const startedAtMs = Date.now();

  router.get('/health', (req: AuthedRequest, res: Response) => {
    const adapters = getAdapterConfigStatus();
    sendApiOk(req, res, {
      service: 'nexora-api-v1',
      version: '1.0.0',
      uptimeSec: Math.round((Date.now() - startedAtMs) / 1000),
      projectId: deps.projectId,
      firestoreConfigured: isFirestoreConfigured(),
      adapters,
    });
  });

  router.get('/auth/me', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    let profile: Record<string, any> | null = null;
    try {
      profile = await fsGetDoc(`users/${user.uid}`, user.idToken);
    } catch {
      profile = null;
    }
    sendApiOk(req, res, {
      user: {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        isAdmin: deps.isAdminUserServer(user),
      },
      profile,
    });
  });

  router.post('/auth/deactivate', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const parsed = parseWithSchema(req, res, DeactivateSchema, req.body || {});
    if (!parsed) return;

    const rate = deps.checkRateLimit(`deactivate:${user.uid}`, 5, 10 * 60 * 1000);
    if (!rate.allowed) {
      sendApiError(req, res, 429, 'RATE_LIMIT', `Please wait ${rate.retryAfterSec}s before retrying.`);
      return;
    }

    nexoraStore.clearUserLocation(user.uid);
    try {
      const existing = await fsGetDoc(`users/${user.uid}`, user.idToken);
      if (existing) {
        await fsSetDoc(
          `users/${user.uid}`,
          {
            status: 'offline',
            customStatus: 'Account deactivated',
            updatedAt: serverTimestampSentinel(),
          },
          user.idToken,
          { mergeFields: ['status', 'customStatus', 'updatedAt'], preconditionExists: true }
        );
      }
      await fsSetDoc(
        `users/${user.uid}/private/account_state`,
        {
          deactivated: true,
          reason: parsed.reason,
          deactivatedAt: serverTimestampSentinel(),
          updatedAt: serverTimestampSentinel(),
        },
        user.idToken
      ).catch(() => {});
    } catch (err: any) {
      logEvent('warn', 'account_deactivate_firestore_partial', {
        uid: user.uid,
        error: err?.message || 'unknown',
      });
    }

    logEvent('info', 'account_deactivated', { uid: user.uid, requestId: req.requestId });
    sendApiOk(req, res, { deactivated: true });
  });

  router.delete('/auth/account', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const parsed = parseWithSchema(req, res, DeleteAccountSchema, req.body || {});
    if (!parsed) return;

    const removedMedia = nexoraStore.purgeUserData(user.uid);
    const cookieSigClear = crypto.randomBytes(4).toString('hex');
    logEvent('info', 'account_server_cleanup', {
      uid: user.uid,
      removedMedia,
      tokenRef: cookieSigClear,
      requestId: req.requestId,
    });
    sendApiOk(req, res, {
      deletedServerState: true,
      removedMediaCount: removedMedia,
    });
  });

  return router;
}
