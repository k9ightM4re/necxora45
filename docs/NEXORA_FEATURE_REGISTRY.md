# NEXORA — Master Feature Registry

Single source of truth synchronized with `shared/featureRegistry.ts`, `/api/v1/features/registry`, and `/api/v1/admin/feature-health`.

## Product Scope Boundaries

- **Included:** Core Nexora social networking, real-time 1:1 & group messaging, audio/video calling, communities, stories, in-app reels & templates, privacy-safe nearby discovery, notifications, social commerce, visual product search, Nexora Studio, and safety moderation.
- **Strictly Excluded:** Standalone Organization application, standalone Reels publishing application, and OpenBot/AI bot marketplaces or bot-team interfaces.

## Status Summary

- **Registered Features:** 25 core & adapter modules across Modules A–N
- **Implemented & Verified:** 20 modules (full Frontend + Backend + Database + API + GUI + Automated Tests)
- **Blocked on External Provider Credentials:** 5 adapter modules (`NX-MSG-04` Redis pub/sub, `NX-MEDIA-02` S3/FFmpeg, `NX-SHOP-02` Merchant Feed Sync, `NX-VSEARCH-01` External Visual Search, `NX-STUDIO-02` Virtual Try-On), each surfacing honest `REQUIRES_CONFIGURATION` / HTTP `503` UI & API responses until keys are supplied.

## Complete Registry Table (Modules A–N)

| ID | Module Group | Feature | Category | Nav Surface | API / Transport | Availability | Status |
|---|---|---|---|---|---|---|---|
| `NX-AUTH-01` | A. Authentication & Account | User Registration & Verification | Personalization | `/signup.html` | `POST /api/auth/send-email-otp`, `POST /api/auth/verify-email-otp` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-AUTH-02` | A. Authentication & Account | Sign In, Session Guard & Logout | Personalization | `/login.html`, Settings | `POST /api/auth/verify-session`, `GET /api/v1/auth/me` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-AUTH-03` | A. Authentication & Account | Account Deactivation, Deletion & Privacy Controls | Personalization | Settings -> Security | `POST /api/v1/auth/deactivate`, `DELETE /api/v1/auth/account` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-PROF-01` | B. User Profile | User Profile & Extended Editing | Personalization | My Profile (`#profile`) | `GET /api/v1/users/:userId`, `PATCH /api/v1/users/me` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-PROF-02` | B. User Profile | Followers, Following & Mutual Connections | Social | My Profile -> Connections | `GET /api/v1/users/:userId/mutuals` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-GRAPH-01` | C. Social Graph | Follow, Private Follow Requests & Remove Follower | Social | Profile & Notifications | `POST /api/v1/users/:userId/follow`, `/follow-requests` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-GRAPH-02` | C. Social Graph | Block, Unblock & Mute Accounts | Personalization | Profile & Privacy Settings | `POST/DELETE /api/v1/users/:userId/block`, `/mute` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-FEED-01` | D. Social Feed | Deterministic Ranked Home Feed | Social | Home (`#home`) | `GET /api/v1/feed`, `POST /api/v1/feed/feedback` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-FEED-02` | D. Social Feed | Posts Composer (Text, Multi-Media, Product Tags) | Social | Home -> Composer | `POST/PATCH/DELETE /api/v1/posts` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-FEED-03` | D. Social Feed | Likes, Nested Comments, Reactions, Repost & Bookmarks | Social | Home & Saved (`#saved`) | `POST /api/v1/posts/:id/repost`, `/comments` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-DISC-01` | E. Discovery | Unified Explore, Search Suggestions & History | Discovery | Explore (`#explore`) & Top Search | `GET /api/v1/search`, `/search/suggestions`, `/search/history` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-MSG-01` | F. Messaging | 3-Zone Direct & Group Messaging Workspace | Communication | Messages (`#messages`) | `GET/POST /api/v1/messages/threads/*` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-MSG-02` | F. Messaging | Real-Time WebSockets, Presence, Typing & Receipts | Communication | Messages & Video Calls | `WS /ws` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-MSG-03` | F. Messaging | Offline Outbox & Reconnection Catchup Sync | Communication | Messages (`#messages`) | `GET /api/v1/messages/threads/:id/sync` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-MSG-04` | F. Messaging | Multi-Node Redis Pub/Sub Fanout Adapter | Communication | Feature Health | `WS /ws` + `REDIS_URL` | `REQUIRES_CONFIGURATION` | `BLOCKED_EXTERNAL_DEPENDENCY` |
| `NX-COMM-01` | G. Communities | Communities, Channels, Polls, Roles & Invites | Communities | Communities (`#communities`) | Firestore RBAC + `server/api_router.ts` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-MEDIA-01` | H. Stories & Media | 24-Hour Stories, Camera, Reactions & Expiration | Media | Home -> Stories Strip | `GET /api/v1/stories/active`, `POST /api/v1/stories/sweep-expired` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-MEDIA-02` | H. Stories & Media | Validated Media Upload & S3/FFmpeg Adapters | Media | Home / Messages / Studio | `POST /api/media/upload`, `GET /api/v1/media/status` | `REQUIRES_CONFIGURATION` | `BLOCKED_EXTERNAL_DEPENDENCY` |
| `NX-MEDIA-03` | H. Stories & Media | In-App Reels & Template Studio | Media | Reels (`#reels`) & Templates | `POST /api/templates/generate` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-NEAR-01` | I. Nearby Discovery | Privacy-Safe Nearby People & Local Events | Discovery | Nearby (`#nearby`) | `POST /api/v1/nearby/location`, `GET /api/v1/nearby/people` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-NOTIF-01` | J. Notifications | Real-Time Activity Notifications & Quiet Preferences | Social | Notifications (`#notifications`) | `GET /api/v1/notifications`, `PATCH /read`, `POST /read-all` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-SHOP-01` | K. Social Commerce | Marketplace Catalog, Merchants & Collections | Commerce | Marketplace (`#marketplace`) | `/api/v1/merchants`, `/api/v1/products`, `/api/v1/commerce/collections` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-SHOP-02` | K. Social Commerce | External Merchant Feed Sync Adapter | Commerce | Marketplace Banner | `GET /api/v1/commerce/status`, `POST /api/v1/commerce/sync` | `REQUIRES_CONFIGURATION` | `BLOCKED_EXTERNAL_DEPENDENCY` |
| `NX-VSEARCH-01` | L. Visual Product Search | Visual Product Search (Image Preview & Catalog Match) | Commerce | Visual Search (`#visual-search`) | `GET /api/v1/visual-search/status`, `POST /api/v1/visual-search` | `REQUIRES_CONFIGURATION` | `BLOCKED_EXTERNAL_DEPENDENCY` |
| `NX-STUDIO-01` | M. Nexora Studio | Consented Photos & Outfit Builder | Commerce | Nexora Studio (`#studio`) | `/api/v1/studio/photos`, `/api/v1/studio/outfits` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-STUDIO-02` | M. Nexora Studio | Virtual Try-On Rendering Adapter | Commerce | Nexora Studio Try-On Card | `GET /api/v1/studio/status`, `POST /api/v1/studio/try-on` | `REQUIRES_CONFIGURATION` | `BLOCKED_EXTERNAL_DEPENDENCY` |
| `NX-MOD-01` | N. Moderation & Security | Safety Reporting, Moderation Queue & Audit Logs | Communities | Admin Dashboard (`#admin`) | `GET/PATCH /api/v1/moderation/reports` | `RESTRICTED_BY_PERMISSIONS` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-DISC-02` | N. Moderation & Security | Authenticated Feature Discovery Hub (`/features`) | Discovery | Features (`#features`) | `GET /api/v1/features/registry` | `ENABLED` | `IMPLEMENTED_AND_VERIFIED` |
| `NX-MOD-02` | N. Moderation & Security | Admin Feature Health Diagnostics (`/admin/feature-health`) | Personalization | Feature Health (`#admin-feature-health`) | `GET /api/v1/admin/feature-health` | `RESTRICTED_BY_PERMISSIONS` | `IMPLEMENTED_AND_VERIFIED` |
