# NEXORA — Real-Time Messaging Architecture

## 1. 3-Zone Workspace Layout

- **Zone A (Icon Rail):** Collapsed 72px left rail (`#nx-left-nav.collapsed`) providing section switching across Home, Explore, Nearby, Marketplace, Visual Search, Studio, Reels, Templates, Social Circle, Messages, Calls, Communities, Notifications, Profile, Saved, Features, and Settings.
- **Zone B (Thread List — `src/inbox/ConversationList.tsx`):** Searchable, filterable inbox (`All`, `Unread`, `Requests`, `Groups`) with real-time unread badges, pinned thread indicators, and mute state.
- **Zone C (Active Thread — `src/inbox/ActiveConversation.tsx`):** Virtualized message stream (`react-virtuoso`), date separators, reply threading, emoji reactions, message edit/delete, pin toggles, typing indicator, attachment previews, and thread action bar (Mute Alerts / Unmute, Remove Chat for Me, Group Rename / Leave Group).

## 2. Transport & Reliability Pipeline

1. **Authenticated WebSocket Hub (`server/realtime_ws.ts` + `js/ws_client.js`):**
   - Handshake validates Firebase ID token via Bearer/query token and associates socket with verified `uid`.
   - Publishes presence snapshots, typing states, read receipts, message fanout, and WebRTC signaling.
   - Single-node WebSocket fanout runs automatically; multi-replica pub/sub uses `REDIS_URL` when configured.
2. **Idempotent Message Creation (`server/v1/messaging_media_router.ts`):**
   - `POST /api/v1/messages/threads/:threadId/messages` accepts `clientMutationId`.
   - Bounded 24-hour / 5,000-entry idempotency cache deduplicates client retries without creating duplicate Firestore records.
3. **Offline Outbox & Reconnect Delta Catchup (`js/app.js`):**
   - Offline sends are queued under `localStorage` key `nx_dm_outbox_v1` with unique `clientMutationId`.
   - On browser `online` or WebSocket reconnect, `flushDmOutbox()` replays queued messages via `/api/v1/messages/threads/:threadId/messages` and calls `GET /api/v1/messages/threads/:threadId/sync?sinceMs=...` to fetch any missed deltas.
4. **Per-User Thread Controls (`PATCH /api/v1/messages/threads/:threadId/preferences`):**
   - Persists `mutedBy`, `archivedBy`, and `deletedFor[uid]` cutoffs so deleting a conversation hides prior messages only for the requesting user without affecting peer participants.
5. **Group Management (`POST /api/v1/messages/threads/:threadId/members`):**
   - Enforces participant membership & group admin checks for adding/removing members, promoting/demoting admins, renaming groups, and cleanly leaving groups.
