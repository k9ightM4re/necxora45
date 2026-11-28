# NEXORA — Engineering Changelog

## v1.0.0 — Full Core Feature Completion, GUI Activation & Diagnostics

### Added
- **Central Feature Registry & Live Diagnostics:** Created `shared/featureRegistry.ts`, `server/v1/features_router.ts` (`GET /api/v1/features/registry`, `GET /api/v1/admin/feature-health`), `/features` (`FeaturesDiscoveryView.tsx`), and admin-gated `/admin/feature-health` (`AdminFeatureHealthView.tsx`).
- **React 19 Platform Workspace (`src/platform/*`):** Implemented `MarketplaceView.tsx`, `VisualSearchView.tsx`, `NexoraStudioView.tsx`, `FeaturesDiscoveryView.tsx`, `AdminFeatureHealthView.tsx`, `PlatformWorkspace.tsx`, and `mountPlatform.tsx`.
- **Express `/api/v1/*` Backend Routers (`server/v1/*`):** Modular routers for auth/deactivation, social graph/follow requests/mutes/mutuals, deterministic feed ranking & unified search, messaging sync/idempotency/preferences/group management, privacy-safe nearby discovery & notifications, social commerce, visual search, Nexora Studio, and moderation.
- **Automated Verification Pipeline:** Added `scripts/verify-features.mjs` (`npm run verify:features`) generating `/reports/feature-verification.json` and `/reports/NEXORA_FEATURE_VERIFICATION.md`, plus security, feed algorithm, messaging reliability, registry, and commerce/studio adapter tests.
- **Containerization & Docs:** Added `Dockerfile`, `docker-compose.yml`, and updated engineering docs under `/docs/`.

### Changed
- Connected all social, messaging, nearby, profile, and settings controls in `js/social.js`, `js/app.js`, `js/profile.js`, and `src/inbox/ActiveConversation.tsx` to live `/api/v1/*` endpoints.
- Added Express deep-link redirects (`/features`, `/admin/feature-health`, `/marketplace`, `/visual-search`, `/studio`, `/nearby` -> `/app.html#<section>`).
- Kept standalone Organization app, standalone Reels app, and bot/AI agent UI strictly excluded from scope.
