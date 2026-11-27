# NEXORA — Frontend Architecture & Repository Audit

**Audit Date:** 2026-11-27  
**Scope:** Existing Nexora Public Website, Auth Entry Points, Authenticated Workspace, Messaging Inbox & Live Scene  
**Constraint:** Preserve backend (`server/`, Firestore schemas, Firebase Auth, WebRTC, and existing API routes) untouched.

---

## 1. Repository & Stack Inventory

### Package Stack (`package.json` & `bun.lock`)
- **Build & Bundler:** `vite` (`^8.3.0`), `@vitejs/plugin-react` (`^6.1.1`), `@tailwindcss/vite` (`^4.3.3`)
- **UI & Animation:** `react` (`^19.0.1`), `react-dom` (`^19.0.1`), `motion` (`^12.23.24`), `lucide-react` (`^0.546.0`)
- **Server & AI:** `express` (`^4.21.2`), `tsx` (`^4.21.0`), `firebase` (`^13.3.0`), `@google/genai` (`^2.4.0`), `dotenv` (`^17.2.3`)
- **Scripts:** `"dev": "tsx server.ts"`, `"build": "vite build"`, `"lint": "tsc --noEmit"`, `"start": "node server.ts"`
- **Verification:** `node --test tests/*.test.mjs` (`11` test suites, `59` passing assertions).

### Entry Points & Route Map (`vite.config.ts`)
Nexora is a **Vite 8 Multi-Page Application (MPA)** with 8 HTML entries served cleanly by Express (`server.ts`):
1. `index.html` (`/`): Public marketing website (`js/landing.js`, `css/landing.css`, `css/global.css`) + lazy-mounted React 19 **Live Team Scene** (`src/live_scene/mountLiveScene.tsx`).
2. `app.html` (`/app.html`): Authenticated workspace shell (`1,450` lines) combining:
   - Left navigation rail (`#nx-left-nav`), top global search/theme/notifications/account bar (`.nx-top-header`), mobile bottom bar (`#nx-mobile-bottom-nav`), and `#nx-social-root` managed by `js/social.js` (Home Feed, Stories, Explore, Reels, Templates, Social Circle, Video Calls, Notifications, Profile, Saved, Settings, Live, Admin).
   - Dedicated active call workspace (`#nx-call-tab-workspace`, `js/call_tab.js`).
   - Messaging & Communities workspace (`#nx-legacy-workspace`, `js/app.js` + `js/comms.js` + `js/rtc.js`) toggled via `data-workspace-mode="messages|communities"` inside `#nx-legacy-workspace`.
3. `login.html`, `signup.html`, `verify.html`, `forgot-password.html`, `reset-password.html`: Authentication pages (`js/auth.js`, `css/auth.css`, `css/global.css`) backed by Firebase Auth + Express OTP endpoints.
4. `welcome.html`: Community invite & connection request hub (`js/welcome.js`, `css/welcome.css`, `css/global.css`).

*Note on `src/App.tsx`:* An unused prototype tree (`src/App.tsx`, `src/main.tsx`, `src/components/*`) exists in `src/` but is not bundled by `vite.config.ts`. Live production UI uses the 8 HTML pages + `js/` + `css/` + `src/live_scene/`.

---

## 2. Current Design Tokens, Fonts & Theme Gaps

| Dimension | Current State | Target (`MASTER SPECIFICATION`) | Action Required |
|---|---|---|---|
| **Color Palette** | Dark `#0B0C0E` + `#E5A93C` (Obsidian Brass) / `#F6F5F1` (Alabaster), plus `midnight-cyan` & `ember` in `css/global.css`, `css/app.css`, `css/social.css`, `css/auth.css` | **Graphite** (`#242B35`) + **Signal Blue** (`#4777DF`) + **Soft Amber** (`#C49A52`) with Dark `#101318`/`#171C23`/`#1D232C`/`#242B35` default & Light `#F5F6F8`/`#EBEEF2`/`#FFFFFF` | Unify all 4 stylesheets + `LiveTeamScene.tsx` tokens onto Graphite, Signal Blue, Soft Amber while preserving clean Light/Dark theme switching (`localStorage` key `nexora_theme`) |
| **Typography** | `Bricolage Grotesque` + `Plus Jakarta Sans` + `JetBrains Mono` | **Manrope** (500–800 display/headings) + **Inter** (400–700 body/UI/inbox) + tabular numerals | Update font imports across all 8 HTML entries + CSS `--font-display` / `--font-sans` tokens without render blocking |
| **Glassmorphism** | Ad-hoc `--glass-bg` on landing header only | Standardized 3-level system (`--nx-glass-bg`, `--nx-glass-border`, `--nx-glass-blur`, `--nx-glass-shadow`) | Define reusable Level 1 Solid, Level 2 Subtle Glass, Level 3 Floating Glass utilities |
| **Public Landing & Hero** | Asymmetric text + desk photo (`hero_studio_workspace_*.jpg`), flat sticky bar | Floating capsule navbar + SynApse-inspired centered architectural grid hero (`"THE HUMAN + AI NETWORK"`, `"One network. Infinite possibilities."`, `"Explore Nexora"` / `"Discover the network"`) + **large angled Nexora Product Mockup** + 8 cohesive sections | Rebuild `index.html` & `css/landing.css` faithfully while keeping Live Team Scene functional inside the Product Preview / interactive showcase |
| **Authenticated Inbox (`Messages`)** | `#nx-legacy-workspace[data-workspace-mode="messages"]` uses `.channel-sidebar` + flat `.msg-row` rows designed originally like Discord channels | **Instagram-inspired Messaging Inbox**: crisp two-pane (conversation list + active thread, optional collapsible details drawer), incoming neutral elevated bubbles vs outgoing Signal Blue bubbles, clean grouped timestamps, delivery state (`Sent` / `Seen`), native mobile list <-> conversation push/back navigation | Refactor `app.html`, `css/app.css`, and `js/app.js` (DM rendering + mobile back trigger) while preserving every Firebase DM, group chat, request gate, reply, reaction, poll, bookmark, pin, attachment, voice note, and WebRTC call action |
| **Human vs AI Identity** | Generic `.msg-avatar` & agent badges in `LiveTeamScene.tsx` only | Reusable distinguishable visual identity markers (Human: avatar + username + presence/verified; AI Agent: role + state + Signal Blue / Soft Amber indicator + explicit text label) | Add `.nx-identity-human` / `.nx-identity-agent` styling + badges across Landing Mockup, Live Scene, Feed, and Inbox |

---

## 3. Existing Functionality to Preserve 100%

- **Firebase Auth & Session Gates:** Google Sign-In, Email+Password, Sign-In Link, Phone OTP (`login.html`, `signup.html`, `verify.html`, `forgot-password.html`, `reset-password.html`, `js/auth.js`, `js/session.js`).
- **Authenticated Workspace (`app.html` + `js/social.js` + `js/app.js` + `js/rtc.js` + `js/template_studio.js` + `js/reel_studio.js` + `js/social_circle_ui.js` + `js/rag_assistant.js`):**
  - Social Feed, Stories, Reels, Explore, Template Studio, Social Circle M1 consent/OAuth/sync, Video Calls, Notifications, Profile, Saved, Settings, Admin Moderation, Go Live.
  - Request-gated Direct Messages, Group Chats, Archived DMs, Polls, File/Image/Video/Audio attachments, Voice Note recording, Emoji Picker, Search, Message Replies/Threads/Reactions/Edits/Pins/Bookmarks, WebRTC Voice/Video/Screen Share calls.
- **Interactive Live Team Scene (`src/live_scene/engine.ts` + `LiveTeamScene.tsx`):** Simulation & optional `/api/live-scene/run` live mode, model swapping, handoff graph, and approval flow.

---

## 4. Honest Backend Capability Boundary
- **Live Backend Supported Today:** Firebase Auth, Firestore real-time feeds/DMs/communities/stories/calls, Express `/api/health`, `/api/auth/*`, `/api/search`, `/api/ai-providers*`, `/api/templates/generate`, `/api/rag/{search,query}`, `/api/live-scene/run`, `/api/social-circle/*`.
- **Illustrative Preview Data:** The landing page's hero product preview and public feature showcase use clearly labeled illustrative preview data (example accounts/agent interactions) matching the real authenticated Nexora UI.
