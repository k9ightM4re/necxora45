# NEXORA — Master Implementation Roadmap & Feature Matrix

> **Scope Boundary:** Core Nexora platform only. Standalone Organization Administration and Standalone Reels apps are excluded.

## Phase Roadmap
- **Phase 0**: Full repository audit & engineering documentation (`/docs/*`). *(Completed)*
- **Phase 1**: Foundation (`/api/v1/*` modular router, request IDs, structured logger, Zod validation, error envelopes, account deactivation/cleanup, health telemetry).
- **Phase 2**: User Profiles & Social Graph (`follow_requests`, `mutes`, mutuals, follower removal, private-profile API/search non-leakage, Firestore rules + RPC deploy).
- **Phase 3**: Posts & Social Interactions (multi-image, video, drafts, product links, reposts, bounded nested comments & reactions, optimistic updates + rollback).
- **Phase 4**: Home Feed & Deterministic Ranking (`For You`, `Following`, `Latest`, weighted relevance/recency/relationship/engagement/diversity, author-repetition suppression, cursor pagination, short-TTL cache).
- **Phase 5**: Explore & Unified Search (people, posts, topics, communities, products; suggestions; persistent recent searches; time-decay trending velocity; private-account filtering).
- **Phase 6**: Messaging System (human-only 3-column React inbox, idempotency keys, offline outbox retry & reconnect delta sync, group roles/admin controls, mute & delete-for-me thread preferences, reliability tests).
- **Phase 7**: Communities & Real-Time Channels (owner/administrator/moderator/member roles, general/announcements/questions/events/media channels, audit logs).
- **Phase 8**: Stories (24h expiration sweep, viewer receipts, reactions, replies).
- **Phase 9**: Media Infrastructure (`upload-session` + validated disk fallback + provider-independent S3 & FFmpeg unconfigured adapters).
- **Phase 10**: Nearby Location Discovery (opt-in, pause toggle, 100m/200m/custom radius, block filtering, short TTL, probe rate limits, coarse bands only).
- **Phase 11**: Notifications (deduplication, pagination, preferences enforcement, mark-all-read, retry status).
- **Phase 12**: Social Commerce / Marketplace (React/TS view, merchants, products, offers, stale-price indicator, saved collections, unconfigured merchant feed sync adapter).
- **Phase 13**: Visual Product Search (`Find This Product` React/TS upload + catalog matching + external visual search adapter).
- **Phase 14**: Nexora Studio (React/TS consented photo upload/delete, outfit builder, collections, unconfigured virtual try-on provider adapter returning honest 503 status).
- **Phase 15**: Moderation & Safety (`open`, `under_review`, `resolved`, `dismissed` case queue, audit trail, admin dashboard wiring).
- **Phase 16**: Production Hardening, Security/Integration Tests, Docker setup, Final Docs & Build Verification.
