import crypto from 'crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  getAdapterConfigStatus,
  parseWithSchema,
  sendApiError,
  sendApiOk,
  type AuthedRequest,
  type VerifiedUser,
} from './context.ts';
import {
  fsGetDoc,
  fsListCollection,
  fsPatchDoc,
  fsQueryCollection,
  fsSetDoc,
  serverTimestampSentinel,
} from './firestore_rest.ts';

export interface MessagingMediaDeps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
  broadcastToUids?: (uids: string[], payload: Record<string, any>) => void;
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

// Bounded in-memory idempotency cache (24h window / max 5000 entries) preventing duplicate sends on client retries
const idempotencyCache = new Map<string, { createdAtMs: number; message: Record<string, any> }>();

export function resetIdempotencyCacheForTests(): void {
  idempotencyCache.clear();
}

export function rememberIdempotentMessage(key: string, message: Record<string, any>): void {
  if (idempotencyCache.size >= 5000) {
    const oldestKey = idempotencyCache.keys().next().value;
    if (oldestKey) idempotencyCache.delete(oldestKey);
  }
  idempotencyCache.set(key, { createdAtMs: Date.now(), message });
}

export function findIdempotentMessage(key: string): Record<string, any> | null {
  const hit = idempotencyCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAtMs > 24 * 3600_000) {
    idempotencyCache.delete(key);
    return null;
  }
  return hit.message;
}

const CommerceCardSchema = z.object({
  kind: z.enum(['product_share', 'collection_share', 'product_inquiry', 'price_offer', 'counteroffer']),
  productId: z.string().max(128).optional(),
  productTitle: z.string().max(140).optional(),
  productPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  productCurrency: z.string().max(8).optional(),
  productImageUrl: z.string().max(2000).optional(),
  merchantName: z.string().max(100).optional(),
  collectionId: z.string().max(128).optional(),
  collectionTitle: z.string().max(100).optional(),
  offerPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  inquiryStatus: z.enum(['open', 'accepted', 'declined', 'countered']).optional(),
  note: z.string().max(300).optional(),
});

const OfferStatusSchema = z.object({
  status: z.enum(['accepted', 'declined', 'countered']),
  counterPriceCents: z.number().int().min(0).max(100_000_000).optional(),
});

const SendMessageSchema = z.object({
  content: z.string().max(2000).default(''),
  clientMutationId: z.string().min(4).max(128).optional(),
  replyToId: z.string().max(128).optional(),
  commerceCard: CommerceCardSchema.optional(),
  attachment: z
    .object({
      name: z.string().max(120),
      type: z.string().max(80),
      size: z.number().min(0).max(15_000_000),
      dataUrl: z.string().min(4).max(400_000),
    })
    .optional(),
});

const ThreadPreferencesSchema = z.object({
  muted: z.boolean().optional(),
  archived: z.boolean().optional(),
  deleteForMe: z.boolean().optional(),
});

const GroupMemberActionSchema = z.object({
  action: z.enum(['add', 'remove', 'promote', 'demote', 'rename', 'leave']),
  targetUid: z.string().max(128).optional(),
  groupName: z.string().trim().min(1).max(80).optional(),
});

export function createMessagingMediaV1Router(deps: MessagingMediaDeps): Router {
  const router = Router();

  /* -------------------- PHASE 6 & 7: MESSAGING RELIABILITY & GROUPS -------------------- */

  router.get('/messages/threads', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const threads = await fsQueryCollection('dm_threads', user.idToken, {
      where: [{ field: 'participants', op: 'ARRAY_CONTAINS', value: user.uid }],
      limit: 80,
    }).catch(() => []);

    const filtered = threads.filter((t) => {
      const deletedMap = t.deletedFor && typeof t.deletedFor === 'object' ? t.deletedFor : {};
      const deletedAtMs = Number(deletedMap[user.uid] || 0);
      const updatedMs = t.updatedAt ? Date.parse(String(t.updatedAt)) : 0;
      if (deletedAtMs > 0 && updatedMs <= deletedAtMs) return false;
      return true;
    });

    sendApiOk(req, res, { threads: filtered });
  });

  router.get('/messages/threads/:threadId/sync', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const threadId = String(req.params.threadId || '').trim();
    if (!VALID_ID_RE.test(threadId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid thread identifier.');
      return;
    }
    const thread = await fsGetDoc(`dm_threads/${threadId}`, user.idToken);
    if (!thread || !Array.isArray(thread.participants) || !thread.participants.includes(user.uid)) {
      sendApiError(req, res, 404, 'THREAD_NOT_FOUND', 'Conversation not found.');
      return;
    }
    const sinceMs = Math.max(0, Number(req.query.sinceMs || 0));
    const deletedCutoff = Number(thread.deletedFor?.[user.uid] || 0);
    const effectiveCutoff = Math.max(sinceMs, deletedCutoff);

    const messages = await fsQueryCollection('messages', user.idToken, {
      parentPath: `dm_threads/${threadId}`,
      orderBy: { field: 'createdAt', direction: 'ASCENDING' },
      limit: 120,
    }).catch(() => []);

    const delta = messages.filter((m) => {
      const updatedMs = m.updatedAt ? Date.parse(String(m.updatedAt)) : m.createdAt ? Date.parse(String(m.createdAt)) : 0;
      return !effectiveCutoff || updatedMs > effectiveCutoff;
    });

    sendApiOk(req, res, {
      thread,
      messages: delta,
      syncedAtMs: Date.now(),
    });
  });

  router.post('/messages/threads/:threadId/messages', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const threadId = String(req.params.threadId || '').trim();
    if (!VALID_ID_RE.test(threadId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid thread identifier.');
      return;
    }

    const body = parseWithSchema(req, res, SendMessageSchema, req.body || {});
    if (!body) return;
    if (!body.content.trim() && !body.attachment && !body.commerceCard) {
      sendApiError(req, res, 400, 'EMPTY_MESSAGE', 'Message content, attachment, or product card is required.');
      return;
    }

    if (body.clientMutationId) {
      const idemKey = `${user.uid}:${threadId}:${body.clientMutationId}`;
      const cached = findIdempotentMessage(idemKey);
      if (cached) {
        sendApiOk(req, res, { message: cached, deduplicated: true });
        return;
      }
      const existing = await fsQueryCollection('messages', user.idToken, {
        parentPath: `dm_threads/${threadId}`,
        where: [{ field: 'clientMutationId', op: 'EQUAL', value: body.clientMutationId }],
        limit: 1,
      }).catch(() => []);
      if (existing.length > 0) {
        rememberIdempotentMessage(idemKey, existing[0]);
        sendApiOk(req, res, { message: existing[0], deduplicated: true });
        return;
      }
    }

    const thread = await fsGetDoc(`dm_threads/${threadId}`, user.idToken);
    if (!thread || !Array.isArray(thread.participants) || !thread.participants.includes(user.uid)) {
      sendApiError(req, res, 404, 'THREAD_NOT_FOUND', 'Conversation not found.');
      return;
    }

    const senderDoc = await fsGetDoc(`users/${user.uid}`, user.idToken).catch(() => null);
    const msgId = `dmmsg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const fallbackLabel = body.commerceCard
      ? `[${body.commerceCard.productTitle || body.commerceCard.collectionTitle || 'Commerce Item'}]`
      : `[Attachment: ${body.attachment?.name || 'File'}]`;
    const content = (body.content.trim() || fallbackLabel).slice(0, 2000);

    const message = await fsSetDoc(
      `dm_threads/${threadId}/messages/${msgId}`,
      {
        id: msgId,
        threadId,
        participantIds: thread.participants,
        ...(body.clientMutationId ? { clientMutationId: body.clientMutationId } : {}),
        senderId: user.uid,
        senderName: String(senderDoc?.displayName || user.displayName || 'Member').slice(0, 50),
        senderInitials: String(senderDoc?.initials || 'NX').slice(0, 4),
        content,
        ...(body.attachment ? { attachment: body.attachment } : {}),
        ...(body.commerceCard ? { commerceCard: body.commerceCard } : {}),
        ...(body.replyToId ? { replyToId: body.replyToId } : {}),
        deliveredTo: [user.uid],
        seenBy: [user.uid],
        edited: false,
        pinned: false,
        reactions: [],
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );

    await fsPatchDoc(
      `dm_threads/${threadId}`,
      {
        lastMessage: content.slice(0, 300),
        lastSenderId: user.uid,
        seenBy: [user.uid],
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    ).catch(() => {});

    if (body.clientMutationId) {
      rememberIdempotentMessage(`${user.uid}:${threadId}:${body.clientMutationId}`, message);
    }

    const recipientUids = (thread.participants as string[]).filter((uid) => uid !== user.uid);
    deps.broadcastToUids?.(recipientUids, {
      type: 'dm:notify',
      threadId,
      messageId: msgId,
      fromUid: user.uid,
      atMs: Date.now(),
    });

    sendApiOk(req, res, { message, deduplicated: false }, 201);
  });

  router.patch('/messages/threads/:threadId/messages/:messageId/offer-status', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const threadId = String(req.params.threadId || '').trim();
    const messageId = String(req.params.messageId || '').trim();
    if (!VALID_ID_RE.test(threadId) || !VALID_ID_RE.test(messageId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid thread or message identifier.');
      return;
    }
    const body = parseWithSchema(req, res, OfferStatusSchema, req.body || {});
    if (!body) return;

    const [thread, msg] = await Promise.all([
      fsGetDoc(`dm_threads/${threadId}`, user.idToken).catch(() => null),
      fsGetDoc(`dm_threads/${threadId}/messages/${messageId}`, user.idToken).catch(() => null),
    ]);
    if (!thread || !Array.isArray(thread.participants) || !thread.participants.includes(user.uid)) {
      sendApiError(req, res, 404, 'THREAD_NOT_FOUND', 'Conversation not found.');
      return;
    }
    if (!msg || !msg.commerceCard) {
      sendApiError(req, res, 404, 'OFFER_NOT_FOUND', 'Commerce offer message not found.');
      return;
    }

    const nextCard = {
      ...msg.commerceCard,
      inquiryStatus: body.status,
      ...(body.counterPriceCents !== undefined ? { offerPriceCents: body.counterPriceCents } : {}),
    };

    const updated = await fsPatchDoc(
      `dm_threads/${threadId}/messages/${messageId}`,
      {
        commerceCard: nextCard,
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );

    sendApiOk(req, res, { message: updated });
  });

  router.patch('/messages/threads/:threadId/preferences', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const threadId = String(req.params.threadId || '').trim();
    if (!VALID_ID_RE.test(threadId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid thread identifier.');
      return;
    }
    const body = parseWithSchema(req, res, ThreadPreferencesSchema, req.body || {});
    if (!body) return;

    const thread = await fsGetDoc(`dm_threads/${threadId}`, user.idToken);
    if (!thread || !Array.isArray(thread.participants) || !thread.participants.includes(user.uid)) {
      sendApiError(req, res, 404, 'THREAD_NOT_FOUND', 'Conversation not found.');
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: serverTimestampSentinel() };
    if (body.muted !== undefined) {
      const mutedBy = Array.isArray(thread.mutedBy) ? [...thread.mutedBy] : [];
      patch.mutedBy = body.muted
        ? Array.from(new Set([...mutedBy, user.uid])).slice(0, 30)
        : mutedBy.filter((id) => id !== user.uid);
    }
    if (body.archived !== undefined) {
      const archivedBy = Array.isArray(thread.archivedBy) ? [...thread.archivedBy] : [];
      patch.archivedBy = body.archived
        ? Array.from(new Set([...archivedBy, user.uid])).slice(0, 30)
        : archivedBy.filter((id) => id !== user.uid);
    }
    if (body.deleteForMe) {
      const deletedFor = thread.deletedFor && typeof thread.deletedFor === 'object' ? { ...thread.deletedFor } : {};
      deletedFor[user.uid] = Date.now();
      patch.deletedFor = deletedFor;
    }

    const updated = await fsPatchDoc(`dm_threads/${threadId}`, patch, user.idToken);
    sendApiOk(req, res, { thread: updated });
  });

  router.post('/messages/threads/:threadId/members', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const threadId = String(req.params.threadId || '').trim();
    if (!VALID_ID_RE.test(threadId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid thread identifier.');
      return;
    }
    const body = parseWithSchema(req, res, GroupMemberActionSchema, req.body || {});
    if (!body) return;

    const thread = await fsGetDoc(`dm_threads/${threadId}`, user.idToken);
    if (!thread || thread.type !== 'group' || !Array.isArray(thread.participants) || !thread.participants.includes(user.uid)) {
      sendApiError(req, res, 404, 'GROUP_NOT_FOUND', 'Group conversation not found.');
      return;
    }

    const memberRoles: Record<string, string> =
      thread.memberRoles && typeof thread.memberRoles === 'object'
        ? { ...thread.memberRoles }
        : { [String(thread.createdBy || user.uid)]: 'admin' };
    const isAdmin = thread.createdBy === user.uid || memberRoles[user.uid] === 'admin';
    let participants = [...(thread.participants as string[])];

    if (body.action === 'leave') {
      if (participants.length <= 2) {
        sendApiError(req, res, 400, 'MIN_PARTICIPANTS', 'A group conversation requires at least 2 participants.');
        return;
      }
      participants = participants.filter((id) => id !== user.uid);
      delete memberRoles[user.uid];
      const updated = await fsPatchDoc(
        `dm_threads/${threadId}`,
        { participants, memberRoles, updatedAt: serverTimestampSentinel() },
        user.idToken
      );
      sendApiOk(req, res, { thread: updated });
      return;
    }

    if (!isAdmin) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Only group admins can manage members or group details.');
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: serverTimestampSentinel() };
    if (body.action === 'rename' && body.groupName) {
      patch.groupName = body.groupName;
    } else if (body.targetUid && VALID_ID_RE.test(body.targetUid)) {
      if (body.action === 'add') {
        if (participants.length >= 30) {
          sendApiError(req, res, 400, 'GROUP_FULL', 'Group conversations support up to 30 members.');
          return;
        }
        participants = Array.from(new Set([...participants, body.targetUid]));
        memberRoles[body.targetUid] = memberRoles[body.targetUid] || 'member';
      } else if (body.action === 'remove') {
        if (participants.length <= 2) {
          sendApiError(req, res, 400, 'MIN_PARTICIPANTS', 'Group must retain at least 2 participants.');
          return;
        }
        participants = participants.filter((id) => id !== body.targetUid);
        delete memberRoles[body.targetUid];
      } else if (body.action === 'promote') {
        if (participants.includes(body.targetUid)) memberRoles[body.targetUid] = 'admin';
      } else if (body.action === 'demote') {
        if (participants.includes(body.targetUid) && body.targetUid !== thread.createdBy) {
          memberRoles[body.targetUid] = 'member';
        }
      }
      patch.participants = participants;
      patch.memberRoles = memberRoles;
    }

    const updated = await fsPatchDoc(`dm_threads/${threadId}`, patch, user.idToken);
    sendApiOk(req, res, { thread: updated });
  });

  /* -------------------- PHASE 8: MEDIA ADAPTER STATUS & UPLOAD SESSION -------------------- */

  router.get('/media/status', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const status = getAdapterConfigStatus();
    sendApiOk(req, res, {
      storage: status.s3Storage,
      transcoding: status.ffmpegTranscoding,
      maxUploadBytes: 10 * 1024 * 1024,
    });
  });

  router.post('/media/upload-session', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const status = getAdapterConfigStatus();
    const sessionId = `upsess-${crypto.randomBytes(8).toString('hex')}`;
    sendApiOk(req, res, {
      sessionId,
      uploadEndpoint: '/api/media/upload',
      maxBytes: 10 * 1024 * 1024,
      adapter: status.s3Storage.configured ? 's3' : status.s3Storage.fallback,
      transcodingConfigured: status.ffmpegTranscoding.configured,
    });
  });

  /* -------------------- PHASE 9: STORIES EXPIRY SWEEP -------------------- */

  router.get('/stories/active', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const now = Date.now();
    const stories = await fsListCollection('stories', user.idToken, 100).catch(() => []);
    const active = stories.filter((s) => Number(s.expiresAtMs || 0) > now);
    sendApiOk(req, res, { stories: active, count: active.length });
  });

  router.post('/stories/sweep-expired', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const now = Date.now();
    const stories = await fsQueryCollection('stories', user.idToken, {
      where: [{ field: 'userId', op: 'EQUAL', value: user.uid }],
      limit: 100,
    }).catch(() => []);
    const expired = stories.filter((s) => Number(s.expiresAtMs || 0) <= now);
    sendApiOk(req, res, { expiredCount: expired.length, activeCount: stories.length - expired.length });
  });

  return router;
}
