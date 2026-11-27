import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractHashtags,
  extractMentions,
  formatCompactCount,
  formatFileSize,
  formatRelativeTime,
  filterActiveStories,
  generateMeetingCode,
  groupStoriesByUser,
  isAdminUser,
  normalizeThemePreference,
  rankTrendingHashtags,
  scoreSearchMatches,
} from '../js/social_utils.js';

test('extractHashtags and extractMentions deduplicate and normalize lowercase', () => {
  const tags = extractHashtags('Hello #Nexora #SocialNetwork #nexora #Tech2026!');
  assert.deepEqual(tags, ['#nexora', '#socialnetwork', '#tech2026']);

  const mentions = extractMentions('Shoutout @priya_dev and @rohit.k and @priya_dev!');
  assert.deepEqual(mentions, ['priya_dev', 'rohit.k']);
});

test('formatCompactCount formats thousands and millions cleanly', () => {
  assert.equal(formatCompactCount(0), '0');
  assert.equal(formatCompactCount(842), '842');
  assert.equal(formatCompactCount(12500), '12.5K');
  assert.equal(formatCompactCount(2000000), '2M');
});

test('formatRelativeTime returns readable intervals', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRelativeTime(now - 10_000, now), 'Just now');
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m ago');
  assert.equal(formatRelativeTime(now - 3 * 3600_000, now), '3h ago');
  assert.equal(formatRelativeTime(now - 2 * 86400_000, now), '2d ago');
});

test('rankTrendingHashtags counts tags across posts in descending order', () => {
  const posts = [
    { content: 'Launch #Nexora #Design', hashtags: ['#nexora', '#design'] },
    { content: 'Building on #Nexora', hashtags: ['#nexora'] },
    { content: 'Reels #Design #Reels', hashtags: ['#design', '#reels'] },
    { content: 'Hello #Nexora', hashtags: ['#nexora'] },
  ];
  const ranked = rankTrendingHashtags(posts, 3);
  assert.deepEqual(ranked, [
    { tag: '#nexora', count: 3 },
    { tag: '#design', count: 2 },
    { tag: '#reels', count: 1 },
  ]);
});

test('filterActiveStories excludes expired 24h stories and groupStoriesByUser prioritizes current user', () => {
  const now = 2_000_000_000_000;
  const stories = [
    { id: 's1', userId: 'u2', userName: 'User Two', expiresAtMs: now + 60_000, createdAtMs: now - 1000 },
    { id: 's2', userId: 'u3', userName: 'Expired', expiresAtMs: now - 1000, createdAtMs: now - 90_000_000 },
    { id: 's3', userId: 'u1', userName: 'Me', expiresAtMs: now + 120_000, createdAtMs: now - 5000 },
  ];
  const active = filterActiveStories(stories, now);
  assert.equal(active.length, 2);
  const grouped = groupStoriesByUser(stories, 'u1', now);
  assert.equal(grouped[0].userId, 'u1');
  assert.equal(grouped[1].userId, 'u2');
});

test('isAdminUser authorizes verified admin email or admin collection UID only', () => {
  assert.equal(isAdminUser({ uid: 'x', email: 'kj74647688@gmail.com', emailVerified: true }), true);
  assert.equal(isAdminUser({ uid: 'x', email: 'kj74647688@gmail.com', emailVerified: false }), false);
  assert.equal(isAdminUser({ uid: 'u99', email: 'other@example.com', emailVerified: true }, new Set(['u99'])), true);
  assert.equal(isAdminUser({ uid: 'u1', email: 'user@example.com', emailVerified: true }, new Set(['u99'])), false);
});

test('scoreSearchMatches filters across users, posts, reels, and communities', () => {
  const res = scoreSearchMatches('design', {
    users: [{ displayName: 'Maya', username: 'maya_design', bio: 'UI Studio' }],
    posts: [{ content: 'Sharing our #design system', authorName: 'Maya', hashtags: ['#design'] }],
    reels: [{ caption: 'Motion reel', authorName: 'Alex', audioTitle: 'Design Lo-Fi' }],
    communities: [{ name: 'Design Lab', category: 'Design', description: 'Critiques' }],
  });
  assert.equal(res.users.length, 1);
  assert.equal(res.posts.length, 1);
  assert.equal(res.reels.length, 1);
  assert.equal(res.communities.length, 1);
});

test('generateMeetingCode, normalizeThemePreference, and formatFileSize behave deterministically', () => {
  assert.match(generateMeetingCode(), /^NX-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeThemePreference('navy-dark'), 'dark');
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(formatFileSize(2048), '2 KB');
});
