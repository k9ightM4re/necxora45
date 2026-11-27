# NEXORA — Phase 0 Frontend Architecture & Gap Audit

**Date:** 2026-11-27  
**Scope:** Phase 0 Read-Only Audit (`NEXORA_FRONTEND_MASTER.md` baseline)  
**Target Branch (proposed):** `feat/nexora-frontend` *(Note: `.git` is not currently initialized in `/app/applet` — see Section 6)*

---

## 1. Detected Stack & Repository Reality

Nexora is **not** a standard single-page React app today. It is a **hybrid Vite 8 Multi-Page Application (MPA) + Express backend** combining:
1. **8 separate HTML entry points** (`vite.config.ts` Rollup multi-entry):
   - `index.html` (Marketing landing + embedded React Live Team Scene island)
   - `app.html` (Main social/community workspace — `1,450` lines of static DOM containers hydrated by vanilla JS)
   - `login.html`, `signup.html`, `verify.html`, `welcome.html`, `forgot-password.html`, `reset-password.html`
2. **26 Vanilla ES modules (`js/*.js` — ~26,563 LOC)** driving almost all runtime UI:
   - `js/app.js` (6,615 LOC), `js/social.js` (5,904 LOC), `js/template_studio.js` (3,695 LOC), `js/rtc.js` (1,229 LOC), `js/reel_studio.js` (945 LOC), `js/call_tab.js` (881 LOC), `js/template_library.js` (720 LOC), `js/template_schema.js` (595 LOC), `js/auth.js` (589 LOC), `js/welcome.js` (558 LOC), `js/template_renderer.js` (513 LOC), `js/social_circle_ui.js` (367 LOC), `js/social_utils.js` (354 LOC), `js/rag_assistant.js` (345 LOC), `js/notifications.js` (331 LOC), `js/comms.js` (316 LOC), `js/profile.js` (227 LOC), `js/session.js` (222 LOC), `js/community_moderation.js` (198 LOC), `js/theme.js` (196 LOC), `js/firebase.js` (146 LOC), `js/supabase.js` (122 LOC), `js/tour_utils.js` (115 LOC), `js/landing.js` (111 LOC), `js/icons.js` (90 LOC), `js/pwa.js` (85 LOC).
3. **7 Vanilla CSS stylesheets (`css/*.css` — ~9,739 LOC)**:
   - `css/app.css` (3,073), `css/social.css` (2,546), `css/landing.css` (1,927), `css/templates.css` (726), `css/auth.css` (611), `css/global.css` (523), `css/welcome.css` (333).
4. **Two Disconnected React Trees inside `src/`**:
   - **Active Island:** `src/live_scene/` (`engine.ts` 1,047 LOC, `LiveTeamScene.tsx` 833 LOC, `mountLiveScene.tsx` 15 LOC) mounted inside `#live-scene` on `index.html`.
   - **Orphaned / Legacy SPA Prototype:** `src/App.tsx`, `src/main.tsx`, `src/index.css`, and `src/components/{chat,common,discovery,forum,friends,members,modals,navigation,voice,workspace}` — Discord-style React UI that is **not included** in `vite.config.ts` build inputs.
5. **Runtime Packages & Tooling (`package.json`):**
   - **Installed:** `react` 19.0.1, `react-dom` 19.0.1, `vite` 8.3.0, `@tailwindcss/vite` 4.3.3, `tailwindcss` 4.3.3, `typescript` 7.0.2, `motion` 12.23.24, `lucide-react` 0.546.0, `express` 4.21.2, `firebase` 13.3.0, `@google/genai` 2.4.0, `tsx` 4.21.0, `eslint` 10.14.0 (`@firebase/eslint-plugin-security-rules` only).
   - **Package Manager State:** `bun.lock` is present alongside `package.json`; scripts execute via `npm`/`tsx` (`"dev": "tsx server.ts"`, `"build": "vite build"`, `"lint": "tsc --noEmit"`).
   - **Tests:** 11 test files under `tests/*.test.mjs` (`59/59` passing via Node built-in `node --test`). No Vitest, React Testing Library, or Playwright suite configured yet.
6. **Backend Surface (`server.ts`, `server/api_router.ts`, `server/social_circle/router.ts`, `vite.config.ts` dev plugin):**
   - Express serves `/api/health`, `/api/auth/*`, `/api/search`, `/api/ai-providers*`, `/api/templates/generate`, `/api/rag/search`, `/api/rag/query` (JSON + SSE), `/api/live-scene/run`, `/api/social-circle/{status,consent,oauth/:provider/callback,sync/:provider,disconnect/:provider,retention,webhooks/:provider}`.
   - **Important:** `vite.config.ts` duplicates several `/api/auth/*` & `/api/search` middlewares inside `nexoraServerPlugin()`.

---

## 2. Inventory of Existing Pages, Routes, Views & State

### HTML Entry Points vs. Master Prompt Routes
| Current Route / File | Current Implementation | Master Prompt Target | Migration Action |
|---|---|---|---|
| `/`, `/index.html` | Landing page + React Live Team Scene island (`Obsidian Brass` theme) | `/` + `/scene` | Migrate to React SPA entry with `/` landing & dedicated `/scene` workspace; keep query/hash compatibility |
| `/app.html` | 1,450-line MPA shell (`Home`, `Explore`, `Reels`, `Templates`, `Social Circle`, `Messages`, `Video Calls`, `Communities`, `Notifications`, `My Profile`, `Saved Posts`, `Settings`, `Admin`, `Go Live`) | `/app/*` + `/circles`, `/connect`, `/ask`, `/insights`, `/privacy`, `/settings` | Redirect `/app.html` -> canonical SPA workspace routes while preserving deep hash tabs (`#home`, `#social-circle`, etc.) |
| `/login.html`, `/signup.html`, `/verify.html`, `/welcome.html`, `/forgot-password.html`, `/reset-password.html` | Vanilla JS + Firebase Auth (`js/auth.js`, `js/welcome.js`) | Auth routes inside SPA (`/login`, `/signup`, `/verify`, `/welcome`, `/forgot-password`, `/reset-password`) | Provide SPA routes + keep `.html` redirect/entry shims so bookmarks and Firebase OAuth callbacks never break |
| *(Missing)* | — | `/design` | Add interactive 6-theme showcase, WCAG AA contrast matrix, typography & component gallery |
| *(Partial inline)* | `js/social_circle_ui.js` (367 LOC) + `js/rag_assistant.js` (345 LOC) | `/connect`, `/circles`, `/ask`, `/insights`, `/privacy` | Replace imperative DOM rendering with typed React + TanStack Query + Worker-powered visualizations |

### Existing State Management
- Currently fragmented across module-level mutable objects in `js/app.js` / `js/social.js`, `localStorage` (`nx_theme`, `nx_density`, drafts), Firebase Auth/Firestore listeners (`js/firebase.js`), Supabase helper (`js/supabase.js`), and React local `useState` inside `LiveTeamScene.tsx`.
- **No** centralized Zustand store, **no** TanStack Query cache, and **no** Zod validation on API responses.

---

## 3. Quantitative Performance & Asset Baseline (`dist/assets/`)

Measured directly from the current production Vite build (`total dist/assets = ~5.1 MB`):

| Built Asset | Raw Size | Gzip Size | Assessment vs. `< 170 KB gzip` JS Budget |
|---|---:|---:|---|
| `theme-*.js` (shared chunk pulled onto landing + app!) | 1,464,996 B | **318,193 B (310.7 KB)** | **CRITICAL BLOCKER** — 1.87x budget on a single shared chunk |
| `mountLiveScene-*.js` (Landing React + Motion + Scene) | 981,673 B | **212,704 B (207.7 KB)** | **CRITICAL BLOCKER** — Landing loads ~533 KB gzip JS upfront |
| `app-*.js` (`app.html` monolithic JS) | 830,424 B | **175,304 B (171.2 KB)** | **OVER BUDGET** — Imperative monolith with no route splitting |
| `main-*.js`, `auth-*.js`, `welcome-*.js`, `icons-*.js`, `rag_assistant-*.js`, `pwa-*.js` | 80,829 B | **23,737 B (23.2 KB)** | OK |
| **CSS Total** (`app`, `landing`, `theme`, `auth`, `welcome`) | 183,739 B | **33,000 B (32.2 KB)** | Moderate; can drop significantly once Tailwind v4 replaces 9.7k LOC vanilla CSS |
| `hero_studio_workspace_*.jpg` | 718,525 B | **708,183 B (691.6 KB)** | **HIGH** — Uncompressed raster; replace/optimize to WebP/AVIF (<120 KB) |
| `icon-512-maskable.png` + `icon-512.png` + `logo.png` | 986,696 B | **981,663 B (958.7 KB)** | **HIGH** — Oversized PNG icons inflate PWA/static payload |

**Compute & Rendering Bottlenecks:**
- `js/social.js` (5,904 LOC) renders feed cards, stories, comments, and member lists via raw `innerHTML` / DOM mutations with **zero list virtualization** (`@tanstack/react-virtual` absent).
- No **Web Worker pool** exists; future 5k-node Circle graph layout (`d3-force`) or client RAG vector/BM25 scoring would freeze the main thread if added without workers.
- No live `PerformanceObserver` / FPS / Memory / Worker HUD (`PerfPanel`) exists yet.

---

## 4. Gap Analysis Against `NEXORA_FRONTEND_MASTER.md`

| Master Prompt Requirement | Current State | Gap Severity |
|---|---|---|
| **Single Typed API Client (`VITE_API_MODE=mock\|live`) + Zod + MSW** | Direct `fetch('/api/...')` calls scattered in `js/social_circle_ui.js`, `js/rag_assistant.js`, `js/app.js`, `LiveTeamScene.tsx`; no Zod, no MSW | **High** |
| **Tech Stack Standardization** (`TS strict`, `Tailwind + shadcn/Radix`, `Framer Motion`, `Lucide`, `TanStack Query`, `TanStack Virtual`, `Zustand`, `Recharts`, `d3-force`, `Three.js`) | React 19 + Tailwind v4 + `motion` + `lucide-react` installed, but `app.html` is vanilla JS; missing `shadcn/Radix`, `zod`, `zustand`, `@tanstack/react-query`, `@tanstack/react-virtual`, `msw`, `recharts`, `d3-force`, `three`, `vitest`, `playwright` | **High** |
| **6-Theme System + `/design` Inspector** (`aurora`, `aurora-light`, `midnight-cyan`, `ember`, `obsidian-gold`, `ivory-gold`) | 4 themes exist in `js/theme.js` (`dark`/Obsidian Brass, `light`/Alabaster, `midnight-cyan`, `ember`); missing `aurora`, `aurora-light`, strict `ivory-gold` naming & `/design` route | **Medium** |
| **Instagram + OpenBot (`morluto/rea`) Community Craft** | Current feed in `js/social.js` uses traditional CSS cards; lacks Instagram-grade spring physics, multi-segment story progress rings, gesture double-tap heart burst, swipeable media carousel physics, fluid bottom/detail comment sheets, and crisp responsive feed ergonomics | **High** |
| **Live Team Scene (`/`, `/scene`)** | Strong working foundation (`src/live_scene/engine.ts` + `LiveTeamScene.tsx`) with Atlas/Nova/Iris/Orion, handoff SVG, model swap, approval flow, **zero** download UI | **Low–Medium** (port cleanly to `/scene` + sync themes/API client) |
| **Connect Hub & Circle Explorer (`/connect`, `/circles`)** | Basic modal/tab in `js/social_circle_ui.js`; no 5k-node WebGL/Canvas explorer, no Worker-offloaded `d3-force`, no rich visual scope/data inventory UI | **High** |
| **Ask (`/ask`), Insights (`/insights`), Privacy Center (`/privacy`), Settings (`/settings`)** | Partial command drawer (`js/rag_assistant.js`) & basic settings panel; no dedicated `/ask`, `/insights` (Recharts), or `/privacy` one-click disconnect/export/delete center | **High** |
| **Testing & A11y Gates** | 59 Node unit tests pass, `tsc --noEmit` passes; zero Vitest/RTL/Playwright/axe automated checks | **Medium–High** |

---

## 5. Proposed Adaptations (Keep vs. Refactor)

1. **Preserve Backend & Existing Tests Untouched During Frontend Phases:**
   - Do **not** modify `server/` logic during Phases 1–9. Keep `server.ts` serving the SPA + static redirects, and keep `tests/*.test.mjs` passing alongside new Vitest + Playwright suites.
2. **Unified React 19 SPA with Legacy `.html` Redirects:**
   - Replace the split `8 HTML MPA + 26 vanilla JS + orphaned src/App.tsx` architecture cleanly inside React 19 + TypeScript (`strict`) + Tailwind v4 + Radix/shadcn + `motion`.
   - Maintain thin compatibility entry/redirect handlers for `/app.html`, `/login.html`, `/signup.html`, `/verify.html`, `/welcome.html`, `/forgot-password.html`, and `/reset-password.html` so no existing URL or OAuth callback breaks.
   - Retire/archive the unused Discord-style `src/components/{server,channel,...}` files only after verifying nothing imports them, avoiding dead-code bloat in bundles.
3. **Mock-First API Boundary (`src/api/client.ts`):**
   - Default `VITE_API_MODE=mock` using MSW + deterministic fixtures for every endpoint (including Instagram-style community feed, stories, reels, circles, RAG streaming, and Live Team Scene).
   - Provide a 1:1 `live` adapter targeting the exact existing Express contracts (`/api/social-circle/*`, `/api/rag/*`, `/api/live-scene/run`, `/api/templates/generate`).
4. **Instagram + OpenBot Community Layer (Original Implementation):**
   - Build Feed, Stories, Reels, Explore, Profile, and Circle views with crisp `1px` surface hairlines, gradient story rings, SVG multi-segment story viewer, gesture double-tap heart burst (`motion` spring physics), virtualized feeds (`@tanstack/react-virtual`), and mobile-first bottom sheet drawers—using **only original Nexora components, Lucide icons, and theme tokens** (no copied third-party code or logos).
5. **Aggressive Code-Splitting to Hit `< 170 KB gzip` Initial JS:**
   - Lazy-load `/scene` (Three.js/Live Scene), `/circles` (5k-node Canvas/WebGL + `d3-force`), `/insights` (Recharts), and `/app` modules; move graph/RAG heavy math into a dedicated **Web Worker pool**; optimize raster assets (`hero_studio_workspace_*.jpg` and PWA icons).

---

## 6. Open Questions for CHECKPOINT 0

Before I begin **Phase 1**, please confirm your preferences on these four decisions:

1. **Default Theme Choice:** Earlier you asked to replace the purple gradient with the Obsidian/Brass aesthetic, while `NEXORA_FRONTEND_MASTER.md` lists 6 themes (`aurora`, `aurora-light`, `midnight-cyan`, `ember`, `obsidian-gold`, `ivory-gold`). Should **`obsidian-gold`** be the default dark theme (with `ivory-gold` as default light, and `aurora` available in the 6-theme switcher), or do you prefer `aurora` as default?
2. **Legacy MPA (`app.html` & `js/*.js`) Cutover Strategy:** Should we convert `/` + `/app` into a unified React SPA immediately (leaving lightweight HTML redirects for `/app.html`, `/login.html`, etc.), or keep `app.html` live side-by-side until Phases 3–6 are complete? *(Recommended: unified SPA with clean `.html` redirects so we eliminate the 1.4 MB / 830 KB duplicate bundles early.)*
3. **API Mode & Live Backend Wiring:** Confirm defaulting to `VITE_API_MODE=mock` (MSW + fixtures) throughout Phases 1–8 while ensuring `VITE_API_MODE=live` wires cleanly to the existing Express endpoints (`/api/social-circle/*`, `/api/rag/*`, `/api/live-scene/run`)?
4. **Git & Tooling Setup:** Notice `.git` is not initialized in `/app/applet` (and `bun.lock` exists alongside `package.json`). Should I use **`npm`** (matching `package.json` scripts) and initialize a local git repo + `feat/nexora-frontend` branch before Phase 1 commits, or skip git initialization in this sandbox?

---

**Status:** **STOPPED AT CHECKPOINT 0.** Awaiting your confirmation on the questions above before starting Phase 1.
