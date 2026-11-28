import { Router, type Response } from 'express';
import { z } from 'zod';
import { nexoraStore } from '../nexora_store.ts';
import {
  parseWithSchema,
  sendApiError,
  sendApiOk,
  type AuthedRequest,
  type VerifiedUser,
} from './context.ts';
import {
  fsListCollection,
  fsPatchDoc,
  fsQueryCollection,
  serverTimestampSentinel,
} from './firestore_rest.ts';

export interface NearbyNotificationsDeps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
}

const NearbyLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  city: z.string().max(80).optional().default('Nearby Area'),
  displayName: z.string().max(120).optional(),
  username: z.string().max(50).optional(),
  discoverable: z.boolean().default(true),
  pauseMinutes: z.number().min(0).max(1440).optional().default(0),
  ttlMinutes: z.number().min(5).max(240).optional().default(15),
});

export function createNearbyNotificationsV1Router(deps: NearbyNotificationsDeps): Router {
  const router = Router();

  /* -------------------- PHASE 10: NEARBY DISCOVERY (PRIVACY-SAFE) -------------------- */

  router.post('/nearby/location', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, NearbyLocationSchema, req.body || {});
    if (!body) return;

    if (!body.discoverable) {
      nexoraStore.clearUserLocation(user.uid);
      sendApiOk(req, res, { discoverable: false, cleared: true });
      return;
    }

    const now = Date.now();
    const saved = nexoraStore.upsertLocation({
      uid: user.uid,
      displayName: body.displayName || user.displayName || 'Nexora Member',
      username: body.username || 'member',
      lat: body.lat,
      lon: body.lon,
      city: body.city,
      discoverable: true,
      expiresAtMs: now + body.ttlMinutes * 60_000,
      pausedUntilMs: body.pauseMinutes > 0 ? now + body.pauseMinutes * 60_000 : 0,
      updatedAtMs: now,
    });

    sendApiOk(req, res, {
      location: {
        city: saved.city,
        discoverable: saved.discoverable,
        expiresAtMs: saved.expiresAtMs,
        pausedUntilMs: saved.pausedUntilMs,
        updatedAtMs: saved.updatedAtMs,
      },
    });
  });

  router.get('/nearby/people', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    // Anti-trilateration probe rate limit
    const rate = deps.checkRateLimit(`nearby-probe:${user.uid}`, 30, 60_000);
    if (!rate.allowed) {
      sendApiError(req, res, 429, 'RATE_LIMITED', `Nearby lookup limit reached. Wait ${rate.retryAfterSec}s.`);
      return;
    }

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Math.min(250, Math.max(0.1, Number(req.query.radiusKm || 5)));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      sendApiError(req, res, 400, 'COORDINATES_REQUIRED', 'Valid latitude and longitude are required.');
      return;
    }

    const [blockDocs, muteDocs] = await Promise.all([
      fsListCollection(`users/${user.uid}/blocks`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/mutes`, user.idToken, 200).catch(() => []),
    ]);
    const prefs = nexoraStore.getUserPreferences(user.uid);
    const excluded = new Set<string>([
      ...blockDocs.map((d) => String(d.blockedUid || d.id || '')),
      ...muteDocs.map((d) => String(d.mutedUid || d.id || '')),
      ...(prefs.mutedUids || []),
    ]);

    // Never return raw peer lat/lon coordinates — only city, coarse distanceKm, and bucketed distanceLabel
    const people = nexoraStore.listNearbyUsers(lat, lon, radiusKm, user.uid, excluded);
    sendApiOk(req, res, {
      radiusKm,
      people,
      privacyNote: 'Exact coordinates are rounded and never shared with other users.',
    });
  });

  /* -------------------- PHASE 11: NOTIFICATIONS -------------------- */

  router.get('/notifications', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const categoryFilter = String(req.query.category || 'all').trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number.parseInt(String(req.query.cursor || '0'), 10) || 0);

    const [rawNotifs, muteDocs, blockDocs] = await Promise.all([
      fsQueryCollection('notifications', user.idToken, {
        parentPath: `users/${user.uid}`,
        orderBy: { field: 'createdAt', direction: 'DESCENDING' },
        limit: 120,
      }).catch(() => []),
      fsListCollection(`users/${user.uid}/mutes`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/blocks`, user.idToken, 200).catch(() => []),
    ]);

    const mutedSenders = new Set([
      ...muteDocs.map((d) => String(d.mutedUid || d.id || '')),
      ...blockDocs.map((d) => String(d.blockedUid || d.id || '')),
      ...(nexoraStore.getUserPreferences(user.uid).mutedUids || []),
    ]);

    const seenKeys = new Set<string>();
    const deduped = rawNotifs.filter((n) => {
      if (!n?.id) return false;
      if (n.senderId && mutedSenders.has(String(n.senderId))) return false;
      const cat = String(n.category || 'general').toLowerCase();
      if (categoryFilter !== 'all' && cat !== categoryFilter) return false;
      const key = `${cat}:${n.targetId || ''}:${n.senderId || ''}:${n.title || ''}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    const page = deduped.slice(offset, offset + limit);
    const nextCursor = offset + limit < deduped.length ? String(offset + limit) : null;
    const unreadCount = deduped.filter((n) => Boolean(n.unread)).length;

    sendApiOk(req, res, {
      notifications: page,
      unreadCount,
      nextCursor,
    });
  });

  router.patch('/notifications/:notifId/read', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const notifId = String(req.params.notifId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!notifId) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid notification ID.');
      return;
    }
    const updated = await fsPatchDoc(
      `users/${user.uid}/notifications/${notifId}`,
      { unread: false },
      user.idToken
    );
    sendApiOk(req, res, { notification: updated });
  });

  router.post('/notifications/read-all', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const unread = await fsQueryCollection('notifications', user.idToken, {
      parentPath: `users/${user.uid}`,
      where: [{ field: 'unread', op: 'EQUAL', value: true }],
      limit: 60,
    }).catch(() => []);

    await Promise.all(
      unread.map((n) =>
        fsPatchDoc(`users/${user.uid}/notifications/${n.id}`, { unread: false }, user.idToken).catch(() => null)
      )
    );
    sendApiOk(req, res, { markedReadCount: unread.length });
  });

  return router;
}
