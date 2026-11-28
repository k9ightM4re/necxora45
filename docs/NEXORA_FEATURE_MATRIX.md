# NEXORA — Detailed Feature Matrix

Detailed breakdown linking frontend views, API v1 endpoints, Firestore collections, and acceptance criteria across Phases 1–16.

1. **Core Foundation**: `/api/v1/health`, `/api/v1/auth/*`, structured JSON logging, correlation ID (`X-Request-Id`), Zod schema validation, standardized error envelope, account deactivation & cleanup.
2. **Social Graph**: `/users/{id}`, `/users/{id}/follow_requests`, `/users/{id}/followers`, `/users/{id}/following`, `/users/{id}/blocks`, `/users/{id}/mutes`; strict private-profile filtering and mutual connections.
3. **Posts & Comments**: Multi-image/video/draft/repost/product-linked posts; nested replies capped at depth 2; reactions; optimistic UI with error rollback.
4. **Feed Ranking**: Deterministic weighted scorer (`For You`, `Following`, `Latest`), pre-rank privacy/block/mute gates, author-repetition suppression, diversity boost, cursor pagination, short-TTL server cache.
5. **Explore & Search**: Unified search (`all`, `people`, `posts`, `topics`, `communities`, `products`), prefix suggestions, persistent search history, time-decay trending topics, suggested people/communities.
6. **Messaging**: Human-only 3-column React inbox, WebSocket presence/typing/receipts, `clientMutationId` idempotency, offline outbox retry & reconnect delta sync, group roles (`admin`/`member`), mute & delete-for-me view state.
7. **Communities & Stories**: Role-hardened servers & typed channels, 24h story expiration sweep, viewer receipts, reactions/replies.
8. **Media & Nearby**: Validated media upload sessions + unconfigured S3/FFmpeg adapters; privacy-first nearby discovery (`100m`/`200m`/custom radius, pause toggle, block filter, coarse labels, short TTL).
9. **Notifications, Commerce, Visual Search, Studio & Moderation**: Paginated deduplicated notifications; React/TS Marketplace (`products`, `merchants`, `collections`, stale-price indicator, unconfigured feed adapter); Visual Product Search (`Find This Product`); Nexora Studio (consented personal photos, outfit builder, unconfigured VTON adapter); Moderation queue (`open`, `under_review`, `resolved`, `dismissed`) & audit logs.
