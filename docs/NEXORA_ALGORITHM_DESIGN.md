# NEXORA — Feed Ranking & Discovery Algorithm Design

Implemented deterministically in `server/v1/feed_ranker.ts` and exposed through `GET /api/v1/feed`, `POST /api/v1/feed/feedback`, and `GET /api/v1/discover/trending`.

## 1. Pre-Score Safety & Visibility Filtering (`canViewerAccessPost`)

Every candidate post is filtered **before** scoring:
1. Exclude authors in `viewer.blockedIds`.
2. Exclude authors in `viewer.mutedIds` (unless the post author is the viewer).
3. Exclude unpublished drafts (`post.isDraft === true`).
4. Enforce audience privacy:
   - `public`: visible to authenticated viewers.
   - `followers`: visible only if `viewer` follows the author or is explicitly listed in `allowedViewerUids`.
   - `private`: visible only to the post author.
5. Exclude posts in `viewer.negativePostIds` ("Not interested" feedback).

## 2. Tab Modes

- **`following`**: Restricts to `authorId === viewerUid` or `followingIds.has(authorId)`, sorted strictly chronologically (`createdAtMs DESC`).
- **`latest`**: All eligible posts sorted strictly chronologically (`createdAtMs DESC`).
- **`for-you`**: Deterministic multi-signal scoring + diversity reranking.

## 3. Multi-Signal Scoring Formula (`for-you`)

1. **Recency Decay (max +14):** `14 * exp(-ageHours / 24)` (24-hour exponential decay).
2. **Relationship Affinity:** `+6` if followed, additional `+4` if mutual connection, `+1.5` for viewer's own post.
3. **Interest Match (max +10):** `+2.5` per overlapping normalized hashtag or interest keyword.
4. **Bounded Engagement Quality (max +18):** `min(18, 1.4*ln(1+likes) + 2.3*ln(1+comments) + 2.8*ln(1+shares) + mediaBonus + productTagBonus)`.
5. **Negative Author Penalty:** `-8` if viewer previously marked an author's post as "Not interested".
6. **Greedy Diversity & Repetition Suppression Pass:** Iteratively scans top 15 remaining items, subtracting `4.5 * priorAuthorCount` to avoid consecutive author clustering and adding `+0.8` when `mediaType` alternates from the previous card.

## 4. Trending Velocity (`computeTrendingTopics`)

Aggregates public non-draft post hashtags weighted by `1 / (ageHours + 2)^1.25` to surface accelerating topics ahead of stale high-volume tags.
