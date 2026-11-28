import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getMessageDayKey,
  formatMessageDateLabel,
  shouldGroupMessages,
  getDmUnreadCount,
} from '../js/comms.js';

test('getMessageDayKey and formatMessageDateLabel produce consistent day keys and labels', () => {
  const now = new Date(2026, 10, 27, 15, 30, 0).getTime(); // Nov 27, 2026
  const todayMorning = new Date(2026, 10, 27, 9, 15, 0).getTime();
  const yesterdayEvening = new Date(2026, 10, 26, 21, 45, 0).getTime();
  const olderDate = new Date(2026, 10, 12, 11, 0, 0).getTime();

  assert.equal(getMessageDayKey(todayMorning), '2026-11-27');
  assert.equal(getMessageDayKey(yesterdayEvening), '2026-11-26');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(getMessageDayKey(null)));

  assert.equal(formatMessageDateLabel(todayMorning, now), 'Today');
  assert.equal(formatMessageDateLabel(yesterdayEvening, now), 'Yesterday');
  const formattedOlder = formatMessageDateLabel(olderDate, now);
  assert.ok(formattedOlder.includes('Nov') && formattedOlder.includes('12'));
});

test('shouldGroupMessages groups rapid same-author messages on the same day and breaks on replies, polls, or gaps', () => {
  const base = new Date(2026, 10, 27, 14, 0, 0).getTime();
  const m1 = { id: '1', authorId: 'u1', timestamp: base };
  const m2 = { id: '2', authorId: 'u1', timestamp: base + 90_000 }; // 1.5 min later
  const m3 = { id: '3', authorId: 'u1', timestamp: base + 6 * 60_000 }; // 6 min gap from m1
  const mOther = { id: '4', authorId: 'u2', timestamp: base + 120_000 };
  const mReply = { id: '5', authorId: 'u1', timestamp: base + 100_000, replyToId: 'x' };
  const mPoll = { id: '6', authorId: 'u1', timestamp: base + 110_000, poll: { question: 'Launch?' } };
  const mNextDay = { id: '7', authorId: 'u1', timestamp: new Date(2026, 10, 28, 0, 1, 0).getTime() };

  assert.equal(shouldGroupMessages(null, m1), false);
  assert.equal(shouldGroupMessages(m1, m2), true);
  assert.equal(shouldGroupMessages(m1, m3), false);
  assert.equal(shouldGroupMessages(m1, mOther), false);
  assert.equal(shouldGroupMessages(m1, mReply), false);
  assert.equal(shouldGroupMessages(m1, mPoll), false);
  assert.equal(shouldGroupMessages({ id: '8', authorId: 'u1', timestamp: new Date(2026, 10, 27, 23, 59, 30).getTime() }, mNextDay), false);
});

test('getDmUnreadCount computes accurate unread counts excluding self messages and respecting seenBy arrays', () => {
  const selfUid = 'me';
  const dm = {
    id: 'dm_1',
    lastSenderId: 'peer',
    seenBy: [],
  };
  const cached = [
    { id: 'a', authorId: 'peer', timestamp: 1500, seenBy: ['me'] }, // already seen
    { id: 'b', authorId: 'me', timestamp: 2500, seenBy: ['me'] },   // self
    { id: 'c', authorId: 'peer', timestamp: 3000, seenBy: [] },     // unread
    { id: 'd', authorId: 'peer', timestamp: 3500 },                 // unread
  ];

  assert.equal(getDmUnreadCount(dm, cached, selfUid), 2);
  assert.equal(getDmUnreadCount({ id: 'dm_2', lastSenderId: 'peer', seenBy: [] }, [], selfUid), 1);
  assert.equal(getDmUnreadCount({ id: 'dm_3', lastSenderId: 'peer', seenBy: ['me'] }, [], selfUid), 0);
  assert.equal(getDmUnreadCount({ id: 'dm_4', lastSenderId: 'me', seenBy: [] }, [], selfUid), 0);
  assert.equal(getDmUnreadCount(null, [], selfUid), 0);
});

test('3-zone Messaging UI exposes Zone A collapsed rail, Zone B React inbox panel, and Zone C thread tools', () => {
  const appHtml = fs.readFileSync(path.resolve(process.cwd(), 'app.html'), 'utf8');
  const appCss = fs.readFileSync(path.resolve(process.cwd(), 'css/app.css'), 'utf8');
  const socialCss = fs.readFileSync(path.resolve(process.cwd(), 'css/social.css'), 'utf8');
  const appJs = fs.readFileSync(path.resolve(process.cwd(), 'js/app.js'), 'utf8');
  const inboxActive = fs.readFileSync(path.resolve(process.cwd(), 'src/inbox/ActiveConversation.tsx'), 'utf8');

  // Zone A: Icon navigation rail + Messages + bottom profile avatar + tooltips
  assert.ok(appHtml.includes('data-nx-nav="messages"'));
  assert.ok(!appHtml.includes('data-nx-nav="ai-agents"'), 'Removed AI bot navigation must stay absent');
  assert.ok(appHtml.includes('id="nx-rail-user-btn"'));
  assert.ok(appHtml.includes('data-tooltip="Messages"'));
  assert.ok(socialCss.includes('.nx-left-nav.collapsed'));
  assert.ok(socialCss.includes('width: 72px'));
  assert.ok(socialCss.includes('[data-tooltip]:hover::after'));

  // Zone B & C: React 3-zone inbox mount, legacy fallback CSS, search clear, mute/delete/group management
  assert.ok(appHtml.includes('id="nx-inbox-react-root"'));
  assert.ok(appCss.includes('.nx-legacy-workspace[data-workspace-mode="messages"] .server-rail'));
  assert.ok(appCss.includes('.nx-legacy-workspace[data-workspace-mode="messages"] .user-dock'));
  assert.ok(appCss.includes('width: 340px'));
  assert.ok(appJs.includes('id="dm-search-clear-btn"'));
  assert.ok(appJs.includes('data-dm-tab="all"'));
  assert.ok(appJs.includes('data-dm-tab="unread"'));
  assert.ok(appJs.includes('data-dm-tab="requests"'));
  assert.ok(inboxActive.includes('toggleMuteDm'));
  assert.ok(inboxActive.includes('deleteThreadForMe'));
  assert.ok(inboxActive.includes('manageGroupMembers'));

  // Zone C: Thread search clear/toggle, date separators, skeletons, composer focus/sending/disabled
  assert.ok(appHtml.includes('id="msg-search-wrap"'));
  assert.ok(appHtml.includes('id="msg-search-clear-btn"'));
  assert.ok(appHtml.includes('id="msg-search-toggle-btn"'));
  assert.ok(appJs.includes('nx-msg-date-sep'));
  assert.ok(appJs.includes('nx-dm-skeleton-list'));
  assert.ok(appCss.includes('.nx-legacy-workspace[data-workspace-mode="messages"] .composer-box:focus-within'));
  assert.ok(appCss.includes('.composer-send.is-sending'));
  assert.ok(appCss.includes('[data-theme="light"] .nx-dm-bubble.is-peer'));
});
