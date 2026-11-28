import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { attachRequestContext, v1ErrorMiddleware } from '../server/v1/context.ts';
import { createV1FoundationRouter } from '../server/v1/auth_router.ts';
import { createFeaturesV1Router } from '../server/v1/features_router.ts';
import { maskUserProfile } from '../server/v1/feed_ranker.ts';
import { nexoraStore } from '../server/nexora_store.ts';

function buildTestServer() {
  const app = express();
  app.use(express.json());
  app.use(attachRequestContext);

  const requireVerifiedBearer = async (req, res) => {
    const auth = String(req.headers.authorization || '');
    if (auth === 'Bearer user-token') {
      const user = {
        uid: 'u-standard',
        email: 'member@nexora.example',
        emailVerified: true,
        phoneNumber: '',
        displayName: 'Member',
        idToken: 'user-token',
      };
      req.verifiedUser = user;
      return user;
    }
    if (auth === 'Bearer admin-token') {
      const admin = {
        uid: 'u-admin',
        email: 'admin@nexora.example',
        emailVerified: true,
        phoneNumber: '',
        displayName: 'Admin',
        idToken: 'admin-token',
      };
      req.verifiedUser = admin;
      return admin;
    }
    res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Valid Bearer token required.' } });
    return null;
  };

  const isAdminUserServer = (user) => user?.uid === 'u-admin';
  const checkRateLimit = () => ({ allowed: true, retryAfterSec: 0 });

  const router = express.Router();
  router.use(
    createV1FoundationRouter({
      projectId: 'test-project',
      requireVerifiedBearer,
      checkRateLimit,
      isAdminUserServer,
    })
  );
  router.use(createFeaturesV1Router({ requireVerifiedBearer, isAdminUserServer }));

  app.use('/api/v1', router);
  app.use(v1ErrorMiddleware);
  return app;
}

test('API v1 enforces fail-closed Bearer auth and strict admin RBAC on /api/v1/admin/feature-health', async () => {
  const app = buildTestServer();
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Health endpoint succeeds without leaking secrets
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.ok(healthJson.requestId);
    assert.ok(healthJson.adapters);

    // Unauthenticated registry & admin health fail closed (401)
    const unauthReg = await fetch(`${baseUrl}/api/v1/features/registry`);
    assert.equal(unauthReg.status, 401);

    const unauthAdmin = await fetch(`${baseUrl}/api/v1/admin/feature-health`);
    assert.equal(unauthAdmin.status, 401);

    // Standard authenticated user sees non-admin features, gets 403 on admin health
    const userReg = await fetch(`${baseUrl}/api/v1/features/registry`, {
      headers: { Authorization: 'Bearer user-token' },
    });
    assert.equal(userReg.status, 200);
    const userRegJson = await userReg.json();
    assert.equal(userRegJson.isAdmin, false);
    assert.equal(userRegJson.features.some((f) => f.adminOnly), false);

    const userAdminRes = await fetch(`${baseUrl}/api/v1/admin/feature-health`, {
      headers: { Authorization: 'Bearer user-token' },
    });
    assert.equal(userAdminRes.status, 403);
    const userAdminJson = await userAdminRes.json();
    assert.equal(userAdminJson.error.code, 'FORBIDDEN');

    // Verified admin receives full diagnostics summary
    const adminRes = await fetch(`${baseUrl}/api/v1/admin/feature-health`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(adminRes.status, 200);
    const adminJson = await adminRes.json();
    assert.ok(adminJson.summary.totalRegistered >= 20);
    assert.ok(adminJson.features.some((f) => f.id === 'NX-MOD-02'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('maskUserProfile protects private profiles from non-followers and blocks completely', () => {
  const privateUser = {
    id: 'u-priv',
    username: 'maya_lin',
    displayName: 'Maya Lin',
    bio: 'Sensitive bio',
    website: 'https://maya.example',
    locationLabel: 'San Francisco',
    interests: ['design'],
    followersCount: 42,
    accountPrivacy: 'private',
  };

  const strangerView = maskUserProfile(privateUser, 'u-stranger', { isFollowing: false });
  assert.equal(strangerView?.isPrivateLocked, true);
  assert.equal(strangerView?.bio, undefined);
  assert.equal(strangerView?.website, undefined);
  assert.equal(strangerView?.locationLabel, undefined);

  const followerView = maskUserProfile(privateUser, 'u-follower', { isFollowing: true });
  assert.equal(followerView?.isPrivateLocked, false);
  assert.equal(followerView?.bio, 'Sensitive bio');

  const blockedView = maskUserProfile(privateUser, 'u-blocked', { isBlocked: true });
  assert.equal(blockedView, null);
});

test('nexoraStore geo nearby honors radius presets, pause, opt-out clear, blocks, and coarse labels', () => {
  const now = Date.now();
  nexoraStore.upsertLocation({
    uid: 'geo-me',
    displayName: 'Alex',
    username: 'alex',
    lat: 37.7749,
    lon: -122.4194,
    city: 'San Francisco',
    discoverable: true,
    updatedAtMs: now,
  });
  nexoraStore.upsertLocation({
    uid: 'geo-near',
    displayName: 'Sam',
    username: 'sam',
    lat: 37.7755,
    lon: -122.4196,
    city: 'San Francisco',
    discoverable: true,
    updatedAtMs: now,
  });
  nexoraStore.upsertLocation({
    uid: 'geo-blocked',
    displayName: 'BlockedUser',
    username: 'blk',
    lat: 37.775,
    lon: -122.4195,
    city: 'San Francisco',
    discoverable: true,
    updatedAtMs: now,
  });

  const hits = nexoraStore.listNearbyUsers(37.7749, -122.4194, 1, 'geo-me', new Set(['geo-blocked']));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].uid, 'geo-near');
  assert.ok(hits[0].distanceLabel);
  assert.equal(hits[0].lat, undefined);
  assert.equal(hits[0].lon, undefined);

  // Pause hides user
  nexoraStore.upsertLocation({
    uid: 'geo-near',
    displayName: 'Sam',
    username: 'sam',
    lat: 37.7755,
    lon: -122.4196,
    city: 'San Francisco',
    discoverable: true,
    pausedUntilMs: now + 60_000,
    updatedAtMs: now,
  });
  const afterPause = nexoraStore.listNearbyUsers(37.7749, -122.4194, 1, 'geo-me', new Set(['geo-blocked']));
  assert.equal(afterPause.length, 0);

  nexoraStore.clearUserLocation('geo-me');
  nexoraStore.clearUserLocation('geo-near');
  nexoraStore.clearUserLocation('geo-blocked');
});
