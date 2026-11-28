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
  fsCommitWrites,
  fsDeleteDoc,
  fsGetDoc,
  fsListCollection,
  fsPatchDoc,
  fsQueryCollection,
  fsSetDoc,
  serverTimestampSentinel,
} from './firestore_rest.ts';
import { maskUserProfile } from './feed_ranker.ts';

export interface SocialV1Deps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
  invalidateFeedCache?: (uid?: string) => void;
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const UpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,50}$/, 'Username must be 2–50 lowercase letters, numbers, ., _, or -.')
    .optional(),
  bio: z.string().max(500).optional(),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((v) => !v || /^https?:\/\//i.test(v), 'Website must begin with http:// or https://.')
    .optional(),
  locationLabel: z.string().max(100).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  customStatus: z.string().max(200).optional(),
  accountPrivacy: z.enum(['everyone', 'requests_only', 'private']).optional(),
});

const CreatePostSchema = z.object({
  content: z.string().max(4000).default(''),
  mediaType: z.enum(['none', 'image', 'video', 'carousel']).default('none'),
  mediaItems: z
    .array(
      z.object({
        type: z.enum(['image', 'video']),
        url: z.string().min(4).max(400000),
      })
    )
    .max(4)
    .optional()
    .default([]),
  feeling: z.string().max(80).optional().default(''),
  location: z.string().max(100).optional().default(''),
  visibility: z.enum(['public', 'followers', 'private']).default('public'),
  isDraft: z.boolean().optional().default(false),
  productIds: z.array(z.string().max(128)).max(10).optional().default([]),
});

const PatchPostSchema = z.object({
  content: z.string().max(4000).optional(),
  visibility: z.enum(['public', 'followers', 'private']).optional(),
  isDraft: z.boolean().optional(),
  feeling: z.string().max(80).optional(),
  location: z.string().max(100).optional(),
});

const CreateCommentSchema = z.object({
  content: z.string().trim().min(1).max(1500),
  replyToId: z.string().max(128).optional().default(''),
  replyToName: z.string().max(80).optional().default(''),
});

const CommentReactionSchema = z.object({
  emoji: z.string().trim().min(1).max(12),
});

function extractTags(text: string): string[] {
  const matches = String(text || '').match(/#([a-zA-Z0-9_]{2,40})/g) || [];
  return Array.from(new Set(matches.map((m) => `#${m.slice(1).toLowerCase()}`))).slice(0, 20);
}

function extractMentionsList(text: string): string[] {
  const matches = String(text || '').match(/@([a-zA-Z0-9._-]{2,40})/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase()))).slice(0, 20);
}

export function createSocialV1Router(deps: SocialV1Deps): Router {
  const router = Router();

  /* -------------------- PHASE 2: PROFILES & SOCIAL GRAPH -------------------- */

  router.get('/users/:userId', async (req: AuthedRequest, res: Response) => {
    const viewer = await deps.requireVerifiedBearer(req, res);
    if (!viewer) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid user identifier.');
      return;
    }

    const [targetDoc, blockDoc, followDoc, reqDoc, viewerFollowing, targetFollowers] = await Promise.all([
      fsGetDoc(`users/${targetUid}`, viewer.idToken).catch(() => null),
      fsGetDoc(`users/${targetUid}/blocks/${viewer.uid}`, viewer.idToken).catch(() => null),
      fsGetDoc(`users/${viewer.uid}/following/${targetUid}`, viewer.idToken).catch(() => null),
      fsGetDoc(`users/${targetUid}/follow_requests/${viewer.uid}`, viewer.idToken).catch(() => null),
      fsListCollection(`users/${viewer.uid}/following`, viewer.idToken, 100).catch(() => []),
      fsListCollection(`users/${targetUid}/followers`, viewer.idToken, 100).catch(() => []),
    ]);

    if (!targetDoc) {
      sendApiError(req, res, 404, 'USER_NOT_FOUND', 'User profile not found.');
      return;
    }
    if (blockDoc) {
      sendApiError(req, res, 403, 'PROFILE_BLOCKED', 'This profile is unavailable.');
      return;
    }

    const myFollowingIds = new Set(viewerFollowing.map((f) => String(f.uid || f.id || '')));
    const mutualCount = targetFollowers.filter((f) => myFollowingIds.has(String(f.uid || f.id || ''))).length;
    const masked = maskUserProfile(targetDoc, viewer.uid, {
      isFollowing: Boolean(followDoc),
      isBlocked: Boolean(blockDoc),
      hasPendingFollowRequest: reqDoc?.status === 'pending',
      mutualCount,
    });

    sendApiOk(req, res, { user: masked });
  });

  router.patch('/users/me', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, UpdateProfileSchema, req.body || {});
    if (!body) return;

    const patch: Record<string, unknown> = {
      updatedAt: serverTimestampSentinel(),
    };
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.username !== undefined) patch.username = body.username;
    if (body.bio !== undefined) patch.bio = body.bio;
    if (body.website !== undefined) patch.website = body.website;
    if (body.locationLabel !== undefined) patch.locationLabel = body.locationLabel;
    if (body.interests !== undefined) patch.interests = body.interests;
    if (body.customStatus !== undefined) patch.customStatus = body.customStatus;
    if (body.accountPrivacy !== undefined) patch.accountPrivacy = body.accountPrivacy;

    const updated = await fsPatchDoc(`users/${user.uid}`, patch, user.idToken);
    deps.invalidateFeedCache?.(user.uid);
    sendApiOk(req, res, { user: updated });
  });

  router.get('/users/:userId/mutuals', async (req: AuthedRequest, res: Response) => {
    const viewer = await deps.requireVerifiedBearer(req, res);
    if (!viewer) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid user identifier.');
      return;
    }

    const [myFollowing, targetFollowers] = await Promise.all([
      fsListCollection(`users/${viewer.uid}/following`, viewer.idToken, 150).catch(() => []),
      fsListCollection(`users/${targetUid}/followers`, viewer.idToken, 150).catch(() => []),
    ]);
    const mySet = new Set(myFollowing.map((d) => String(d.uid || d.id || '')));
    const mutuals = targetFollowers
      .filter((d) => mySet.has(String(d.uid || d.id || '')))
      .slice(0, 50)
      .map((d) => ({
        uid: d.uid || d.id,
        displayName: d.displayName || 'Nexora Member',
        username: d.username || 'member',
        avatar: d.avatar || '',
      }));

    sendApiOk(req, res, { mutuals, count: mutuals.length });
  });

  router.post('/users/:userId/follow', async (req: AuthedRequest, res: Response) => {
    const viewer = await deps.requireVerifiedBearer(req, res);
    if (!viewer) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid) || targetUid === viewer.uid) {
      sendApiError(req, res, 400, 'INVALID_TARGET', 'Cannot follow this user.');
      return;
    }

    const [targetDoc, viewerDoc, blocked] = await Promise.all([
      fsGetDoc(`users/${targetUid}`, viewer.idToken),
      fsGetDoc(`users/${viewer.uid}`, viewer.idToken),
      fsGetDoc(`users/${targetUid}/blocks/${viewer.uid}`, viewer.idToken).catch(() => null),
    ]);
    if (!targetDoc) {
      sendApiError(req, res, 404, 'USER_NOT_FOUND', 'Target user not found.');
      return;
    }
    if (blocked) {
      sendApiError(req, res, 403, 'USER_BLOCKED', 'You cannot follow this user.');
      return;
    }

    const requiresApproval = targetDoc.accountPrivacy === 'private' || targetDoc.accountPrivacy === 'requests_only';
    if (requiresApproval) {
      await fsSetDoc(
        `users/${targetUid}/follow_requests/${viewer.uid}`,
        {
          requesterUid: viewer.uid,
          targetUid,
          displayName: String(viewerDoc?.displayName || viewer.displayName || 'Nexora Member').slice(0, 120),
          username: String(viewerDoc?.username || 'member').slice(0, 50),
          avatar: String(viewerDoc?.avatar || '').slice(0, 200000),
          status: 'pending',
          createdAt: serverTimestampSentinel(),
          updatedAt: serverTimestampSentinel(),
        },
        viewer.idToken
      );
      sendApiOk(req, res, { status: 'requested', targetUid });
      return;
    }

    await fsCommitWrites(
      [
        {
          type: 'set',
          docPath: `users/${targetUid}/followers/${viewer.uid}`,
          data: {
            uid: viewer.uid,
            displayName: String(viewerDoc?.displayName || viewer.displayName || 'Nexora Member').slice(0, 120),
            username: String(viewerDoc?.username || 'member').slice(0, 50),
            avatar: String(viewerDoc?.avatar || '').slice(0, 200000),
            createdAt: serverTimestampSentinel(),
          },
        },
        {
          type: 'set',
          docPath: `users/${viewer.uid}/following/${targetUid}`,
          data: {
            uid: targetUid,
            displayName: String(targetDoc.displayName || 'Nexora Member').slice(0, 120),
            username: String(targetDoc.username || 'member').slice(0, 50),
            avatar: String(targetDoc.avatar || '').slice(0, 200000),
            createdAt: serverTimestampSentinel(),
          },
        },
      ],
      viewer.idToken
    );

    deps.invalidateFeedCache?.(viewer.uid);
    sendApiOk(req, res, { status: 'following', targetUid });
  });

  router.delete('/users/:userId/follow', async (req: AuthedRequest, res: Response) => {
    const viewer = await deps.requireVerifiedBearer(req, res);
    if (!viewer) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid user identifier.');
      return;
    }

    await Promise.all([
      fsDeleteDoc(`users/${targetUid}/followers/${viewer.uid}`, viewer.idToken).catch(() => false),
      fsDeleteDoc(`users/${viewer.uid}/following/${targetUid}`, viewer.idToken).catch(() => false),
      fsDeleteDoc(`users/${targetUid}/follow_requests/${viewer.uid}`, viewer.idToken).catch(() => false),
    ]);
    deps.invalidateFeedCache?.(viewer.uid);
    sendApiOk(req, res, { status: 'unfollowed', targetUid });
  });

  router.delete('/users/me/followers/:followerUid', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const followerUid = String(req.params.followerUid || '').trim();
    if (!VALID_ID_RE.test(followerUid)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid follower identifier.');
      return;
    }

    await Promise.all([
      fsDeleteDoc(`users/${user.uid}/followers/${followerUid}`, user.idToken).catch(() => false),
      fsDeleteDoc(`users/${followerUid}/following/${user.uid}`, user.idToken).catch(() => false),
    ]);
    sendApiOk(req, res, { removedFollowerUid: followerUid });
  });

  router.get('/follow-requests', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const docs = await fsQueryCollection('follow_requests', user.idToken, {
      parentPath: `users/${user.uid}`,
      where: [{ field: 'targetUid', op: 'EQUAL', value: user.uid }],
      limit: 50,
    }).catch(() => []);
    const pending = docs.filter((d) => d.status === 'pending');
    sendApiOk(req, res, { requests: pending });
  });

  router.post('/follow-requests/:requesterUid/respond', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const requesterUid = String(req.params.requesterUid || '').trim();
    if (!VALID_ID_RE.test(requesterUid)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid requester identifier.');
      return;
    }
    const body = parseWithSchema(req, res, z.object({ action: z.enum(['accept', 'decline']) }), req.body || {});
    if (!body) return;

    const reqDoc = await fsGetDoc(`users/${user.uid}/follow_requests/${requesterUid}`, user.idToken);
    if (!reqDoc) {
      sendApiError(req, res, 404, 'REQUEST_NOT_FOUND', 'Follow request not found.');
      return;
    }

    if (body.action === 'decline') {
      await fsPatchDoc(
        `users/${user.uid}/follow_requests/${requesterUid}`,
        { status: 'declined', updatedAt: serverTimestampSentinel() },
        user.idToken
      );
      sendApiOk(req, res, { status: 'declined', requesterUid });
      return;
    }

    const myProfile = await fsGetDoc(`users/${user.uid}`, user.idToken).catch(() => null);
    // Write followers/following BEFORE updating/deleting follow_request so Firestore rule 1013 passes cleanly
    await fsCommitWrites(
      [
        {
          type: 'set',
          docPath: `users/${user.uid}/followers/${requesterUid}`,
          data: {
            uid: requesterUid,
            displayName: String(reqDoc.displayName || 'Nexora Member').slice(0, 120),
            username: String(reqDoc.username || 'member').slice(0, 50),
            avatar: String(reqDoc.avatar || '').slice(0, 200000),
            createdAt: serverTimestampSentinel(),
          },
        },
        {
          type: 'set',
          docPath: `users/${requesterUid}/following/${user.uid}`,
          data: {
            uid: user.uid,
            displayName: String(myProfile?.displayName || user.displayName || 'Nexora Member').slice(0, 120),
            username: String(myProfile?.username || 'member').slice(0, 50),
            avatar: String(myProfile?.avatar || '').slice(0, 200000),
            createdAt: serverTimestampSentinel(),
          },
        },
        {
          type: 'patch',
          docPath: `users/${user.uid}/follow_requests/${requesterUid}`,
          data: { status: 'accepted', updatedAt: serverTimestampSentinel() },
          mergeFields: ['status', 'updatedAt'],
        },
      ],
      user.idToken
    );

    sendApiOk(req, res, { status: 'accepted', requesterUid });
  });

  router.post('/users/:userId/mute', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid) || targetUid === user.uid) {
      sendApiError(req, res, 400, 'INVALID_TARGET', 'Invalid user to mute.');
      return;
    }
    const targetDoc = await fsGetDoc(`users/${targetUid}`, user.idToken).catch(() => null);
    await fsSetDoc(
      `users/${user.uid}/mutes/${targetUid}`,
      {
        mutedUid: targetUid,
        mutedName: String(targetDoc?.displayName || 'Member').slice(0, 80),
        createdAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    const prefs = nexoraStore.getUserPreferences(user.uid);
    nexoraStore.upsertUserPreferences(user.uid, {
      mutedUids: Array.from(new Set([...prefs.mutedUids, targetUid])),
    });
    deps.invalidateFeedCache?.(user.uid);
    sendApiOk(req, res, { mutedUid: targetUid, muted: true });
  });

  router.delete('/users/:userId/mute', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid user identifier.');
      return;
    }
    await fsDeleteDoc(`users/${user.uid}/mutes/${targetUid}`, user.idToken).catch(() => false);
    const prefs = nexoraStore.getUserPreferences(user.uid);
    nexoraStore.upsertUserPreferences(user.uid, {
      mutedUids: prefs.mutedUids.filter((id) => id !== targetUid),
    });
    deps.invalidateFeedCache?.(user.uid);
    sendApiOk(req, res, { mutedUid: targetUid, muted: false });
  });

  router.post('/users/:userId/block', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid) || targetUid === user.uid) {
      sendApiError(req, res, 400, 'INVALID_TARGET', 'Invalid user to block.');
      return;
    }
    const targetDoc = await fsGetDoc(`users/${targetUid}`, user.idToken).catch(() => null);
    await fsSetDoc(
      `users/${user.uid}/blocks/${targetUid}`,
      {
        blockedUid: targetUid,
        blockedName: String(targetDoc?.displayName || 'Member').slice(0, 80),
        createdAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    await Promise.all([
      fsDeleteDoc(`users/${user.uid}/following/${targetUid}`, user.idToken).catch(() => false),
      fsDeleteDoc(`users/${targetUid}/followers/${user.uid}`, user.idToken).catch(() => false),
      fsDeleteDoc(`users/${user.uid}/followers/${targetUid}`, user.idToken).catch(() => false),
    ]);
    deps.invalidateFeedCache?.(user.uid);
    sendApiOk(req, res, { blockedUid: targetUid, blocked: true });
  });

  router.delete('/users/:userId/block', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const targetUid = String(req.params.userId || '').trim();
    if (!VALID_ID_RE.test(targetUid)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid user identifier.');
      return;
    }
    await fsDeleteDoc(`users/${user.uid}/blocks/${targetUid}`, user.idToken).catch(() => false);
    deps.invalidateFeedCache?.(user.uid);
    sendApiOk(req, res, { blockedUid: targetUid, blocked: false });
  });

  /* -------------------- PHASE 3: POSTS & BOUNDED COMMENTS -------------------- */

  router.post('/posts', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const rate = deps.checkRateLimit(`v1-post:${user.uid}`, 15, 60_000);
    if (!rate.allowed) {
      sendApiError(req, res, 429, 'RATE_LIMITED', `Wait ${rate.retryAfterSec}s before posting again.`);
      return;
    }
    const body = parseWithSchema(req, res, CreatePostSchema, req.body || {});
    if (!body) return;
    if (!body.content.trim() && body.mediaItems.length === 0) {
      sendApiError(req, res, 400, 'EMPTY_POST', 'Post requires text content or media.');
      return;
    }

    const authorDoc = await fsGetDoc(`users/${user.uid}`, user.idToken).catch(() => null);
    const postId = `post-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const payload = {
      id: postId,
      authorId: user.uid,
      authorName: String(authorDoc?.displayName || user.displayName || 'Nexora Member').slice(0, 120),
      authorUsername: String(authorDoc?.username || 'member').slice(0, 50),
      authorInitials: String(authorDoc?.initials || 'NX').slice(0, 16),
      authorAvatar: String(authorDoc?.avatar || '').slice(0, 200000),
      authorVerified: Boolean(authorDoc?.verified),
      content: body.content.trim(),
      mediaType: body.mediaItems.length > 1 ? 'carousel' : body.mediaItems[0]?.type || body.mediaType,
      mediaItems: body.mediaItems,
      feeling: body.feeling,
      location: body.location,
      hashtags: extractTags(body.content),
      mentions: extractMentionsList(body.content),
      visibility: body.visibility,
      isDraft: body.isDraft,
      productIds: body.productIds,
      likesUids: [],
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      edited: false,
      createdAt: serverTimestampSentinel(),
      updatedAt: serverTimestampSentinel(),
    };

    const created = await fsSetDoc(`posts/${postId}`, payload, user.idToken);
    deps.invalidateFeedCache?.();
    sendApiOk(req, res, { post: created }, 201);
  });

  router.patch('/posts/:postId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const postId = String(req.params.postId || '').trim();
    if (!VALID_ID_RE.test(postId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid post identifier.');
      return;
    }
    const existing = await fsGetDoc(`posts/${postId}`, user.idToken);
    if (!existing) {
      sendApiError(req, res, 404, 'POST_NOT_FOUND', 'Post not found.');
      return;
    }
    if (existing.authorId !== user.uid) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Only the author can edit this post.');
      return;
    }
    const body = parseWithSchema(req, res, PatchPostSchema, req.body || {});
    if (!body) return;

    const patch: Record<string, unknown> = {
      edited: true,
      updatedAt: serverTimestampSentinel(),
    };
    if (body.content !== undefined) {
      patch.content = body.content.trim();
      patch.hashtags = extractTags(body.content);
      patch.mentions = extractMentionsList(body.content);
    }
    if (body.visibility !== undefined) patch.visibility = body.visibility;
    if (body.isDraft !== undefined) patch.isDraft = body.isDraft;
    if (body.feeling !== undefined) patch.feeling = body.feeling;
    if (body.location !== undefined) patch.location = body.location;

    const updated = await fsPatchDoc(`posts/${postId}`, patch, user.idToken);
    deps.invalidateFeedCache?.();
    sendApiOk(req, res, { post: updated });
  });

  router.delete('/posts/:postId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const postId = String(req.params.postId || '').trim();
    if (!VALID_ID_RE.test(postId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid post identifier.');
      return;
    }
    const existing = await fsGetDoc(`posts/${postId}`, user.idToken);
    if (!existing) {
      sendApiError(req, res, 404, 'POST_NOT_FOUND', 'Post not found.');
      return;
    }
    if (existing.authorId !== user.uid) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Only the author can delete this post.');
      return;
    }
    await fsDeleteDoc(`posts/${postId}`, user.idToken);
    deps.invalidateFeedCache?.();
    sendApiOk(req, res, { deletedId: postId });
  });

  router.post('/posts/:postId/repost', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const sourceId = String(req.params.postId || '').trim();
    if (!VALID_ID_RE.test(sourceId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid post identifier.');
      return;
    }
    const source = await fsGetDoc(`posts/${sourceId}`, user.idToken);
    if (!source || source.visibility === 'private') {
      sendApiError(req, res, 404, 'POST_NOT_FOUND', 'Post unavailable for sharing.');
      return;
    }
    const authorDoc = await fsGetDoc(`users/${user.uid}`, user.idToken).catch(() => null);
    const note = String(req.body?.note || '').trim().slice(0, 600);
    const repostId = `post-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const content = note ? `${note}\n\n— Shared from @${source.authorUsername || 'member'}: ${String(source.content || '').slice(0, 300)}` : `Shared from @${source.authorUsername || 'member'}: ${String(source.content || '').slice(0, 400)}`;

    const created = await fsSetDoc(
      `posts/${repostId}`,
      {
        id: repostId,
        authorId: user.uid,
        authorName: String(authorDoc?.displayName || user.displayName || 'Nexora Member').slice(0, 120),
        authorUsername: String(authorDoc?.username || 'member').slice(0, 50),
        authorInitials: String(authorDoc?.initials || 'NX').slice(0, 16),
        authorAvatar: String(authorDoc?.avatar || '').slice(0, 200000),
        content,
        mediaType: 'none',
        mediaItems: [],
        hashtags: extractTags(content),
        mentions: extractMentionsList(content),
        visibility: 'public',
        repostOfId: sourceId,
        likesUids: [],
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        edited: false,
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );

    deps.invalidateFeedCache?.();
    sendApiOk(req, res, { post: created }, 201);
  });

  router.get('/posts/:postId/comments', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const postId = String(req.params.postId || '').trim();
    if (!VALID_ID_RE.test(postId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid post identifier.');
      return;
    }
    const comments = await fsQueryCollection('comments', user.idToken, {
      parentPath: `posts/${postId}`,
      orderBy: { field: 'createdAt', direction: 'ASCENDING' },
      limit: 100,
    }).catch(() => []);
    sendApiOk(req, res, { comments });
  });

  router.post('/posts/:postId/comments', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const postId = String(req.params.postId || '').trim();
    if (!VALID_ID_RE.test(postId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid post identifier.');
      return;
    }
    const body = parseWithSchema(req, res, CreateCommentSchema, req.body || {});
    if (!body) return;

    const [postDoc, userDoc] = await Promise.all([
      fsGetDoc(`posts/${postId}`, user.idToken),
      fsGetDoc(`users/${user.uid}`, user.idToken).catch(() => null),
    ]);
    if (!postDoc) {
      sendApiError(req, res, 404, 'POST_NOT_FOUND', 'Post not found.');
      return;
    }

    let replyToId = body.replyToId || '';
    let depth = 0;
    if (replyToId) {
      const parentComment = await fsGetDoc(`posts/${postId}/comments/${replyToId}`, user.idToken).catch(() => null);
      if (parentComment) {
        const parentDepth = Number(parentComment.depth || 0);
        if (parentDepth >= 2 && parentComment.replyToId) {
          // Bounded nesting: clamp depth <= 2 by attaching to the level-1 parent
          replyToId = String(parentComment.replyToId);
          depth = 2;
        } else {
          depth = Math.min(2, parentDepth + 1);
        }
      } else {
        replyToId = '';
      }
    }

    const commentId = `cmt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const comment = await fsSetDoc(
      `posts/${postId}/comments/${commentId}`,
      {
        id: commentId,
        parentId: postId,
        authorId: user.uid,
        authorName: String(userDoc?.displayName || user.displayName || 'Nexora Member').slice(0, 120),
        authorInitials: String(userDoc?.initials || 'NX').slice(0, 16),
        authorAvatar: String(userDoc?.avatar || '').slice(0, 200000),
        content: body.content,
        ...(replyToId ? { replyToId, replyToName: body.replyToName } : {}),
        depth,
        reactions: {},
        likesUids: [],
        edited: false,
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { comment }, 201);
  });

  router.post('/posts/:postId/comments/:commentId/react', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const postId = String(req.params.postId || '').trim();
    const commentId = String(req.params.commentId || '').trim();
    if (!VALID_ID_RE.test(postId) || !VALID_ID_RE.test(commentId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid identifier.');
      return;
    }
    const body = parseWithSchema(req, res, CommentReactionSchema, req.body || {});
    if (!body) return;

    const existing = await fsGetDoc(`posts/${postId}/comments/${commentId}`, user.idToken);
    if (!existing) {
      sendApiError(req, res, 404, 'COMMENT_NOT_FOUND', 'Comment not found.');
      return;
    }
    const reactions: Record<string, string[]> =
      existing.reactions && typeof existing.reactions === 'object' ? { ...existing.reactions } : {};
    const list = Array.isArray(reactions[body.emoji]) ? [...reactions[body.emoji]] : [];
    if (list.includes(user.uid)) {
      reactions[body.emoji] = list.filter((id) => id !== user.uid);
    } else {
      reactions[body.emoji] = [...list, user.uid].slice(0, 200);
    }
    if (reactions[body.emoji].length === 0) delete reactions[body.emoji];

    const updated = await fsPatchDoc(
      `posts/${postId}/comments/${commentId}`,
      { reactions, updatedAt: serverTimestampSentinel() },
      user.idToken
    );
    sendApiOk(req, res, { comment: updated });
  });

  return router;
}
