import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { nexoraStore } from './nexora_store.ts';

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  city: z.string().max(80).optional().default('Nearby Area'),
  displayName: z.string().max(120).optional().default('Nexora Member'),
  username: z.string().max(50).optional().default('member'),
  discoverable: z.boolean().optional().default(true),
});

const LocalEventSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(320).optional().default(''),
  category: z.string().max(40).optional().default('Meetup'),
  city: z.string().max(80).optional().default('Local Area'),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  startsAt: z.string().min(2).max(64),
});

const PreferencesSchema = z.object({
  closeFriendUids: z.array(z.string().max(128)).max(200).optional(),
  mutedUids: z.array(z.string().max(128)).max(200).optional(),
  quietMode: z.boolean().optional(),
  notifyDms: z.boolean().optional(),
  notifyMentions: z.boolean().optional(),
  notifyLikes: z.boolean().optional(),
  notifyFollows: z.boolean().optional(),
});

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(500),
  keys: z.record(z.string(), z.string()).optional(),
});

export interface DiscoveryRouterDeps {
  requireVerifiedBearer: (req: Request, res: Response) => Promise<any | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
}

export function mountDiscoveryRoutes(app: Express, deps: DiscoveryRouterDeps): void {
  /* ---------------- Geo Discovery & Local Events ---------------- */

  app.post('/api/discovery/location', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const parsed = LocationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid coordinates are required.' });
      return;
    }

    const saved = nexoraStore.upsertLocation({
      uid: user.uid,
      displayName: parsed.data.displayName || user.displayName || 'Nexora Member',
      username: parsed.data.username || 'member',
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      city: parsed.data.city || 'Nearby Area',
      discoverable: parsed.data.discoverable,
      updatedAtMs: Date.now(),
    });

    res.json({
      ok: true,
      location: {
        city: saved.city,
        discoverable: saved.discoverable,
        updatedAtMs: saved.updatedAtMs,
      },
    });
  });

  app.get('/api/discovery/nearby', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const rawLat = req.query.lat !== undefined ? Number(req.query.lat) : null;
    const rawLon = req.query.lon !== undefined ? Number(req.query.lon) : null;
    const radiusKm = Math.min(250, Math.max(1, Number(req.query.radiusKm || 50)));

    const hasValidCoords =
      rawLat !== null &&
      rawLon !== null &&
      Number.isFinite(rawLat) &&
      Number.isFinite(rawLon) &&
      rawLat >= -90 &&
      rawLat <= 90 &&
      rawLon >= -180 &&
      rawLon <= 180;

    const people = hasValidCoords
      ? nexoraStore.listNearbyUsers(rawLat!, rawLon!, radiusKm, user.uid)
      : [];
    const events = nexoraStore.listNearbyEvents(
      hasValidCoords ? rawLat : null,
      hasValidCoords ? rawLon : null,
      radiusKm
    );

    res.json({
      ok: true,
      radiusKm,
      people,
      events,
    });
  });

  app.post('/api/discovery/events', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const rate = deps.checkRateLimit(`local-evt:${user.uid}`, 10, 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many local events created. Retry in ${rate.retryAfterSec}s.` });
      return;
    }

    const parsed = LocalEventSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Title, location, and start time are required.' });
      return;
    }

    const event = nexoraStore.createLocalEvent({
      id: `levt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      category: parsed.data.category.trim(),
      city: parsed.data.city.trim(),
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      startsAt: parsed.data.startsAt.trim(),
      hostUid: user.uid,
      hostName: user.displayName || 'Nexora Member',
      rsvpUids: [user.uid],
      createdAtMs: Date.now(),
    });

    res.status(201).json({ ok: true, event });
  });

  app.post('/api/discovery/events/:eventId/rsvp', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const eventId = String(req.params.eventId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const updated = nexoraStore.toggleEventRsvp(eventId, user.uid);
    if (!updated) {
      res.status(404).json({ error: 'Local event not found.' });
      return;
    }
    res.json({ ok: true, event: updated });
  });

  /* ---------------- WebRTC ICE / TURN Endpoint ---------------- */

  app.get('/api/rtc/ice-servers', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    const turnUrls = String(process.env.TURN_URLS || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (turnUrls.length > 0) {
      iceServers.push({
        urls: turnUrls,
        ...(process.env.TURN_USERNAME ? { username: process.env.TURN_USERNAME } : {}),
        ...(process.env.TURN_CREDENTIAL ? { credential: process.env.TURN_CREDENTIAL } : {}),
      });
    }

    res.json({
      ok: true,
      iceServers,
      turnConfigured: turnUrls.length > 0,
    });
  });

  /* ---------------- Notification Preferences & Web Push ---------------- */

  app.get('/api/notifications/preferences', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    res.json({ ok: true, preferences: nexoraStore.getUserPreferences(user.uid) });
  });

  app.put('/api/notifications/preferences', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const parsed = PreferencesSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid notification preferences.' });
      return;
    }

    const updated = nexoraStore.upsertUserPreferences(user.uid, parsed.data);
    res.json({ ok: true, preferences: updated });
  });

  app.post('/api/push/subscribe', async (req: Request, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const parsed = PushSubscriptionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid Web Push subscription is required.' });
      return;
    }

    nexoraStore.savePushSubscription(user.uid, {
      endpoint: parsed.data.endpoint,
      keys: parsed.data.keys,
      createdAtMs: Date.now(),
    });
    res.json({ ok: true });
  });
}
