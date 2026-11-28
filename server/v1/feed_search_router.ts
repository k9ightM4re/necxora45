import crypto from 'crypto';
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
  fsDeleteDoc,
  fsGetDoc,
  fsListCollection,
  fsQueryCollection,
  fsSetDoc,
  serverTimestampSentinel,
} from './firestore_rest.ts';
import { computeTrendingTopics, rankFeedPosts, type FeedPostRecord } from './feed_ranker.ts';

export interface FeedSearchDeps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
}

interface CacheEntry {
  expiresAtMs: number;
  payload: Record<string, unknown>;
}

const FEED_CACHE_TTL_MS = 15_000;
const feedCache = new Map<string, CacheEntry>();
const negativeFeedbackByUser = new Map<string, { postIds: Set<string>; authorIds: Set<string> }>();

export function invalidateFeedCache(uid?: string): void {
  if (!uid) {
    feedCache.clear();
    return;
  }
  for (const key of feedCache.keys()) {
    if (key.startsWith(`${uid}:`)) {
      feedCache.delete(key);
    }
  }
}

const FeedbackSchema = z.object({
  postId: z.string().min(1).max(128),
  authorId: z.string().max(128).optional().default(''),
  action: z.enum(['not_interested', 'hide', 'undo']).default('not_interested'),
});

const SearchHistorySchema = z.object({
  query: z.string().trim().min(1).max(120),
  category: z.string().max(32).optional().default('all'),
});

export function createFeedSearchV1Router(deps: FeedSearchDeps): Router {
  const router = Router();

  /* -------------------- PHASE 4: HOME FEED & RANKING -------------------- */

  router.get('/feed', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const rawTab = String(req.query.tab || 'for-you');
    const tab: 'for-you' | 'following' | 'latest' =
      rawTab === 'following' || rawTab === 'latest' ? rawTab : 'for-you';
    const hashtag = String(req.query.hashtag || '').trim().slice(0, 60);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 10)));
    const offset = Math.max(0, Number.parseInt(String(req.query.cursor || '0'), 10) || 0);

    const cacheKey = `${user.uid}:${tab}:${hashtag}:${offset}:${limit}`;
    const cached = feedCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      sendApiOk(req, res, { ...cached.payload, cached: true });
      return;
    }

    const [viewerDoc, followingDocs, followerDocs, blockDocs, muteDocs, recentPosts] = await Promise.all([
      fsGetDoc(`users/${user.uid}`, user.idToken).catch(() => null),
      fsListCollection(`users/${user.uid}/following`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/followers`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/blocks`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/mutes`, user.idToken, 200).catch(() => []),
      fsQueryCollection('posts', user.idToken, {
        orderBy: { field: 'createdAt', direction: 'DESCENDING' },
        limit: 160,
      }).catch(() => []),
    ]);

    const followingIds = new Set(followingDocs.map((d) => String(d.uid || d.id || '')).filter(Boolean));
    const followerIds = new Set(followerDocs.map((d) => String(d.uid || d.id || '')).filter(Boolean));
    const mutualIds = new Set([...followingIds].filter((id) => followerIds.has(id)));
    const blockedIds = new Set(blockDocs.map((d) => String(d.blockedUid || d.id || '')).filter(Boolean));
    const storePrefs = nexoraStore.getUserPreferences(user.uid);
    const mutedIds = new Set([
      ...muteDocs.map((d) => String(d.mutedUid || d.id || '')).filter(Boolean),
      ...(storePrefs.mutedUids || []),
    ]);
    const neg = negativeFeedbackByUser.get(user.uid);

    const ranked = rankFeedPosts(recentPosts as FeedPostRecord[], {
      viewerUid: user.uid,
      followingIds,
      mutualIds,
      blockedIds,
      mutedIds,
      viewerInterests: Array.isArray(viewerDoc?.interests) ? viewerDoc.interests : [],
      negativePostIds: neg?.postIds,
      negativeAuthorIds: neg?.authorIds,
      tab,
      hashtag,
    });

    const pageSlice = ranked.slice(offset, offset + limit);
    const nextCursor = offset + limit < ranked.length ? String(offset + limit) : null;
    const payload = {
      tab,
      items: pageSlice.map((entry) => ({
        ...entry.post,
        rankingScore: entry.score,
        rankingReasons: entry.reasons,
      })),
      nextCursor,
      totalRanked: ranked.length,
      cached: false,
    };

    feedCache.set(cacheKey, {
      expiresAtMs: Date.now() + FEED_CACHE_TTL_MS,
      payload,
    });

    sendApiOk(req, res, payload);
  });

  router.post('/feed/feedback', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, FeedbackSchema, req.body || {});
    if (!body) return;

    let entry = negativeFeedbackByUser.get(user.uid);
    if (!entry) {
      entry = { postIds: new Set(), authorIds: new Set() };
      negativeFeedbackByUser.set(user.uid, entry);
    }

    if (body.action === 'undo') {
      entry.postIds.delete(body.postId);
      if (body.authorId) entry.authorIds.delete(body.authorId);
    } else {
      entry.postIds.add(body.postId);
      if (body.action === 'not_interested' && body.authorId) {
        entry.authorIds.add(body.authorId);
      }
    }
    invalidateFeedCache(user.uid);
    sendApiOk(req, res, { postId: body.postId, action: body.action });
  });

  /* -------------------- PHASE 5: EXPLORE & SEARCH -------------------- */

  router.get('/search', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 120);
    const type = String(req.query.type || 'all').toLowerCase();
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 15)));
    const offset = Math.max(0, Number.parseInt(String(req.query.cursor || '0'), 10) || 0);

    const [users, posts, servers, products, followingDocs, blockDocs, muteDocs] = await Promise.all([
      fsListCollection('users', user.idToken, 120).catch(() => []),
      fsQueryCollection('posts', user.idToken, {
        orderBy: { field: 'createdAt', direction: 'DESCENDING' },
        limit: 120,
      }).catch(() => []),
      fsListCollection('servers', user.idToken, 80).catch(() => []),
      fsListCollection('products', user.idToken, 100).catch(() => []),
      fsListCollection(`users/${user.uid}/following`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/blocks`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/mutes`, user.idToken, 200).catch(() => []),
    ]);

    const followingIds = new Set(followingDocs.map((d) => String(d.uid || d.id || '')));
    const blockedIds = new Set(blockDocs.map((d) => String(d.blockedUid || d.id || '')));
    const mutedIds = new Set(muteDocs.map((d) => String(d.mutedUid || d.id || '')));

    const matchedUsers = users
      .filter((u) => {
        if (!u?.id || blockedIds.has(u.id) || u.deactivated || u.suspended) return false;
        if (u.accountPrivacy === 'private' && u.id !== user.uid && !followingIds.has(u.id)) return false;
        if (!q) return true;
        return (
          String(u.displayName || '').toLowerCase().includes(q) ||
          String(u.username || '').toLowerCase().includes(q) ||
          String(u.bio || '').toLowerCase().includes(q)
        );
      })
      .slice(offset, offset + limit);

    const visiblePosts = posts.filter((p) => {
      if (!p?.id || !p.authorId || p.isDraft) return false;
      if (blockedIds.has(p.authorId) || (p.authorId !== user.uid && mutedIds.has(p.authorId))) return false;
      if (p.authorId === user.uid || p.visibility === 'public') return true;
      return p.visibility === 'followers' && followingIds.has(p.authorId);
    });

    const matchedPosts = visiblePosts
      .filter((p) => {
        if (!q) return true;
        const qTag = q.startsWith('#') ? q : `#${q}`;
        return (
          String(p.content || '').toLowerCase().includes(q) ||
          String(p.authorName || '').toLowerCase().includes(q) ||
          (Array.isArray(p.hashtags) && p.hashtags.some((t: any) => String(t).toLowerCase().includes(qTag)))
        );
      })
      .slice(offset, offset + limit);

    const matchedCommunities = servers
      .filter((s) => {
        if (!s?.id || s.visibility === 'private') return false;
        if (!q) return true;
        return (
          String(s.name || '').toLowerCase().includes(q) ||
          String(s.category || '').toLowerCase().includes(q) ||
          String(s.description || '').toLowerCase().includes(q)
        );
      })
      .slice(offset, offset + limit);

    const matchedProducts = products
      .filter((pr) => {
        if (!pr?.id || pr.status !== 'active') return false;
        if (!q) return true;
        return (
          String(pr.title || '').toLowerCase().includes(q) ||
          String(pr.category || '').toLowerCase().includes(q) ||
          String(pr.merchantName || '').toLowerCase().includes(q) ||
          (Array.isArray(pr.tags) && pr.tags.some((t: any) => String(t).toLowerCase().includes(q)))
        );
      })
      .slice(offset, offset + limit);

    const topics = computeTrendingTopics(visiblePosts as FeedPostRecord[], Date.now(), 20).filter(
      (t) => !q || t.tag.includes(q.replace(/^#/, ''))
    );

    sendApiOk(req, res, {
      query: q,
      type,
      users: type === 'all' || type === 'people' ? matchedUsers : [],
      posts: type === 'all' || type === 'posts' ? matchedPosts : [],
      topics: type === 'all' || type === 'topics' ? topics.slice(0, limit) : [],
      communities: type === 'all' || type === 'communities' ? matchedCommunities : [],
      products: type === 'all' || type === 'products' ? matchedProducts : [],
    });
  });

  router.get('/search/suggestions', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);

    const [history, users, posts, products] = await Promise.all([
      fsListCollection(`users/${user.uid}/search_history`, user.idToken, 15).catch(() => []),
      fsListCollection('users', user.idToken, 60).catch(() => []),
      fsQueryCollection('posts', user.idToken, { limit: 60 }).catch(() => []),
      fsListCollection('products', user.idToken, 40).catch(() => []),
    ]);

    const suggestions: Array<{ type: string; label: string; value: string }> = [];
    for (const h of history) {
      if (!q || String(h.query || '').toLowerCase().includes(q)) {
        suggestions.push({ type: 'recent', label: String(h.query), value: String(h.query) });
      }
    }
    for (const t of computeTrendingTopics(posts as FeedPostRecord[], Date.now(), 8)) {
      if (!q || t.tag.includes(q.replace(/^#/, ''))) {
        suggestions.push({ type: 'topic', label: t.tag, value: t.tag });
      }
    }
    for (const u of users) {
      if (u.accountPrivacy === 'private' || u.deactivated) continue;
      const handle = `@${u.username || ''}`;
      if (!q || String(u.displayName || '').toLowerCase().includes(q) || handle.includes(q)) {
        suggestions.push({ type: 'person', label: `${u.displayName} (${handle})`, value: String(u.username || u.displayName) });
      }
      if (suggestions.length >= 16) break;
    }
    for (const p of products) {
      if (p.status !== 'active') continue;
      if (!q || String(p.title || '').toLowerCase().includes(q)) {
        suggestions.push({ type: 'product', label: String(p.title), value: String(p.title) });
      }
      if (suggestions.length >= 20) break;
    }

    sendApiOk(req, res, { suggestions: suggestions.slice(0, 15) });
  });

  router.get('/search/history', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const items = await fsQueryCollection('search_history', user.idToken, {
      parentPath: `users/${user.uid}`,
      orderBy: { field: 'createdAt', direction: 'DESCENDING' },
      limit: 20,
    }).catch(() => []);
    sendApiOk(req, res, { history: items });
  });

  router.post('/search/history', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, SearchHistorySchema, req.body || {});
    if (!body) return;
    const entryId = `sh-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const saved = await fsSetDoc(
      `users/${user.uid}/search_history/${entryId}`,
      {
        id: entryId,
        query: body.query,
        category: body.category,
        createdAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { item: saved }, 201);
  });

  router.delete('/search/history/:entryId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const entryId = String(req.params.entryId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!entryId) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid search history entry.');
      return;
    }
    await fsDeleteDoc(`users/${user.uid}/search_history/${entryId}`, user.idToken).catch(() => false);
    sendApiOk(req, res, { deletedId: entryId });
  });

  router.get('/discover/trending', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const posts = await fsQueryCollection('posts', user.idToken, {
      orderBy: { field: 'createdAt', direction: 'DESCENDING' },
      limit: 120,
    }).catch(() => []);
    sendApiOk(req, res, { topics: computeTrendingTopics(posts as FeedPostRecord[], Date.now(), 12) });
  });

  router.get('/discover/people', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const [users, followingDocs, blockDocs] = await Promise.all([
      fsListCollection('users', user.idToken, 100).catch(() => []),
      fsListCollection(`users/${user.uid}/following`, user.idToken, 200).catch(() => []),
      fsListCollection(`users/${user.uid}/blocks`, user.idToken, 200).catch(() => []),
    ]);
    const followingIds = new Set(followingDocs.map((d) => String(d.uid || d.id || '')));
    const blockedIds = new Set(blockDocs.map((d) => String(d.blockedUid || d.id || '')));
    const suggested = users
      .filter(
        (u) =>
          u?.id &&
          u.id !== user.uid &&
          !followingIds.has(u.id) &&
          !blockedIds.has(u.id) &&
          u.accountPrivacy !== 'private' &&
          !u.suspended &&
          !u.deactivated
      )
      .sort((a, b) => Number(b.followersCount || 0) - Number(a.followersCount || 0))
      .slice(0, 12);
    sendApiOk(req, res, { people: suggested });
  });

  router.get('/discover/communities', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const servers = await fsListCollection('servers', user.idToken, 80).catch(() => []);
    const publicCommunities = servers.filter((s) => s?.id && s.visibility !== 'private').slice(0, 20);
    sendApiOk(req, res, { communities: publicCommunities });
  });

  return router;
}
