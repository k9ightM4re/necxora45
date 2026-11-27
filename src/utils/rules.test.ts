import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPermission,
  sanitizeChannelName,
  validateServerName,
  castPollVote,
  calculatePollPercentage,
  filterDiscoveryServers,
} from './rules';
import { Role, Poll, Server } from '../types';

test('hasPermission returns true for administrator role regardless of individual flags', () => {
  const adminRole: Role = {
    id: 'r1',
    name: 'Admin',
    color: '#ff0000',
    permissions: {
      administrator: true,
      viewChannels: false,
      sendMessages: false,
      manageMessages: false,
      manageChannels: false,
      manageRoles: false,
      kickMembers: false,
      banMembers: false,
      connectVoice: false,
      speakVoice: false,
      manageEvents: false,
    },
  };

  assert.equal(hasPermission([adminRole], 'manageChannels'), true);
  assert.equal(hasPermission([adminRole], 'kickMembers'), true);
});

test('hasPermission handles non-admin roles with explicit permissions', () => {
  const modRole: Role = {
    id: 'r2',
    name: 'Moderator',
    color: '#00ff00',
    permissions: {
      administrator: false,
      viewChannels: true,
      sendMessages: true,
      manageMessages: true,
      manageChannels: false,
      manageRoles: false,
      kickMembers: true,
      banMembers: false,
      connectVoice: true,
      speakVoice: true,
      manageEvents: false,
    },
  };

  assert.equal(hasPermission([modRole], 'manageMessages'), true);
  assert.equal(hasPermission([modRole], 'banMembers'), false);
  assert.equal(hasPermission([], 'viewChannels'), false);
});

test('sanitizeChannelName formats channel names correctly', () => {
  assert.deepEqual(sanitizeChannelName('General Chat'), {
    valid: true,
    formatted: 'general-chat',
  });

  assert.deepEqual(sanitizeChannelName('🔥-announcements!'), {
    valid: true,
    formatted: '-announcements',
  });

  assert.equal(sanitizeChannelName('   ').valid, false);
});

test('validateServerName validates length boundaries', () => {
  assert.equal(validateServerName('A').valid, false);
  assert.equal(validateServerName('Apex Hub').valid, true);
  assert.equal(validateServerName('a'.repeat(51)).valid, false);
});

test('castPollVote and calculatePollPercentage calculate accurate voting states', () => {
  const initialPoll: Poll = {
    id: 'poll-1',
    question: 'Favorite stack?',
    options: [
      { id: 'opt-1', text: 'React + Vite', votes: 1, votedUserIds: ['user-a'] },
      { id: 'opt-2', text: 'Next.js', votes: 0, votedUserIds: [] },
    ],
    totalVotes: 1,
  };

  // User B votes for opt-2
  const updated1 = castPollVote(initialPoll, 'opt-2', 'user-b');
  assert.equal(updated1.totalVotes, 2);
  assert.equal(updated1.options[1].votes, 1);
  assert.equal(calculatePollPercentage(1, 2), 50);

  // User A switches vote to opt-2
  const updated2 = castPollVote(updated1, 'opt-2', 'user-a');
  assert.equal(updated2.totalVotes, 2);
  assert.equal(updated2.options[0].votes, 0);
  assert.equal(updated2.options[1].votes, 2);
  assert.equal(calculatePollPercentage(2, 2), 100);

  // User A retracts vote from opt-2
  const updated3 = castPollVote(updated2, 'opt-2', 'user-a');
  assert.equal(updated3.totalVotes, 1);
  assert.equal(updated3.options[1].votes, 1);
});

test('filterDiscoveryServers filters by category and search keywords', () => {
  const servers: Server[] = [
    {
      id: 's1',
      name: 'Cyber Gaming League',
      icon: '',
      description: 'Competitive e-sports & casual fun',
      category: 'Gaming',
      ownerId: 'u1',
      membersCount: 1200,
      defaultChannelId: 'c1',
      categories: [],
      roles: [],
      invites: [],
      tags: ['fps', 'valorant'],
    },
    {
      id: 's2',
      name: 'TypeScript Masters',
      icon: '',
      description: 'Web development and fullstack engineering',
      category: 'Technology',
      ownerId: 'u2',
      membersCount: 850,
      defaultChannelId: 'c2',
      categories: [],
      roles: [],
      invites: [],
      tags: ['coding', 'react'],
    },
  ];

  // Search by category
  const gamingServers = filterDiscoveryServers(servers, '', 'Gaming');
  assert.equal(gamingServers.length, 1);
  assert.equal(gamingServers[0].id, 's1');

  // Search by query
  const reactMatches = filterDiscoveryServers(servers, 'react', 'All');
  assert.equal(reactMatches.length, 1);
  assert.equal(reactMatches[0].id, 's2');
});
