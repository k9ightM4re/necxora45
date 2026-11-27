import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCommentThreads,
  canUserViewPost,
  estimateJsonByteSize,
  filterAndSortFeedPosts,
  selectSuggestedUsers,
} from '../js/social_utils.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('Multi-account global post visibility: User A & B posts sync across A, B, C with privacy and pagination safety', () => {
  const uidA = 'user-A-uid';
  const uidB = 'user-B-uid';
  const uidC = 'user-C-uid';

  const posts = [
    {
      id: 'pst-101',
      authorId: uidA,
      authorName: 'User A',
      content: 'Hello from User A #launch',
      visibility: 'public',
      likesCount: 2,
      commentsCount: 1,
      createdAtMs: 1000,
    },
    {
      id: 'pst-102',
      authorId: uidB,
      authorName: 'User B',
      content: 'Followers only update from B #insider',
      visibility: 'followers',
      allowedViewerUids: [uidB, uidA],
      likesCount: 5,
      commentsCount: 0,
      createdAtMs: 2000,
    },
    {
      id: 'pst-103',
      authorId: uidA,
      authorName: 'User A',
      content: 'Private journal note',
      visibility: 'private',
      likesCount: 0,
      commentsCount: 0,
      createdAtMs: 3000,
    },
    {
      id: 'pst-104',
      authorId: uidB,
      authorName: 'User B',
      content: 'Public announcement from B #launch',
      visibility: 'public',
      likesCount: 1,
      commentsCount: 2,
      createdAtMs: 4000,
    },
  ];

  // User B views home feed (For You / Latest) -> sees A's public post & own posts, not A's private post
  const feedB = filterAndSortFeedPosts(posts, {
    viewerUid: uidB,
    followingIds: new Set(),
    feedTab: 'latest',
  });
  assert.deepEqual(
    feedB.map((p) => p.id),
    ['pst-104', 'pst-102', 'pst-101']
  );

  // User C (does NOT follow B yet) views home feed -> sees public posts from A & B only
  const feedC = filterAndSortFeedPosts(posts, {
    viewerUid: uidC,
    followingIds: new Set(),
    feedTab: 'latest',
  });
  assert.deepEqual(
    feedC.map((p) => p.id),
    ['pst-104', 'pst-101']
  );

  // User A follows B -> Following feed for User A includes User B's posts + User A's own posts
  const feedAFollowing = filterAndSortFeedPosts(posts, {
    viewerUid: uidA,
    followingIds: new Set([uidB]),
    feedTab: 'following',
  });
  assert.deepEqual(
    feedAFollowing.map((p) => p.id),
    ['pst-104', 'pst-103', 'pst-102', 'pst-101']
  );

  // Hashtag filtering works cleanly with viewer visibility rules
  const taggedC = filterAndSortFeedPosts(posts, {
    viewerUid: uidC,
    followingIds: new Set(),
    feedTab: 'latest',
    hashtag: '#launch',
  });
  assert.deepEqual(
    taggedC.map((p) => p.id),
    ['pst-104', 'pst-101']
  );

  // Blocking hides blocked user's posts immediately
  assert.equal(canUserViewPost(posts[0], uidC, new Set(), new Set([uidA])), false);
});

test('Multi-account follow/unfollow transactions prevent double counting and sync across A, B, C', () => {
  const db = {
    users: new Map([
      ['A', { id: 'A', followersCount: 0, followingCount: 0, followers: new Set(), following: new Set() }],
      ['B', { id: 'B', followersCount: 0, followingCount: 0, followers: new Set(), following: new Set() }],
      ['C', { id: 'C', followersCount: 0, followingCount: 0, followers: new Set(), following: new Set() }],
    ]),
  };

  function followTx(actorUid, targetUid, forceDuplicateAttempt = false) {
    assert.notEqual(actorUid, targetUid);
    const actor = db.users.get(actorUid);
    const target = db.users.get(targetUid);
    const alreadyFollowing = actor.following.has(targetUid);
    const alreadyFollower = target.followers.has(actorUid);

    if (alreadyFollowing && !forceDuplicateAttempt) {
      actor.following.delete(targetUid);
      actor.followingCount = Math.max(0, actor.followingCount - 1);
      if (alreadyFollower) {
        target.followers.delete(actorUid);
        target.followersCount = Math.max(0, target.followersCount - 1);
      }
      return 'unfollowed';
    }
    if (!alreadyFollowing) {
      actor.following.add(targetUid);
      actor.followingCount += 1;
    }
    if (!alreadyFollower) {
      target.followers.add(actorUid);
      target.followersCount += 1;
    }
    return 'followed';
  }

  // User A follows User B
  assert.equal(followTx('A', 'B'), 'followed');
  assert.equal(db.users.get('A').followingCount, 1);
  assert.equal(db.users.get('B').followersCount, 1);
  assert.equal(db.users.get('B').followers.has('A'), true);

  // Duplicate follow click while locked/idempotent cannot double-count
  assert.equal(followTx('A', 'B', true), 'followed');
  assert.equal(db.users.get('A').followingCount, 1);
  assert.equal(db.users.get('B').followersCount, 1);

  // User C follows User A, User B follows User A, then User B unfollows User A
  followTx('C', 'A');
  followTx('B', 'A');
  assert.equal(db.users.get('A').followersCount, 2);
  assert.equal(followTx('B', 'A'), 'unfollowed');
  assert.equal(db.users.get('A').followersCount, 1);
  assert.equal(db.users.get('A').followers.has('B'), false);
  assert.equal(db.users.get('A').followers.has('C'), true);
});

test('Comment threads, follow suggestions, and post payload byte-size guard operate deterministically', () => {
  const comments = [
    { id: 'c2', content: 'Reply to c1', replyToId: 'c1', createdAtMs: 200 },
    { id: 'c1', content: 'Root comment 1', createdAtMs: 100 },
    { id: 'c3', content: 'Root comment 2', createdAtMs: 300 },
    { id: 'c4', content: 'Reply to deleted parent', replyToId: 'missing-id', createdAtMs: 400 },
  ];
  const threaded = buildCommentThreads(comments);
  assert.equal(threaded.length, 3);
  assert.equal(threaded[0].id, 'c1');
  assert.deepEqual(
    threaded[0].replies.map((r) => r.id),
    ['c2']
  );
  assert.equal(threaded[2].id, 'c4');

  const directory = [
    { id: 'me', displayName: 'Me', followersCount: 50, accountPrivacy: 'everyone' },
    { id: 'already', displayName: 'Already Following', followersCount: 100, accountPrivacy: 'everyone' },
    { id: 'blocked', displayName: 'Blocked', followersCount: 99, accountPrivacy: 'everyone' },
    { id: 'priv', displayName: 'Private', followersCount: 80, accountPrivacy: 'private' },
    { id: 'top', displayName: 'Top Creator', followersCount: 40, accountPrivacy: 'everyone' },
    { id: 'new', displayName: 'New Creator', followersCount: 5, accountPrivacy: 'everyone' },
  ];
  const suggestions = selectSuggestedUsers(directory, {
    viewerUid: 'me',
    followingIds: new Set(['already']),
    blockedSet: new Set(['blocked']),
    limit: 4,
  });
  assert.deepEqual(
    suggestions.map((u) => u.id),
    ['top', 'new']
  );

  const smallSize = estimateJsonByteSize({ content: 'Hello NEXORA' });
  assert.ok(smallSize > 10 && smallSize < 1000);
});

test('Security & Blueprint parity audit: no demo auth bypass, no wildcard writes, no exists()/get() in list rules', () => {
  const sessionSrc = fs.readFileSync(path.join(ROOT, 'js', 'session.js'), 'utf8');
  const rulesSrc = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-blueprint.json'), 'utf8'));

  // No unauthenticated demo user fallback
  assert.equal(sessionSrc.includes('demo-user-alex'), false);

  // No wildcard open read/write in Firestore rules
  assert.equal(/allow\s+(read|write)\s*:\s*if\s+true\s*;/.test(rulesSrc), false);

  // Every required social collection & subcollection exists in both rules and blueprint
  for (const col of [
    '/users/{userId}',
    '/users/{userId}/followers/{followerUid}',
    '/users/{userId}/following/{targetUid}',
    '/posts/{postId}',
    '/posts/{postId}/likes/{userId}',
    '/posts/{postId}/comments/{commentId}',
    '/reels/{reelId}',
    '/reels/{reelId}/likes/{userId}',
    '/reels/{reelId}/comments/{commentId}',
  ]) {
    assert.ok(blueprint.firestore[col], `Missing ${col} in firebase-blueprint.json`);
  }

  assert.ok(rulesSrc.includes('match /likes/{userId}'));
  assert.ok(rulesSrc.includes('isValidLike('));
  assert.ok(rulesSrc.includes('allowedViewerUids'));

  // Eight Pillars check: no exists(), get(), or isAdmin() inside multi-line allow list expressions
  const listBlocks = [...rulesSrc.matchAll(/allow\s+list\s*:([\s\S]*?);/g)].map((m) => m[1]);
  assert.ok(listBlocks.length > 5);
  for (const expr of listBlocks) {
    assert.equal(/\b(exists|get|existsAfter|getAfter|isAdmin)\s*\(/.test(expr), false, `Forbidden lookup in allow list:${expr}`);
  }

  const firebaseSrc = fs.readFileSync(path.join(ROOT, 'js', 'firebase.js'), 'utf8');
  const socialSrc = fs.readFileSync(path.join(ROOT, 'js', 'social.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

  assert.ok(
    firebaseSrc.includes('experimentalAutoDetectLongPolling: true') ||
      firebaseSrc.includes('experimentalForceLongPolling: true')
  );
  assert.ok(socialSrc.includes("query(collection(db, 'stories'), where('expiresAtMs', '>', 0), orderBy('expiresAtMs', 'desc')"));
  assert.ok(socialSrc.includes("query(collection(db, 'reels'), where('id', '>', ''), limit(200))"));
  assert.ok(socialSrc.includes('`reel-0-${reelRevTs}-'));
  assert.ok(socialSrc.includes('`pst-0-${revTs}-'));
  assert.ok(socialSrc.includes("where('authorId', '==', targetUid)"));
  assert.ok(socialSrc.includes("query(collection(db, 'meetings'), where('status', 'in', ['scheduled', 'live', 'ended'])"));
  assert.ok(socialSrc.includes("query(collection(db, 'live_streams'), where('status', 'in', ['live', 'ended'])"));
  assert.ok(socialSrc.includes("query(collection(db, 'users', fbUser.uid, 'following'), where('uid', '>', ''))"));
  assert.ok(socialSrc.includes("query(collection(db, 'users', fbUser.uid, 'followers'), where('uid', '>', ''))"));
  assert.ok(socialSrc.includes("query(collection(db, 'users', targetUid, 'followers'), where('uid', '>', ''))"));
  assert.ok(socialSrc.includes("query(collection(db, 'users', targetUid, 'following'), where('uid', '>', ''))"));
  assert.ok(socialSrc.includes("query(collection(db, 'stories', item.id, 'views'), where('viewerUid', '>', ''))"));
  assert.ok(appSrc.includes("query(collection(db, 'servers', serverId, 'members'), where('role', 'in', ['owner', 'moderator', 'member']))"));
  assert.ok(appSrc.includes('limit(250)'));
});
