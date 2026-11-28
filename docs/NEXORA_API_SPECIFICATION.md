# NEXORA — API Specification (`/api/v1/*`)

**Base Path:** `/api/v1` (Legacy `/api/*` aliases retained for backward compatibility)  
**Authentication:** `Authorization: Bearer <Firebase_ID_Token>` on protected endpoints  
**Request Correlation:** Every response includes `X-Request-Id` header and structured error payloads:
```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {},
    "requestId": "req_..."
  }
}
```

---

## 1. Foundation & Auth (`/api/v1/health`, `/api/v1/auth/*`)
- `GET /api/v1/health` — Service health, Firestore config status, configured external adapters (`gemini`, `s3`, `ffmpeg`, `merchantFeed`, `virtualTryOn`, `turn`).
- `POST /api/v1/auth/verify-session` — Verifies Firebase ID token and OTP signature cookie.
- `POST /api/v1/auth/rate-check` — Server rate limit check for OTP/login actions.
- `POST /api/v1/auth/send-email-otp` & `POST /api/v1/auth/verify-email-otp` — Rate-limited 6-digit verification.
- `POST /api/v1/auth/logout` — Clears session cookie.
- `POST /api/v1/auth/deactivate` & `DELETE /api/v1/auth/account` — Marks account deactivated / cleans server-side user session & local assets.

## 2. Users & Social Graph (`/api/v1/users/*`, `/api/v1/social/*`)
- `GET /api/v1/users/:userId` — Privacy-aware profile lookup (masks private details when `accountPrivacy === 'private'` and requester is not an approved follower/owner; hides blocked users).
- `PATCH /api/v1/users/me` — Updates editable profile fields (`displayName`, `username`, `bio`, `website`, `locationLabel`, `interests`, `accountPrivacy`).
- `GET /api/v1/users/:userId/mutuals` — Computes mutual followers/following between caller and target user.
- `POST /api/v1/social/follow/:targetUid` / `DELETE /api/v1/social/follow/:targetUid` — Follow or send follow request for private accounts; unfollow.
- `GET /api/v1/social/follow-requests` & `POST /api/v1/social/follow-requests/:requesterUid/respond` — List and accept/decline follow requests.
- `POST /api/v1/social/mute/:targetUid` / `DELETE /api/v1/social/mute/:targetUid` — Mute/unmute accounts.
- `POST /api/v1/social/block/:targetUid` / `DELETE /api/v1/social/block/:targetUid` — Block/unblock accounts.

## 3. Posts & Feed Ranking (`/api/v1/posts/*`, `/api/v1/feed`)
- `GET /api/v1/feed?tab=for-you|following|latest&cursor=...&limit=10` — Deterministic weighted feed ranking (`For You`, `Following`, `Latest`), strict privacy/block/mute filtering, diversity & author-repetition suppression, cursor pagination, short-TTL response cache.
- `POST /api/v1/posts` / `PATCH /api/v1/posts/:postId` / `DELETE /api/v1/posts/:postId` — Create/edit/delete posts (drafts, multi-media up to 4 items, product links, shared/reposted IDs, audience visibility).
- `GET /api/v1/posts/:postId/comments` & `POST /api/v1/posts/:postId/comments` — Nested comment retrieval & bounded depth (`<= 2`) creation.

## 4. Explore & Unified Search (`/api/v1/search`, `/api/v1/discover/*`)
- `GET /api/v1/search?q=...&type=all|people|posts|topics|communities|products&cursor=...` — Unified privacy-safe search across people, posts, topics, communities, and products.
- `GET /api/v1/search/suggestions?q=...` — Fast prefix suggestions.
- `GET /api/v1/search/history` & `DELETE /api/v1/search/history` — Persistent recent searches.
- `GET /api/v1/discover/trending` — Time-decay velocity ranked hashtags/topics.
- `GET /api/v1/discover/people` & `GET /api/v1/discover/communities` — Suggested accounts & communities excluding blocks/private leaks.

## 5. Messaging (`/api/v1/messages/*`)
- `GET /api/v1/messages/threads` — Active conversations with mute/archive/delete-view filtering and unread counts.
- `GET /api/v1/messages/threads/:threadId/sync?sinceMs=...` — Offline reconnect / missed-message delta sync.
- `POST /api/v1/messages/threads/:threadId/messages` — Idempotent message send (`clientMutationId` deduplication).
- `PATCH /api/v1/messages/threads/:threadId/preferences` — Mute/unmute, archive/unarchive, delete-view (`deletedFor[uid]`).
- `POST /api/v1/messages/threads/:threadId/members` — Group chat member add/remove/role/rename/leave.

## 6. Communities, Stories & Media
- `GET /api/v1/media/status` — Storage & FFmpeg transcoding adapter status (`local-disk` active; `s3` / `ffmpeg` unconfigured until env vars set).
- `POST /api/v1/media/upload-session` & `POST /api/v1/media/upload` — Validated magic-byte upload with quota & metadata.
- `POST /api/v1/stories/:storyId/view` & `POST /api/v1/stories/sweep-expired` — Viewer receipt & expiration cleanup.

## 7. Nearby Discovery (`/api/v1/nearby/*`, `/api/discovery/*`)
- `POST /api/v1/nearby/location` — Explicit opt-in location update (`discoverable`, `paused`, custom radius `0.1km..250km`, short TTL, coarse coordinates only).
- `GET /api/v1/nearby/people?radiusKm=...` — Block-filtered nearby discovery returning coarse distance bands (`< 100m`, `< 200m`, `~1.4 km`), never raw peer lat/lon.

## 8. Notifications (`/api/v1/notifications/*`)
- `GET /api/v1/notifications?cursor=...&limit=20&category=...` — Paginated inbox with deduplication & preference filtering.
- `POST /api/v1/notifications/read-all` & `PATCH /api/v1/notifications/:notifId/read` — Read state management.

## 9. Social Commerce, Visual Product Search & Nexora Studio
- `GET /api/v1/commerce/status` — External merchant feed & affiliate adapter status (`unconfigured` until keys provided).
- `GET /api/v1/products`, `POST /api/v1/products`, `GET /api/v1/products/:id` — Real catalog products, offers, and stale-price flags (`priceLastCheckedAtMs`).
- `GET /api/v1/commerce/collections` / `POST /api/v1/commerce/collections` — Saved product collections.
- `POST /api/v1/visual-search` — Image upload/feature matching against real indexed catalog items + adapter status for external visual search providers.
- `GET /api/v1/studio/status`, `POST /api/v1/studio/photos`, `DELETE /api/v1/studio/photos/:id`, `POST /api/v1/studio/outfits`, `POST /api/v1/studio/try-on` — Consent-gated photo upload/deletion, outfit collections, and provider-independent Virtual Try-On adapter returning `503 VTON_UNCONFIGURED` when external VTON keys are absent.

## 10. Moderation (`/api/v1/moderation/*`)
- `GET /api/v1/moderation/reports`, `PATCH /api/v1/moderation/reports/:reportId`, `GET /api/v1/moderation/audit-logs` — Admin/moderator case triage (`open`, `under_review`, `resolved`, `dismissed`) and audit trail.
