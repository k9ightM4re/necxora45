/**
 * NEXORA Platform Onboarding & Quick Launch Tour Utilities.
 * Pure logic for tour state, feature pillar metadata, and onboarding milestone progress.
 */

export const PLATFORM_PILLARS = [
  {
    id: 'reels',
    badge: 'CREATOR STUDIO',
    title: 'Short Vertical Reels & YouTube',
    description: 'Create vertical short videos with soundtrack beats, draggable text stickers & 1-click export to YouTube Shorts.',
    icon: 'reels',
    gradient: 'linear-gradient(135deg, #EC4899, #8B5CF6)',
    primaryAction: { label: 'Open Reel Studio', act: 'open-upload-reel' },
    secondaryAction: { label: 'Watch Reels', nav: 'reels' },
  },
  {
    id: 'messages',
    badge: 'REAL-TIME CHAT',
    title: 'Direct & Group Messages',
    description: 'Instant 1-on-1 chats and group rooms with audio voice notes, photo sharing, typing indicators & read receipts.',
    icon: 'chat',
    gradient: 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
    primaryAction: { label: 'Open Messages', nav: 'messages' },
    secondaryAction: { label: 'All Chats', nav: 'messages' },
  },
  {
    id: 'communities',
    badge: 'DISCORD-STYLE SPACES',
    title: 'Communities & Voice Stages',
    description: 'Join topic servers with dedicated text channels, drop-in voice lounges, moderation roles & invite links.',
    icon: 'users',
    gradient: 'linear-gradient(135deg, #6366F1, #06B6D4)',
    primaryAction: { label: 'Browse Spaces', nav: 'communities' },
    secondaryAction: { label: '+ Create Space', act: 'open-create-community' },
  },
  {
    id: 'calls',
    badge: 'HD VIDEO MEETINGS',
    title: 'Instant Video Meetings & Screen Share',
    description: 'Start or join Zoom-quality HD video calls with camera switch, mic mute, screen sharing & easy room codes.',
    icon: 'video',
    gradient: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
    primaryAction: { label: 'Start Instant Meeting', act: 'start-instant-meeting' },
    secondaryAction: { label: 'All Meetings', nav: 'calls' },
  },
  {
    id: 'stories',
    badge: 'STORIES & FEED',
    title: 'Social Feed & 24h Stories',
    description: 'Post photo updates, thoughts & feelings with custom emojis. Share disappearing 24-hour stories with viewer counts.',
    icon: 'camera',
    gradient: 'linear-gradient(135deg, #F59E0B, #EC4899)',
    primaryAction: { label: 'Post 24h Story', act: 'open-create-story' },
    secondaryAction: { label: 'Write a Post', act: 'focus-composer' },
  },
  {
    id: 'live',
    badge: 'BROADCAST LIVE',
    title: 'Go Live Studio',
    description: 'Broadcast your webcam or screen live to all NEXORA members with real-time viewer count & live chat.',
    icon: 'radio',
    gradient: 'linear-gradient(135deg, #EF4444, #F59E0B)',
    primaryAction: { label: 'Go Live Studio', nav: 'live' },
    secondaryAction: { label: 'Browse Streams', nav: 'live' },
  },
];

export function shouldShowWelcomeTour(dismissedVal) {
  if (!dismissedVal) return true;
  if (dismissedVal === 'true' || dismissedVal === '1' || dismissedVal === 'dismissed') return false;
  return true;
}

export function calculateOnboardingProgress({ profile = {}, postsCount = 0, storiesCount = 0, communitiesCount = 0 } = {}) {
  const hasAvatar = Boolean(profile.avatar && profile.avatar.length > 5);
  const hasBio = Boolean(profile.bio && profile.bio.trim().length > 0);
  const profileComplete = hasAvatar || hasBio;

  const sharedContent = (postsCount > 0) || (storiesCount > 0);
  const connectedSocial = (communitiesCount > 0) || Boolean(profile.followingCount && profile.followingCount > 0);

  const steps = [
    {
      id: 'profile',
      label: 'Personalize your profile avatar & bio',
      completed: profileComplete,
      action: { nav: 'profile' },
    },
    {
      id: 'content',
      label: 'Share your first story or thought',
      completed: sharedContent,
      action: { act: 'open-create-story' },
    },
    {
      id: 'connect',
      label: 'Join a community or send a message',
      completed: connectedSocial,
      action: { nav: 'communities' },
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const percent = Math.round((completedCount / totalCount) * 100);

  return {
    steps,
    completedCount,
    totalCount,
    percent,
    allCompleted: completedCount === totalCount,
  };
}
