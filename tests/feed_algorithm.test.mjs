import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTrendingTopics, rankFeedPosts } from '../server/v1/feed_ranker.ts';

test('rankFeedPosts enforces block, mute, draft, and private/followers visibility before ranking', () => {
  const now = 1_780_000_000_000;
  const posts = [
    { id: 'p-public', authorId: 'u2', visibility: 'public', content: 'Open post', createdAtMs: now - 1000 },
    { id: 'p-blocked', authorId: 'u-blk', visibility: 'public', content: 'Blocked', createdAtMs: now },
    { id: 'p-muted', authorId: 'u-mute', visibility: 'public', content: 'Muted', createdAtMs: now },
    { id: 'p-draft', authorId: 'u-me', visibility: 'public', isDraft: true, content: 'Draft', createdAtMs: now },
    { id: 'p-followers-yes', authorId: 'u-follow', visibility: 'followers', content: 'Friend post', createdAtMs: now - 2000 },
    { id: 'p-followers-no', authorId: 'u-stranger', visibility: 'followers', content: 'Hidden', createdAtMs: now },
    { id: 'p-private', authorId: 'u2', visibility: 'private', content: 'Private', createdAtMs: now },
  ];

  const ranked = rankFeedPosts(posts, {
    viewerUid: 'u-me',
    followingIds: new Set(['u-follow']),
    blockedIds: new Set(['u-blk']),
    mutedIds: new Set(['u-mute']),
    tab: 'for-you',
    nowMs: now,
  });

  const ids = ranked.map((r) => r.post.id);
  assert.deepEqual(ids.sort(), ['p-followers-yes', 'p-public']);
});

test('rankFeedPosts supports interest/affinity boosts, negative feedback suppression, hashtag filter, and diversity', () => {
  const now = 1_780_000_000_000;
  const posts = [
    {
      id: 'p-hidden',
      authorId: 'u1',
      visibility: 'public',
      hashtags: ['#design'],
      createdAtMs: now,
    },
    {
      id: 'p-mutual-interest',
      authorId: 'u-friend',
      visibility: 'public',
      hashtags: ['#design'],
      mediaType: 'image',
      likesCount: 25,
      commentsCount: 6,
      createdAtMs: now - 3600_000,
    },
    {
      id: 'p-downranked',
      authorId: 'u-bad',
      visibility: 'public',
      hashtags: ['#design'],
      likesCount: 30,
      createdAtMs: now - 3600_000,
    },
    {
      id: 'p-other-tag',
      authorId: 'u2',
      visibility: 'public',
      hashtags: ['#cooking'],
      createdAtMs: now,
    },
  ];

  const ranked = rankFeedPosts(posts, {
    viewerUid: 'u-me',
    followingIds: new Set(['u-friend']),
    mutualIds: new Set(['u-friend']),
    blockedIds: new Set(),
    mutedIds: new Set(),
    viewerInterests: ['design'],
    negativePostIds: new Set(['p-hidden']),
    negativeAuthorIds: new Set(['u-bad']),
    hashtag: '#design',
    tab: 'for-you',
    nowMs: now,
  });

  assert.equal(ranked.some((r) => r.post.id === 'p-hidden'), false);
  assert.equal(ranked.some((r) => r.post.id === 'p-other-tag'), false);
  assert.equal(ranked[0].post.id, 'p-mutual-interest');
  assert.ok(ranked[0].reasons.includes('mutual_connection'));
  assert.ok(ranked[0].reasons.includes('interest_match'));
  const downranked = ranked.find((r) => r.post.id === 'p-downranked');
  assert.ok(downranked?.reasons.includes('negative_feedback_suppressed'));
});

test('rankFeedPosts latest & following tabs preserve strict chronological order and computeTrendingTopics ignores drafts', () => {
  const now = 1_780_000_000_000;
  const posts = [
    { id: 'old', authorId: 'u-follow', visibility: 'public', hashtags: ['#nexora'], createdAtMs: now - 50_000_000 },
    { id: 'mid', authorId: 'u-stranger', visibility: 'public', hashtags: ['#nexora'], createdAtMs: now - 10_000 },
    { id: 'new', authorId: 'u-follow', visibility: 'public', hashtags: ['#launch'], createdAtMs: now - 1_000 },
    { id: 'draft', authorId: 'u-me', isDraft: true, hashtags: ['#secret'], createdAtMs: now },
  ];

  const following = rankFeedPosts(posts, {
    viewerUid: 'u-me',
    followingIds: new Set(['u-follow']),
    blockedIds: new Set(),
    mutedIds: new Set(),
    tab: 'following',
    nowMs: now,
  });
  assert.deepEqual(following.map((r) => r.post.id), ['new', 'old']);

  const latest = rankFeedPosts(posts, {
    viewerUid: 'u-me',
    followingIds: new Set(['u-follow']),
    blockedIds: new Set(),
    mutedIds: new Set(),
    tab: 'latest',
    nowMs: now,
  });
  assert.deepEqual(latest.map((r) => r.post.id), ['new', 'mid', 'old']);

  const trending = computeTrendingTopics(posts, now, 5);
  assert.equal(trending.some((t) => t.tag === '#secret'), false);
  assert.equal(trending[0].tag, '#nexora');
  assert.equal(trending[1].tag, '#launch');
});
