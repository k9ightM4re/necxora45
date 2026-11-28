# NEXORA — Feature Completion Matrix

Synchronized with `shared/featureRegistry.ts` and `/reports/feature-verification.json`. Status values: `DONE`, `UNCONFIGURED_ADAPTER`, `OUT_OF_SCOPE`.

| Feature Area | Sub-Features | Current Status | Notes |
|---|---|---|---|
| **Foundation** | Express `/api/v1/*`, WS, Health, Auth, Deactivation | `DONE` | Fail-closed Bearer verification, correlation IDs, structured logs |
| **Profiles & Graph** | Profiles, Follow Requests, Mutuals, Block, Mute | `DONE` | Private profile field masking & follower removal enforced |
| **Posts & Comments** | Multi-image/video, Drafts, Shares, Nested Replies | `DONE` | Product tags, emoji comment reactions, report workflow |
| **Feed Ranking** | For You, Following, Latest, Feedback, Diversity | `DONE` | Deterministic multi-signal engine in `server/v1/feed_ranker.ts` |
| **Explore & Search** | Unified Search, History, Trending, Suggestions | `DONE` | Includes product search tab & persistent search history |
| **Messaging** | 3-Col React Inbox, WS, Outbox, Sync, Groups | `DONE` | `REDIS_URL` multi-node fanout marked `UNCONFIGURED_ADAPTER` |
| **Communities** | Servers, Roles, Channels, Polls, Moderation | `DONE` | Role-based RBAC enforced in `firestore.rules` |
| **Stories & Media** | 24h Stories, Reels, Templates, Media Uploads | `DONE` | Magic-byte disk storage active; S3/FFmpeg `UNCONFIGURED_ADAPTER` |
| **Nearby Discovery** | Opt-in, Pause, Radius Presets, Coarse Labels | `DONE` | Ephemeral TTL geo store; never leaks raw peer coordinates |
| **Notifications** | In-App, Preferences, Deduplication, Read-All | `DONE` | Connected via `/api/v1/notifications` |
| **Social Commerce** | Merchants, Products, Collections, Price Freshness | `DONE` | External merchant feed sync marked `UNCONFIGURED_ADAPTER` |
| **Visual Search** | Image Upload + Real Catalog Match | `DONE` | External visual index marked `UNCONFIGURED_ADAPTER` |
| **Nexora Studio** | Consented Photos, Outfit Builder, VTON Adapter | `DONE` | Live VTON returns `503 VTON_UNCONFIGURED` without keys |
| **Moderation & Health** | Reports Queue, `/features`, `/admin/feature-health` | `DONE` | Admin diagnostics gated by backend RBAC (`403` non-admin) |
| **Excluded Apps** | Separate Organization & Standalone Reels Apps | `OUT_OF_SCOPE` | Intentionally excluded per product scope |
