export interface FeedPostRecord {
  id: string;
  authorId: string;
  authorName?: string;
  authorUsername?: string;
  authorAvatar?: string;
  authorVerified?: boolean;
  content?: string;
  mediaType?: 'none' | 'image' | 'video' | 'carousel';
  mediaItems?: Array<{ type: string; url: string }>;
  hashtags?: string[];
  mentions?: string[];
  visibility?: 'public' | 'followers' | 'private';
  allowedViewerUids?: string[];
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  productIds?: string[];
  isDraft?: boolean;
  createdAt?: string;
  createdAtMs?: number;
  [key: string]: any;
}

export interface FeedRankingContext {
  viewerUid: string;
  followingIds: Set<string>;
  mutualIds?: Set<string>;
  blockedIds: Set<string>;
  mutedIds: Set<string>;
  viewerInterests?: string[];
  negativePostIds?: Set<string>;
  negativeAuthorIds?: Set<string>;
  tab?: 'for-you' | 'following' | 'latest';
  hashtag?: string;
  nowMs?: number;
}

export interface RankedPostEntry<T extends FeedPostRecord = FeedPostRecord> {
  post: T;
  score: number;
  reasons: string[];
}

export function resolveTimestampMs(item: { createdAtMs?: number; createdAt?: string } | null | undefined): number {
  if (!item) return 0;
  if (typeof item.createdAtMs === 'number' && Number.isFinite(item.createdAtMs) && item.createdAtMs > 0) {
    return item.createdAtMs;
  }
  if (typeof item.createdAt === 'string' && item.createdAt) {
    const parsed = Date.parse(item.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function canViewerAccessPost(post: FeedPostRecord | null | undefined, ctx: FeedRankingContext): boolean {
  if (!post || !post.id || !post.authorId) return false;
  if (ctx.blockedIds.has(post.authorId)) return false;
  if (post.authorId !== ctx.viewerUid && ctx.mutedIds.has(post.authorId)) return false;
  if (post.isDraft) return false;

  if (post.authorId === ctx.viewerUid) return true;
  if (post.visibility === 'public' || !post.visibility) return true;
  if (post.visibility === 'followers') {
    if (ctx.followingIds.has(post.authorId)) return true;
    if (Array.isArray(post.allowedViewerUids) && post.allowedViewerUids.includes(ctx.viewerUid)) return true;
    return false;
  }
  return false;
}

/**
 * Deterministic multi-signal feed ranking engine (Phase 4):
 * - Enforces block, mute, draft, and private/followers visibility filtering BEFORE scoring.
 * - `following` and `latest` tabs preserve strict chronological order.
 * - `for-you` combines:
 *   1) Interest match (+2.5 per overlapping hashtag/interest, max +10)
 *   2) Relationship affinity (+6 follow, +4 mutual, +1.5 own post)
 *   3) Logarithmic engagement quality (likes, comments, shares, rich media)
 *   4) Exponential recency decay (24h half-life scale)
 *   5) Negative feedback penalties (-100 post hide, -8 author downrank)
 *   6) Greedy diversity & author-repetition suppression pass
 */
export function rankFeedPosts<T extends FeedPostRecord>(
  posts: T[],
  ctx: FeedRankingContext
): Array<RankedPostEntry<T>> {
  const nowMs = ctx.nowMs ?? Date.now();
  const tab = ctx.tab || 'for-you';
  const tagFilter = String(ctx.hashtag || '').trim().toLowerCase();
  const normalizedInterests = new Set(
    (ctx.viewerInterests || [])
      .map((s) => String(s || '').trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean)
  );
  const mutualIds = ctx.mutualIds || new Set<string>();
  const negativePostIds = ctx.negativePostIds || new Set<string>();
  const negativeAuthorIds = ctx.negativeAuthorIds || new Set<string>();

  const eligible = (posts || []).filter((post) => {
    if (!canViewerAccessPost(post, ctx)) return false;
    if (negativePostIds.has(post.id)) return false;
    if (tagFilter) {
      const normTag = tagFilter.startsWith('#') ? tagFilter : `#${tagFilter}`;
      const matchesTag =
        (Array.isArray(post.hashtags) &&
          post.hashtags.some((t) => String(t).toLowerCase() === normTag || String(t).toLowerCase() === tagFilter)) ||
        String(post.content || '').toLowerCase().includes(normTag);
      if (!matchesTag) return false;
    }
    if (tab === 'following') {
      return post.authorId === ctx.viewerUid || ctx.followingIds.has(post.authorId);
    }
    return true;
  });

  if (tab === 'following' || tab === 'latest') {
    return eligible
      .map((post) => ({
        post,
        score: resolveTimestampMs(post),
        reasons: [tab === 'following' ? 'following_chronological' : 'latest_chronological'],
      }))
      .sort((a, b) => b.score - a.score || b.post.id.localeCompare(a.post.id));
  }

  const baseScored: Array<RankedPostEntry<T>> = eligible.map((post) => {
    const reasons: string[] = [];
    const createdMs = resolveTimestampMs(post) || nowMs;
    const ageHours = Math.max(0, (nowMs - createdMs) / 3_600_000);

    // 1. Recency decay (max +14)
    const recencyScore = 14 * Math.exp(-ageHours / 24);

    // 2. Relationship affinity
    let relationshipScore = 0;
    if (post.authorId === ctx.viewerUid) {
      relationshipScore += 1.5;
    } else if (ctx.followingIds.has(post.authorId)) {
      relationshipScore += 6;
      reasons.push('following');
      if (mutualIds.has(post.authorId)) {
        relationshipScore += 4;
        reasons.push('mutual_connection');
      }
    }

    // 3. Interest relevance
    let interestMatches = 0;
    if (normalizedInterests.size > 0) {
      const postTags = (Array.isArray(post.hashtags) ? post.hashtags : []).map((t) =>
        String(t).toLowerCase().replace(/^#/, '')
      );
      for (const tag of postTags) {
        if (normalizedInterests.has(tag)) interestMatches += 1;
      }
      if (interestMatches === 0 && post.content) {
        const lower = String(post.content).toLowerCase();
        for (const interest of normalizedInterests) {
          if (lower.includes(interest)) interestMatches += 1;
        }
      }
    }
    const interestScore = Math.min(10, interestMatches * 2.5);
    if (interestScore > 0) reasons.push('interest_match');

    // 4. Engagement quality (bounded logarithmic curve)
    const likes = Math.max(0, Number(post.likesCount || 0));
    const comments = Math.max(0, Number(post.commentsCount || 0));
    const shares = Math.max(0, Number(post.sharesCount || 0));
    const engagementScore = Math.min(
      18,
      Math.log1p(likes) * 1.4 +
        Math.log1p(comments) * 2.3 +
        Math.log1p(shares) * 2.8 +
        (post.mediaType && post.mediaType !== 'none' ? 1.2 : 0) +
        (Array.isArray(post.productIds) && post.productIds.length > 0 ? 0.8 : 0)
    );
    if (engagementScore >= 4) reasons.push('engagement_quality');

    // 5. Negative feedback penalty
    const negativePenalty = negativeAuthorIds.has(post.authorId) ? -8 : 0;
    if (negativePenalty < 0) reasons.push('negative_feedback_suppressed');

    const total = Math.round((recencyScore + relationshipScore + interestScore + engagementScore + negativePenalty) * 1000) / 1000;
    return { post, score: total, reasons };
  });

  // 6. Greedy author-repetition suppression and media-type diversity pass
  const remaining = [...baseScored].sort((a, b) => b.score - a.score);
  const reranked: Array<RankedPostEntry<T>> = [];
  const authorCounts = new Map<string, number>();
  let lastMediaType = '';

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestAdjusted = -Infinity;
    const scanLimit = Math.min(remaining.length, 15);
    for (let i = 0; i < scanLimit; i++) {
      const candidate = remaining[i];
      const priorAuthorCount = authorCounts.get(candidate.post.authorId) || 0;
      const authorPenalty = priorAuthorCount * 4.5;
      const mediaType = candidate.post.mediaType || 'none';
      const diversityBonus = lastMediaType && mediaType !== lastMediaType ? 0.8 : 0;
      const adjusted = candidate.score - authorPenalty + diversityBonus;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    const prevCount = authorCounts.get(picked.post.authorId) || 0;
    authorCounts.set(picked.post.authorId, prevCount + 1);
    lastMediaType = picked.post.mediaType || 'none';
    reranked.push({
      post: picked.post,
      score: Math.round(bestAdjusted * 1000) / 1000,
      reasons: prevCount > 0 ? [...picked.reasons, 'diversity_reranked'] : picked.reasons,
    });
  }

  return reranked;
}

export function computeTrendingTopics(
  posts: FeedPostRecord[],
  nowMs = Date.now(),
  limit = 10
): Array<{ tag: string; count: number; velocityScore: number }> {
  const stats = new Map<string, { count: number; velocityScore: number }>();
  for (const post of posts || []) {
    if (!post || post.isDraft || post.visibility === 'private') continue;
    const createdMs = resolveTimestampMs(post) || nowMs;
    const ageHours = Math.max(0, (nowMs - createdMs) / 3_600_000);
    const weight = 1 / Math.pow(ageHours + 2, 1.25);
    const tags = Array.isArray(post.hashtags) ? post.hashtags : [];
    for (const raw of tags) {
      const clean = String(raw || '').trim().toLowerCase();
      const tag = clean.startsWith('#') ? clean : `#${clean}`;
      if (tag.length < 3) continue;
      const entry = stats.get(tag) || { count: 0, velocityScore: 0 };
      entry.count += 1;
      entry.velocityScore += weight;
      stats.set(tag, entry);
    }
  }
  return Array.from(stats.entries())
    .map(([tag, s]) => ({
      tag,
      count: s.count,
      velocityScore: Math.round(s.velocityScore * 1000) / 1000,
    }))
    .sort((a, b) => b.velocityScore - a.velocityScore || b.count - a.count)
    .slice(0, limit);
}

export function maskUserProfile(
  userDoc: Record<string, any> | null,
  viewerUid: string,
  options: { isFollowing?: boolean; isBlocked?: boolean; hasPendingFollowRequest?: boolean; mutualCount?: number } = {}
): Record<string, any> | null {
  if (!userDoc || !userDoc.id) return null;
  if (options.isBlocked) return null;

  const isSelf = userDoc.id === viewerUid;
  const isPrivate = userDoc.accountPrivacy === 'private';
  const canSeeDetails = isSelf || !isPrivate || Boolean(options.isFollowing);

  if (canSeeDetails) {
    return {
      ...userDoc,
      isPrivateLocked: false,
      isFollowing: Boolean(options.isFollowing),
      hasPendingFollowRequest: Boolean(options.hasPendingFollowRequest),
      ...(typeof options.mutualCount === 'number' ? { mutualCount: options.mutualCount } : {}),
    };
  }

  // Private profile viewed by non-follower: strip bio, website, location, interests, and counts
  return {
    id: userDoc.id,
    username: userDoc.username || 'member',
    displayName: userDoc.displayName || 'Nexora Member',
    initials: userDoc.initials || 'NX',
    avatar: userDoc.avatar || '',
    accountPrivacy: 'private',
    verified: Boolean(userDoc.verified),
    isPrivateLocked: true,
    isFollowing: false,
    hasPendingFollowRequest: Boolean(options.hasPendingFollowRequest),
  };
}
