import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_PILLARS,
  shouldShowWelcomeTour,
  calculateOnboardingProgress,
} from '../js/tour_utils.js';

test('PLATFORM_PILLARS covers all 6 core pillars of NEXORA', () => {
  assert.equal(PLATFORM_PILLARS.length, 6);
  const ids = PLATFORM_PILLARS.map((p) => p.id);
  assert.ok(ids.includes('reels'), 'Includes reels pillar');
  assert.ok(ids.includes('messages'), 'Includes messages pillar');
  assert.ok(ids.includes('communities'), 'Includes communities pillar');
  assert.ok(ids.includes('calls'), 'Includes calls pillar');
  assert.ok(ids.includes('stories'), 'Includes stories pillar');
  assert.ok(ids.includes('live'), 'Includes live pillar');

  for (const pillar of PLATFORM_PILLARS) {
    assert.ok(pillar.title.length > 5, `Pillar ${pillar.id} has descriptive title`);
    assert.ok(pillar.badge.length > 3, `Pillar ${pillar.id} has badge`);
    assert.ok(pillar.description.length > 15, `Pillar ${pillar.id} has clear description`);
    assert.ok(pillar.primaryAction.label.length > 3, `Pillar ${pillar.id} has actionable primary button`);
  }
});

test('shouldShowWelcomeTour parses localStorage state correctly', () => {
  assert.equal(shouldShowWelcomeTour(null), true);
  assert.equal(shouldShowWelcomeTour(''), true);
  assert.equal(shouldShowWelcomeTour('false'), true);
  assert.equal(shouldShowWelcomeTour('0'), true);
  assert.equal(shouldShowWelcomeTour('true'), false);
  assert.equal(shouldShowWelcomeTour('1'), false);
  assert.equal(shouldShowWelcomeTour('dismissed'), false);
});

test('calculateOnboardingProgress computes milestones accurately', () => {
  // Empty profile
  const p0 = calculateOnboardingProgress({
    profile: { avatar: '', bio: '' },
    postsCount: 0,
    storiesCount: 0,
    communitiesCount: 0,
  });
  assert.equal(p0.completedCount, 0);
  assert.equal(p0.percent, 0);
  assert.equal(p0.allCompleted, false);

  // Completed profile & content
  const p1 = calculateOnboardingProgress({
    profile: { avatar: 'https://example.com/a.jpg', bio: 'Building cool apps' },
    postsCount: 2,
    storiesCount: 0,
    communitiesCount: 0,
  });
  assert.equal(p1.completedCount, 2);
  assert.equal(p1.percent, 67);
  assert.equal(p1.allCompleted, false);

  // All completed
  const p2 = calculateOnboardingProgress({
    profile: { avatar: 'https://example.com/a.jpg', bio: 'Dev' },
    postsCount: 1,
    storiesCount: 1,
    communitiesCount: 3,
  });
  assert.equal(p2.completedCount, 3);
  assert.equal(p2.percent, 100);
  assert.equal(p2.allCompleted, true);
});
