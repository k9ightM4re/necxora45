import { Router, type Express, type Response } from 'express';
import {
  attachRequestContext,
  sendApiError,
  v1ErrorMiddleware,
  type AuthedRequest,
  type VerifiedUser,
} from './context.ts';
import { createV1FoundationRouter } from './auth_router.ts';
import { createSocialV1Router } from './social_router.ts';
import { createFeedSearchV1Router, invalidateFeedCache } from './feed_search_router.ts';
import { createMessagingMediaV1Router } from './messaging_media_router.ts';
import { createNearbyNotificationsV1Router } from './nearby_notifications_router.ts';
import { createCommerceStudioModerationV1Router } from './commerce_studio_moderation_router.ts';
import { createFeaturesV1Router } from './features_router.ts';
import { createStyleStudioV1Router } from './style_studio_router.ts';
import { createWorkflowsV1Router } from './workflows_router.ts';

export interface V1RouterDeps {
  projectId: string | null;
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  verifyOptionalBearer: (req: AuthedRequest) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
  isAdminUserServer: (user: any) => boolean;
  wsBroadcastRef?: { broadcastToUids?: (uids: string[], payload: Record<string, any>) => void };
}

export function mountV1ApiRoutes(app: Express, deps: V1RouterDeps): void {
  const v1 = Router();
  v1.use(attachRequestContext);

  v1.use(
    '/',
    createV1FoundationRouter({
      projectId: deps.projectId,
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
      isAdminUserServer: deps.isAdminUserServer,
    })
  );

  v1.use(
    '/',
    createSocialV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
      invalidateFeedCache,
    })
  );

  v1.use(
    '/',
    createFeedSearchV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
    })
  );

  v1.use(
    '/',
    createMessagingMediaV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
      broadcastToUids: (uids, payload) => {
        deps.wsBroadcastRef?.broadcastToUids?.(uids, payload);
      },
    })
  );

  v1.use(
    '/',
    createNearbyNotificationsV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
    })
  );

  v1.use(
    '/',
    createCommerceStudioModerationV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
      isAdminUserServer: deps.isAdminUserServer,
      broadcastToUids: (uids, payload) => {
        deps.wsBroadcastRef?.broadcastToUids?.(uids, payload);
      },
    })
  );

  v1.use(
    '/',
    createStyleStudioV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
    })
  );

  v1.use(
    '/',
    createWorkflowsV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      checkRateLimit: deps.checkRateLimit,
    })
  );

  v1.use(
    '/',
    createFeaturesV1Router({
      requireVerifiedBearer: deps.requireVerifiedBearer,
      isAdminUserServer: deps.isAdminUserServer,
    })
  );

  // Scoped 404 handler for /api/v1/*
  v1.use((req: AuthedRequest, res: Response) => {
    sendApiError(req, res, 404, 'NOT_FOUND', `Endpoint ${req.method} ${req.originalUrl} not found.`);
  });

  v1.use(v1ErrorMiddleware);
  app.use('/api/v1', v1);
}
