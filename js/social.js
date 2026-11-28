import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase.js';
import { formatFriendlyError } from './notifications.js';
import {
  getInitials,
  renderUserAvatarHtml,
  updateUserProfile,
} from './profile.js';
import {
  changeAccountEmail,
  changeAccountPassword,
  deactivateCurrentAccount,
  deleteCurrentAccount,
  signOutSession,
} from './session.js';
import { apiV1Fetch } from './api_v1.js';
import {
  buildCommentThreads,
  canUserViewPost,
  compressImageFile,
  estimateJsonByteSize,
  extractHashtags,
  extractMentions,
  filterActiveStories,
  filterAndSortFeedPosts,
  formatCompactCount,
  formatRelativeTime,
  generateMeetingCode,
  groupStoriesByUser,
  isAdminUser,
  normalizeThemePreference,
  rankTrendingHashtags,
  readMediaFileBounded,
  sanitizeSafeUrl,
  scoreSearchMatches,
  selectSuggestedUsers,
  uploadMediaFileToServer,
} from './social_utils.js';
import { svgIcon } from './icons.js';
import { getRoomCallId } from './comms.js';
import {
  PHOTO_TEMPLATES,
  REEL_FILTERS,
  REEL_SOUNDTRACKS,
  REEL_TEXT_COLORS,
  REEL_VIDEO_TEMPLATES,
  ReelAudioEngine,
  SNAP_LENS_STICKERS,
  blobToBoundedDataUrl,
  exportEditedReelForYouTube,
  getReelFilterCss,
  getReelTemplateMeta,
  getReelTextStyleMeta,
  getSoundtrackMeta,
  getYouTubeEmbedUrl,
  getYouTubeThumbUrl,
  parseYouTubeVideoId,
  renderPhotoTemplateToDataUrl,
  sanitizeReelTextOverlays,
} from './reel_studio.js';
import {
  PLATFORM_PILLARS,
  shouldShowWelcomeTour,
  calculateOnboardingProgress,
} from './tour_utils.js';
import { createTemplateStudioModule } from './template_studio.js';
import { createSocialCircleUi } from './social_circle_ui.js';

const REACT_PLATFORM_VIEWS = new Set([
  'marketplace',
  'visual-search',
  'studio',
  'camera',
  'features',
  'admin-feature-health',
]);

const SOCIAL_VIEWS = new Set([
  'home',
  'explore',
  'nearby',
  'reels',
  'templates',
  'social-circle',
  'calls',
  'notifications',
  'profile',
  'saved',
  'settings',
  'live',
  'admin',
]);

const FEED_PAGE_SIZE = 10;

export function createSocialModule(ctx) {
  const {
    state,
    profile,
    prefs,
    directoryMap,
    ensureUsersInDirectory = async () => false,
    rtc,
    showToast,
    escapeHtml,
    openModal,
    closeAllModals,
    openPopoverNear,
    closePopover,
    navigateToLegacyMode,
    openDirectMessageWithUser,
    startDmCallWithUser,
    applyPrefsToDom,
    savePrefs,
    getRtcState,
  } = ctx;

  const socialCircleUi = createSocialCircleUi({ auth, showToast, escapeHtml });

  let currentUser = null;
  let currentSection = 'home';
  let feedTab = 'for-you';
  let activeHashtagFilter = '';
  let feedLimit = FEED_PAGE_SIZE;
  let publicPostsLimit = 200;
  let hasMoreServerPosts = false;
  let postsLoading = true;
  let postsError = '';
  let highlightedPostId = '';
  let exploreTab = 'all';
  let exploreQuery = '';
  let savedTab = 'all';
  let notifFilter = 'all';
  let settingsTab = 'account';
  let adminTab = 'overview';
  let profileTargetUid = '';
  let profileTab = 'posts';
  let profileEditing = false;
  let confirmDeleteOpen = false;
  let nearbyCoords = null; // { lat, lon }
  let nearbyRadiusKm = 10;
  let nearbyPausedUntilMs = 0;
  let nearbyPeople = [];
  let nearbyEvents = [];
  let nearbyLoading = false;
  let nearbyError = '';
  let exploreProducts = [];
  let searchHistoryItems = [];
  const hiddenPostIds = new Set();
  const mutedAuthorIds = new Set();
  let serverFeedRankedIds = [];
  let serverFeedCursor = null;
  let pendingFollowRequests = [];
  let viewedProfileMutuals = [];
  let viewedProfilePendingReq = false;

  // Composer transient state
  let composerText = '';
  let composerMedia = []; // { type: 'image' | 'video', url: string }
  let composerFeeling = '';
  let composerLocation = '';
  let composerVisibility = 'public';
  let composerProductTags = '';
  let editingPostId = null;

  // Comments & viewers
  const expandedPostIds = new Set();
  const postCommentsMap = new Map();
  const unsubPostComments = new Map();
  const replyingToCommentMap = new Map();
  const editingCommentMap = new Map();

  // Reels & Reel Studio state
  let activeReelIndex = 0;
  let reelMuted = false;
  let lastFeedReelKey = '';
  const reelCommentsMap = new Map();
  const unsubReelComments = new Map();
  const studioAudioEngine = new ReelAudioEngine();
  const feedAudioEngine = new ReelAudioEngine();

  function createInitialReelStudioState() {
    return {
      activeTab: 'source',
      sourceType: 'video',
      youtubeId: '',
      videoUrl: '',
      blobObjectUrl: '',
      videoDataUrl: '',
      audioTrackId: 'original',
      audioDataUrl: '',
      audioTitle: '',
      musicVolume: 0.75,
      videoVolume: 0.5,
    filterName: 'none',
    playbackSpeed: 1,
    templateId: '',
    backdropColors: ['#101124', '#4C1D95', '#286BFF'],
    textOverlays: [],
    selectedTextId: '',
    previewMuted: false,
    lastExportedBlobUrl: '',
    exportBusy: false,
  };
}
let reelStudio = createInitialReelStudioState();

let photoStudio = {
  imageDataUrl: '',
  templateId: 'polaroid-frame',
  filterId: 'clarendon',
  stickerText: '',
  headline: '',
  subline: '',
  renderedDataUrl: '',
};
let pendingStoryStudioDataUrl = '';

  // Live & Meetings chat
  let activeMeetingId = '';
  let meetingChatList = [];
  let unsubMeetingChat = null;

  let activeLiveStreamId = '';
  let liveChatList = [];
  let unsubLiveChat = null;

  // Story viewer state
  let storyGroups = [];
  let activeStoryGroupIdx = 0;
  let activeStoryItemIdx = 0;
  let storyProgressTimer = null;
  let storyProgressPct = 0;
  let storyViewsList = [];
  let unsubStoryViews = null;

  // Real-time data collections
  const publicPostsMap = new Map();
  const followersPostsMap = new Map();
  const ownPostsMap = new Map();
  const viewedProfilePostsMap = new Map();
  let posts = [];
  let stories = [];
  let reels = [];
  let meetings = [];
  let liveStreams = [];
  let myFollowingIds = new Set();
  let myFollowersIds = new Set();
  let myFollowersSynced = false;
  let viewedProfileFollowers = [];
  let viewedProfileFollowing = [];
  let viewedFollowersLoaded = false;
  let viewedFollowingLoaded = false;
  let viewedProfileDoc = null;
  let viewedProfileLoaded = false;
  let adminUidSet = new Set();
  let isCurrentUserAdmin = false;

  // Concurrency locks & real-time like state
  const pendingFollowUids = new Set();
  const pendingLikePostIds = new Set();
  const pendingLikeReelIds = new Set();

  // Unsubs
  let unsubPublicPosts = null;
  let unsubFollowersPosts = null;
  let unsubOwnPosts = null;
  let unsubStories = null;
  let unsubReels = null;
  let unsubMeetings = null;
  let unsubLiveStreams = null;
  let unsubMyFollowing = null;
  let unsubMyFollowers = null;
  let unsubViewedProfile = null;
  let unsubViewedFollowers = null;
  let unsubViewedFollowing = null;
  let unsubViewedPosts = null;

  let boundDomEvents = false;

  function tsMillis(createdAt, fallback = 0) {
    if (createdAt && typeof createdAt.toMillis === 'function') return createdAt.toMillis();
    if (typeof createdAt === 'number') return createdAt;
    return fallback;
  }

  function resolveUserDisplay(uid, fallback = {}) {
    if (uid === profile.id) return profile;
    const found = directoryMap.get(uid);
    if (found) return found;
    return {
      id: uid,
      displayName: fallback.displayName || 'Member',
      username: fallback.username || 'member',
      initials: fallback.initials || getInitials(fallback.displayName || 'MB'),
      avatar: fallback.avatar || '',
      coverPhoto: fallback.coverPhoto || '',
      bio: fallback.bio || '',
      status: fallback.status || 'offline',
      verified: Boolean(fallback.verified),
    };
  }

  async function sendUserNotification(targetUid, { category = 'social', targetId = '', title, body }) {
    if (!currentUser || !targetUid || targetUid === currentUser.uid) return;
    const notifId = `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'users', targetUid, 'notifications', notifId), {
        id: notifId,
        senderId: currentUser.uid,
        category: String(category).slice(0, 32),
        targetId: String(targetId).slice(0, 128),
        title: String(title || 'NEXORA Update').slice(0, 120),
        body: String(body || '').slice(0, 300),
        unread: true,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal notification sync failure
    }
  }

  function mergePosts() {
    const merged = new Map([
      ...publicPostsMap,
      ...followersPostsMap,
      ...ownPostsMap,
      ...viewedProfilePostsMap,
    ]);
    posts = Array.from(merged.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  function mapPostDoc(docSnap) {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      ...d,
      createdAtMs: tsMillis(d.createdAt, Date.now()),
      likesUids: Array.isArray(d.likesUids) ? d.likesUids : [],
      mediaItems: Array.isArray(d.mediaItems) ? d.mediaItems : [],
      hashtags: Array.isArray(d.hashtags) ? d.hashtags : extractHashtags(d.content || ''),
      likesCount: Number(d.likesCount ?? (Array.isArray(d.likesUids) ? d.likesUids.length : 0)),
      commentsCount: Number(d.commentsCount || 0),
      sharesCount: Number(d.sharesCount || 0),
    };
  }

  function hydrateAuthorsAsync(items, field = 'authorId') {
    const uids = items.map((item) => item?.[field]).filter(Boolean);
    if (uids.length === 0) return;
    ensureUsersInDirectory(uids)
      .then((updated) => {
        if (updated) renderIfSocial();
      })
      .catch(() => {});
  }

  function syncFollowersPostsAudience() {
    if (!currentUser || !myFollowersSynced) return;
    const desired = Array.from(new Set([currentUser.uid, ...myFollowersIds])).slice(0, 500);
    const desiredSet = new Set(desired);
    for (const post of ownPostsMap.values()) {
      if (!post || post.authorId !== currentUser.uid || post.visibility !== 'followers') continue;
      const existing = Array.isArray(post.allowedViewerUids) ? post.allowedViewerUids : [];
      const existingSet = new Set(existing);
      const isEqual =
        existingSet.size === desiredSet.size &&
        desired.every((uid) => existingSet.has(uid));
      if (!isEqual) {
        updateDoc(doc(db, 'posts', post.id), {
          allowedViewerUids: desired,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }
  }

  function subscribePublicPosts() {
    if (unsubPublicPosts) {
      unsubPublicPosts();
      unsubPublicPosts = null;
    }
    if (!currentUser) return;

    unsubPublicPosts = onSnapshot(
      query(collection(db, 'posts'), where('visibility', '==', 'public'), limit(publicPostsLimit)),
      (snap) => {
        postsLoading = false;
        postsError = '';
        hasMoreServerPosts = snap.size >= publicPostsLimit;
        publicPostsMap.clear();
        snap.forEach((docSnap) => publicPostsMap.set(docSnap.id, mapPostDoc(docSnap)));
        mergePosts();
        hydrateAuthorsAsync(Array.from(publicPostsMap.values()), 'authorId');
        renderIfSocial();
      },
      (err) => {
        postsLoading = false;
        postsError = handleFirestoreError(err, OperationType.LIST, 'posts', {
          silent: true,
          fallback: 'Unable to sync public posts right now.',
        });
        renderIfSocial();
      }
    );
  }

  function subscribeFollowersPosts(uid) {
    if (unsubFollowersPosts) {
      unsubFollowersPosts();
      unsubFollowersPosts = null;
    }
    if (!uid) return;

    unsubFollowersPosts = onSnapshot(
      query(
        collection(db, 'posts'),
        where('visibility', '==', 'followers'),
        where('allowedViewerUids', 'array-contains', uid),
        limit(100)
      ),
      (snap) => {
        followersPostsMap.clear();
        snap.forEach((docSnap) => followersPostsMap.set(docSnap.id, mapPostDoc(docSnap)));
        mergePosts();
        hydrateAuthorsAsync(Array.from(followersPostsMap.values()), 'authorId');
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'posts', { silent: true });
      }
    );
  }

  function subscribeOwnPosts(uid) {
    if (unsubOwnPosts) {
      unsubOwnPosts();
      unsubOwnPosts = null;
    }
    if (!uid) return;

    unsubOwnPosts = onSnapshot(
      query(collection(db, 'posts'), where('authorId', '==', uid), limit(100)),
      (snap) => {
        ownPostsMap.clear();
        snap.forEach((docSnap) => ownPostsMap.set(docSnap.id, mapPostDoc(docSnap)));
        mergePosts();
        syncFollowersPostsAudience();
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'posts', { silent: true });
      }
    );
  }

  function subscribeAll(fbUser) {
    cleanup();
    currentUser = fbUser;
    if (!fbUser) return;

    profileTargetUid = fbUser.uid;
    postsLoading = true;
    postsError = '';
    if (['for-you', 'following', 'latest'].includes(prefs.feedDefaultTab)) {
      feedTab = prefs.feedDefaultTab;
    }
    if (['public', 'followers', 'private'].includes(prefs.defaultVisibility)) {
      composerVisibility = prefs.defaultVisibility;
    }

    if (typeof window !== 'undefined' && window.location.hash?.startsWith('#post-')) {
      highlightedPostId = window.location.hash.slice('#post-'.length);
    }

    // Admin detection
    if (fbUser.isNexoraAccount) {
      postsLoading = false;
      postsError = '';
      isCurrentUserAdmin = false;
      updateAdminNavVisibility();
      void refreshFollowRequests();
      void refreshSearchHistory();
      void refreshServerFeed(false);
      templateStudio.subscribeAll(fbUser);
      if (typeof window !== 'undefined' && window.location.hash?.startsWith('#template')) {
        templateStudio.handleDeepLink(window.location.hash);
      }
      renderIfSocial();
      return;
    }

    isCurrentUserAdmin = isAdminUser(fbUser, adminUidSet);
    updateAdminNavVisibility();
    getDoc(doc(db, 'admins', fbUser.uid))
      .then((snap) => {
        if (snap.exists()) {
          adminUidSet.add(fbUser.uid);
        }
        isCurrentUserAdmin = isAdminUser(fbUser, adminUidSet);
        updateAdminNavVisibility();
      })
      .catch(() => {});

    subscribePublicPosts();
    subscribeFollowersPosts(fbUser.uid);
    subscribeOwnPosts(fbUser.uid);

    unsubStories = onSnapshot(
      query(collection(db, 'stories'), where('expiresAtMs', '>', 0), orderBy('expiresAtMs', 'desc'), limit(80)),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            ...data,
            createdAtMs: tsMillis(data.createdAt, Number(data.expiresAtMs || 0) - 86400000),
          });
        });
        stories = filterActiveStories(list);
        storyGroups = groupStoriesByUser(stories, fbUser.uid);
        hydrateAuthorsAsync(stories, 'userId');
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'stories', { silent: true });
      }
    );

    unsubReels = onSnapshot(
      query(collection(db, 'reels'), where('id', '>', ''), limit(200)),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            ...data,
            createdAtMs: tsMillis(data.createdAt, Date.now()),
            likesUids: Array.isArray(data.likesUids) ? data.likesUids : [],
            hashtags: Array.isArray(data.hashtags) ? data.hashtags : extractHashtags(data.caption || ''),
          });
        });
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        reels = list;
        if (activeReelIndex >= reels.length) activeReelIndex = Math.max(0, reels.length - 1);
        hydrateAuthorsAsync(reels, 'authorId');
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'reels', { silent: true });
      }
    );

    unsubMeetings = onSnapshot(
      query(collection(db, 'meetings'), where('status', 'in', ['scheduled', 'live', 'ended']), limit(50)),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            ...data,
            createdAtMs: tsMillis(data.createdAt, Date.now()),
          });
        });
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        meetings = list;
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'meetings', { silent: true });
      }
    );

    unsubLiveStreams = onSnapshot(
      query(collection(db, 'live_streams'), where('status', 'in', ['live', 'ended']), limit(35)),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            ...data,
            startedAtMs: tsMillis(data.startedAt, Date.now()),
          });
        });
        list.sort((a, b) => b.startedAtMs - a.startedAtMs);
        liveStreams = list;
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'live_streams', { silent: true });
      }
    );

    unsubMyFollowing = onSnapshot(
      query(collection(db, 'users', fbUser.uid, 'following'), where('uid', '>', '')),
      (snap) => {
        const set = new Set();
        snap.forEach((d) => set.add(d.id));
        myFollowingIds = set;
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `users/${fbUser.uid}/following`, { silent: true });
      }
    );

    unsubMyFollowers = onSnapshot(
      query(collection(db, 'users', fbUser.uid, 'followers'), where('uid', '>', '')),
      (snap) => {
        const set = new Set();
        snap.forEach((d) => set.add(d.id));
        myFollowersIds = set;
        myFollowersSynced = true;
        syncFollowersPostsAudience();
        renderIfSocial();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `users/${fbUser.uid}/followers`, { silent: true });
      }
    );

    subscribeViewedProfileEdges(fbUser.uid);
    void refreshFollowRequests();
    void refreshSearchHistory();
    void refreshServerFeed(false);
    templateStudio.subscribeAll(fbUser);
    if (typeof window !== 'undefined' && window.location.hash?.startsWith('#template')) {
      templateStudio.handleDeepLink(window.location.hash);
    }
  }

  function subscribeViewedProfileEdges(targetUid) {
    if (unsubViewedProfile) {
      unsubViewedProfile();
      unsubViewedProfile = null;
    }
    if (unsubViewedFollowers) {
      unsubViewedFollowers();
      unsubViewedFollowers = null;
    }
    if (unsubViewedFollowing) {
      unsubViewedFollowing();
      unsubViewedFollowing = null;
    }
    if (unsubViewedPosts) {
      unsubViewedPosts();
      unsubViewedPosts = null;
    }
    viewedProfilePostsMap.clear();
    viewedProfileFollowers = [];
    viewedProfileFollowing = [];
    viewedFollowersLoaded = false;
    viewedFollowingLoaded = false;
    viewedProfileDoc = null;
    viewedProfileLoaded = false;
    mergePosts();
    if (!targetUid) return;

    if (currentUser?.isNexoraAccount) {
      viewedProfileLoaded = true;
      viewedFollowersLoaded = true;
      viewedFollowingLoaded = true;
      if (targetUid === profile.id) {
        viewedProfileDoc = { ...profile };
      }
      apiV1Fetch(`/users/${encodeURIComponent(targetUid)}/mutuals`)
        .then((res) => {
          viewedProfileMutuals = Array.isArray(res?.mutuals) ? res.mutuals : [];
          if (currentSection === 'profile') render();
        })
        .catch(() => {
          viewedProfileMutuals = [];
        });
      if (targetUid !== currentUser.uid) {
        apiV1Fetch(`/users/${encodeURIComponent(targetUid)}`)
          .then((res) => {
            if (res?.user) {
              viewedProfileDoc = res.user;
              directoryMap.set(targetUid, res.user);
            }
            viewedProfilePendingReq = Boolean(res?.user?.hasPendingFollowRequest);
            if (currentSection === 'profile') render();
          })
          .catch(() => {
            viewedProfilePendingReq = false;
          });
      } else {
        viewedProfilePendingReq = false;
        void refreshFollowRequests();
      }
      if (currentSection === 'profile') render();
      return;
    }

    unsubViewedProfile = onSnapshot(
      doc(db, 'users', targetUid),
      (snap) => {
        viewedProfileLoaded = true;
        if (snap.exists()) {
          const d = snap.data();
          const normalized = {
            id: snap.id,
            displayName: d.displayName || 'Member',
            username: d.username || 'member',
            initials: d.initials || getInitials(d.displayName || 'MB'),
            avatar: d.avatar || '',
            coverPhoto: d.coverPhoto || '',
            bio: d.bio || '',
            status: d.status || 'offline',
            customStatus: d.customStatus || '',
            accountPrivacy: d.accountPrivacy || 'everyone',
            verified: Boolean(d.verified),
            suspended: Boolean(d.suspended),
            followersCount: Math.max(0, Number(d.followersCount || 0)),
            followingCount: Math.max(0, Number(d.followingCount || 0)),
            postsCount: Math.max(0, Number(d.postsCount || 0)),
            roleId: snap.id === profile.id ? 'role-owner' : 'role-member',
          };
          viewedProfileDoc = normalized;
          directoryMap.set(snap.id, normalized);
          if (snap.id === profile.id) {
            Object.assign(profile, normalized);
          }
        }
        if (currentSection === 'profile') render();
      },
      (err) => {
        viewedProfileLoaded = true;
        handleFirestoreError(err, OperationType.GET, `users/${targetUid}`, { silent: true });
      }
    );

    if (currentUser && targetUid !== currentUser.uid) {
      unsubViewedPosts = onSnapshot(
        query(
          collection(db, 'posts'),
          where('authorId', '==', targetUid),
          where('visibility', '==', 'public'),
          limit(100)
        ),
        (snap) => {
          viewedProfilePostsMap.clear();
          snap.forEach((docSnap) => viewedProfilePostsMap.set(docSnap.id, mapPostDoc(docSnap)));
          mergePosts();
          hydrateAuthorsAsync(Array.from(viewedProfilePostsMap.values()), 'authorId');
          if (currentSection === 'profile') render();
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'posts', { silent: true });
        }
      );
    }

    unsubViewedFollowers = onSnapshot(
      query(collection(db, 'users', targetUid, 'followers'), where('uid', '>', '')),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        viewedProfileFollowers = list;
        viewedFollowersLoaded = true;
        hydrateAuthorsAsync(list.map((f) => ({ authorId: f.uid || f.id })), 'authorId');
        if (currentSection === 'profile') render();
      },
      (err) => {
        viewedFollowersLoaded = true;
        handleFirestoreError(err, OperationType.LIST, `users/${targetUid}/followers`, { silent: true });
      }
    );

    unsubViewedFollowing = onSnapshot(
      query(collection(db, 'users', targetUid, 'following'), where('uid', '>', '')),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        viewedProfileFollowing = list;
        viewedFollowingLoaded = true;
        hydrateAuthorsAsync(list.map((f) => ({ authorId: f.uid || f.id })), 'authorId');
        if (currentSection === 'profile') render();
      },
      (err) => {
        viewedFollowingLoaded = true;
        handleFirestoreError(err, OperationType.LIST, `users/${targetUid}/following`, { silent: true });
      }
    );

    if (currentUser) {
      apiV1Fetch(`/users/${encodeURIComponent(targetUid)}/mutuals`)
        .then((res) => {
          viewedProfileMutuals = Array.isArray(res?.mutuals) ? res.mutuals : [];
          if (currentSection === 'profile') render();
        })
        .catch(() => {
          viewedProfileMutuals = [];
        });
      if (targetUid !== currentUser.uid) {
        apiV1Fetch(`/users/${encodeURIComponent(targetUid)}`)
          .then((res) => {
            viewedProfilePendingReq = Boolean(res?.user?.hasPendingFollowRequest);
            if (currentSection === 'profile') render();
          })
          .catch(() => {
            viewedProfilePendingReq = false;
          });
      } else {
        viewedProfilePendingReq = false;
        void refreshFollowRequests();
      }
    }
  }

  function cleanup() {
    if (unsubPublicPosts) { unsubPublicPosts(); unsubPublicPosts = null; }
    if (unsubFollowersPosts) { unsubFollowersPosts(); unsubFollowersPosts = null; }
    if (unsubOwnPosts) { unsubOwnPosts(); unsubOwnPosts = null; }
    if (unsubStories) { unsubStories(); unsubStories = null; }
    if (unsubReels) { unsubReels(); unsubReels = null; }
    if (unsubMeetings) { unsubMeetings(); unsubMeetings = null; }
    if (unsubLiveStreams) { unsubLiveStreams(); unsubLiveStreams = null; }
    if (unsubMyFollowing) { unsubMyFollowing(); unsubMyFollowing = null; }
    if (unsubMyFollowers) { unsubMyFollowers(); unsubMyFollowers = null; }
    if (unsubViewedProfile) { unsubViewedProfile(); unsubViewedProfile = null; }
    if (unsubViewedFollowers) { unsubViewedFollowers(); unsubViewedFollowers = null; }
    if (unsubViewedFollowing) { unsubViewedFollowing(); unsubViewedFollowing = null; }
    if (unsubViewedPosts) { unsubViewedPosts(); unsubViewedPosts = null; }
    if (unsubMeetingChat) { unsubMeetingChat(); unsubMeetingChat = null; }
    if (unsubLiveChat) { unsubLiveChat(); unsubLiveChat = null; }
    if (unsubStoryViews) { unsubStoryViews(); unsubStoryViews = null; }
    for (const u of unsubPostComments.values()) u();
    unsubPostComments.clear();
    postCommentsMap.clear();
    expandedPostIds.clear();
    for (const u of unsubReelComments.values()) u();
    unsubReelComments.clear();
    reelCommentsMap.clear();
    publicPostsMap.clear();
    followersPostsMap.clear();
    ownPostsMap.clear();
    viewedProfilePostsMap.clear();
    posts = [];
    stories = [];
    reels = [];
    meetings = [];
    liveStreams = [];
    myFollowingIds = new Set();
    myFollowersIds = new Set();
    myFollowersSynced = false;
    viewedProfileFollowers = [];
    viewedProfileFollowing = [];
    viewedFollowersLoaded = false;
    viewedFollowingLoaded = false;
    viewedProfileDoc = null;
    viewedProfileLoaded = false;
    pendingFollowUids.clear();
    pendingLikePostIds.clear();
    pendingLikeReelIds.clear();
    replyingToCommentMap.clear();
    editingCommentMap.clear();
    postsLoading = false;
    postsError = '';
    stopStoryTimer();
    studioAudioEngine.stop();
    feedAudioEngine.stop();
    lastFeedReelKey = '';
    templateStudio.cleanup();
  }

  function updateAdminNavVisibility() {
    const adminBtn = document.getElementById('nx-admin-nav-btn');
    if (adminBtn) adminBtn.hidden = !isCurrentUserAdmin;
    const healthBtn = document.getElementById('nx-admin-health-nav-btn');
    if (healthBtn) healthBtn.hidden = !isCurrentUserAdmin;
  }

  function updateNavActiveClasses() {
    document.querySelectorAll('[data-nx-nav]').forEach((btn) => {
      const target = btn.getAttribute('data-nx-nav');
      const isActive =
        target === currentSection ||
        (currentSection === 'explore' && exploreTab === 'nearby' && target === 'nearby');
      btn.classList.toggle('active', isActive);
    });
  }

  let lastNavOpts = {};

  function syncWorkspaceVisibility(opts = lastNavOpts) {
    lastNavOpts = opts || {};
    const socialRoot = document.getElementById('nx-social-root');
    const inboxRoot = document.getElementById('nx-inbox-react-root');
    const platformRoot = document.getElementById('nx-platform-react-root');
    const legacyWs = document.getElementById('nx-legacy-workspace');
    const frame = document.getElementById('app-shell');
    const leftNav = document.getElementById('nx-left-nav');
    updateNavActiveClasses();

    const isMessagesSection = currentSection === 'messages';
    const isCommunitiesSection = currentSection === 'communities';
    const isPlatformReactSection = REACT_PLATFORM_VIEWS.has(currentSection);
    const isCollapsedSection = isMessagesSection || isCommunitiesSection;
    if (leftNav) {
      leftNav.classList.toggle('collapsed', isCollapsedSection);
    }

    if (isMessagesSection) {
      if (socialRoot) socialRoot.hidden = true;
      if (platformRoot) platformRoot.hidden = true;
      if (legacyWs) {
        legacyWs.hidden = true;
        legacyWs.classList.remove('mobile-nav-open');
      }
      if (inboxRoot) inboxRoot.hidden = false;
      frame?.classList.remove('nav-open');
      window.dispatchEvent(new CustomEvent('nexora:section-change', { detail: { section: currentSection, opts: lastNavOpts } }));
      return;
    }

    if (inboxRoot) inboxRoot.hidden = true;

    if (isCommunitiesSection) {
      if (socialRoot) socialRoot.hidden = true;
      if (platformRoot) platformRoot.hidden = true;
      if (legacyWs) {
        legacyWs.hidden = false;
        legacyWs.classList.remove('mobile-nav-open');
      }
      frame?.classList.remove('nav-open');
      window.dispatchEvent(new CustomEvent('nexora:section-change', { detail: { section: currentSection, opts: lastNavOpts } }));
      return;
    }

    if (legacyWs) {
      legacyWs.hidden = true;
      legacyWs.classList.remove('mobile-nav-open');
    }

    if (isPlatformReactSection) {
      if (socialRoot) socialRoot.hidden = true;
      if (platformRoot) platformRoot.hidden = false;
      frame?.classList.remove('nav-open');
      window.dispatchEvent(new CustomEvent('nexora:section-change', { detail: { section: currentSection, opts: lastNavOpts } }));
      return;
    }

    if (platformRoot) platformRoot.hidden = true;
    if (socialRoot) socialRoot.hidden = false;
    frame?.classList.remove('nav-open');
    window.dispatchEvent(new CustomEvent('nexora:section-change', { detail: { section: currentSection, opts: lastNavOpts } }));
  }

  function navigateTo(section, opts = {}) {
    if (!section) return;
    lastNavOpts = opts || {};
    const createMenu = document.getElementById('nx-create-nav-menu');
    const createBtn = document.getElementById('nx-create-nav-btn');
    if (createMenu) createMenu.hidden = true;
    if (createBtn) createBtn.setAttribute('aria-expanded', 'false');

    if (section !== 'reels') {
      feedAudioEngine.stop();
      lastFeedReelKey = '';
    }
    if (section === 'messages' || section === 'communities') {
      currentSection = section;
      syncWorkspaceVisibility(lastNavOpts);
      navigateToLegacyMode(section, opts);
      return;
    }
    if (section === 'nearby') {
      exploreTab = 'nearby';
      currentSection = 'explore';
      syncWorkspaceVisibility(lastNavOpts);
      render();
      void refreshNearbyDiscovery();
      return;
    }
    if (REACT_PLATFORM_VIEWS.has(section)) {
      if (section === 'admin-feature-health' && !isCurrentUserAdmin) {
        showToast('Admin Feature Health is restricted to verified administrators.');
        return;
      }
      currentSection = section;
      if (typeof window !== 'undefined' && window.location.hash !== `#${section}`) {
        window.history.replaceState(null, '', `#${section}`);
      }
      syncWorkspaceVisibility(lastNavOpts);
      return;
    }
    if (!SOCIAL_VIEWS.has(section)) return;
    if (section === 'admin' && !isCurrentUserAdmin) {
      showToast('Admin Dashboard is restricted to verified administrators.');
      return;
    }
    if (section === 'profile') {
      const nextUid = opts.uid || profile.id;
      if (nextUid && (nextUid !== profileTargetUid || !unsubViewedProfile)) {
        profileTargetUid = nextUid;
        profileEditing = false;
        subscribeViewedProfileEdges(profileTargetUid);
      }
    }
    if (opts.hashtag) {
      activeHashtagFilter = opts.hashtag.startsWith('#') ? opts.hashtag.toLowerCase() : `#${opts.hashtag.toLowerCase()}`;
    }
    if (opts.exploreQuery !== undefined) {
      exploreQuery = opts.exploreQuery;
    }
    if (opts.focusComposer) {
      setTimeout(() => {
        const composer = document.getElementById('nx-post-textarea');
        if (composer) {
          composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
          composer.focus();
        }
      }, 60);
    }
    currentSection = section;
    syncWorkspaceVisibility(lastNavOpts);
    render();
  }

  if (typeof window !== 'undefined') {
    window.NEXORA_SOCIAL_NAV = navigateTo;
  }

  function renderIfSocial() {
    if (SOCIAL_VIEWS.has(currentSection) && !REACT_PLATFORM_VIEWS.has(currentSection)) {
      render();
    }
  }

  const templateStudio = createTemplateStudioModule({
    state,
    profile,
    directoryMap,
    isAdmin: () => isCurrentUserAdmin,
    showToast,
    escapeHtml,
    navigateTo: (...args) => navigateTo(...args),
    openDirectMessageWithUser,
    requestSocialRender: renderIfSocial,
  });

  function formatRichContent(rawText) {
    let safe = escapeHtml(rawText || '');
    safe = safe.replace(
      /(https?:\/\/[^\s<]+)/g,
      (fullUrl) => {
        const clean = sanitizeSafeUrl(fullUrl, '');
        if (!clean) return fullUrl;
        const safeHref = escapeHtml(clean);
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="nx-hashtag-link">${fullUrl}</a>`;
      }
    );
    safe = safe.replace(
      /(^|\s)(#[a-zA-Z0-9_]{2,40})/g,
      '$1<button type="button" class="nx-hashtag-link" data-nx-act="filter-hashtag" data-tag="$2">$2</button>'
    );
    safe = safe.replace(
      /(^|\s)(@[a-zA-Z0-9._-]{2,40})/g,
      '$1<button type="button" class="nx-mention-link" data-nx-act="open-mention" data-handle="$2">$2</button>'
    );
    return safe;
  }

  async function refreshFollowRequests() {
    if (!currentUser) return;
    try {
      const res = await apiV1Fetch('/follow-requests');
      pendingFollowRequests = Array.isArray(res?.requests) ? res.requests : [];
      if (currentSection === 'profile') render();
    } catch {
      pendingFollowRequests = [];
    }
  }

  async function refreshSearchHistory() {
    if (!currentUser) return;
    try {
      const res = await apiV1Fetch('/search/history');
      searchHistoryItems = Array.isArray(res?.history) ? res.history : [];
      if (currentSection === 'explore') render();
    } catch {
      searchHistoryItems = [];
    }
  }

  async function refreshExploreProducts() {
    if (!currentUser) return;
    try {
      const params = new URLSearchParams({ type: 'products' });
      if (exploreQuery.trim()) params.set('q', exploreQuery.trim());
      const res = await apiV1Fetch(`/search?${params.toString()}`);
      exploreProducts = Array.isArray(res?.products) ? res.products : [];
      if (currentSection === 'explore') render();
    } catch {
      exploreProducts = [];
    }
  }

  async function refreshServerFeed(append = false) {
    if (!currentUser) return;
    try {
      const params = new URLSearchParams({ tab: feedTab, limit: '15' });
      if (activeHashtagFilter) params.set('hashtag', activeHashtagFilter);
      if (append && serverFeedCursor) params.set('cursor', serverFeedCursor);
      const res = await apiV1Fetch(`/feed?${params.toString()}`);
      const items = Array.isArray(res?.items) ? res.items : [];
      const ids = items.map((i) => i.id).filter(Boolean);
      serverFeedRankedIds = append ? Array.from(new Set([...serverFeedRankedIds, ...ids])) : ids;
      serverFeedCursor = res?.nextCursor || null;
      if (currentSection === 'home') render();
    } catch {
      // Realtime Firestore listener stays active as seamless fallback
    }
  }

  async function refreshNearbyDiscovery() {
    if (!currentUser) return;
    nearbyLoading = true;
    nearbyError = '';
    renderIfSocial();
    try {
      const token = await currentUser.getIdToken();
      const eventParams = new URLSearchParams({ radiusKm: String(nearbyRadiusKm) });
      if (nearbyCoords) {
        eventParams.set('lat', String(nearbyCoords.lat));
        eventParams.set('lon', String(nearbyCoords.lon));
      }
      const [eventsRes, peopleRes] = await Promise.all([
        fetch(`/api/discovery/nearby?${eventParams.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json().catch(() => ({}))),
        nearbyCoords
          ? apiV1Fetch(
              `/nearby/people?lat=${encodeURIComponent(String(nearbyCoords.lat))}&lon=${encodeURIComponent(
                String(nearbyCoords.lon)
              )}&radiusKm=${encodeURIComponent(String(nearbyRadiusKm))}`
            ).catch(() => ({ people: [] }))
          : Promise.resolve({ people: [] }),
      ]);
      nearbyPeople = Array.isArray(peopleRes?.people) ? peopleRes.people : [];
      nearbyEvents = Array.isArray(eventsRes?.events) ? eventsRes.events : [];
    } catch (err) {
      nearbyError = formatFriendlyError(err, 'Unable to load nearby discovery.');
    } finally {
      nearbyLoading = false;
      renderIfSocial();
    }
  }

  async function enableGeoDiscovery() {
    if (!currentUser) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showToast('Browser geolocation is unavailable on this device.', 'error');
      return;
    }
    nearbyLoading = true;
    nearbyError = '';
    renderIfSocial();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          nearbyCoords = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          };
          nearbyPausedUntilMs = 0;
          await apiV1Fetch('/nearby/location', {
            method: 'POST',
            body: JSON.stringify({
              lat: nearbyCoords.lat,
              lon: nearbyCoords.lon,
              city: profile.locationLabel || 'Local Area',
              displayName: profile.displayName,
              username: profile.username,
              discoverable: true,
              ttlMinutes: 30,
            }),
          });
          showToast('Approximate area updated for nearby discovery.', 'success');
          await refreshNearbyDiscovery();
        } catch (err) {
          nearbyError = formatFriendlyError(err, 'Could not update discovery area.');
          nearbyLoading = false;
          renderIfSocial();
        }
      },
      () => {
        nearbyLoading = false;
        nearbyError = 'Location permission was declined. Local events remain visible.';
        void refreshNearbyDiscovery();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
    );
  }

  async function pauseNearbyDiscovery(pauseMinutes) {
    if (!currentUser || !nearbyCoords) {
      showToast('Enable location discovery first before pausing.');
      return;
    }
    try {
      const res = await apiV1Fetch('/nearby/location', {
        method: 'POST',
        body: JSON.stringify({
          lat: nearbyCoords.lat,
          lon: nearbyCoords.lon,
          city: profile.locationLabel || 'Local Area',
          discoverable: true,
          pauseMinutes,
        }),
      });
      nearbyPausedUntilMs = Number(res?.location?.pausedUntilMs || Date.now() + pauseMinutes * 60_000);
      showToast(`Nearby discovery paused for ${pauseMinutes} minutes.`, 'success');
      renderIfSocial();
    } catch (err) {
      showToast(formatFriendlyError(err, 'Could not pause discovery.'), 'error');
    }
  }

  async function stopNearbyDiscovery() {
    if (!currentUser) return;
    try {
      await apiV1Fetch('/nearby/location', {
        method: 'POST',
        body: JSON.stringify({
          lat: nearbyCoords?.lat ?? 0,
          lon: nearbyCoords?.lon ?? 0,
          discoverable: false,
        }),
      });
      nearbyCoords = null;
      nearbyPausedUntilMs = 0;
      nearbyPeople = [];
      showToast('Nearby location sharing turned off and cleared.');
      renderIfSocial();
    } catch (err) {
      showToast(formatFriendlyError(err, 'Could not clear location.'), 'error');
    }
  }

  /* ---------- COMMENTS & ENGAGEMENT SUBSCRIPTIONS ---------- */

  function ensurePostCommentsSubscription(postId) {
    if (unsubPostComments.has(postId)) return;
    const q = query(collection(db, 'posts', postId, 'comments'), where('parentId', '==', postId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({ id: d.id, ...data, createdAtMs: tsMillis(data.createdAt, Date.now()) });
        });
        list.sort((a, b) => a.createdAtMs - b.createdAtMs);
        postCommentsMap.set(postId, list);
        if (currentSection === 'home' || currentSection === 'profile' || currentSection === 'explore') {
          render();
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `posts/${postId}/comments`, { silent: true });
      }
    );
    unsubPostComments.set(postId, unsub);
  }

  function ensureReelCommentsSubscription(reelId) {
    if (unsubReelComments.has(reelId)) return;
    const q = query(collection(db, 'reels', reelId, 'comments'), where('parentId', '==', reelId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({ id: d.id, ...data, createdAtMs: tsMillis(data.createdAt, Date.now()) });
        });
        list.sort((a, b) => a.createdAtMs - b.createdAtMs);
        reelCommentsMap.set(reelId, list);
        if (currentSection === 'reels') render();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `reels/${reelId}/comments`, { silent: true });
      }
    );
    unsubReelComments.set(reelId, unsub);
  }

  function subscribeMeetingChat(meetingId) {
    if (unsubMeetingChat) {
      unsubMeetingChat();
      unsubMeetingChat = null;
    }
    meetingChatList = [];
    if (!meetingId) return;
    unsubMeetingChat = onSnapshot(
      query(collection(db, 'meetings', meetingId, 'chat'), where('meetingId', '==', meetingId)),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({ id: d.id, ...data, createdAtMs: tsMillis(data.createdAt, Date.now()) });
        });
        list.sort((a, b) => a.createdAtMs - b.createdAtMs);
        meetingChatList = list;
        if (currentSection === 'calls') render();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `meetings/${meetingId}/chat`, { silent: true });
      }
    );
  }

  function subscribeLiveChat(streamId) {
    if (unsubLiveChat) {
      unsubLiveChat();
      unsubLiveChat = null;
    }
    liveChatList = [];
    if (!streamId) return;
    unsubLiveChat = onSnapshot(
      query(collection(db, 'live_streams', streamId, 'chat'), where('streamId', '==', streamId)),
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({ id: d.id, ...data, createdAtMs: tsMillis(data.createdAt, Date.now()) });
        });
        list.sort((a, b) => a.createdAtMs - b.createdAtMs);
        liveChatList = list;
        if (currentSection === 'live') render();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `live_streams/${streamId}/chat`, { silent: true });
      }
    );
  }

  /* ---------- STORIES RENDER & VIEWER ---------- */

  function stopStoryTimer() {
    if (storyProgressTimer) {
      clearInterval(storyProgressTimer);
      storyProgressTimer = null;
    }
  }

  function renderStoriesStripHtml() {
    const scrollItems = storyGroups
      .map((grp, idx) => {
        const isMine = grp.userId === profile.id;
        const userObj = resolveUserDisplay(grp.userId, {
          displayName: grp.userName,
          avatar: grp.userAvatar,
          initials: grp.userInitials,
        });
        const label = isMine ? 'Your Story' : userObj.displayName;
        return `
          <button type="button" class="nx-story-tile" data-nx-act="open-story-group" data-group-idx="${idx}" aria-label="View story by ${escapeHtml(label)}">
            <span class="nx-story-ring">
              <span class="nx-story-inner">
                ${renderUserAvatarHtml(userObj, 54)}
              </span>
            </span>
            <span class="nx-story-name">${escapeHtml(label)}</span>
          </button>
        `;
      })
      .join('');

    return `
      <section class="nx-card nx-stories-card" aria-label="Stories">
        <div class="nx-stories-row" id="nx-stories-row">
          <button type="button" class="nx-story-tile" data-nx-act="open-create-story" aria-label="Create Story">
            <span class="nx-story-ring create-ring">
              <span class="nx-story-inner">${renderUserAvatarHtml(profile, 54)}</span>
              <span class="nx-story-plus" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </span>
            </span>
            <span class="nx-story-name">Create Story</span>
          </button>
          ${
            scrollItems ||
            `<div style="font-size:0.82rem;color:var(--nx-text-muted);padding-left:6px;">Share a 24-hour photo, video, or update story with your network.</div>`
          }
        </div>
        ${
          storyGroups.length > 3
            ? `<button type="button" class="nx-story-scroll-next" data-nx-act="scroll-stories-right" aria-label="More stories">${svgIcon('chevronRight', 15)}</button>`
            : ''
        }
      </section>
    `;
  }

  function openStoryViewer(groupIdx, itemIdx = 0) {
    if (!storyGroups.length) return;
    activeStoryGroupIdx = Math.max(0, Math.min(groupIdx, storyGroups.length - 1));
    const grp = storyGroups[activeStoryGroupIdx];
    activeStoryItemIdx = Math.max(0, Math.min(itemIdx, grp.items.length - 1));
    openModal('view-story-modal');
    loadActiveStorySlide();
  }

  function loadActiveStorySlide() {
    stopStoryTimer();
    const grp = storyGroups[activeStoryGroupIdx];
    const item = grp?.items?.[activeStoryItemIdx];
    const body = document.getElementById('view-story-body');
    const title = document.getElementById('view-story-title');
    if (!grp || !item || !body) {
      closeAllModals();
      return;
    }

    if (title) title.textContent = `${grp.userName || 'Member'}'s Story`;

    // Record view in Firestore
    if (currentUser && item.id) {
      setDoc(doc(db, 'stories', item.id, 'views', currentUser.uid), {
        viewerUid: currentUser.uid,
        viewerName: profile.displayName.slice(0, 120),
        viewerAvatar: String(profile.avatar || '').slice(0, 200000),
        viewedAt: serverTimestamp(),
      }).catch(() => {});

      if (unsubStoryViews) {
        unsubStoryViews();
        unsubStoryViews = null;
      }
      unsubStoryViews = onSnapshot(
        query(collection(db, 'stories', item.id, 'views'), where('viewerUid', '>', '')),
        (snap) => {
          const v = [];
          snap.forEach((d) => v.push(d.data()));
          storyViewsList = v;
          const vc = document.getElementById('nx-story-views-count');
          if (vc) vc.textContent = `${v.length} view${v.length === 1 ? '' : 's'}`;
        },
        () => {}
      );
    }

    const mediaHtml =
      item.mediaType === 'image' && item.mediaUrl
        ? `<img src="${escapeHtml(item.mediaUrl)}" alt="Story image" style="width:100%;max-height:320px;object-fit:cover;border-radius:14px;" />`
        : item.mediaType === 'video' && item.mediaUrl
          ? `<video src="${escapeHtml(item.mediaUrl)}" controls autoplay playsinline style="width:100%;max-height:320px;border-radius:14px;background:#000;"></video>`
          : '';

    const reactionsMap = item.reactions || {};
    const rxSummary = Object.entries(reactionsMap)
      .filter(([, uids]) => Array.isArray(uids) && uids.length > 0)
      .map(([em, uids]) => `${em} ${uids.length}`)
      .join(' · ');

    const isMine = item.userId === profile.id || isCurrentUserAdmin;

    body.innerHTML = `
      <div style="display:grid;gap:12px;">
        <div style="display:grid;grid-template-columns:repeat(${grp.items.length}, 1fr);gap:5px;">
          ${grp.items
            .map((_, i) => {
              const width = i < activeStoryItemIdx ? '100%' : i === activeStoryItemIdx ? '0%' : '0%';
              return `<div style="height:4px;border-radius:999px;background:rgba(128,128,160,0.3);overflow:hidden;">
                <div id="${i === activeStoryItemIdx ? 'nx-story-prog-active' : ''}" style="height:100%;width:${width};background:var(--nx-grad);transition:width 80ms linear;"></div>
              </div>`;
            })
            .join('')}
        </div>

        <div style="padding:22px 18px;border-radius:16px;background:${escapeHtml(item.bgGradient || 'linear-gradient(135deg, #701CFF 0%, #286BFF 100%)')};color:#ffffff;display:grid;gap:12px;min-height:220px;align-content:space-between;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:8px;">
              ${renderUserAvatarHtml(resolveUserDisplay(item.userId, { displayName: item.userName, avatar: item.userAvatar }), 34)}
              <div>
                <strong style="font-size:0.9rem;">${escapeHtml(item.userName || 'Member')}</strong>
                <div style="font-size:0.74rem;opacity:0.85;">${formatRelativeTime(item.createdAtMs)}</div>
              </div>
            </div>
            ${
              item.sticker
                ? `<span style="padding:4px 10px;border-radius:999px;background:rgba(255,255,255,0.2);font-size:0.75rem;font-weight:700;">${escapeHtml(item.sticker)}</span>`
                : ''
            }
          </div>

          ${mediaHtml}

          <p style="margin:0;font-size:1.05rem;font-weight:700;line-height:1.45;">${escapeHtml(item.content || '')}</p>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${['❤️', '🔥', '👏', '😮', '💜']
              .map(
                (em) =>
                  `<button type="button" class="nx-btn-soft" style="height:32px;padding:0 10px;" data-nx-act="react-story" data-story-id="${escapeHtml(item.id)}" data-emoji="${em}">${em}</button>`
              )
              .join('')}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="member-sub" id="nx-story-views-count">${storyViewsList.length} view${storyViewsList.length === 1 ? '' : 's'}</span>
            ${
              isMine
                ? `<button type="button" class="nx-btn-danger" style="height:30px;" data-nx-act="delete-story" data-story-id="${escapeHtml(item.id)}">Delete</button>`
                : ''
            }
          </div>
        </div>
        ${rxSummary ? `<div class="member-sub">Reactions: ${escapeHtml(rxSummary)}</div>` : ''}

        ${
          item.userId !== profile.id
            ? `<form id="nx-story-reply-form" data-story-id="${escapeHtml(item.id)}" data-author-id="${escapeHtml(item.userId)}" class="nx-comment-form">
                <input type="text" id="nx-story-reply-input" placeholder="Reply to ${escapeHtml(item.userName || 'story')}..." maxlength="240" required />
                <button type="submit" class="nx-btn-grad">Reply</button>
              </form>`
            : ''
        }

        <div style="display:flex;justify-content:space-between;gap:8px;">
          <button type="button" class="nx-btn-soft" data-nx-act="prev-story-slide">Previous</button>
          <button type="button" class="nx-btn-grad" data-nx-act="next-story-slide">Next Story</button>
        </div>
      </div>
    `;

    storyProgressPct = 0;
    storyProgressTimer = window.setInterval(() => {
      if (!document.getElementById('view-story-modal')?.classList.contains('open')) {
        stopStoryTimer();
        return;
      }
      storyProgressPct += 2;
      const bar = document.getElementById('nx-story-prog-active');
      if (bar) bar.style.width = `${Math.min(100, storyProgressPct)}%`;
      if (storyProgressPct >= 100) {
        stepStorySlide(1);
      }
    }, 100);
  }

  function stepStorySlide(delta) {
    const grp = storyGroups[activeStoryGroupIdx];
    if (!grp) {
      closeAllModals();
      return;
    }
    if (delta > 0) {
      if (activeStoryItemIdx + 1 < grp.items.length) {
        activeStoryItemIdx += 1;
        loadActiveStorySlide();
      } else if (activeStoryGroupIdx + 1 < storyGroups.length) {
        activeStoryGroupIdx += 1;
        activeStoryItemIdx = 0;
        loadActiveStorySlide();
      } else {
        stopStoryTimer();
        closeAllModals();
      }
    } else {
      if (activeStoryItemIdx > 0) {
        activeStoryItemIdx -= 1;
        loadActiveStorySlide();
      } else if (activeStoryGroupIdx > 0) {
        activeStoryGroupIdx -= 1;
        activeStoryItemIdx = Math.max(0, storyGroups[activeStoryGroupIdx].items.length - 1);
        loadActiveStorySlide();
      }
    }
  }

  /* ---------- HOME FEED COMPOSER & POST CARDS ---------- */

  function renderComposerCardHtml() {
    const hasDraft = Boolean(localStorage.getItem('nx_post_draft_v1'));
    return `
      <section class="nx-card nx-composer-card" aria-label="Create post">
        <div class="nx-composer-top">
          ${renderUserAvatarHtml(profile, 44)}
          <textarea
            id="nx-post-textarea"
            class="nx-composer-textarea"
            placeholder="What's on your mind?"
            aria-label="Create a post on NEXORA"
            maxlength="4000"
          >${escapeHtml(composerText)}</textarea>
        </div>

        ${
          composerFeeling || composerLocation || composerProductTags
            ? `<div class="nx-composer-meta-chips">
                ${
                  composerFeeling
                    ? `<span class="nx-meta-chip">${escapeHtml(composerFeeling)} <button type="button" class="nx-link-action" data-nx-act="clear-composer-feeling" aria-label="Remove feeling">×</button></span>`
                    : ''
                }
                ${
                  composerLocation
                    ? `<span class="nx-meta-chip">${svgIcon('mapPin', 12)} ${escapeHtml(composerLocation)} <button type="button" class="nx-link-action" data-nx-act="clear-composer-location" aria-label="Remove location">×</button></span>`
                    : ''
                }
                ${
                  composerProductTags
                    ? `<span class="nx-meta-chip">Products: ${escapeHtml(composerProductTags)} <button type="button" class="nx-link-action" data-nx-act="clear-composer-products" aria-label="Remove product tags">×</button></span>`
                    : ''
                }
              </div>`
            : ''
        }

        ${
          composerMedia.length > 0
            ? `<div class="nx-composer-media-preview">
                ${composerMedia
                  .map(
                    (m, idx) => `
                    <div class="nx-media-thumb-box">
                      ${
                        m.type === 'video'
                          ? `<video src="${escapeHtml(m.url)}" controls muted></video>`
                          : `<img src="${escapeHtml(m.url)}" alt="Upload preview" />`
                      }
                      <button type="button" class="nx-media-remove-btn" data-nx-act="remove-composer-media" data-idx="${idx}" aria-label="Remove attachment">×</button>
                    </div>
                  `
                  )
                  .join('')}
              </div>`
            : ''
        }

        <div class="nx-composer-actions">
          <div class="nx-composer-tools">
            <label class="nx-tool-pill" style="cursor:pointer;">
              <span class="ic-photo">${svgIcon('image', 16)}</span>
              <span>Photo</span>
              <input type="file" id="nx-post-photo-input" accept="image/*" multiple hidden />
            </label>
            <label class="nx-tool-pill" style="cursor:pointer;">
              <span class="ic-video">${svgIcon('video', 16)}</span>
              <span>Video</span>
              <input type="file" id="nx-post-video-input" accept="video/*" hidden />
            </label>
            <button type="button" class="nx-tool-pill" data-nx-act="open-photo-studio">
              <span class="ic-photo">${svgIcon('sparkles', 16)}</span>
              <span>Photo Templates</span>
            </button>
            <button type="button" class="nx-tool-pill" data-nx-act="toggle-feeling-picker">
              <span class="ic-feel">${svgIcon('smile', 16)}</span>
              <span>Feeling</span>
            </button>
            <button type="button" class="nx-tool-pill" data-nx-act="prompt-checkin">
              <span class="ic-loc">${svgIcon('mapPin', 16)}</span>
              <span>Check-in</span>
            </button>
            <button type="button" class="nx-tool-pill" data-nx-act="prompt-product-tag">
              <span>Tag Product</span>
            </button>
          </div>

          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="nx-btn-soft" style="height:32px;font-size:0.74rem;" data-nx-act="save-post-draft">Save Draft</button>
            ${
              hasDraft
                ? `<button type="button" class="nx-btn-soft" style="height:32px;font-size:0.74rem;" data-nx-act="load-post-draft">Restore Draft</button>`
                : ''
            }
            <select id="nx-post-visibility" class="select" style="height:34px;font-size:0.78rem;width:auto;padding-inline:10px;" aria-label="Post visibility">
              <option value="public" ${composerVisibility === 'public' ? 'selected' : ''}>Public</option>
              <option value="followers" ${composerVisibility === 'followers' ? 'selected' : ''}>Followers</option>
              <option value="private" ${composerVisibility === 'private' ? 'selected' : ''}>Only Me</option>
            </select>
            <button type="button" class="nx-btn-grad" id="nx-publish-post-btn" data-nx-act="publish-post">
              <span>Post</span>
              ${svgIcon('send', 14)}
            </button>
          </div>
        </div>
      </section>
    `;
  }

  function renderPostCardHtml(post) {
    const author = resolveUserDisplay(post.authorId, {
      displayName: post.authorName,
      username: post.authorUsername,
      avatar: post.authorAvatar,
      initials: post.authorInitials,
      verified: post.authorVerified,
    });
    const isLiked = (post.likesUids || []).includes(profile.id);
    const isBookmarked = state.bookmarks.some((b) => b.sourceType === 'post' && b.sourceId === post.id);
    const isAuthor = post.authorId === profile.id;
    const isExpanded = expandedPostIds.has(post.id);
    const comments = postCommentsMap.get(post.id) || [];

    const visIcon =
      post.visibility === 'private'
        ? svgIcon('lock', 12)
        : post.visibility === 'followers'
          ? svgIcon('users', 12)
          : svgIcon('globe', 12);

    const mediaItems = post.mediaItems || [];
    const mediaHtml =
      mediaItems.length > 0
        ? `<div class="nx-post-media-grid ${mediaItems.length > 1 ? 'cols-2' : ''}">
            ${mediaItems
              .map((m) =>
                m.type === 'video'
                  ? `<video src="${escapeHtml(m.url)}" controls playsinline preload="metadata"></video>`
                  : `<img src="${escapeHtml(m.url)}" alt="Post media" loading="lazy" />`
              )
              .join('')}
          </div>`
        : '';

    const feelingLine =
      post.feeling || post.location
        ? `<span style="font-weight:600;color:var(--nx-text-secondary);font-size:0.8rem;">${[
            post.feeling ? `is feeling ${post.feeling}` : '',
            post.location ? `at ${post.location}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}</span>`
        : '';

    const editBlock =
      editingPostId === post.id
        ? `<div style="display:grid;gap:8px;">
            <textarea id="nx-edit-post-input" class="nx-composer-textarea" rows="3">${escapeHtml(post.content)}</textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button type="button" class="nx-btn-soft" data-nx-act="cancel-edit-post">Cancel</button>
              <button type="button" class="nx-btn-grad" data-nx-act="save-edit-post" data-post-id="${escapeHtml(post.id)}">Save Post</button>
            </div>
          </div>`
        : `<div class="nx-post-body">${formatRichContent(post.content)}${
            post.edited ? ' <span class="member-sub">(edited)</span>' : ''
          }</div>`;

    const replyState = replyingToCommentMap.get(post.id) || null;
    const editingCommentId = editingCommentMap.get(post.id) || '';
    const threadedComments = buildCommentThreads(comments);

    const renderCommentItemHtml = (c, isReply = false) => {
      const commentAuthor = resolveUserDisplay(c.authorId, {
        displayName: c.authorName,
        avatar: c.authorAvatar,
      });
      const canEditComment = c.authorId === profile.id;
      const canDeleteComment = c.authorId === profile.id || isAuthor || isCurrentUserAdmin;
      const isEditingThis = editingCommentId === c.id;
      return `
        <div class="nx-comment-item" style="${isReply ? 'margin-left:34px;padding-left:10px;border-left:2px solid var(--nx-border);' : ''}">
          ${renderUserAvatarHtml(commentAuthor, isReply ? 26 : 30)}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <button type="button" class="nx-link-action" style="padding:0;font-size:0.82rem;font-weight:700;color:var(--nx-text);" data-nx-act="view-user-profile" data-uid="${escapeHtml(c.authorId)}">${escapeHtml(commentAuthor.displayName || c.authorName || 'Member')}</button>
              <span class="member-sub" style="font-size:0.72rem;">${formatRelativeTime(c.createdAtMs)}${c.edited ? ' · edited' : ''}</span>
            </div>
            ${
              c.replyToName && !isReply
                ? `<div class="member-sub" style="font-size:0.72rem;">Replying to @${escapeHtml(c.replyToName)}</div>`
                : ''
            }
            ${
              isEditingThis
                ? `<form class="nx-comment-form" data-nx-edit-comment-post="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}" style="margin-top:4px;">
                    <input type="text" name="editCommentText" value="${escapeHtml(c.content)}" maxlength="1500" required />
                    <button type="submit" class="nx-btn-grad" style="height:32px;">Save</button>
                    <button type="button" class="nx-btn-soft" style="height:32px;" data-nx-act="cancel-edit-comment" data-post-id="${escapeHtml(post.id)}">Cancel</button>
                  </form>`
                : `<div style="font-size:0.84rem;line-height:1.4;margin-top:2px;">${formatRichContent(c.content)}</div>
                   <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;align-items:center;">
                     <button type="button" class="nx-link-action" style="font-size:0.74rem;" data-nx-act="react-comment" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}" data-emoji="👍">👍 ${Array.isArray(c.reactions?.['👍']) ? c.reactions['👍'].length : 0}</button>
                     <button type="button" class="nx-link-action" style="font-size:0.74rem;" data-nx-act="react-comment" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}" data-emoji="❤️">❤️ ${Array.isArray(c.reactions?.['❤️']) ? c.reactions['❤️'].length : 0}</button>
                     <button type="button" class="nx-link-action" style="font-size:0.74rem;" data-nx-act="reply-comment" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}" data-author-name="${escapeHtml(commentAuthor.displayName || c.authorName || 'Member')}">Reply</button>
                     ${canEditComment ? `<button type="button" class="nx-link-action" style="font-size:0.74rem;" data-nx-act="edit-comment" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}">Edit</button>` : ''}
                     ${canDeleteComment ? `<button type="button" class="nx-link-action" style="font-size:0.74rem;color:var(--danger);" data-nx-act="delete-comment" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(c.id)}">Delete</button>` : ''}
                     ${!canEditComment ? `<button type="button" class="nx-link-action" style="font-size:0.74rem;" data-action="open-report" data-target-type="comment" data-target-id="${escapeHtml(c.id)}">Report</button>` : ''}
                   </div>`
            }
          </div>
        </div>
      `;
    };

    const commentsHtml = isExpanded
      ? `<div class="nx-comments-drawer">
          ${
            threadedComments.length > 0
              ? threadedComments
                  .map(
                    (c) => `
                  ${renderCommentItemHtml(c, false)}
                  ${(c.replies || []).map((r) => renderCommentItemHtml(r, true)).join('')}
                `
                  )
                  .join('')
              : `<div class="member-sub">No comments yet. Start the conversation below.</div>`
          }
          ${
            replyState
              ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;border-radius:8px;background:var(--nx-input-bg);font-size:0.76rem;">
                  <span>Replying to <strong>${escapeHtml(replyState.authorName)}</strong></span>
                  <button type="button" class="nx-link-action" data-nx-act="cancel-reply-comment" data-post-id="${escapeHtml(post.id)}">Cancel</button>
                </div>`
              : ''
          }
          <form class="nx-comment-form" data-nx-comment-post="${escapeHtml(post.id)}">
            <input type="text" name="commentText" placeholder="${replyState ? `Reply to ${escapeHtml(replyState.authorName)}...` : 'Write a comment...'}" maxlength="1500" required />
            <button type="submit" class="nx-btn-grad" style="height:36px;">Send</button>
          </form>
        </div>`
      : '';

    const isHighlighted = highlightedPostId && highlightedPostId === post.id;

    return `
      <article class="nx-card nx-post-card" id="post-${escapeHtml(post.id)}" data-post-id="${escapeHtml(post.id)}" style="${isHighlighted ? 'box-shadow:0 0 0 2px var(--nx-primary);' : ''}">
        <div class="nx-post-head">
          <button type="button" class="nx-post-author-btn" data-nx-act="view-user-profile" data-uid="${escapeHtml(post.authorId)}">
            ${renderUserAvatarHtml(author, 42)}
            <div>
              <div class="nx-post-author-name">
                <span>${escapeHtml(author.displayName)}</span>
                ${
                  author.verified || post.authorVerified
                    ? `<span class="nx-verified-badge" title="Verified" aria-label="Verified">${svgIcon('check', 10)}</span>`
                    : ''
                }
                ${feelingLine}
              </div>
              <div class="nx-post-meta">
                <span>@${escapeHtml(author.username)}</span>
                <span>•</span>
                <span>${formatRelativeTime(post.createdAtMs)}</span>
                <span>•</span>
                ${visIcon}
              </div>
            </div>
          </button>

          <button type="button" class="nx-top-icon-btn" style="width:34px;height:34px;" data-nx-act="post-menu" data-post-id="${escapeHtml(post.id)}" aria-label="Post options">
            ${svgIcon('more', 16)}
          </button>
        </div>

        ${editBlock}
        ${mediaHtml}
        ${
          Array.isArray(post.productIds) && post.productIds.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${post.productIds
                  .map(
                    (pidTag) =>
                      `<button type="button" class="nx-meta-chip" data-nx-nav="marketplace" data-product-id="${escapeHtml(String(pidTag))}">Shop Tagged Item: ${escapeHtml(String(pidTag))}</button>`
                  )
                  .join('')}
              </div>`
            : ''
        }

        <div class="nx-post-footer">
          <div class="nx-post-actions-left">
            <button type="button" class="nx-post-act-btn ${isLiked ? 'liked' : ''}" data-nx-act="toggle-like-post" data-post-id="${escapeHtml(post.id)}" aria-label="Like post">
              ${svgIcon(isLiked ? 'heartFilled' : 'heart', 17)}
              <span>${formatCompactCount(post.likesCount)}</span>
            </button>
            <button type="button" class="nx-post-act-btn" data-nx-act="toggle-comments-post" data-post-id="${escapeHtml(post.id)}" aria-label="Comments">
              ${svgIcon('chat', 17)}
              <span>${formatCompactCount(Math.max(post.commentsCount, comments.length))}</span>
            </button>
            <button type="button" class="nx-post-act-btn" data-nx-act="share-post" data-post-id="${escapeHtml(post.id)}" aria-label="Share post">
              ${svgIcon('share', 17)}
              <span>${formatCompactCount(post.sharesCount)}</span>
            </button>
          </div>
          <button type="button" class="nx-post-act-btn ${isBookmarked ? 'bookmarked' : ''}" data-nx-act="bookmark-post" data-post-id="${escapeHtml(post.id)}" aria-label="${isBookmarked ? 'Remove bookmark' : 'Save post'}">
            ${svgIcon(isBookmarked ? 'bookmarkFilled' : 'bookmark', 17)}
          </button>
        </div>

        ${commentsHtml}
      </article>
    `;
  }

  function renderRightRailHtml() {
    // Active Now — strictly real registered users from directoryMap
    const onlinePeers = (state.directoryUsers || [])
      .filter((u) => u.id !== profile.id && !state.blockedSet.has(u.id))
      .sort((a, b) => {
        const aOn = a.status === 'online' || a.status === 'idle' || a.status === 'dnd' ? 0 : 1;
        const bOn = b.status === 'online' || b.status === 'idle' || b.status === 'dnd' ? 0 : 1;
        return aOn - bOn;
      })
      .slice(0, 6);

    const suggestedUsers = selectSuggestedUsers(state.directoryUsers || [], {
      viewerUid: profile.id,
      followingIds: myFollowingIds,
      blockedSet: state.blockedSet,
      limit: 4,
    });

    const upcomingMeetings = meetings.filter((m) => m.status !== 'ended').slice(0, 3);
    const trendingTags = rankTrendingHashtags(posts, 5);

    return `
      <aside class="nx-right-rail" aria-label="Live activity and discovery">
        <section class="nx-card">
          <div class="nx-card-head">
            <h2 class="nx-card-title">
              <span style="width:9px;height:9px;border-radius:999px;background:#22C55E;display:inline-block;"></span>
              <span>Active Now</span>
            </h2>
            <button type="button" class="nx-link-action" data-nx-act="see-all-people">See all ${svgIcon('arrowRight', 13)}</button>
          </div>
          <div style="display:grid;gap:4px;">
            ${
              onlinePeers.length > 0
                ? onlinePeers
                    .map((u) => {
                      const statusLabel =
                        u.status === 'dnd' ? 'Busy' : u.status === 'idle' ? 'Away' : u.status === 'offline' ? 'Offline' : 'Online';
                      const dotClass = u.status === 'dnd' ? 'busy' : u.status === 'idle' ? 'idle' : u.status === 'offline' ? 'offline' : '';
                      return `
                        <button type="button" class="nx-active-row" data-nx-act="view-user-profile" data-uid="${escapeHtml(u.id)}">
                          <span style="position:relative;display:inline-flex;">
                            ${renderUserAvatarHtml(u, 36)}
                            <span class="nx-online-dot ${dotClass}"></span>
                          </span>
                          <span style="flex:1;min-width:0;">
                            <span style="display:block;font-size:0.86rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(u.displayName)}</span>
                            <span style="display:block;font-size:0.74rem;color:var(--nx-text-muted);">${escapeHtml(statusLabel)}</span>
                          </span>
                        </button>
                      `;
                    })
                    .join('')
                : `<div class="member-sub" style="padding:8px 4px;white-space:normal;line-height:1.45;">Invite friends or search registered members in Explore to connect and see them online here.</div>`
            }
          </div>
        </section>

        ${
          suggestedUsers.length > 0
            ? `<section class="nx-card">
                <div class="nx-card-head">
                  <h2 class="nx-card-title">
                    <span style="color:var(--nx-primary);">${svgIcon('userPlus', 16)}</span>
                    <span>Suggested for You</span>
                  </h2>
                  <button type="button" class="nx-link-action" data-nx-act="see-all-people">Explore ${svgIcon('arrowRight', 13)}</button>
                </div>
                <div style="display:grid;gap:8px;">
                  ${suggestedUsers
                    .map(
                      (u) => `
                    <div class="nx-meeting-mini" style="gap:8px;">
                      <button type="button" class="nx-post-author-btn" style="min-width:0;flex:1;" data-nx-act="view-user-profile" data-uid="${escapeHtml(u.id)}">
                        ${renderUserAvatarHtml(u, 34)}
                        <span style="min-width:0;text-align:left;">
                          <strong style="display:block;font-size:0.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(u.displayName)}</strong>
                          <span class="member-sub" style="font-size:0.72rem;">@${escapeHtml(u.username)}</span>
                        </span>
                      </button>
                      <button type="button" class="nx-btn-grad" style="height:28px;padding:0 12px;font-size:0.74rem;flex-shrink:0;" data-nx-act="toggle-follow" data-uid="${escapeHtml(u.id)}">Follow</button>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </section>`
            : ''
        }

        <section class="nx-card">
          <div class="nx-card-head">
            <h2 class="nx-card-title">
              <span style="color:var(--nx-primary);">${svgIcon('calendar', 16)}</span>
              <span>Upcoming Meetings</span>
            </h2>
            <button type="button" class="nx-link-action" data-nx-act="goto-calls">See all ${svgIcon('arrowRight', 13)}</button>
          </div>
          <div style="display:grid;gap:8px;">
            ${
              upcomingMeetings.length > 0
                ? upcomingMeetings
                    .map(
                      (m) => `
                    <div class="nx-meeting-mini">
                      <div style="min-width:0;">
                        <strong style="display:block;font-size:0.84rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(m.title)}</strong>
                        <span class="member-sub" style="font-size:0.73rem;">${escapeHtml(m.scheduledFor || 'Instant Room')}</span>
                      </div>
                      <button type="button" class="nx-btn-grad" style="height:30px;padding:0 14px;font-size:0.76rem;" data-nx-act="join-meeting" data-meeting-id="${escapeHtml(m.id)}">Join</button>
                    </div>
                  `
                    )
                    .join('')
                : `<div style="display:grid;gap:8px;">
                    <span class="member-sub" style="white-space:normal;">No meetings scheduled yet.</span>
                    <button type="button" class="nx-btn-soft" style="height:32px;" data-nx-act="open-schedule-meeting">Schedule Meeting</button>
                  </div>`
            }
          </div>
        </section>

        <section class="nx-card nx-platform-guide-card">
          <div class="nx-card-head">
            <h2 class="nx-card-title">
              <span style="color:var(--nx-primary);">${svgIcon('sparkles', 16)}</span>
              <span>Platform Shortcuts</span>
            </h2>
          </div>
          <p class="member-sub" style="margin:0 0 10px;line-height:1.45;">Quick 1-click access to all NEXORA features:</p>
          <div class="nx-quick-actions-grid">
            <button type="button" class="nx-quick-action-pill" data-nx-nav="camera">${svgIcon('camera', 14)} Nexora Camera</button>
            <button type="button" class="nx-quick-action-pill" data-nx-nav="visual-search">${svgIcon('search', 14)} Visual Search</button>
            <button type="button" class="nx-quick-action-pill" data-nx-nav="studio">${svgIcon('sparkles', 14)} Style Studio</button>
            <button type="button" class="nx-quick-action-pill" data-nx-nav="marketplace">${svgIcon('share', 14)} Exchange</button>
            <button type="button" class="nx-quick-action-pill" data-nx-nav="templates">${svgIcon('templates', 14)} AI Templates</button>
            <button type="button" class="nx-quick-action-pill" data-nx-act="open-upload-reel">${svgIcon('reels', 14)} Reel Studio</button>
            <button type="button" class="nx-quick-action-pill" data-nx-nav="messages">${svgIcon('chat', 14)} Inbox</button>
            <button type="button" class="nx-quick-action-pill" data-nx-nav="live">${svgIcon('radio', 14)} Go Live</button>
          </div>
          <div style="margin-top:10px;text-align:center;">
            <button type="button" class="nx-link-action" data-nx-act="toggle-welcome-tour">
              ${shouldShowWelcomeTour(localStorage.getItem('nx_welcome_tour_dismissed')) ? 'Minimize Launchpad ↑' : 'Show Full Launchpad ↑'}
            </button>
          </div>
        </section>

        <section class="nx-reels-promo-card">
          <h3>NEXORA Reels</h3>
          <p>Watch • Enjoy • Share short vertical stories &amp; creator clips in real-time.</p>
          <button type="button" class="nx-reels-promo-btn" data-nx-act="goto-reels">
            <span>Explore Now</span>
            ${svgIcon('arrowRight', 14)}
          </button>
        </section>

        ${
          trendingTags.length > 0
            ? `<section class="nx-card">
                <div class="nx-card-head">
                  <h2 class="nx-card-title">${svgIcon('trendUp', 16)} <span>Trending Hashtags</span></h2>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  ${trendingTags
                    .map(
                      (t) =>
                        `<button type="button" class="nx-tab-chip" style="height:30px;font-size:0.76rem;" data-nx-act="filter-hashtag" data-tag="${escapeHtml(t.tag)}">${escapeHtml(t.tag)} (${t.count})</button>`
                    )
                    .join('')}
                </div>
              </section>`
            : ''
        }
      </aside>
    `;
  }

  function renderHomeWelcomeTourHtml() {
    const isDismissed = !shouldShowWelcomeTour(localStorage.getItem('nx_welcome_tour_dismissed'));
    const progress = calculateOnboardingProgress({
      profile,
      postsCount: Math.max(Number(profile.postsCount || 0), posts.filter((p) => p.authorId === profile.id).length),
      storiesCount: stories.filter((s) => s.userId === profile.id).length,
      communitiesCount: (state.servers || []).length,
    });

    if (isDismissed) {
      return `
        <div class="nx-welcome-tour-compact" aria-label="NEXORA Platform Guide (Minimized)">
          <div class="nx-tour-compact-content">
            <span class="nx-tour-compact-icon">${svgIcon('sparkles', 15)}</span>
            <span><strong>Explore NEXORA:</strong> Reels Studio, Direct Messages, Spaces &amp; Channels, Video Meetings &amp; Live Streaming.</span>
          </div>
          <button type="button" class="nx-btn-soft nx-tour-btn-sub" data-nx-act="restore-welcome-tour" aria-label="Open Full Platform Guide">
            <span>Open Launchpad</span>
            ${svgIcon('arrowRight', 12)}
          </button>
        </div>
      `;
    }

    return `
      <section class="nx-welcome-tour-card" aria-label="NEXORA Quick Start & Platform Guide">
        <div class="nx-tour-header">
          <div>
            <div class="nx-tour-badge">
              ${svgIcon('sparkles', 13)}
              <span>What is NEXORA? · All-In-One Social Universe</span>
            </div>
            <h2 class="nx-tour-title">Welcome to NEXORA 👋 Connect. Create. Share.</h2>
            <p class="nx-tour-desc">
              Everything in one place: short vertical reels with YouTube export, instant direct &amp; group messages, Discord-style communities with voice lounges, HD video meetings, and live streaming.
            </p>
          </div>
          <button type="button" class="nx-tour-dismiss-btn" data-nx-act="dismiss-welcome-tour" title="Minimize Guide" aria-label="Minimize Guide">
            ${svgIcon('close', 13)}
            <span>Minimize</span>
          </button>
        </div>

        <div class="nx-tour-grid">
          ${PLATFORM_PILLARS.map((p) => {
            const hasSec = Boolean(p.secondaryAction);
            return `
              <article class="nx-tour-tile">
                <div>
                  <div class="nx-tour-tile-head">
                    <div class="nx-tour-tile-icon" style="background:${p.gradient};">
                      ${svgIcon(p.icon, 18)}
                    </div>
                    <div style="min-width:0;flex:1;">
                      <span class="nx-tour-tile-badge">${escapeHtml(p.badge)}</span>
                      <h3 class="nx-tour-tile-title">${escapeHtml(p.title)}</h3>
                    </div>
                  </div>
                  <p class="nx-tour-tile-body" style="margin-top:8px;">${escapeHtml(p.description)}</p>
                </div>

                <div class="nx-tour-tile-actions">
                  ${
                    p.primaryAction.act
                      ? `<button type="button" class="nx-btn-grad nx-tour-btn-main" data-nx-act="${escapeHtml(p.primaryAction.act)}">${escapeHtml(p.primaryAction.label)}</button>`
                      : `<button type="button" class="nx-btn-grad nx-tour-btn-main" data-nx-nav="${escapeHtml(p.primaryAction.nav)}">${escapeHtml(p.primaryAction.label)}</button>`
                  }
                  ${
                    hasSec
                      ? p.secondaryAction.act
                        ? `<button type="button" class="nx-btn-soft nx-tour-btn-sub" data-nx-act="${escapeHtml(p.secondaryAction.act)}">${escapeHtml(p.secondaryAction.label)}</button>`
                        : `<button type="button" class="nx-btn-soft nx-tour-btn-sub" data-nx-nav="${escapeHtml(p.secondaryAction.nav)}">${escapeHtml(p.secondaryAction.label)}</button>`
                      : ''
                  }
                </div>
              </article>
            `;
          }).join('')}
        </div>

        <div class="nx-tour-footer">
          <div class="nx-tour-progress-wrap">
            <div class="nx-tour-progress">
              <span>Getting Started (${progress.completedCount}/${progress.totalCount})</span>
              <div class="nx-tour-progress-bar">
                <div class="nx-tour-progress-fill" style="width:${progress.percent}%;"></div>
              </div>
            </div>

            <div class="nx-tour-checklist">
              ${progress.steps
                .map(
                  (s) => `
                <button type="button" class="nx-tour-check-item ${s.completed ? 'done' : ''}" ${
                  s.action.act ? `data-nx-act="${s.action.act}"` : `data-nx-nav="${s.action.nav}"`
                }>
                  <span>${s.completed ? svgIcon('check', 13) : '○'}</span>
                  <span>${escapeHtml(s.label)}</span>
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <button type="button" class="nx-link-action" data-nx-act="dismiss-welcome-tour">
            <span>Got it, hide guide</span>
          </button>
        </div>
      </section>
    `;
  }

  function renderHomeView() {
    let visiblePosts = filterAndSortFeedPosts(posts, {
      viewerUid: profile.id,
      followingIds: myFollowingIds,
      blockedSet: state.blockedSet,
      feedTab,
      hashtag: activeHashtagFilter,
    }).filter((p) => !hiddenPostIds.has(p.id) && !mutedAuthorIds.has(p.authorId));

    if (feedTab === 'for-you' && serverFeedRankedIds.length > 0) {
      const rankOrder = new Map(serverFeedRankedIds.map((id, idx) => [id, idx]));
      visiblePosts = [...visiblePosts].sort((a, b) => {
        const ra = rankOrder.has(a.id) ? rankOrder.get(a.id) : 9999;
        const rb = rankOrder.has(b.id) ? rankOrder.get(b.id) : 9999;
        if (ra !== rb) return ra - rb;
        return (b.createdAtMs || 0) - (a.createdAtMs || 0);
      });
    }

    const sliced = visiblePosts.slice(0, feedLimit);
    const hasMore = visiblePosts.length > sliced.length || hasMoreServerPosts || Boolean(serverFeedCursor);

    return `
      <div class="nx-home-grid">
        <div class="nx-feed-col">
          ${renderStoriesStripHtml()}
          ${renderHomeWelcomeTourHtml()}
          ${renderComposerCardHtml()}

          <div class="nx-feed-tabs">
            <button type="button" class="nx-tab-chip ${feedTab === 'for-you' ? 'active' : ''}" data-nx-act="set-feed-tab" data-tab="for-you">For You</button>
            <button type="button" class="nx-tab-chip ${feedTab === 'following' ? 'active' : ''}" data-nx-act="set-feed-tab" data-tab="following">Following</button>
            <button type="button" class="nx-tab-chip ${feedTab === 'latest' ? 'active' : ''}" data-nx-act="set-feed-tab" data-tab="latest">Latest</button>
            ${
              activeHashtagFilter
                ? `<button type="button" class="nx-tab-chip active" data-nx-act="clear-hashtag-filter">${escapeHtml(activeHashtagFilter)} ×</button>`
                : ''
            }
          </div>

          ${
            postsError
              ? `<div class="nx-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                  <span class="member-sub" style="white-space:normal;">${escapeHtml(postsError)}</span>
                  <button type="button" class="nx-btn-soft" data-nx-act="retry-feed-sync">Retry Sync</button>
                </div>`
              : ''
          }

          ${
            postsLoading && sliced.length === 0
              ? `<div class="nx-card" style="text-align:center;padding:34px 20px;">
                  <h3 style="margin:0 0 8px;">Syncing NEXORA Feed...</h3>
                  <p class="member-sub" style="margin:0;">Fetching the latest posts across accounts in real time.</p>
                </div>`
              : sliced.length > 0
                ? sliced.map((p) => renderPostCardHtml(p)).join('')
                : `<div class="nx-card" style="text-align:center;padding:34px 20px;">
                    <h3 style="margin:0 0 8px;">Your NEXORA Feed is Ready</h3>
                    <p class="member-sub" style="white-space:normal;max-width:440px;margin:0 auto 14px;">
                      ${
                        feedTab === 'following'
                          ? 'Follow creators in Explore or publish your first post above to see updates from your network.'
                          : 'Publish your first post, photo, or video above to start connecting and sharing with the community.'
                      }
                    </p>
                  </div>`
          }

          ${
            hasMore
              ? `<div style="text-align:center;">
                  <button type="button" class="nx-btn-soft" data-nx-act="load-more-posts">Load more posts</button>
                </div>`
              : ''
          }
        </div>

        ${renderRightRailHtml()}
      </div>
    `;
  }

  /* ---------- EXPLORE VIEW ---------- */

  function renderExploreView() {
    const publicComms = state.publicServers || [];
    const results = scoreSearchMatches(exploreQuery, {
      posts: posts.filter((p) => p.visibility === 'public' && !state.blockedSet.has(p.authorId)),
      users: (state.directoryUsers || []).filter((u) => u.id !== profile.id && !state.blockedSet.has(u.id)),
      reels,
      communities: publicComms,
    });

    return `
      <div class="nx-view-container">
        <div class="nx-card" style="display:grid;gap:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <h2 style="margin:0;font-size:1.25rem;font-weight:800;">Explore NEXORA</h2>
              <p class="member-sub" style="margin:3px 0 0;">Discover real people, trending posts, reels, hashtags, and communities.</p>
            </div>
            <input type="search" id="nx-explore-search-input" class="input" style="max-width:300px;" placeholder="Filter people, hashtags, posts..." value="${escapeHtml(exploreQuery)}" />
          </div>
          <div class="nx-feed-tabs">
            ${['all', 'people', 'nearby', 'posts', 'reels', 'hashtags', 'communities', 'products']
              .map(
                (t) =>
                  `<button type="button" class="nx-tab-chip ${exploreTab === t ? 'active' : ''}" data-nx-act="set-explore-tab" data-tab="${t}">${t === 'nearby' ? 'Nearby & Local' : t[0].toUpperCase() + t.slice(1)}</button>`
              )
              .join('')}
          </div>
          ${
            searchHistoryItems.length > 0
              ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span class="member-sub">Recent:</span>
                  ${searchHistoryItems
                    .slice(0, 6)
                    .map(
                      (h) => `
                      <span class="nx-meta-chip" style="display:inline-flex;align-items:center;gap:4px;">
                        <button type="button" class="nx-link-action" data-nx-act="apply-search-history" data-query="${escapeHtml(h.query)}">${escapeHtml(h.query)}</button>
                        <button type="button" class="nx-link-action" data-nx-act="delete-search-history" data-id="${escapeHtml(h.id)}" aria-label="Remove search history">×</button>
                      </span>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>

        ${
          exploreTab === 'nearby'
            ? `<section class="nx-card" style="display:grid;gap:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                  <div>
                    <h3 style="margin:0;font-size:1rem;">Nearby People &amp; Local Events</h3>
                    <p class="member-sub" style="margin:3px 0 0;">Privacy-safe radius discovery — raw peer coordinates are rounded and never shared.</p>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="nx-btn-grad" data-nx-act="enable-geo-discovery" ${nearbyLoading ? 'disabled' : ''}>${nearbyLoading ? 'Locating...' : nearbyCoords ? 'Update My Area' : 'Share My Area'}</button>
                    <button type="button" class="nx-btn-soft" data-nx-act="refresh-nearby-discovery" ${nearbyLoading ? 'disabled' : ''}>Refresh</button>
                    ${nearbyCoords ? `<button type="button" class="nx-btn-soft" data-nx-act="pause-nearby" data-minutes="15">Pause 15m</button>` : ''}
                    ${nearbyCoords ? `<button type="button" class="nx-btn-soft" data-nx-act="pause-nearby" data-minutes="60">Pause 1h</button>` : ''}
                    ${nearbyCoords ? `<button type="button" class="nx-btn-danger" data-nx-act="stop-nearby-discovery">Stop Sharing</button>` : ''}
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  <span class="member-sub">Radius:</span>
                  ${[
                    { km: 0.1, label: '100m' },
                    { km: 0.2, label: '200m' },
                    { km: 1, label: '1 km' },
                    { km: 10, label: '10 km' },
                    { km: 50, label: '50 km' },
                  ]
                    .map(
                      (r) =>
                        `<button type="button" class="nx-tab-chip ${nearbyRadiusKm === r.km ? 'active' : ''}" data-nx-act="set-nearby-radius" data-km="${r.km}">${r.label}</button>`
                    )
                    .join('')}
                  ${nearbyPausedUntilMs > Date.now() ? `<span class="nx-meta-chip">Discovery Paused</span>` : ''}
                </div>
                ${nearbyError ? `<p class="member-sub" style="color:var(--danger);margin:0;">${escapeHtml(nearbyError)}</p>` : ''}

                <div style="display:grid;gap:10px;">
                  <strong style="font-size:0.9rem;">People Nearby (${nearbyPeople.length})</strong>
                  ${
                    nearbyPeople.length > 0
                      ? `<div class="nx-two-col-grid">
                          ${nearbyPeople
                            .filter((p) => !state.blockedSet.has(p.uid))
                            .map((p) => `
                              <div class="file-row" style="justify-content:space-between;padding:10px;">
                                <div>
                                  <strong style="display:block;font-size:0.88rem;">${escapeHtml(p.displayName)}</strong>
                                  <span class="member-sub">@${escapeHtml(p.username)} · ${escapeHtml(p.distanceLabel || `~${p.distanceKm} km away`)}</span>
                                </div>
                                <div style="display:flex;gap:6px;">
                                  <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.76rem;" data-nx-act="view-user-profile" data-uid="${escapeHtml(p.uid)}">Profile</button>
                                  <button type="button" class="nx-btn-grad" style="height:30px;font-size:0.76rem;" data-nx-act="open-dm-user" data-uid="${escapeHtml(p.uid)}">Message</button>
                                </div>
                              </div>
                            `)
                            .join('')}
                        </div>`
                      : `<span class="member-sub">${nearbyCoords ? 'No other discoverable members within this radius yet.' : 'Click "Share My Area" above to discover people nearby.'}</span>`
                  }
                </div>

                <div style="display:grid;gap:10px;border-top:1px solid var(--border-subtle);padding-top:12px;">
                  <strong style="font-size:0.9rem;">Local Community Events (${nearbyEvents.length})</strong>
                  <form id="nx-local-event-form" style="display:grid;gap:8px;background:var(--bg-elevated);padding:12px;border-radius:12px;">
                    <div class="nx-two-col-grid">
                      <input type="text" id="nx-local-event-title" class="input" placeholder="Host a local meetup or workshop..." required maxlength="100" />
                      <input type="text" id="nx-local-event-starts" class="input" placeholder="When (e.g. Sat 5:00 PM)" required maxlength="64" />
                    </div>
                    <div class="nx-two-col-grid">
                      <input type="text" id="nx-local-event-city" class="input" placeholder="Neighborhood / City" maxlength="80" />
                      <button type="submit" class="nx-btn-grad">Publish Local Event</button>
                    </div>
                  </form>
                  ${
                    nearbyEvents.length > 0
                      ? `<div class="nx-two-col-grid">
                          ${nearbyEvents
                            .map((ev) => {
                              const going = Array.isArray(ev.rsvpUids) && ev.rsvpUids.includes(profile.id);
                              return `
                                <div class="nx-card" style="display:grid;gap:6px;padding:12px;">
                                  <strong>${escapeHtml(ev.title)}</strong>
                                  <span class="member-sub">${escapeHtml(ev.city || 'Local')} · ${escapeHtml(ev.startsAt)}${ev.distanceKm !== null ? ` · ~${ev.distanceKm} km` : ''}</span>
                                  <span class="member-sub">Hosted by ${escapeHtml(ev.hostName)} · ${(ev.rsvpUids || []).length} going</span>
                                  <button type="button" class="${going ? 'nx-btn-soft' : 'nx-btn-grad'}" style="height:32px;font-size:0.78rem;" data-nx-act="rsvp-local-event" data-event-id="${escapeHtml(ev.id)}">${going ? 'Going ✓' : 'RSVP'}</button>
                                </div>
                              `;
                            })
                            .join('')}
                        </div>`
                      : `<span class="member-sub">No local events published yet. Start one above!</span>`
                  }
                </div>
              </section>`
            : ''
        }

        ${
          (exploreTab === 'all' || exploreTab === 'people') && results.users.length > 0
            ? `<section class="nx-card" style="display:grid;gap:12px;">
                <h3 style="margin:0;font-size:1rem;">People on NEXORA (${results.users.length})</h3>
                <div class="nx-two-col-grid">
                  ${results.users
                    .map((u) => {
                      const isFollowing = myFollowingIds.has(u.id);
                      return `
                        <div class="file-row" style="justify-content:space-between;padding:12px;">
                          <button type="button" class="nx-post-author-btn" data-nx-act="view-user-profile" data-uid="${escapeHtml(u.id)}">
                            ${renderUserAvatarHtml(u, 42)}
                            <div>
                              <strong style="display:block;font-size:0.9rem;">${escapeHtml(u.displayName)}</strong>
                              <span class="member-sub">@${escapeHtml(u.username)}</span>
                            </div>
                          </button>
                          <div style="display:flex;gap:6px;">
                            <button type="button" class="${isFollowing ? 'nx-btn-soft' : 'nx-btn-grad'}" style="height:32px;font-size:0.78rem;" data-nx-act="toggle-follow" data-uid="${escapeHtml(u.id)}">${isFollowing ? 'Following' : 'Follow'}</button>
                            <button type="button" class="nx-btn-soft" style="height:32px;font-size:0.78rem;" data-nx-act="open-dm-user" data-uid="${escapeHtml(u.id)}">Message</button>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </section>`
            : ''
        }

        ${
          (exploreTab === 'all' || exploreTab === 'hashtags') && results.hashtags.length > 0
            ? `<section class="nx-card" style="display:grid;gap:10px;">
                <h3 style="margin:0;font-size:1rem;">Trending Hashtags</h3>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${results.hashtags
                    .map(
                      (h) =>
                        `<button type="button" class="nx-tab-chip" data-nx-act="filter-hashtag" data-tag="${escapeHtml(h.tag)}">${escapeHtml(h.tag)} · ${h.count} posts</button>`
                    )
                    .join('')}
                </div>
              </section>`
            : ''
        }

        ${
          exploreTab === 'all' || exploreTab === 'posts'
            ? `<section style="display:grid;gap:14px;">
                ${
                  results.posts.length > 0
                    ? results.posts.map((p) => renderPostCardHtml(p)).join('')
                    : `<div class="nx-card"><span class="member-sub">No matching public posts yet.</span></div>`
                }
              </section>`
            : ''
        }

        ${
          exploreTab === 'reels'
            ? `<section class="nx-two-col-grid">
                ${
                  results.reels.length > 0
                    ? results.reels
                        .map(
                          (r, idx) => `
                        <div class="nx-card" style="display:grid;gap:10px;">
                          <video src="${escapeHtml(sanitizeSafeUrl(r.videoUrl))}" controls muted playsinline style="width:100%;max-height:240px;border-radius:12px;background:#090915;"></video>
                          <strong>${escapeHtml(r.authorName)}</strong>
                          <span class="member-sub" style="white-space:normal;">${escapeHtml(r.caption)}</span>
                          <button type="button" class="nx-btn-grad" data-nx-act="open-reel-at" data-idx="${idx}">Watch in Reels</button>
                        </div>
                      `
                        )
                        .join('')
                    : `<div class="nx-card"><span class="member-sub">No reels uploaded yet.</span></div>`
                }
              </section>`
            : ''
        }

        ${
          exploreTab === 'products'
            ? `<section class="nx-two-col-grid">
                ${
                  exploreProducts.length > 0
                    ? exploreProducts
                        .map(
                      (pr) => `
                        <div class="nx-card" style="display:grid;gap:8px;">
                          <strong>${escapeHtml(pr.title)}</strong>
                          <span class="member-sub">${escapeHtml(pr.merchantName || 'Merchant')} · ${escapeHtml(pr.category || 'Catalog')} · $${(Number(pr.priceCents || 0) / 100).toFixed(2)}</span>
                          <button type="button" class="nx-btn-grad" data-nx-nav="marketplace" data-product-id="${escapeHtml(String(pr.id))}">View in Exchange</button>
                        </div>`
                    )
                    .join('')
                    : `<div class="nx-card"><span class="member-sub">No Exchange products match this search yet. <button type="button" class="nx-link-action" data-nx-nav="marketplace">Browse Exchange</button></span></div>`
                }
              </section>`
            : ''
        }

        ${
          exploreTab === 'communities'
            ? `<section class="nx-two-col-grid">
                ${
                  results.communities.length > 0
                    ? results.communities
                        .map(
                          (c) => `
                        <div class="nx-card" style="display:grid;gap:8px;">
                          <strong>${escapeHtml(c.name)}</strong>
                          <span class="member-sub">${escapeHtml(c.category || 'Community')}</span>
                          <p class="member-sub" style="white-space:normal;margin:0;">${escapeHtml(c.description || '')}</p>
                          <button type="button" class="nx-btn-grad" data-nx-act="goto-communities">Open in Communities</button>
                        </div>
                      `
                        )
                        .join('')
                    : `<div class="nx-card"><span class="member-sub">No public communities found.</span></div>`
                }
              </section>`
            : ''
        }
      </div>
    `;
  }

  /* ---------- REELS VIEW & INSTAGRAM-STYLE STUDIO ---------- */

  function renderReelTextOverlaysHtml(overlays, selectedId = '', interactive = false) {
    const clean = sanitizeReelTextOverlays(overlays);
    return clean
      .map((ov) => {
        const meta = getReelTextStyleMeta(ov.style);
        const bgClass = `bg-${ov.bgMode || 'pill'}`;
        const isSelected = interactive && ov.id === selectedId;
        const textColor = ov.bgMode === 'pill' && ov.color.toUpperCase() === '#FFFFFF' ? '#101124' : ov.color;
        const neonShadow = meta.neon ? 'text-shadow:0 0 12px #A735FF, 0 0 22px #701CFF;' : '';
        const textTransform = meta.uppercase ? 'uppercase' : 'none';
        const display = meta.uppercase ? ov.text.toUpperCase() : ov.text;
        return `
          <div
            class="nx-reel-text-item ${bgClass} ${isSelected ? 'selected' : ''}"
            ${interactive ? `data-overlay-id="${escapeHtml(ov.id)}"` : ''}
            style="left:${ov.x}%;top:${ov.y}%;font-family:${meta.fontFamily};font-weight:${meta.fontWeight};letter-spacing:${meta.letterSpacing};font-size:${ov.fontSize}px;color:${escapeHtml(textColor)};text-transform:${textTransform};${neonShadow}"
          >${escapeHtml(display)}</div>
        `;
      })
      .join('');
  }

  function resetReelStudio() {
    studioAudioEngine.stop();
    if (reelStudio.blobObjectUrl) {
      try { URL.revokeObjectURL(reelStudio.blobObjectUrl); } catch {}
    }
    if (reelStudio.lastExportedBlobUrl) {
      try { URL.revokeObjectURL(reelStudio.lastExportedBlobUrl); } catch {}
    }
    reelStudio = createInitialReelStudioState();

    const form = document.getElementById('create-reel-form');
    if (form instanceof HTMLFormElement) form.reset();

    const vidEl = document.getElementById('reel-studio-video');
    if (vidEl instanceof HTMLVideoElement) {
      vidEl.pause();
      vidEl.removeAttribute('src');
      vidEl.load();
      vidEl.hidden = true;
    }
    const ytEl = document.getElementById('reel-studio-youtube');
    if (ytEl instanceof HTMLIFrameElement) {
      ytEl.src = 'about:blank';
      ytEl.hidden = true;
    }
    const statusEl = document.getElementById('reel-export-status');
    if (statusEl) statusEl.innerHTML = '';
  }

  function setReelStudioTab(tabName) {
    const allowed = new Set(['source', 'templates', 'music', 'text', 'filters', 'youtube']);
    const next = allowed.has(tabName) ? tabName : 'source';
    reelStudio.activeTab = next;
    document.querySelectorAll('#create-reel-modal .nx-studio-tab[data-reel-tab]').forEach((btn) => {
      const active = btn.getAttribute('data-reel-tab') === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('#create-reel-modal .nx-studio-pane[data-reel-pane]').forEach((pane) => {
      const active = pane.getAttribute('data-reel-pane') === next;
      pane.classList.toggle('active', active);
      pane.hidden = !active;
    });
  }

  function getStudioDisplaySongTitle() {
    const customInput = document.getElementById('reel-audio-input');
    const typed = customInput instanceof HTMLInputElement ? customInput.value.trim() : '';
    if (typed) return typed;
    if (reelStudio.audioTitle) return reelStudio.audioTitle;
    const meta = getSoundtrackMeta(reelStudio.audioTrackId);
    return meta.id === 'original' ? 'Original Video Audio' : `${meta.title} — ${meta.artist}`;
  }

  function playStudioSongPreview() {
    if (!reelStudio.audioTrackId || reelStudio.audioTrackId === 'original') {
      studioAudioEngine.stop();
      return;
    }
    studioAudioEngine.play({
      trackId: reelStudio.audioTrackId,
      audioDataUrl: reelStudio.audioDataUrl,
      volume: reelStudio.musicVolume,
      muted: reelStudio.previewMuted,
    });
  }

  function renderReelStudioControls() {
    const songLibEl = document.getElementById('studio-song-library');
    if (songLibEl) {
      const tracks = REEL_SOUNDTRACKS.filter((t) => t.id !== 'custom' || Boolean(reelStudio.audioDataUrl));
      songLibEl.innerHTML = tracks
        .map(
          (t) => `
          <button type="button" class="nx-song-row ${reelStudio.audioTrackId === t.id ? 'active' : ''}" data-studio-pick-song="${escapeHtml(t.id)}">
            <div style="text-align:left;min-width:0;">
              <div style="font-weight:700;font-size:0.82rem;color:var(--nx-text);">${escapeHtml(t.title)}</div>
              <div class="member-sub">${escapeHtml(t.artist)}${t.bpm ? ` • ${t.bpm} BPM` : ''}</div>
            </div>
            <span class="kbd-chip">${reelStudio.audioTrackId === t.id ? 'Selected' : 'Use'}</span>
          </button>
        `
        )
        .join('');
    }

    const chipsEl = document.getElementById('studio-text-chips');
    if (chipsEl) {
      chipsEl.innerHTML =
        reelStudio.textOverlays
          .map(
            (ov, idx) => `
            <button type="button" class="nx-tab-chip ${ov.id === reelStudio.selectedTextId ? 'active' : ''}" data-select-overlay="${escapeHtml(ov.id)}">
              ${escapeHtml((ov.text || `Text ${idx + 1}`).slice(0, 18))}
            </button>
          `
          )
          .join('') || '<span class="member-sub">Click "+ Add Text" to place Instagram-style text edits on your Reel.</span>';
    }

    const selected = reelStudio.textOverlays.find((o) => o.id === reelStudio.selectedTextId) || reelStudio.textOverlays[0] || null;
    if (selected && reelStudio.selectedTextId !== selected.id) {
      reelStudio.selectedTextId = selected.id;
    }

    const textValEl = document.getElementById('studio-text-value-input');
    const styleEl = document.getElementById('studio-text-style-select');
    const bgEl = document.getElementById('studio-text-bg-select');
    const sizeRangeEl = document.getElementById('studio-text-size-range');
    const sizeLabelEl = document.getElementById('studio-text-size-label');
    const deleteBtn = document.getElementById('studio-text-delete-btn');
    const colorsEl = document.getElementById('studio-text-colors');

    if (textValEl instanceof HTMLInputElement) {
      textValEl.disabled = !selected;
      if (document.activeElement !== textValEl) {
        textValEl.value = selected ? selected.text : '';
      }
    }
    if (styleEl instanceof HTMLSelectElement) {
      styleEl.disabled = !selected;
      if (selected) styleEl.value = selected.style || 'modern';
    }
    if (bgEl instanceof HTMLSelectElement) {
      bgEl.disabled = !selected;
      if (selected) bgEl.value = selected.bgMode || 'pill';
    }
    if (sizeRangeEl instanceof HTMLInputElement) {
      sizeRangeEl.disabled = !selected;
      sizeRangeEl.value = String(selected ? selected.fontSize : 24);
    }
    if (sizeLabelEl) sizeLabelEl.textContent = `${selected ? selected.fontSize : 24}px`;
    if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = !selected;

    if (colorsEl) {
      colorsEl.innerHTML = REEL_TEXT_COLORS.map(
        (hex) => `
          <button
            type="button"
            class="nx-color-swatch ${selected && selected.color.toUpperCase() === hex ? 'active' : ''}"
            style="background:${hex};"
            data-studio-text-color="${hex}"
            aria-label="Text color ${hex}"
            ${!selected ? 'disabled' : ''}
          ></button>
        `
      ).join('');
    }

    const templateGridEl = document.getElementById('studio-template-grid');
    if (templateGridEl) {
      templateGridEl.innerHTML = REEL_VIDEO_TEMPLATES.map(
        (tpl) => `
          <button type="button" class="nx-template-card ${reelStudio.templateId === tpl.id ? 'active' : ''}" data-studio-template="${escapeHtml(tpl.id)}">
            <div class="nx-template-card-head">
              <strong class="nx-template-card-title">${escapeHtml(tpl.name)}</strong>
              <span class="nx-template-card-meta">${escapeHtml(tpl.badge)}</span>
            </div>
            <span class="nx-template-card-desc">${escapeHtml(tpl.description)}</span>
          </button>
        `
      ).join('');
    }

    const filterGridEl = document.getElementById('studio-filter-grid');
    if (filterGridEl) {
      filterGridEl.innerHTML = REEL_FILTERS.map(
        (f) => `
          <button type="button" class="nx-filter-btn ${reelStudio.filterName === f.id ? 'active' : ''}" data-studio-filter="${escapeHtml(f.id)}">
            <span class="nx-filter-swatch" style="background:${escapeHtml(f.swatch || '#cbd5e1')};"></span>
            <span>${escapeHtml(f.label)}</span>
          </button>
        `
      ).join('');
    }

    const lensGridEl = document.getElementById('studio-lens-grid');
    if (lensGridEl) {
      const placedIds = new Set(reelStudio.textOverlays.map((o) => o.id));
      lensGridEl.innerHTML = SNAP_LENS_STICKERS.map(
        (lens) => `
          <button type="button" class="nx-lens-btn ${placedIds.has(lens.id) ? 'active' : ''}" data-studio-lens="${escapeHtml(lens.id)}">
            ${escapeHtml(lens.label)}
          </button>
        `
      ).join('');
    }

    const speedLabelEl = document.getElementById('studio-speed-label');
    if (speedLabelEl) speedLabelEl.textContent = `${Number(reelStudio.playbackSpeed).toFixed(1)}x`;
    document.querySelectorAll('#studio-speed-row [data-studio-speed]').forEach((btn) => {
      const active = Number(btn.getAttribute('data-studio-speed')) === Number(reelStudio.playbackSpeed);
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-secondary', !active);
    });

    const musicVolLabel = document.getElementById('studio-music-vol-label');
    const videoVolLabel = document.getElementById('studio-video-vol-label');
    if (musicVolLabel) musicVolLabel.textContent = `${Math.round(reelStudio.musicVolume * 100)}%`;
    if (videoVolLabel) videoVolLabel.textContent = `${Math.round(reelStudio.videoVolume * 100)}%`;

    const ytBanner = document.getElementById('studio-yt-detected');
    if (ytBanner) ytBanner.hidden = !(reelStudio.sourceType === 'youtube' && reelStudio.youtubeId);

    const songPill = document.getElementById('reel-studio-song-pill');
    if (songPill) songPill.textContent = `♪ ${getStudioDisplaySongTitle()}`;
  }

  function syncReelStudioPreview() {
    const emptyEl = document.getElementById('reel-studio-empty');
    const stageEl = document.getElementById('reel-studio-stage');
    const vidEl = document.getElementById('reel-studio-video');
    const ytEl = document.getElementById('reel-studio-youtube');
    const layerEl = document.getElementById('reel-studio-overlay-layer');
    const muteBtn = document.getElementById('studio-mute-toggle');
    const filterCss = getReelFilterCss(reelStudio.filterName);

    if (stageEl) {
      const [c0, c1, c2] = reelStudio.backdropColors || ['#101124', '#4C1D95', '#286BFF'];
      stageEl.style.background = `linear-gradient(155deg, ${c0} 0%, ${c1} 55%, ${c2} 100%)`;
      stageEl.style.filter = !reelStudio.blobObjectUrl && !reelStudio.videoUrl && !reelStudio.youtubeId ? filterCss : '';
    }

    if (reelStudio.sourceType === 'youtube' && reelStudio.youtubeId) {
      if (emptyEl) emptyEl.hidden = true;
      if (vidEl instanceof HTMLVideoElement) {
        vidEl.pause();
        vidEl.hidden = true;
      }
      if (ytEl instanceof HTMLIFrameElement) {
        const nextEmbed = getYouTubeEmbedUrl(reelStudio.youtubeId, {
          autoplay: false,
          mute: reelStudio.previewMuted || reelStudio.audioTrackId !== 'original',
          loop: true,
        });
        if (ytEl.getAttribute('data-embed-src') !== nextEmbed) {
          ytEl.setAttribute('data-embed-src', nextEmbed);
          ytEl.src = nextEmbed;
        }
        ytEl.style.filter = filterCss;
        ytEl.hidden = false;
      }
    } else if (reelStudio.blobObjectUrl || reelStudio.videoUrl) {
      const targetSrc = reelStudio.blobObjectUrl || reelStudio.videoUrl;
      if (emptyEl) emptyEl.hidden = true;
      if (ytEl instanceof HTMLIFrameElement) {
        ytEl.hidden = true;
        if (ytEl.getAttribute('data-embed-src')) {
          ytEl.removeAttribute('data-embed-src');
          ytEl.src = 'about:blank';
        }
      }
      if (vidEl instanceof HTMLVideoElement) {
        if (vidEl.getAttribute('data-src-key') !== targetSrc) {
          vidEl.setAttribute('data-src-key', targetSrc);
          vidEl.src = targetSrc;
          vidEl.play().catch(() => {});
        }
        vidEl.style.filter = filterCss;
        vidEl.playbackRate = Number(reelStudio.playbackSpeed || 1);
        vidEl.volume = reelStudio.previewMuted ? 0 : reelStudio.videoVolume;
        vidEl.muted = reelStudio.previewMuted || reelStudio.videoVolume === 0;
        vidEl.hidden = false;
      }
    } else {
      if (emptyEl) emptyEl.hidden = false;
      if (vidEl instanceof HTMLVideoElement) {
        vidEl.pause();
        vidEl.hidden = true;
      }
      if (ytEl instanceof HTMLIFrameElement) {
        ytEl.hidden = true;
      }
    }

    if (layerEl) {
      layerEl.innerHTML = renderReelTextOverlaysHtml(reelStudio.textOverlays, reelStudio.selectedTextId, true);
    }

    if (muteBtn) {
      muteBtn.textContent = reelStudio.previewMuted ? 'Audio Muted' : 'Audio On';
    }
    studioAudioEngine.setVolume(reelStudio.musicVolume, reelStudio.previewMuted);
  }

  function openReelStudioModal() {
    feedAudioEngine.stop();
    lastFeedReelKey = '';
    const activeVid = document.getElementById('nx-active-reel-video');
    if (activeVid instanceof HTMLVideoElement) activeVid.pause();

    resetReelStudio();
    setReelStudioTab('source');
    renderReelStudioControls();
    syncReelStudioPreview();
    openModal('create-reel-modal');
  }

  async function runReelExportForYouTube({
    videoEl = null,
    youtubeTitle = '',
    filterId = 'none',
    textOverlays = [],
    audioTrackId = 'original',
    audioDataUrl = '',
    musicVolume = 0.75,
    backdropColors = reelStudio.backdropColors,
    statusEl = null,
    triggerBtn = null,
  } = {}) {
    if (triggerBtn instanceof HTMLButtonElement) triggerBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Rendering edited 9:16 video (0%)...';
    try {
      const { blob, filename, usedPosterFallback } = await exportEditedReelForYouTube({
        videoEl,
        youtubeTitle,
        filterId,
        textOverlays,
        audioTrackId,
        audioDataUrl,
        musicVolume,
        backdropColors,
        durationSec: 4,
        onProgress: (pct) => {
          if (statusEl) statusEl.textContent = `Rendering edited 9:16 video (${pct}%)...`;
        },
      });
      if (reelStudio.lastExportedBlobUrl) {
        try { URL.revokeObjectURL(reelStudio.lastExportedBlobUrl); } catch {}
      }
      const dlUrl = URL.createObjectURL(blob);
      reelStudio.lastExportedBlobUrl = dlUrl;
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      if (statusEl) {
        statusEl.innerHTML = `${usedPosterFallback ? 'Rendered stylized Reel card + text/song' : 'Rendered video with text, filter & song'} (${Math.max(1, Math.round(blob.size / 1024))} KB). <a href="${dlUrl}" download="${escapeHtml(filename)}" class="nx-hashtag-link">Download ${escapeHtml(filename)}</a> — then upload in YouTube Studio.`;
      }
      showToast('Edited Reel downloaded! Open YouTube Studio Upload ↗ to post to YouTube.', 'success');
    } catch (err) {
      const msg = formatFriendlyError(err, 'Could not export Reel video in this browser.');
      if (statusEl) statusEl.textContent = msg;
      showToast(msg);
    } finally {
      if (triggerBtn instanceof HTMLButtonElement) triggerBtn.disabled = false;
    }
  }

  function renderPhotoStudioControls() {
    const tplGrid = document.getElementById('photo-studio-template-grid');
    if (tplGrid) {
      tplGrid.innerHTML = PHOTO_TEMPLATES.map(
        (tpl) => `
          <button type="button" class="nx-template-card ${photoStudio.templateId === tpl.id ? 'active' : ''}" data-photo-tpl="${escapeHtml(tpl.id)}">
            <div class="nx-template-card-head">
              <strong class="nx-template-card-title">${escapeHtml(tpl.name)}</strong>
            </div>
            <span class="nx-template-card-desc">${escapeHtml(tpl.description)}</span>
          </button>
        `
      ).join('');
    }
    const filterGrid = document.getElementById('photo-studio-filter-grid');
    if (filterGrid) {
      filterGrid.innerHTML = REEL_FILTERS.map(
        (f) => `
          <button type="button" class="nx-filter-btn ${photoStudio.filterId === f.id ? 'active' : ''}" data-photo-filter="${escapeHtml(f.id)}">
            <span class="nx-filter-swatch" style="background:${escapeHtml(f.swatch || '#cbd5e1')};"></span>
            <span>${escapeHtml(f.label)}</span>
          </button>
        `
      ).join('');
    }
    const headlineEl = document.getElementById('photo-studio-headline');
    if (headlineEl instanceof HTMLInputElement && document.activeElement !== headlineEl) {
      headlineEl.value = photoStudio.headline;
    }
    const sublineEl = document.getElementById('photo-studio-subline');
    if (sublineEl instanceof HTMLInputElement && document.activeElement !== sublineEl) {
      sublineEl.value = photoStudio.subline;
    }
    const stickerEl = document.getElementById('photo-studio-sticker');
    if (stickerEl instanceof HTMLSelectElement) {
      stickerEl.value = photoStudio.stickerText;
    }
  }

  async function refreshPhotoStudioPreview() {
    try {
      const rendered = await renderPhotoTemplateToDataUrl({
        imageDataUrl: photoStudio.imageDataUrl,
        templateId: photoStudio.templateId,
        filterId: photoStudio.filterId,
        stickerText: photoStudio.stickerText,
        headline: photoStudio.headline,
        subline: photoStudio.subline || `@${profile.username || 'nexora'}`,
        authorHandle: profile.username || 'nexora',
      });
      photoStudio.renderedDataUrl = rendered;
      const imgEl = document.getElementById('photo-studio-preview-img');
      if (imgEl instanceof HTMLImageElement) {
        imgEl.src = rendered;
      }
    } catch {
      // Keep previous preview if image decode fails
    }
  }

  function openPhotoStudioModal() {
    const fileInput = document.getElementById('photo-studio-file-input');
    if (fileInput instanceof HTMLInputElement) fileInput.value = '';
    if (!photoStudio.subline) {
      photoStudio.subline = `@${profile.username || 'nexora'}`;
    }
    renderPhotoStudioControls();
    refreshPhotoStudioPreview();
    openModal('photo-studio-modal');
  }

  function syncActiveReelPlayback() {
    if (currentSection !== 'reels') {
      feedAudioEngine.stop();
      lastFeedReelKey = '';
      return;
    }
    const activeReel = reels[activeReelIndex] || null;
    if (!activeReel) {
      feedAudioEngine.stop();
      lastFeedReelKey = '';
      return;
    }

    const hasCustomAudio = Boolean(activeReel.audioTrackId && activeReel.audioTrackId !== 'original');
    const vidEl = document.getElementById('nx-active-reel-video');
    if (vidEl instanceof HTMLVideoElement) {
      const speed = Number(activeReel.playbackSpeed || 1);
      vidEl.playbackRate = Number.isFinite(speed) ? Math.min(4, Math.max(0.25, speed)) : 1;
      const vVol = activeReel.videoVolume !== undefined ? Number(activeReel.videoVolume) : hasCustomAudio ? 0.45 : 1;
      vidEl.volume = reelMuted ? 0 : Math.min(1, Math.max(0, Number.isFinite(vVol) ? vVol : 0.7));
      vidEl.muted = reelMuted || vVol === 0;
    }

    const nextKey = `${activeReel.id}|${activeReel.audioTrackId || 'original'}|${reelMuted ? 'm' : 'u'}`;
    if (!hasCustomAudio) {
      feedAudioEngine.stop();
      lastFeedReelKey = nextKey;
      return;
    }

    if (lastFeedReelKey !== nextKey) {
      const justMuteToggle = lastFeedReelKey.startsWith(`${activeReel.id}|`);
      lastFeedReelKey = nextKey;
      if (justMuteToggle && feedAudioEngine.activeTrackId === activeReel.audioTrackId) {
        feedAudioEngine.setVolume(activeReel.musicVolume ?? 0.75, reelMuted);
      } else {
        feedAudioEngine.play({
          trackId: activeReel.audioTrackId,
          audioDataUrl: activeReel.audioDataUrl || '',
          volume: activeReel.musicVolume ?? 0.75,
          muted: reelMuted,
        });
      }
    }
  }

  function renderReelsView() {
    if (activeReelIndex >= reels.length) {
      activeReelIndex = Math.max(0, reels.length - 1);
    }
    const activeReel = reels[activeReelIndex] || null;
    if (activeReel) ensureReelCommentsSubscription(activeReel.id);
    const activeComments = activeReel ? reelCommentsMap.get(activeReel.id) || [] : [];
    const isLiked = activeReel ? (activeReel.likesUids || []).includes(profile.id) : false;
    const isReelBookmarked = activeReel
      ? state.bookmarks.some((b) => b.sourceType === 'reel' && b.sourceId === activeReel.id)
      : false;
    const isFollowing = activeReel ? myFollowingIds.has(activeReel.authorId) : false;
    const ytId = activeReel ? activeReel.youtubeId || parseYouTubeVideoId(activeReel.videoUrl) : '';
    const filterCss = activeReel ? getReelFilterCss(activeReel.filterName) : 'none';
    const hasCustomAudio = Boolean(activeReel?.audioTrackId && activeReel.audioTrackId !== 'original');
    const overlaysHtml = activeReel ? renderReelTextOverlaysHtml(activeReel.textOverlays || [], '', false) : '';

    const reelAuthor = activeReel
      ? resolveUserDisplay(activeReel.authorId, {
          displayName: activeReel.authorName,
          username: activeReel.authorUsername,
          avatar: activeReel.authorAvatar,
        })
      : null;

    return `
      <div class="nx-reels-shell">
        <div class="nx-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;font-size:1.2rem;font-weight:800;">NEXORA Reels Studio &amp; Feed</h2>
            <p class="member-sub" style="margin:2px 0 0;">Watch • Add Songs • Text Edit • Import &amp; Upload to YouTube</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <a
              href="https://studio.youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              class="nx-btn-soft"
              style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;"
            >
              <span>YouTube Studio ↗</span>
            </a>
            <button type="button" class="nx-btn-grad" data-nx-act="open-upload-reel">${svgIcon('plus', 15)} <span>Create / Edit Reel</span></button>
          </div>
        </div>

        ${
          !activeReel
            ? `<div class="nx-card" style="text-align:center;padding:44px 24px;display:grid;gap:12px;justify-items:center;">
                <h3>No Reels Uploaded Yet</h3>
                <p class="member-sub" style="max-width:460px;white-space:normal;">Open NEXORA Reel Studio to upload a clip or import a YouTube Short, add songs, place draggable Instagram-style text edits, and export directly for YouTube.</p>
                <button type="button" class="nx-btn-grad" data-nx-act="open-upload-reel">Open Reel Studio</button>
              </div>`
            : `<div class="nx-reel-stage">
                <div class="nx-reel-player-box">
                  ${
                    ytId
                      ? `<iframe id="nx-active-reel-yt" src="${escapeHtml(getYouTubeEmbedUrl(ytId, { autoplay: prefs.autoplayReels !== false, mute: reelMuted || hasCustomAudio, loop: true }))}" title="YouTube Reel Player" style="filter:${escapeHtml(filterCss)};" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
                      : `<video id="nx-active-reel-video" src="${escapeHtml(activeReel.videoUrl)}" style="filter:${escapeHtml(filterCss)};" ${prefs.autoplayReels !== false ? 'autoplay' : ''} loop playsinline ${reelMuted ? 'muted' : ''}></video>`
                  }

                  <div class="nx-reel-overlay-layer" id="nx-active-reel-overlays">${overlaysHtml}</div>

                  <div class="nx-reel-side-actions">
                    <button type="button" class="nx-reel-circle-btn ${isLiked ? 'liked' : ''}" data-nx-act="toggle-like-reel" data-reel-id="${escapeHtml(activeReel.id)}" aria-label="Like reel">
                      ${svgIcon(isLiked ? 'heartFilled' : 'heart', 19)}
                    </button>
                    <span style="color:#fff;font-size:0.76rem;font-weight:700;">${formatCompactCount(activeReel.likesCount || (activeReel.likesUids || []).length)}</span>

                    <button type="button" class="nx-reel-circle-btn" data-nx-act="toggle-reel-mute" aria-label="Mute or unmute reel">
                      ${svgIcon(reelMuted ? 'volumeMute' : 'volume', 18)}
                    </button>
                    ${
                      !ytId
                        ? `<button type="button" class="nx-reel-circle-btn" data-nx-act="toggle-reel-play" aria-label="Play or pause reel">
                            ${svgIcon('play', 18)}
                          </button>`
                        : ''
                    }
                    <button type="button" class="nx-reel-circle-btn ${isReelBookmarked ? 'liked' : ''}" data-nx-act="bookmark-reel" data-reel-id="${escapeHtml(activeReel.id)}" aria-label="${isReelBookmarked ? 'Remove bookmark' : 'Bookmark reel'}">
                      ${svgIcon(isReelBookmarked ? 'bookmarkFilled' : 'bookmark', 18)}
                    </button>
                  </div>

                  <div class="nx-reel-overlay-bottom">
                    <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
                      <button type="button" class="nx-post-author-btn" style="color:#fff;" data-nx-act="view-user-profile" data-uid="${escapeHtml(activeReel.authorId)}">
                        ${renderUserAvatarHtml(reelAuthor, 34)}
                        <strong>@${escapeHtml(reelAuthor.username || activeReel.authorUsername || 'creator')}</strong>
                      </button>
                      ${
                        activeReel.authorId !== profile.id
                          ? `<button type="button" class="nx-btn-grad" style="height:28px;font-size:0.75rem;padding:0 12px;" data-nx-act="toggle-follow" data-uid="${escapeHtml(activeReel.authorId)}">${isFollowing ? 'Following' : 'Follow'}</button>`
                          : ''
                      }
                    </div>
                    <div style="font-size:0.86rem;line-height:1.35;">${escapeHtml(activeReel.caption)}</div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.74rem;opacity:0.88;">
                      <span>♪ ${escapeHtml(activeReel.audioTitle || 'Original Audio — NEXORA')}</span>
                      ${activeReel.filterName && activeReel.filterName !== 'none' ? `<span>• Filter: ${escapeHtml(activeReel.filterName)}</span>` : ''}
                      ${ytId ? '<span>• YouTube</span>' : ''}
                    </div>
                  </div>
                </div>

                <div style="display:grid;gap:14px;">
                  <div class="nx-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <button type="button" class="nx-btn-soft" data-nx-act="prev-reel" ${activeReelIndex === 0 ? 'disabled' : ''}>Previous Reel</button>
                    <span class="member-sub">Reel ${activeReelIndex + 1} of ${reels.length}</span>
                    <button type="button" class="nx-btn-grad" data-nx-act="next-reel" ${activeReelIndex >= reels.length - 1 ? 'disabled' : ''}>Next Reel</button>
                  </div>

                  <div class="nx-card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                    <div style="min-width:0;">
                      <strong style="font-size:0.88rem;">Upload / Export to YouTube</strong>
                      <div class="member-sub" id="nx-feed-export-status" style="white-space:normal;">Render this edited Reel with text overlays &amp; music into WebM, then upload to YouTube Studio.</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                      <button type="button" class="nx-btn-soft" data-nx-act="export-active-reel">Render for YouTube</button>
                      <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer" class="nx-btn-grad" style="text-decoration:none;display:inline-flex;align-items:center;">YouTube Studio ↗</a>
                    </div>
                  </div>

                  <div class="nx-card" style="display:grid;gap:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <h3 style="margin:0;font-size:0.95rem;">Reel Comments (${activeComments.length})</h3>
                      ${
                        activeReel.authorId === profile.id || isCurrentUserAdmin
                          ? `<button type="button" class="nx-btn-danger" style="height:30px;font-size:0.76rem;" data-nx-act="delete-reel" data-reel-id="${escapeHtml(activeReel.id)}">Delete Reel</button>`
                          : ''
                      }
                    </div>
                    <div style="max-height:280px;overflow-y:auto;display:grid;gap:8px;">
                      ${
                        activeComments
                          .map((c) => {
                            const rcAuthor = resolveUserDisplay(c.authorId, { displayName: c.authorName, avatar: c.authorAvatar });
                            return `
                          <div class="nx-comment-item">
                            ${renderUserAvatarHtml(rcAuthor, 28)}
                            <div>
                              <strong style="font-size:0.8rem;">${escapeHtml(rcAuthor.displayName || c.authorName)}</strong>
                              <div style="font-size:0.82rem;">${escapeHtml(c.content)}</div>
                            </div>
                          </div>
                        `;
                          })
                          .join('') || '<span class="member-sub">No comments yet.</span>'
                      }
                    </div>
                    <form class="nx-comment-form" data-nx-comment-reel="${escapeHtml(activeReel.id)}">
                      <input type="text" name="commentText" placeholder="Add a comment..." maxlength="1500" required />
                      <button type="submit" class="nx-btn-grad">Send</button>
                    </form>
                  </div>
                </div>
              </div>`
        }
      </div>
    `;
  }

  /* ---------- VIDEO CALLS & MEETINGS HUB ---------- */

  function renderCallsView() {
    const rtcState = getRtcState();
    const activeCall = rtcState.activeCall;
    const isMeetingActive = activeCall && (activeCall.kind === 'meeting' || activeMeetingId);
    const activeMeeting = meetings.find((m) => m.id === activeMeetingId);

    return `
      <div class="nx-view-container">
        <div class="nx-card" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;font-weight:800;">Video Calls &amp; Meetings</h2>
            <p class="member-sub" style="margin:3px 0 0;">HD video conferencing, screen sharing, and real-time in-meeting chat.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="nx-btn-grad" data-nx-act="start-instant-meeting">${svgIcon('video', 15)} <span>Start Instant Meeting</span></button>
            <button type="button" class="nx-btn-soft" data-nx-act="open-schedule-meeting">${svgIcon('calendar', 15)} <span>Schedule Meeting</span></button>
          </div>
        </div>

        <div class="nx-card">
          <form id="nx-join-code-form" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <input type="text" id="nx-meeting-code-input" class="input" style="flex:1;min-width:200px;" placeholder="Enter Meeting Code (e.g. NX-AB12-CD34)..." required />
            <button type="submit" class="nx-btn-grad">Join by Code</button>
          </form>
        </div>

        ${
          isMeetingActive && activeCall
            ? `<div class="nx-home-grid" style="grid-template-columns:minmax(0,1fr) 310px;">
                <div class="nx-card" style="display:grid;gap:14px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                    <div>
                      <h3 style="margin:0;">${escapeHtml(activeMeeting?.title || activeCall.title || 'Live Meeting')}</h3>
                      <div class="member-sub">Code: <strong class="mono">${escapeHtml(activeMeeting?.code || activeCall.id)}</strong> · ${(rtcState.peers || []).length || 1} participant(s)</div>
                    </div>
                    <button type="button" class="nx-btn-danger" data-nx-act="leave-meeting">${svgIcon('phoneOff', 14)} <span>Leave Meeting</span></button>
                  </div>

                  <div class="rtc-stage-grid" id="nx-meeting-rtc-stage">
                    ${(rtcState.peers && rtcState.peers.length > 0
                      ? rtcState.peers
                      : [{ userId: profile.id, displayName: profile.displayName, initials: profile.initials, muted: rtcState.muted, videoOn: rtcState.videoOn, screenSharing: rtcState.screenSharing }]
                    )
                      .map((p) => {
                        const isMe = p.userId === profile.id;
                        const hasVid = isMe
                          ? Boolean(rtcState.screenStream || rtcState.localStream?.getVideoTracks().length)
                          : Boolean(rtcState.remoteStreams?.get(p.userId)?.getVideoTracks().length);
                        return `
                          <div class="rtc-video-card">
                            ${
                              hasVid
                                ? `<video class="rtc-video-el" data-rtc-video="${escapeHtml(p.userId)}" data-rtc-local="${isMe ? 'true' : 'false'}" autoplay playsinline ${isMe ? 'muted' : ''}></video>`
                                : `<div class="speaker-avatar-lg">${escapeHtml(p.initials || getInitials(p.displayName || 'MB'))}</div>`
                            }
                            ${!isMe ? `<audio data-rtc-remote-audio="${escapeHtml(p.userId)}" autoplay></audio>` : ''}
                            <div class="rtc-card-overlay">
                              <span class="rtc-name-pill">${escapeHtml(p.displayName)}${isMe ? ' (You)' : ''}</span>
                              <span class="rtc-status-pill">${p.muted ? 'Muted' : 'Mic On'}</span>
                            </div>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>

                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="nx-btn-soft" data-action="toggle-mute">${rtcState.muted ? 'Unmute Mic' : 'Mute Mic'}</button>
                    <button type="button" class="nx-btn-soft" data-action="toggle-camera">${rtcState.videoOn ? 'Camera Off' : 'Camera On'}</button>
                    <button type="button" class="nx-btn-soft" data-action="toggle-screen-share">${rtcState.screenSharing ? 'Stop Share' : 'Share Screen'}</button>
                  </div>
                </div>

                <div class="nx-card" style="display:grid;gap:10px;align-content:start;">
                  <h3 style="margin:0;font-size:0.95rem;">In-Meeting Chat</h3>
                  <div style="max-height:260px;overflow-y:auto;display:grid;gap:8px;">
                    ${
                      meetingChatList
                        .map(
                          (m) => `
                        <div class="nx-comment-item">
                          <div>
                            <strong style="font-size:0.78rem;">${escapeHtml(m.senderName)}</strong>
                            <div style="font-size:0.82rem;">${escapeHtml(m.content)}</div>
                          </div>
                        </div>
                      `
                        )
                        .join('') || '<span class="member-sub">Say hello to meeting participants.</span>'
                    }
                  </div>
                  ${
                    activeMeetingId
                      ? `<form id="nx-meeting-chat-form" class="nx-comment-form">
                          <input type="text" id="nx-meeting-chat-input" placeholder="Send message..." maxlength="1000" required />
                          <button type="submit" class="nx-btn-grad">Send</button>
                        </form>`
                      : ''
                  }
                </div>
              </div>`
            : ''
        }

        <div class="nx-two-col-grid">
          ${
            meetings.filter((m) => m.status !== 'ended').length > 0
              ? meetings
                  .filter((m) => m.status !== 'ended')
                  .map(
                    (m) => `
                  <article class="nx-card" style="display:grid;gap:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                      <div>
                        <strong style="font-size:1rem;">${escapeHtml(m.title)}</strong>
                        <div class="member-sub">${escapeHtml(m.scheduledFor || 'Live Room')} · Host: ${escapeHtml(m.hostName)}</div>
                      </div>
                      <span class="nx-meta-chip mono">${escapeHtml(m.code)}</span>
                    </div>
                    ${m.description ? `<p class="member-sub" style="margin:0;white-space:normal;">${escapeHtml(m.description)}</p>` : ''}
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;">
                      <button type="button" class="nx-btn-grad" data-nx-act="join-meeting" data-meeting-id="${escapeHtml(m.id)}">Join Video</button>
                      <button type="button" class="nx-btn-soft" data-nx-act="copy-meeting-code" data-code="${escapeHtml(m.code)}">Copy Code</button>
                      ${
                        m.hostId === profile.id
                          ? `<button type="button" class="nx-btn-danger" data-nx-act="end-meeting" data-meeting-id="${escapeHtml(m.id)}">End</button>`
                          : ''
                      }
                    </div>
                  </article>
                `
                  )
                  .join('')
              : `<div class="nx-card" style="grid-column:1 / -1;"><span class="member-sub">No scheduled meetings yet. Start an instant meeting or schedule one above!</span></div>`
          }
        </div>
      </div>
    `;
  }

  /* ---------- NOTIFICATIONS VIEW ---------- */

  function renderNotificationsView() {
    const list =
      notifFilter === 'unread' ? (state.notifications || []).filter((n) => n.unread) : state.notifications || [];

    return `
      <div class="nx-view-container">
        <div class="nx-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;font-weight:800;">Notifications</h2>
            <p class="member-sub" style="margin:3px 0 0;">Real-time likes, comments, followers, requests, and community updates.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="nx-tab-chip ${notifFilter === 'all' ? 'active' : ''}" data-nx-act="set-notif-filter" data-filter="all">All (${(state.notifications || []).length})</button>
            <button type="button" class="nx-tab-chip ${notifFilter === 'unread' ? 'active' : ''}" data-nx-act="set-notif-filter" data-filter="unread">Unread</button>
            <button type="button" class="nx-btn-soft" data-nx-act="mark-all-notifs-read">Mark All Read</button>
          </div>
        </div>

        <div class="nx-card" style="display:grid;gap:8px;">
          ${
            list.length > 0
              ? list
                  .map(
                    (n) => `
                  <div class="file-row" style="justify-content:space-between;opacity:${n.unread ? '1' : '0.68'};padding:12px;">
                    <div>
                      <strong style="font-size:0.9rem;">${escapeHtml(n.title)}</strong>
                      <div class="member-sub" style="white-space:normal;">${escapeHtml(n.body)} · ${escapeHtml(n.time)}</div>
                    </div>
                    ${
                      n.unread
                        ? `<button type="button" class="nx-btn-soft" style="height:30px;font-size:0.75rem;" data-nx-act="mark-one-notif-read" data-id="${escapeHtml(n.id)}">Mark Read</button>`
                        : ''
                    }
                  </div>
                `
                  )
                  .join('')
              : `<div style="padding:20px;text-align:center;" class="member-sub">You are completely caught up.</div>`
          }
        </div>
      </div>
    `;
  }

  /* ---------- PROFILE VIEW ---------- */

  function renderProfileView() {
    const uid = profileTargetUid || profile.id;
    const isSelf = uid === profile.id;
    const targetUser = isSelf
      ? profile
      : viewedProfileDoc && viewedProfileDoc.id === uid
        ? viewedProfileDoc
        : resolveUserDisplay(uid);
    const isFollowing = myFollowingIds.has(uid);
    const isPrivateLocked = !isSelf && !isCurrentUserAdmin && targetUser.accountPrivacy === 'private' && !isFollowing;
    const userPosts = isPrivateLocked
      ? []
      : posts.filter((p) => {
          if (p.authorId !== uid) return false;
          return canUserViewPost(p, profile.id, myFollowingIds, state.blockedSet);
        });
    const followersCountDisplay = isPrivateLocked
      ? Math.max(0, Number(targetUser.followersCount || 0))
      : viewedFollowersLoaded
        ? viewedProfileFollowers.length
        : Math.max(0, Number(targetUser.followersCount || 0));
    const followingCountDisplay = isPrivateLocked
      ? Math.max(0, Number(targetUser.followingCount || 0))
      : viewedFollowingLoaded
        ? viewedProfileFollowing.length
        : Math.max(0, Number(targetUser.followingCount || 0));
    const postsCountDisplay = isPrivateLocked
      ? Math.max(0, Number(targetUser.postsCount || 0))
      : userPosts.length;

    return `
      <div class="nx-view-container">
        <section class="nx-card nx-profile-header-card">
          <div class="nx-profile-cover">
            ${targetUser.coverPhoto ? `<img src="${escapeHtml(targetUser.coverPhoto)}" alt="Cover photo" />` : ''}
            ${
              isSelf
                ? `<label class="nx-btn-soft" style="position:absolute;right:14px;bottom:14px;cursor:pointer;height:32px;font-size:0.76rem;">
                    <span>Upload Cover</span>
                    <input type="file" id="nx-cover-upload-input" accept="image/*" hidden />
                  </label>`
                : ''
            }
          </div>

          <div class="nx-profile-header-body">
            <div class="nx-profile-avatar-row">
              <div style="position:relative;display:inline-flex;">
                <div class="nx-profile-avatar-lg">${renderUserAvatarHtml(targetUser, 82)}</div>
                ${
                  isSelf
                    ? `<label class="nx-story-plus" style="cursor:pointer;width:28px;height:28px;right:0;bottom:2px;" title="Change Avatar">
                        ${svgIcon('edit', 13)}
                        <input type="file" id="nx-avatar-upload-input" accept="image/*" hidden />
                      </label>`
                    : ''
                }
              </div>

              <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;">
                ${
                  isSelf
                    ? `<button type="button" class="nx-btn-grad" data-nx-act="toggle-profile-edit">${profileEditing ? 'Close Editor' : 'Edit Profile'}</button>
                       <button type="button" class="nx-btn-soft" data-nx-act="goto-saved">Saved Posts</button>`
                    : `<button type="button" class="${isFollowing || viewedProfilePendingReq ? 'nx-btn-soft' : 'nx-btn-grad'}" data-nx-act="toggle-follow" data-uid="${escapeHtml(uid)}">${isFollowing ? 'Following' : viewedProfilePendingReq ? 'Requested' : 'Follow'}</button>
                       <button type="button" class="nx-btn-soft" data-nx-act="open-dm-user" data-uid="${escapeHtml(uid)}">Message</button>
                       <button type="button" class="nx-btn-soft" data-nx-act="call-dm-user" data-uid="${escapeHtml(uid)}">Video Call</button>
                       <button type="button" class="nx-btn-soft" data-nx-act="toggle-mute-user" data-uid="${escapeHtml(uid)}">${mutedAuthorIds.has(uid) ? 'Unmute' : 'Mute'}</button>`
                }
              </div>
            </div>

            <div>
              <h2 style="margin:0;font-size:1.35rem;font-weight:800;display:flex;align-items:center;gap:6px;">
                <span>${escapeHtml(targetUser.displayName)}</span>
                ${targetUser.verified ? `<span class="nx-verified-badge">${svgIcon('check', 10)}</span>` : ''}
                ${!isSelf && targetUser.accountPrivacy === 'private' ? `<span class="nx-meta-chip">${svgIcon('lock', 11)} Private</span>` : ''}
              </h2>
              <div class="member-sub">@${escapeHtml(targetUser.username)} · ${escapeHtml(targetUser.customStatus || 'Connect. Create. Share.')}</div>
              <p style="margin:8px 0 0;font-size:0.9rem;line-height:1.5;">${escapeHtml(targetUser.bio || 'Member of the NEXORA ecosystem.')}</p>
              ${
                targetUser.locationLabel || targetUser.website
                  ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;font-size:0.82rem;" class="member-sub">
                      ${targetUser.locationLabel ? `<span>${svgIcon('mapPin', 12)} ${escapeHtml(targetUser.locationLabel)}</span>` : ''}
                      ${
                        targetUser.website && sanitizeSafeUrl(targetUser.website)
                          ? `<a href="${escapeHtml(sanitizeSafeUrl(targetUser.website))}" target="_blank" rel="noopener noreferrer" class="nx-hashtag-link">${escapeHtml(targetUser.website)}</a>`
                          : ''
                      }
                    </div>`
                  : ''
              }
              ${
                Array.isArray(targetUser.interests) && targetUser.interests.length > 0
                  ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
                      ${targetUser.interests.map((tag) => `<span class="nx-meta-chip">${escapeHtml(tag)}</span>`).join('')}
                    </div>`
                  : ''
              }
            </div>

            <div class="nx-profile-stats">
              <span><strong>${postsCountDisplay}</strong> Posts</span>
              <span><strong>${followersCountDisplay}</strong> Followers</span>
              <span><strong>${followingCountDisplay}</strong> Following</span>
              ${!isSelf ? `<span><strong>${viewedProfileMutuals.length}</strong> Mutuals</span>` : ''}
            </div>

            ${
              isSelf && pendingFollowRequests.length > 0
                ? `<div style="display:grid;gap:8px;padding-top:12px;border-top:1px solid var(--nx-border);">
                    <strong style="font-size:0.88rem;">Pending Follow Requests (${pendingFollowRequests.length})</strong>
                    ${pendingFollowRequests
                      .map(
                        (reqItem) => `
                        <div class="file-row" style="justify-content:space-between;padding:8px 10px;">
                          <span><strong>${escapeHtml(reqItem.displayName || 'Member')}</strong> <span class="member-sub">@${escapeHtml(reqItem.username || 'member')}</span></span>
                          <div style="display:flex;gap:6px;">
                            <button type="button" class="nx-btn-grad" style="height:28px;font-size:0.74rem;" data-nx-act="respond-follow-request" data-uid="${escapeHtml(reqItem.requesterUid)}" data-decision="accept">Accept</button>
                            <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.74rem;" data-nx-act="respond-follow-request" data-uid="${escapeHtml(reqItem.requesterUid)}" data-decision="decline">Decline</button>
                          </div>
                        </div>`
                      )
                      .join('')}
                  </div>`
                : ''
            }

            ${
              isSelf && profileEditing
                ? `<form id="nx-profile-inline-form" style="display:grid;gap:10px;padding-top:12px;border-top:1px solid var(--nx-border);">
                    <div class="nx-two-col-grid">
                      <label><span class="member-sub">Display Name</span><input type="text" id="nx-prof-name" class="input" value="${escapeHtml(profile.displayName)}" required /></label>
                      <label><span class="member-sub">Username Handle</span><input type="text" id="nx-prof-handle" class="input" value="${escapeHtml(profile.username)}" required /></label>
                    </div>
                    <div class="nx-two-col-grid">
                      <label><span class="member-sub">Custom Status</span><input type="text" id="nx-prof-status" class="input" value="${escapeHtml(profile.customStatus)}" /></label>
                      <label><span class="member-sub">Account Privacy</span>
                        <select id="nx-prof-privacy" class="select">
                          <option value="everyone" ${profile.accountPrivacy === 'everyone' ? 'selected' : ''}>Public Directory</option>
                          <option value="requests_only" ${profile.accountPrivacy === 'requests_only' ? 'selected' : ''}>Requests Only</option>
                          <option value="private" ${profile.accountPrivacy === 'private' ? 'selected' : ''}>Private Account</option>
                        </select>
                      </label>
                    </div>
                    <div class="nx-two-col-grid">
                      <label><span class="member-sub">Location</span><input type="text" id="nx-prof-location" class="input" value="${escapeHtml(profile.locationLabel || '')}" placeholder="City or region" /></label>
                      <label><span class="member-sub">Website</span><input type="url" id="nx-prof-website" class="input" value="${escapeHtml(profile.website || '')}" placeholder="https://example.com" /></label>
                    </div>
                    <label><span class="member-sub">Interests (comma-separated)</span><input type="text" id="nx-prof-interests" class="input" value="${escapeHtml((profile.interests || []).join(', '))}" placeholder="design, photography, audio, startups" /></label>
                    <label><span class="member-sub">Bio</span><textarea id="nx-prof-bio" class="textarea" rows="2">${escapeHtml(profile.bio)}</textarea></label>
                    <div><button type="submit" class="nx-btn-grad">Save Profile Changes</button></div>
                  </form>`
                : ''
            }
          </div>
        </section>

        <div class="nx-feed-tabs">
          <button type="button" class="nx-tab-chip ${profileTab === 'posts' ? 'active' : ''}" data-nx-act="set-profile-tab" data-tab="posts">Posts (${postsCountDisplay})</button>
          <button type="button" class="nx-tab-chip ${profileTab === 'media' ? 'active' : ''}" data-nx-act="set-profile-tab" data-tab="media">Media</button>
          <button type="button" class="nx-tab-chip ${profileTab === 'templates' ? 'active' : ''}" data-nx-act="set-profile-tab" data-tab="templates">Templates</button>
          <button type="button" class="nx-tab-chip ${profileTab === 'followers' ? 'active' : ''}" data-nx-act="set-profile-tab" data-tab="followers">Followers (${followersCountDisplay})</button>
          <button type="button" class="nx-tab-chip ${profileTab === 'following' ? 'active' : ''}" data-nx-act="set-profile-tab" data-tab="following">Following (${followingCountDisplay})</button>
          ${!isSelf ? `<button type="button" class="nx-tab-chip ${profileTab === 'mutuals' ? 'active' : ''}" data-nx-act="set-profile-tab" data-tab="mutuals">Mutuals (${viewedProfileMutuals.length})</button>` : ''}
        </div>

        ${
          isPrivateLocked
            ? `<div class="nx-card" style="text-align:center;padding:30px 20px;display:grid;gap:8px;justify-items:center;">
                ${svgIcon('lock', 24)}
                <strong>This Account is Private</strong>
                <span class="member-sub" style="white-space:normal;">Follow @${escapeHtml(targetUser.username)} to see their posts, media, followers, and following lists.</span>
              </div>`
            : profileTab === 'templates'
              ? templateStudio.renderProfileTemplatesHtml(uid, { isPrivateLocked, targetUser })
              : profileTab === 'posts'
                ? userPosts.map((p) => renderPostCardHtml(p)).join('') || `<div class="nx-card"><span class="member-sub">${viewedProfileLoaded ? 'No posts published yet.' : 'Syncing profile posts...'}</span></div>`
                : profileTab === 'media'
                  ? `<div class="nx-two-col-grid">
                      ${
                        userPosts
                          .flatMap((p) => p.mediaItems || [])
                          .map((m) =>
                            m.type === 'video'
                              ? `<video src="${escapeHtml(m.url)}" controls style="width:100%;border-radius:14px;"></video>`
                              : `<img src="${escapeHtml(m.url)}" alt="Media" style="width:100%;border-radius:14px;object-fit:cover;max-height:280px;" />`
                          )
                          .join('') || `<div class="nx-card"><span class="member-sub">No photos or videos shared yet.</span></div>`
                      }
                    </div>`
                : profileTab === 'mutuals'
                  ? `<div class="nx-card nx-two-col-grid">
                      ${
                        viewedProfileMutuals
                          .map(
                            (m) => `
                          <button type="button" class="nx-active-row" data-nx-act="view-user-profile" data-uid="${escapeHtml(m.uid)}">
                            ${renderUserAvatarHtml(m, 36)}
                            <div>
                              <strong style="display:block;font-size:0.88rem;">${escapeHtml(m.displayName || 'Member')}</strong>
                              <span class="member-sub">@${escapeHtml(m.username || 'member')}</span>
                            </div>
                          </button>`
                          )
                          .join('') || `<span class="member-sub">No mutual connections yet.</span>`
                      }
                    </div>`
                : `<div class="nx-card nx-two-col-grid">
                    ${
                      (profileTab === 'followers' ? viewedProfileFollowers : viewedProfileFollowing)
                        .map((f) => {
                          const fUid = f.uid || f.id;
                          const liveUser = resolveUserDisplay(fUid, {
                            displayName: f.displayName,
                            username: f.username,
                            avatar: f.avatar,
                          });
                          return `
                          <div class="file-row" style="justify-content:space-between;padding:8px 10px;">
                            <button type="button" class="nx-active-row" style="flex:1;" data-nx-act="view-user-profile" data-uid="${escapeHtml(fUid)}">
                              ${renderUserAvatarHtml(liveUser, 36)}
                              <div>
                                <strong style="display:block;font-size:0.88rem;">${escapeHtml(liveUser.displayName || 'Member')}</strong>
                                <span class="member-sub">@${escapeHtml(liveUser.username || 'member')}</span>
                              </div>
                            </button>
                            ${
                              isSelf && profileTab === 'followers'
                                ? `<button type="button" class="nx-btn-soft" style="height:28px;font-size:0.74rem;" data-nx-act="remove-follower" data-uid="${escapeHtml(fUid)}">Remove</button>`
                                : ''
                            }
                          </div>
                        `;
                        })
                        .join('') || `<span class="member-sub">None yet.</span>`
                    }
                  </div>`
        }
      </div>
    `;
  }

  /* ---------- SAVED POSTS VIEW ---------- */

  function renderSavedView() {
    const filtered = (state.bookmarks || []).filter((b) => savedTab === 'all' || b.sourceType === savedTab);
    return `
      <div class="nx-view-container">
        <div class="nx-card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;font-weight:800;">Saved Bookmarks</h2>
            <p class="member-sub" style="margin:3px 0 0;">All your bookmarked posts, reels, and important messages.</p>
          </div>
          <div class="nx-feed-tabs">
            ${['all', 'post', 'reel', 'dm', 'channel']
              .map(
                (t) =>
                  `<button type="button" class="nx-tab-chip ${savedTab === t ? 'active' : ''}" data-nx-act="set-saved-tab" data-tab="${t}">${t === 'all' ? 'All' : t.toUpperCase()}</button>`
              )
              .join('')}
          </div>
        </div>

        <div style="display:grid;gap:12px;">
          ${
            filtered.length > 0
              ? filtered
                  .map(
                    (b) => `
                  <article class="nx-card" style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;">
                    <div style="display:grid;gap:6px;min-width:0;">
                      <div style="display:flex;align-items:center;gap:8px;">
                        <span class="nx-meta-chip">${escapeHtml(String(b.sourceType || 'post').toUpperCase())}</span>
                        <strong>${escapeHtml(b.authorName || 'Member')}</strong>
                      </div>
                      <div style="font-size:0.9rem;line-height:1.45;">${escapeHtml(b.content || '')}</div>
                    </div>
                    <button type="button" class="nx-btn-soft" data-nx-act="remove-saved" data-id="${escapeHtml(b.id)}">Remove</button>
                  </article>
                `
                  )
                  .join('')
              : `<div class="nx-card"><span class="member-sub">Nothing saved in this category yet. Click the bookmark icon on any post, reel, or message.</span></div>`
          }
        </div>
      </div>
    `;
  }

  /* ---------- INTEGRATED SETTINGS VIEW (FACEBOOK & INSTAGRAM BRIEF) ---------- */

  function renderSettingSwitchHtml(prefKey, title, subtitle, defaultVal = true) {
    const checked = prefs[prefKey] === undefined ? Boolean(defaultVal) : Boolean(prefs[prefKey]);
    return `
      <div class="nx-setting-row">
        <div class="nx-setting-row-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(subtitle)}</span>
        </div>
        <button type="button" role="switch" class="switch-btn" aria-checked="${checked}" data-nx-act="toggle-pref" data-pref="${escapeHtml(prefKey)}" aria-label="${escapeHtml(title)}"></button>
      </div>
    `;
  }

  function renderSettingsView() {
    const activeTheme = normalizeThemePreference(prefs.theme);
    const tabs = [
      { id: 'account', label: 'Account Center' },
      { id: 'privacy', label: 'Privacy & Safety' },
      { id: 'notifications', label: 'Notifications & Feed' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'security', label: 'Security & Data' },
    ];
    return `
      <div class="nx-view-container">
        <div class="nx-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;font-weight:800;">Account &amp; Platform Settings</h2>
            <p class="member-sub" style="margin:3px 0 0;">Facebook &amp; Instagram-style controls for account, audience privacy, notifications, media, and security.</p>
          </div>
          <div class="nx-feed-tabs">
            ${tabs
              .map(
                (t) =>
                  `<button type="button" class="nx-tab-chip ${settingsTab === t.id ? 'active' : ''}" data-nx-act="set-settings-tab" data-tab="${t.id}">${t.label}</button>`
              )
              .join('')}
          </div>
        </div>

        <div class="nx-card" style="display:grid;gap:16px;">
          ${
            settingsTab === 'appearance'
              ? `
                <div class="nx-settings-section">
                  <h3 class="nx-settings-section-title">Theme &amp; Display Mode</h3>
                  <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button type="button" class="${activeTheme === 'light' ? 'nx-btn-grad' : 'nx-btn-soft'}" data-nx-act="switch-theme" data-theme="light">Light Mode (Lavender Crisp)</button>
                    <button type="button" class="${activeTheme === 'dark' ? 'nx-btn-grad' : 'nx-btn-soft'}" data-nx-act="switch-theme" data-theme="dark">Dark Mode (Deep Navy Neon)</button>
                  </div>
                </div>
                <div class="nx-settings-section">
                  <h3 class="nx-settings-section-title">Feed &amp; Chat Density</h3>
                  <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button type="button" class="${prefs.density === 'cozy' ? 'nx-btn-grad' : 'nx-btn-soft'}" data-nx-act="switch-density" data-density="cozy">Cozy Spacing</button>
                    <button type="button" class="${prefs.density === 'compact' ? 'nx-btn-grad' : 'nx-btn-soft'}" data-nx-act="switch-density" data-density="compact">Compact Rows</button>
                  </div>
                </div>
              `
              : settingsTab === 'privacy'
                ? `
                  <div class="nx-settings-section">
                    <h3 class="nx-settings-section-title">Audience &amp; Interactions</h3>
                    <div class="nx-two-col-grid">
                      <label class="nx-setting-row" style="cursor:pointer;">
                        <div class="nx-setting-row-copy">
                          <strong>Default Post Audience</strong>
                          <span>Initial visibility for new posts</span>
                        </div>
                        <select class="select" style="width:auto;" data-nx-pref-select="defaultVisibility">
                          <option value="public" ${(prefs.defaultVisibility || 'public') === 'public' ? 'selected' : ''}>Public</option>
                          <option value="followers" ${prefs.defaultVisibility === 'followers' ? 'selected' : ''}>Followers</option>
                          <option value="private" ${prefs.defaultVisibility === 'private' ? 'selected' : ''}>Only Me</option>
                        </select>
                      </label>
                      <label class="nx-setting-row" style="cursor:pointer;">
                        <div class="nx-setting-row-copy">
                          <strong>Who Can Message You</strong>
                          <span>Direct message &amp; request filter</span>
                        </div>
                        <select class="select" style="width:auto;" data-nx-pref-select="whoCanMessage">
                          <option value="everyone" ${(prefs.whoCanMessage || 'everyone') === 'everyone' ? 'selected' : ''}>Everyone</option>
                          <option value="followers" ${prefs.whoCanMessage === 'followers' ? 'selected' : ''}>Followers Only</option>
                          <option value="none" ${prefs.whoCanMessage === 'none' ? 'selected' : ''}>No One</option>
                        </select>
                      </label>
                    </div>
                    <label class="nx-setting-row" style="cursor:pointer;">
                      <div class="nx-setting-row-copy">
                        <strong>Tags &amp; @Mentions</strong>
                        <span>Control who can @mention you in posts &amp; stories</span>
                      </div>
                      <select class="select" style="width:auto;" data-nx-pref-select="whoCanTag">
                        <option value="everyone" ${(prefs.whoCanTag || 'everyone') === 'everyone' ? 'selected' : ''}>Everyone</option>
                        <option value="followers" ${prefs.whoCanTag === 'followers' ? 'selected' : ''}>Followers Only</option>
                        <option value="none" ${prefs.whoCanTag === 'none' ? 'selected' : ''}>Off</option>
                      </select>
                    </label>
                  </div>

                  <div class="nx-settings-section">
                    <h3 class="nx-settings-section-title">Activity &amp; Messaging Privacy</h3>
                    ${renderSettingSwitchHtml('showActivityStatus', 'Show Activity Status', 'Let followers and connections see when you are active online.')}
                    ${renderSettingSwitchHtml('readReceipts', 'Read Receipts', 'Show when you have read direct messages.')}
                  </div>

                  <div class="nx-settings-section">
                    <h3 class="nx-settings-section-title">Blocked Accounts (${(state.blockedUsers || []).length})</h3>
                    <div style="display:grid;gap:8px;">
                      ${
                        (state.blockedUsers || [])
                          .map(
                            (b) => `
                            <div class="file-row" style="justify-content:space-between;">
                              <strong>${escapeHtml(b.blockedName || b.id)}</strong>
                              <button type="button" class="nx-btn-soft" data-action="unblock-user" data-user-id="${escapeHtml(b.id)}">Unblock</button>
                            </div>
                          `
                          )
                          .join('') || '<span class="member-sub">No blocked accounts. Blocked users cannot view your profile or message you.</span>'
                      }
                    </div>
                  </div>
                `
                : settingsTab === 'notifications'
                  ? `
                    <div class="nx-settings-section">
                      <h3 class="nx-settings-section-title">Push &amp; Activity Notifications</h3>
                      ${renderSettingSwitchHtml('quietMode', 'Quiet Mode', 'Mute non-urgent social alerts while you focus or take a break.', false)}
                      ${renderSettingSwitchHtml('notifyLikes', 'Likes &amp; Reactions', 'Notify when someone likes your post, reel, or story.')}
                      ${renderSettingSwitchHtml('notifyComments', 'Comments &amp; Replies', 'Notify on new comments and thread replies.')}
                      ${renderSettingSwitchHtml('notifyFollows', 'New Followers &amp; Requests', 'Notify when someone follows you or accepts a connection.')}
                      ${renderSettingSwitchHtml('notifyDms', 'Direct Messages', 'Notify on incoming direct and group chat messages.')}
                      ${renderSettingSwitchHtml('notifyMentions', '@Mentions &amp; Tags', 'Notify when creators mention your username.')}
                      ${renderSettingSwitchHtml('notifyLive', 'Live Streams &amp; Reels', 'Notify when creators you follow go live.')}
                    </div>

                    <div class="nx-settings-section">
                      <h3 class="nx-settings-section-title">Feed &amp; Media Quality</h3>
                      <label class="nx-setting-row" style="cursor:pointer;">
                        <div class="nx-setting-row-copy">
                          <strong>Default Home Feed</strong>
                          <span>Choose your opening feed order on launch</span>
                        </div>
                        <select class="select" style="width:auto;" data-nx-pref-select="feedDefaultTab">
                          <option value="for-you" ${(prefs.feedDefaultTab || 'for-you') === 'for-you' ? 'selected' : ''}>For You (Recommended)</option>
                          <option value="following" ${prefs.feedDefaultTab === 'following' ? 'selected' : ''}>Following</option>
                          <option value="latest" ${prefs.feedDefaultTab === 'latest' ? 'selected' : ''}>Latest</option>
                        </select>
                      </label>
                      ${renderSettingSwitchHtml('autoplayReels', 'Autoplay Reels &amp; Videos', 'Automatically start playback when opening the Reels player.')}
                      ${renderSettingSwitchHtml('dataSaver', 'Data Saver Mode', 'Reduce preloaded media bandwidth on slower connections.', false)}
                    </div>
                  `
                  : settingsTab === 'security'
                    ? `
                      <div class="nx-settings-section">
                        <h3 class="nx-settings-section-title">Login &amp; Session Security</h3>
                        ${renderSettingSwitchHtml('loginAlerts', 'Unrecognized Login Alerts', 'Highlight new session activity on your NEXORA account.')}
                        <div class="nx-setting-row">
                          <div class="nx-setting-row-copy">
                            <strong>Current Web Session</strong>
                            <span>Signed in as ${escapeHtml(profile.email || `@${profile.username}`)}</span>
                          </div>
                          <button type="button" class="nx-btn-soft" data-action="sign-out">Sign Out</button>
                        </div>
                      </div>
                      <div class="nx-settings-section">
                        <h3 class="nx-settings-section-title">Email &amp; Password</h3>
                        <form id="nx-sec-email-form" style="display:flex;gap:10px;flex-wrap:wrap;">
                          <input type="email" id="nx-sec-email-input" class="input" style="flex:1;min-width:220px;" placeholder="New email address..." required />
                          <button type="submit" class="nx-btn-soft">Update Email</button>
                        </form>
                        <form id="nx-sec-pw-form" style="display:flex;gap:10px;flex-wrap:wrap;">
                          <input type="password" id="nx-sec-pw-input" class="input" style="flex:1;min-width:220px;" placeholder="New password (min 6 characters)..." minlength="6" required />
                          <button type="submit" class="nx-btn-soft">Update Password</button>
                        </form>
                      </div>
                      <div class="nx-settings-section">
                        <h3 class="nx-settings-section-title">Your Information &amp; Account Ownership</h3>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                          <button type="button" class="nx-btn-soft" data-action="export-user-data">Download Your Information (JSON)</button>
                          <button type="button" class="nx-btn-soft" data-nx-act="deactivate-account">Deactivate Account</button>
                          ${
                            confirmDeleteOpen
                              ? `<button type="button" class="nx-btn-danger" data-nx-act="confirm-delete-me">Confirm Permanent Delete</button>
                                 <button type="button" class="nx-btn-soft" data-nx-act="cancel-delete-me">Cancel</button>`
                              : `<button type="button" class="nx-btn-danger" data-nx-act="prompt-delete-me">Delete Account</button>`
                          }
                        </div>
                      </div>
                    `
                    : `
                      <div class="nx-settings-section">
                        <div class="nx-setting-row">
                          <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                            ${renderUserAvatarHtml(profile, 44)}
                            <div class="nx-setting-row-copy">
                              <strong>${escapeHtml(profile.displayName)} ${profile.verified ? '✓' : ''}</strong>
                              <span>@${escapeHtml(profile.username)} · ${profile.accountPrivacy === 'private' ? 'Private Account' : profile.accountPrivacy === 'requests_only' ? 'Requests Only' : 'Public Profile'}</span>
                            </div>
                          </div>
                          <button type="button" class="nx-btn-soft" data-nx-nav="profile">View Profile</button>
                        </div>
                      </div>
                      <form id="nx-settings-account-form" style="display:grid;gap:12px;">
                        <div class="nx-two-col-grid">
                          <label><span class="member-sub">Display Name</span><input type="text" id="nx-set-name" class="input" value="${escapeHtml(profile.displayName)}" required /></label>
                          <label><span class="member-sub">Username Handle</span><input type="text" id="nx-set-handle" class="input" value="${escapeHtml(profile.username)}" required /></label>
                        </div>
                        <div class="nx-two-col-grid">
                          <label><span class="member-sub">Custom Status</span><input type="text" id="nx-set-status" class="input" value="${escapeHtml(profile.customStatus)}" /></label>
                          <label><span class="member-sub">Account Privacy</span>
                            <select id="nx-set-privacy" class="select">
                              <option value="everyone" ${profile.accountPrivacy === 'everyone' ? 'selected' : ''}>Public (Discoverable)</option>
                              <option value="requests_only" ${profile.accountPrivacy === 'requests_only' ? 'selected' : ''}>Requests Only</option>
                              <option value="private" ${profile.accountPrivacy === 'private' ? 'selected' : ''}>Private Account</option>
                            </select>
                          </label>
                        </div>
                        <div class="nx-two-col-grid">
                          <label><span class="member-sub">Location</span><input type="text" id="nx-set-location" class="input" value="${escapeHtml(profile.locationLabel || '')}" placeholder="City or region" /></label>
                          <label><span class="member-sub">Website</span><input type="url" id="nx-set-website" class="input" value="${escapeHtml(profile.website || '')}" placeholder="https://example.com" /></label>
                        </div>
                        <label><span class="member-sub">Interests (comma-separated)</span><input type="text" id="nx-set-interests" class="input" value="${escapeHtml((profile.interests || []).join(', '))}" placeholder="design, photography, audio, startups" /></label>
                        <label><span class="member-sub">Bio</span><textarea id="nx-set-bio" class="textarea" rows="3">${escapeHtml(profile.bio)}</textarea></label>
                        <div><button type="submit" class="nx-btn-grad">Save Account Center</button></div>
                      </form>
                    `
          }
        </div>
      </div>
    `;
  }

  /* ---------- GO LIVE STUDIO VIEW ---------- */

  function renderLiveView() {
    const rtcState = getRtcState();
    const activeStreams = liveStreams.filter((s) => s.status === 'live');
    const selectedStream = liveStreams.find((s) => s.id === activeLiveStreamId) || activeStreams[0] || null;
    if (selectedStream && selectedStream.id !== activeLiveStreamId) {
      activeLiveStreamId = selectedStream.id;
      subscribeLiveChat(selectedStream.id);
    }

    const isBroadcasting =
      Boolean(selectedStream) &&
      selectedStream.status === 'live' &&
      selectedStream.hostId === profile.id &&
      rtcState.activeCall?.targetId === selectedStream.id;

    return `
      <div class="nx-view-container">
        <div class="nx-card" style="display:grid;gap:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
            <div>
              <h2 style="margin:0;font-size:1.25rem;font-weight:800;">NEXORA Go Live Studio</h2>
              <p class="member-sub" style="margin:3px 0 0;">Broadcast real-time WebRTC video, camera, or screen streams with live chat &amp; reactions.</p>
            </div>
            ${
              isBroadcasting
                ? `<button type="button" class="nx-btn-danger" data-nx-act="end-live-stream" data-stream-id="${escapeHtml(selectedStream.id)}">End Live Broadcast</button>`
                : ''
            }
          </div>

          <form id="nx-go-live-form" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <input type="text" id="nx-live-title" class="input" style="flex:1;min-width:200px;" placeholder="Stream Title (e.g. Late Night Coding &amp; Q&amp;A)..." minlength="2" maxlength="120" required />
            <select id="nx-live-category" class="select" style="width:auto;">
              <option value="Talk">Just Chatting</option>
              <option value="Tech">Tech &amp; Build</option>
              <option value="Music">Music &amp; Art</option>
              <option value="Gaming">Gaming</option>
            </select>
            <select id="nx-live-source" class="select" style="width:auto;">
              <option value="camera">Camera + Mic</option>
              <option value="screen">Screen Share</option>
            </select>
            <button type="submit" class="nx-btn-grad">Start Live Stream</button>
          </form>
        </div>

        ${
          selectedStream && selectedStream.status === 'live'
            ? `<div class="nx-home-grid" style="grid-template-columns:minmax(0,1fr) 310px;">
                <div class="nx-card" style="display:grid;gap:12px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <span class="nx-nav-badge" style="border-radius:8px;margin-right:6px;">LIVE</span>
                      <strong>${escapeHtml(selectedStream.title)}</strong>
                      <div class="member-sub">Hosted by ${escapeHtml(selectedStream.hostName)} · ${selectedStream.viewerCount || 1} watching · ${selectedStream.reactionCount || 0} reactions</div>
                    </div>
                    <div style="display:flex;gap:6px;">
                      <button type="button" class="nx-btn-grad" style="height:32px;" data-nx-act="watch-live-stream" data-stream-id="${escapeHtml(selectedStream.id)}">Connect Stream</button>
                      <button type="button" class="nx-btn-soft" style="height:32px;" data-nx-act="react-live-stream" data-stream-id="${escapeHtml(selectedStream.id)}">❤️ Cheer</button>
                    </div>
                  </div>
                  <div class="rtc-stage-grid">
                    ${(rtcState.peers && rtcState.peers.length > 0
                      ? rtcState.peers
                      : [{ userId: selectedStream.hostId, displayName: selectedStream.hostName, initials: selectedStream.hostInitials || 'NX' }]
                    )
                      .map((p) => {
                        const isMe = p.userId === profile.id;
                        const hasVid = isMe
                          ? Boolean(rtcState.screenStream || rtcState.localStream?.getVideoTracks().length)
                          : Boolean(rtcState.remoteStreams?.get(p.userId)?.getVideoTracks().length);
                        return `
                          <div class="rtc-video-card">
                            ${
                              hasVid
                                ? `<video class="rtc-video-el" data-rtc-video="${escapeHtml(p.userId)}" data-rtc-local="${isMe ? 'true' : 'false'}" autoplay playsinline ${isMe ? 'muted' : ''}></video>`
                                : `<div class="speaker-avatar-lg">${escapeHtml(p.initials || 'NX')}</div>`
                            }
                            ${!isMe ? `<audio data-rtc-remote-audio="${escapeHtml(p.userId)}" autoplay></audio>` : ''}
                            <div class="rtc-card-overlay">
                              <span class="rtc-name-pill">${escapeHtml(p.displayName)}</span>
                            </div>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>
                </div>

                <div class="nx-card" style="display:grid;gap:10px;align-content:start;">
                  <h3 style="margin:0;font-size:0.95rem;">Live Chat</h3>
                  <div style="max-height:260px;overflow-y:auto;display:grid;gap:8px;">
                    ${
                      liveChatList
                        .map(
                          (m) => `
                        <div class="nx-comment-item">
                          <div>
                            <strong style="font-size:0.78rem;">${escapeHtml(m.senderName)}</strong>
                            <div style="font-size:0.82rem;">${escapeHtml(m.content)}</div>
                          </div>
                        </div>
                      `
                        )
                        .join('') || '<span class="member-sub">Send a message to the broadcast chat.</span>'
                    }
                  </div>
                  <form id="nx-live-chat-form" data-stream-id="${escapeHtml(selectedStream.id)}" class="nx-comment-form">
                    <input type="text" id="nx-live-chat-input" placeholder="Say something live..." maxlength="500" required />
                    <button type="submit" class="nx-btn-grad">Send</button>
                  </form>
                </div>
              </div>`
            : `<div class="nx-card"><span class="member-sub">No live broadcasts active right now. Start streaming above!</span></div>`
        }
      </div>
    `;
  }

  /* ---------- ADMIN DASHBOARD VIEW (AUTHORIZED ADMINS ONLY) ---------- */

  function renderAdminDashboardView() {
    if (!isCurrentUserAdmin) {
      return `<div class="nx-card"><h3>Restricted Area</h3><p class="member-sub">Verified administrator permissions required.</p></div>`;
    }

    const totalUsers = (state.directoryUsers || []).length;
    const openReports = (state.reports || []).filter((r) => r.status === 'open');

    return `
      <div class="nx-view-container">
        <div class="nx-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;font-weight:800;">NEXORA Admin Dashboard</h2>
            <p class="member-sub" style="margin:3px 0 0;">Real-time platform analytics, user moderation, verification, and safety queues.</p>
          </div>
          <div class="nx-feed-tabs">
            ${['overview', 'users', 'reports', 'content', 'templates']
              .map(
                (t) =>
                  `<button type="button" class="nx-tab-chip ${adminTab === t ? 'active' : ''}" data-nx-act="set-admin-tab" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`
              )
              .join('')}
          </div>
        </div>

        <div class="nx-kpi-grid">
          <div class="nx-kpi-card"><span class="member-sub">Registered Users</span><span class="nx-kpi-val">${totalUsers}</span></div>
          <div class="nx-kpi-card"><span class="member-sub">Published Posts</span><span class="nx-kpi-val">${posts.length}</span></div>
          <div class="nx-kpi-card"><span class="member-sub">Published Reels</span><span class="nx-kpi-val">${reels.length}</span></div>
          <div class="nx-kpi-card"><span class="member-sub">Open Reports</span><span class="nx-kpi-val">${openReports.length}</span></div>
        </div>

        <div class="nx-card" style="display:grid;gap:10px;">
          ${
            adminTab === 'templates'
              ? templateStudio.renderAdminTemplatesTabHtml()
              : adminTab === 'users'
              ? (state.directoryUsers || [])
                  .map(
                    (u) => `
                  <div class="file-row" style="justify-content:space-between;padding:10px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                      ${renderUserAvatarHtml(u, 34)}
                      <div>
                        <strong>${escapeHtml(u.displayName)}</strong>
                        <div class="member-sub">@${escapeHtml(u.username)} · ${u.verified ? 'Verified' : 'Standard'} · ${u.suspended ? 'Suspended' : 'Active'}</div>
                      </div>
                    </div>
                    <div style="display:flex;gap:6px;">
                      <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.75rem;" data-nx-act="admin-toggle-verify" data-uid="${escapeHtml(u.id)}" data-val="${u.verified ? '0' : '1'}">${u.verified ? 'Unverify' : 'Verify Badge'}</button>
                      <button type="button" class="nx-btn-danger" style="height:30px;font-size:0.75rem;" data-nx-act="admin-toggle-suspend" data-uid="${escapeHtml(u.id)}" data-val="${u.suspended ? '0' : '1'}">${u.suspended ? 'Restore' : 'Suspend'}</button>
                    </div>
                  </div>
                `
                  )
                  .join('') || '<span class="member-sub">No users found.</span>'
              : adminTab === 'reports'
                ? (state.reports || [])
                    .map(
                      (r) => `
                    <div class="file-row" style="justify-content:space-between;padding:10px;">
                      <div>
                        <strong>${escapeHtml(r.targetType)} · ${escapeHtml(r.targetId)}</strong>
                        <div class="member-sub" style="white-space:normal;">${escapeHtml(r.reason)} · Status: ${escapeHtml(r.status)}</div>
                      </div>
                      ${
                        r.status === 'open'
                          ? `<div style="display:flex;gap:6px;">
                              <button type="button" class="nx-btn-grad" style="height:30px;font-size:0.75rem;" data-action="resolve-report" data-report-id="${escapeHtml(r.id)}" data-status="resolved">Resolve</button>
                              <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.75rem;" data-action="resolve-report" data-report-id="${escapeHtml(r.id)}" data-status="dismissed">Dismiss</button>
                            </div>`
                          : ''
                      }
                    </div>
                  `
                    )
                    .join('') || '<span class="member-sub">No safety reports queued.</span>'
                : adminTab === 'content'
                  ? posts
                      .slice(0, 20)
                      .map(
                        (p) => `
                      <div class="file-row" style="justify-content:space-between;padding:10px;">
                        <div style="min-width:0;">
                          <strong>${escapeHtml(p.authorName)}</strong>
                          <div class="member-sub" style="white-space:normal;">${escapeHtml(String(p.content || '').slice(0, 140))}</div>
                        </div>
                        <button type="button" class="nx-btn-danger" style="height:30px;font-size:0.75rem;" data-nx-act="delete-post" data-post-id="${escapeHtml(p.id)}">Remove</button>
                      </div>
                    `
                      )
                      .join('') || '<span class="member-sub">No posts published yet.</span>'
                  : `<div style="display:grid;gap:8px;">
                      <strong>System Health &amp; Governance</strong>
                      <p class="member-sub" style="white-space:normal;">All collections enforce Firestore schema validation, owner/admin RBAC, and zero-mock real-time listeners. Switch tabs above to inspect users, safety reports, published content, or Template Studio moderation.</p>
                    </div>`
          }
        </div>
      </div>
    `;
  }

  /* ---------- MAIN SOCIAL RENDER SWITCH ---------- */

  function render() {
    const root = document.getElementById('nx-social-root');
    if (!root || !SOCIAL_VIEWS.has(currentSection)) return;

    // Preserve focus & cursor position across real-time snapshot re-renders
    const activeEl = document.activeElement;
    const activeId = activeEl instanceof HTMLElement ? activeEl.id : '';
    const selStart =
      activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement ? activeEl.selectionStart : null;
    const selEnd =
      activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement ? activeEl.selectionEnd : null;

    let html = '';
    switch (currentSection) {
      case 'home':
        html = renderHomeView();
        break;
      case 'explore':
        html = renderExploreView();
        break;
      case 'reels':
        html = renderReelsView();
        break;
      case 'templates':
        html = templateStudio.renderStudioView();
        break;
      case 'social-circle':
        html = socialCircleUi.renderHtml();
        break;
      case 'calls':
        html = renderCallsView();
        break;
      case 'notifications':
        html = renderNotificationsView();
        break;
      case 'profile':
        html = renderProfileView();
        break;
      case 'saved':
        html = renderSavedView();
        break;
      case 'settings':
        html = renderSettingsView();
        break;
      case 'live':
        html = renderLiveView();
        break;
      case 'admin':
        html = renderAdminDashboardView();
        break;
    }

    if (currentSection !== 'templates') {
      html += templateStudio.renderModalHtml();
    }

    root.innerHTML = html;
    syncWorkspaceVisibility();
    templateStudio.afterRender(root);
    if (currentSection === 'social-circle') {
      socialCircleUi.afterRender(root, render);
    }

    if (currentSection === 'calls' || currentSection === 'live') {
      rtc.attachMediaElements(root);
    }

    syncActiveReelPlayback();

    if (activeId && document.getElementById(activeId)) {
      const nextEl = document.getElementById(activeId);
      if (nextEl instanceof HTMLInputElement || nextEl instanceof HTMLTextAreaElement) {
        nextEl.focus();
        if (typeof selStart === 'number' && typeof selEnd === 'number') {
          try {
            nextEl.setSelectionRange(selStart, selEnd);
          } catch {}
        }
      }
    }

    if (highlightedPostId && currentSection === 'home') {
      const targetEl = document.getElementById(`post-${highlightedPostId}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightedPostId = '';
      }
    }
  }

  /* ---------- FIRESTORE WRITE ACTIONS ---------- */

  async function publishNewPost() {
    if (!currentUser) return;
    const txtEl = document.getElementById('nx-post-textarea');
    const visEl = document.getElementById('nx-post-visibility');
    const content = (txtEl instanceof HTMLTextAreaElement ? txtEl.value : composerText).trim();
    const rawVisibility = visEl instanceof HTMLSelectElement ? visEl.value : composerVisibility;
    const visibility = ['public', 'followers', 'private'].includes(rawVisibility) ? rawVisibility : 'public';

    if (!content && composerMedia.length === 0) {
      showToast('Write a message or attach a photo/video before posting.');
      return;
    }

    const revTs = String(Math.max(0, 9999999999999 - Date.now())).padStart(13, '0');
    const postId = `pst-0-${revTs}-${Math.random().toString(36).slice(2, 6)}`;
    const mediaType =
      composerMedia.length === 0
        ? 'none'
        : composerMedia.length > 1
          ? 'carousel'
          : composerMedia[0].type === 'video'
            ? 'video'
            : 'image';

    const taggedIds = composerProductTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    const payload = {
      id: postId,
      authorId: currentUser.uid,
      authorName: String(profile.displayName || 'Member').slice(0, 120),
      authorUsername: String(profile.username || 'member').slice(0, 50),
      authorInitials: String(profile.initials || 'NX').slice(0, 16),
      authorAvatar: String(profile.avatar || '').slice(0, 200000),
      authorVerified: Boolean(profile.verified || isCurrentUserAdmin),
      content: (content || 'Shared media').slice(0, 4000),
      mediaType,
      mediaItems: composerMedia.slice(0, 4),
      feeling: composerFeeling.slice(0, 80),
      location: composerLocation.slice(0, 100),
      productIds: taggedIds,
      hashtags: extractHashtags(content),
      mentions: extractMentions(content),
      visibility,
      likesUids: [],
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      edited: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (visibility === 'followers') {
      payload.allowedViewerUids = Array.from(new Set([currentUser.uid, ...myFollowersIds])).slice(0, 500);
    }

    if (estimateJsonByteSize(payload) > 820000) {
      showToast('Post media is too large for cloud sync. Remove an attachment or use a smaller image/video.');
      return;
    }

    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const postRef = doc(db, 'posts', postId);
      await runTransaction(db, async (tx) => {
        const userSnap = await tx.get(userRef);
        const currentCount = userSnap.exists() ? Math.max(0, Number(userSnap.data().postsCount || 0)) : 0;
        tx.set(postRef, payload);
        if (userSnap.exists()) {
          tx.update(userRef, {
            postsCount: currentCount + 1,
            updatedAt: serverTimestamp(),
          });
        }
      });
      composerText = '';
      composerMedia = [];
      composerFeeling = '';
      composerLocation = '';
      composerProductTags = '';
      localStorage.removeItem('nx_post_draft_v1');
      showToast('Post published to NEXORA', 'success');
      render();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `posts/${postId}`, 'Site is busy right now. Could not publish post.');
    }
  }

  async function toggleLikePost(postId) {
    if (!currentUser || !postId || pendingLikePostIds.has(postId)) return;
    pendingLikePostIds.add(postId);
    try {
      const postRef = doc(db, 'posts', postId);
      const likeRef = doc(db, 'posts', postId, 'likes', currentUser.uid);
      const result = await runTransaction(db, async (tx) => {
        const [postSnap, likeSnap] = await Promise.all([tx.get(postRef), tx.get(likeRef)]);
        if (!postSnap.exists()) return null;
        const pData = postSnap.data();
        const prevUids = Array.isArray(pData.likesUids) ? pData.likesUids : [];
        const hasLikeDoc = likeSnap.exists();
        const hasLegacyUid = prevUids.includes(currentUser.uid);
        const currentlyLiked = hasLikeDoc || hasLegacyUid;
        const prevCount =
          typeof pData.likesCount === 'number' && Number.isFinite(pData.likesCount)
            ? Math.max(0, pData.likesCount)
            : 0;

        if (currentlyLiked) {
          if (hasLikeDoc) tx.delete(likeRef);
          const nextUids = prevUids.filter((id) => id !== currentUser.uid);
          const nextCount = Math.max(0, prevCount - 1);
          tx.update(postRef, {
            likesUids: nextUids,
            likesCount: nextCount,
            updatedAt: serverTimestamp(),
          });
          return { liked: false, authorId: pData.authorId };
        }

        tx.set(likeRef, {
          userId: currentUser.uid,
          displayName: String(profile.displayName || 'Member').slice(0, 120),
          username: String(profile.username || 'member').slice(0, 50),
          createdAt: serverTimestamp(),
        });
        const nextUids = prevUids.includes(currentUser.uid)
          ? prevUids
          : [...prevUids, currentUser.uid].slice(-500);
        tx.update(postRef, {
          likesUids: nextUids,
          likesCount: prevCount + 1,
          updatedAt: serverTimestamp(),
        });
        return { liked: true, authorId: pData.authorId };
      });

      if (result?.liked && result.authorId && result.authorId !== currentUser.uid) {
        sendUserNotification(result.authorId, {
          category: 'like',
          targetId: postId,
          title: 'New Like on Your Post',
          body: `${profile.displayName} liked your post.`,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `posts/${postId}`);
    } finally {
      pendingLikePostIds.delete(postId);
    }
  }

  async function toggleFollowUser(targetUid) {
    if (!currentUser || !targetUid || targetUid === currentUser.uid) return;
    if (pendingFollowUids.has(targetUid)) return;
    if (state.blockedSet.has(targetUid)) {
      showToast('Unblock this user in Settings before following.');
      return;
    }

    pendingFollowUids.add(targetUid);
    const targetUser = resolveUserDisplay(targetUid);
    const isPrivateOrReq = targetUser.accountPrivacy === 'private' || targetUser.accountPrivacy === 'requests_only';

    if (!myFollowingIds.has(targetUid) && (viewedProfilePendingReq || isPrivateOrReq)) {
      try {
        if (viewedProfilePendingReq) {
          await apiV1Fetch(`/users/${encodeURIComponent(targetUid)}/follow`, { method: 'DELETE' });
          viewedProfilePendingReq = false;
          showToast('Follow request cancelled');
        } else {
          const res = await apiV1Fetch(`/users/${encodeURIComponent(targetUid)}/follow`, { method: 'POST' });
          if (res?.status === 'requested') {
            viewedProfilePendingReq = true;
            showToast(`Follow request sent to ${targetUser.displayName}`, 'success');
          }
        }
        renderIfSocial();
        return;
      } catch (err) {
        showToast(formatFriendlyError(err, 'Could not update follow request right now.'), 'error');
        return;
      } finally {
        pendingFollowUids.delete(targetUid);
      }
    }

    const meRef = doc(db, 'users', currentUser.uid);
    const targetRef = doc(db, 'users', targetUid);
    const followingRef = doc(db, 'users', currentUser.uid, 'following', targetUid);
    const followerRef = doc(db, 'users', targetUid, 'followers', currentUser.uid);

    try {
      const outcome = await runTransaction(db, async (tx) => {
        const [meSnap, targetSnap, followingSnap, followerSnap] = await Promise.all([
          tx.get(meRef),
          tx.get(targetRef),
          tx.get(followingRef),
          tx.get(followerRef),
        ]);
        if (!targetSnap.exists()) {
          throw new Error('User profile not found.');
        }

        const meData = meSnap.exists() ? meSnap.data() : {};
        const targetData = targetSnap.data();
        const meFollowingCount = Math.max(0, Number(meData.followingCount || 0));
        const targetFollowersCount = Math.max(0, Number(targetData.followersCount || 0));
        const alreadyFollowing = followingSnap.exists();
        const alreadyFollower = followerSnap.exists();

        if (alreadyFollowing || (alreadyFollower && myFollowingIds.has(targetUid))) {
          if (alreadyFollowing) {
            tx.delete(followingRef);
            if (meSnap.exists()) {
              tx.update(meRef, {
                followingCount: Math.max(0, meFollowingCount - 1),
                updatedAt: serverTimestamp(),
              });
            }
          }
          if (alreadyFollower) {
            tx.delete(followerRef);
            tx.update(targetRef, {
              followersCount: Math.max(0, targetFollowersCount - 1),
              updatedAt: serverTimestamp(),
            });
          }
          return 'unfollowed';
        }

        if (!alreadyFollowing) {
          tx.set(followingRef, {
            uid: targetUid,
            displayName: String(targetData.displayName || targetUser.displayName || 'Member').slice(0, 120),
            username: String(targetData.username || targetUser.username || 'member').slice(0, 50),
            avatar: String(targetData.avatar || targetUser.avatar || '').slice(0, 200000),
            createdAt: serverTimestamp(),
          });
          if (meSnap.exists()) {
            tx.update(meRef, {
              followingCount: meFollowingCount + 1,
              updatedAt: serverTimestamp(),
            });
          }
        }

        if (!alreadyFollower) {
          tx.set(followerRef, {
            uid: currentUser.uid,
            displayName: String(profile.displayName || 'Member').slice(0, 120),
            username: String(profile.username || 'member').slice(0, 50),
            avatar: String(profile.avatar || '').slice(0, 200000),
            createdAt: serverTimestamp(),
          });
          tx.update(targetRef, {
            followersCount: targetFollowersCount + 1,
            updatedAt: serverTimestamp(),
          });
        }
        return 'followed';
      });

      if (outcome === 'unfollowed') {
        showToast(`Unfollowed ${targetUser.displayName}`);
      } else {
        sendUserNotification(targetUid, {
          category: 'follow',
          targetId: currentUser.uid,
          title: 'New Follower',
          body: `${profile.displayName} started following you.`,
        });
        showToast(`Following ${targetUser.displayName}`, 'success');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}/following/${targetUid}`, 'Could not update follow status right now.');
    } finally {
      pendingFollowUids.delete(targetUid);
    }
  }

  async function startOrJoinMeeting(meetingObj, withVideo = true) {
    if (!currentUser || !meetingObj) return;
    activeMeetingId = meetingObj.id;
    subscribeMeetingChat(meetingObj.id);
    const callId = meetingObj.callId || getRoomCallId('stage', meetingObj.id);
    await rtc.joinCall({
      callId,
      kind: 'stage',
      targetId: meetingObj.id,
      title: meetingObj.title || `Meeting ${meetingObj.code}`,
      currentUserProfile: profile,
      withVideo,
      withScreen: false,
      muted: prefs.muted,
      deafened: prefs.deafened,
      allowReview: true,
    });
    render();
  }

  /* ---------- GLOBAL SEARCH DROPDOWN ---------- */

  function renderGlobalSearchDropdown(queryText) {
    const drop = document.getElementById('nx-search-dropdown');
    if (!drop) return;
    const q = String(queryText || '').trim();
    if (!q) {
      drop.hidden = true;
      drop.innerHTML = '';
      return;
    }

    const res = scoreSearchMatches(q, {
      posts: posts.filter((p) => p.visibility === 'public'),
      users: (state.directoryUsers || []).filter((u) => u.id !== profile.id && !state.blockedSet.has(u.id)),
      reels,
      communities: state.publicServers || [],
    });

    const itemsHtml = [
      ...res.users.slice(0, 4).map(
        (u) =>
          `<button type="button" class="menu-item" data-nx-act="search-pick-user" data-uid="${escapeHtml(u.id)}"><span>${escapeHtml(u.displayName)} (@${escapeHtml(u.username)})</span><span class="kbd-chip">Person</span></button>`
      ),
      ...res.hashtags.slice(0, 3).map(
        (h) =>
          `<button type="button" class="menu-item" data-nx-act="search-pick-tag" data-tag="${escapeHtml(h.tag)}"><span>${escapeHtml(h.tag)}</span><span class="kbd-chip">Hashtag</span></button>`
      ),
      ...res.posts.slice(0, 3).map(
        (p) =>
          `<button type="button" class="menu-item" data-nx-act="search-pick-post" data-query="${escapeHtml(q)}"><span>${escapeHtml(String(p.content || '').slice(0, 46))}</span><span class="kbd-chip">Post</span></button>`
      ),
    ].join('');

    drop.hidden = false;
    drop.innerHTML =
      itemsHtml || `<div class="member-sub" style="padding:8px;">No results for "${escapeHtml(q)}". Press Enter to explore.</div>`;
  }

  /* ---------- DELEGATED DOM BINDINGS ---------- */

  function bindEvents() {
    if (boundDomEvents) return;
    boundDomEvents = true;

    const socialRoot = document.getElementById('nx-social-root');

    // Left sidebar navigation, Create menu, and More & Tools drawer
    document.getElementById('nx-left-nav')?.addEventListener('click', (e) => {
      const targetEl = e.target instanceof Element ? e.target : null;
      if (!targetEl) return;
      const createToggle = targetEl.closest('#nx-create-nav-btn');
      if (createToggle) {
        const menu = document.getElementById('nx-create-nav-menu');
        if (menu) {
          const nextHidden = !menu.hidden;
          menu.hidden = nextHidden;
          createToggle.setAttribute('aria-expanded', String(!nextHidden));
        }
        return;
      }
      const moreToggle = targetEl.closest('#nx-more-tools-btn');
      if (moreToggle) {
        const drawer = document.getElementById('nx-secondary-nav-drawer');
        if (drawer) {
          const nextHidden = !drawer.hidden;
          drawer.hidden = nextHidden;
          moreToggle.setAttribute('aria-expanded', String(!nextHidden));
        }
        return;
      }
      const createAct = targetEl.closest('[data-nx-create]');
      if (createAct) {
        const kind = createAct.getAttribute('data-nx-create');
        if (kind === 'post') {
          navigateTo('home', { focusComposer: true });
        } else if (kind === 'story') {
          pendingStoryStudioDataUrl = '';
          openModal('post-story-modal');
          const menu = document.getElementById('nx-create-nav-menu');
          if (menu) menu.hidden = true;
        } else if (kind === 'product') {
          navigateTo('marketplace', { openCreate: true });
        }
        return;
      }
      const btn = targetEl.closest('[data-nx-nav]');
      if (!btn) return;
      const target = btn.getAttribute('data-nx-nav');
      const productId = btn.getAttribute('data-product-id') || undefined;
      navigateTo(target, productId ? { productId } : {});
    });

    document.getElementById('nx-brand-home-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('home');
    });

    document.getElementById('nx-mobile-menu-btn')?.addEventListener('click', () => {
      const leftNav = document.getElementById('nx-left-nav');
      if (leftNav && (currentSection === 'messages' || currentSection === 'communities') && window.innerWidth > 900) {
        leftNav.classList.toggle('collapsed');
      } else {
        document.getElementById('app-shell')?.classList.toggle('nav-open');
      }
    });
    document.getElementById('nx-mob-more-btn')?.addEventListener('click', () => {
      document.getElementById('app-shell')?.classList.toggle('nav-open');
    });
    document.getElementById('nx-nav-scrim')?.addEventListener('click', () => {
      document.getElementById('app-shell')?.classList.remove('nav-open');
    });

    // Top Header Theme Switcher
    document.getElementById('nx-theme-pill')?.addEventListener('click', () => {
      const cur = normalizeThemePreference(prefs.theme);
      prefs.theme = cur === 'dark' ? 'light' : 'dark';
      savePrefs();
      applyPrefsToDom();
      showToast(prefs.theme === 'dark' ? 'Dark Mode enabled' : 'Light Mode enabled');
    });

    // Top Header Notifications & Messages & Profile
    document.getElementById('nx-top-notif-btn')?.addEventListener('click', () => {
      navigateTo('notifications');
    });
    document.getElementById('nx-top-msg-btn')?.addEventListener('click', () => {
      navigateTo('messages');
    });
    const openUserQuickMenu = (anchorEl) => {
      openPopoverNear(
        anchorEl,
        `
          <div style="display:flex;align-items:center;gap:10px;padding-bottom:8px;border-bottom:1px solid var(--nx-border);">
            ${renderUserAvatarHtml(profile, 38)}
            <div>
              <strong>${escapeHtml(profile.displayName)}</strong>
              <div class="member-sub">@${escapeHtml(profile.username)}</div>
            </div>
          </div>
          <div class="menu-list">
            <button type="button" class="menu-item" data-nx-act="menu-goto-profile"><span>My Profile</span><span>${svgIcon('user', 14)}</span></button>
            <button type="button" class="menu-item" data-nx-act="menu-goto-saved"><span>Saved Posts</span><span>${svgIcon('bookmark', 14)}</span></button>
            <button type="button" class="menu-item" data-nx-act="menu-goto-settings"><span>Settings &amp; Privacy</span><span>${svgIcon('settings', 14)}</span></button>
            ${
              isCurrentUserAdmin
                ? `<button type="button" class="menu-item" data-nx-act="menu-goto-admin"><span>Admin Dashboard</span><span>${svgIcon('shield', 14)}</span></button>`
                : ''
            }
            <button type="button" class="menu-item" style="color:var(--danger);" data-action="sign-out"><span>Sign Out</span><span>${svgIcon('close', 14)}</span></button>
          </div>
        `
      );
    };

    document.getElementById('nx-top-profile-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openUserQuickMenu(e.currentTarget);
    });
    document.getElementById('nx-rail-user-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openUserQuickMenu(e.currentTarget);
    });

    // Global Search Bar
    const searchInput = document.getElementById('nx-global-search');
    searchInput?.addEventListener('input', (e) => {
      if (e.target instanceof HTMLInputElement) {
        renderGlobalSearchDropdown(e.target.value);
      }
    });
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && searchInput instanceof HTMLInputElement) {
        e.preventDefault();
        const drop = document.getElementById('nx-search-dropdown');
        if (drop) drop.hidden = true;
        const q = searchInput.value.trim();
        if (q) {
          apiV1Fetch('/search/history', {
            method: 'POST',
            body: JSON.stringify({ query: q, category: exploreTab || 'all' }),
          })
            .then(() => refreshSearchHistory())
            .catch(() => {});
        }
        navigateTo('explore', { exploreQuery: q });
      }
    });

    // Social Root input delegation
    socialRoot?.addEventListener('input', (e) => {
      if (e.target instanceof HTMLTextAreaElement && e.target.id === 'nx-post-textarea') {
        composerText = e.target.value;
      } else if (e.target instanceof HTMLInputElement && e.target.id === 'nx-explore-search-input') {
        exploreQuery = e.target.value;
        render();
      }
    });

    // Social Root file inputs & select changes
    socialRoot?.addEventListener('change', async (e) => {
      if (e.target instanceof HTMLSelectElement && e.target.id === 'nx-post-visibility') {
        composerVisibility = e.target.value;
        return;
      }
      if (e.target instanceof HTMLSelectElement && e.target.hasAttribute('data-nx-pref-select')) {
        const key = e.target.getAttribute('data-nx-pref-select');
        if (key) {
          prefs[key] = e.target.value;
          savePrefs();
          if (key === 'defaultVisibility') composerVisibility = e.target.value;
          if (key === 'feedDefaultTab') feedTab = e.target.value;
          showToast('Preference saved', 'success');
        }
        return;
      }
      if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'file') return;
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      if (e.target.id === 'nx-post-photo-input') {
        const tok = currentUser ? await currentUser.getIdToken().catch(() => '') : '';
        for (const f of files.slice(0, 4 - composerMedia.length)) {
          try {
            let url = '';
            try {
              const uploaded = await uploadMediaFileToServer(f, { kind: 'post', token: tok });
              if (uploaded.storedOnServer && uploaded.url) url = uploaded.url;
            } catch {}
            if (!url) url = await compressImageFile(f, { maxBytes: 220000 });
            composerMedia.push({ type: 'image', url });
          } catch (err) {
            showToast(formatFriendlyError(err, 'Could not process image.'));
          }
        }
        e.target.value = '';
        render();
      } else if (e.target.id === 'nx-post-video-input') {
        const tok = currentUser ? await currentUser.getIdToken().catch(() => '') : '';
        try {
          let url = '';
          try {
            const uploaded = await uploadMediaFileToServer(files[0], { kind: 'post', token: tok });
            if (uploaded.storedOnServer && uploaded.url) url = uploaded.url;
          } catch {}
          if (!url) url = await readMediaFileBounded(files[0], 550000);
          composerMedia = [{ type: 'video', url }];
        } catch (err) {
          showToast(formatFriendlyError(err, 'Please pick a video clip under 10 MB.'));
        }
        e.target.value = '';
        render();
      } else if (e.target.id === 'nx-avatar-upload-input') {
        const tok = currentUser ? await currentUser.getIdToken().catch(() => '') : '';
        try {
          let url = '';
          try {
            const uploaded = await uploadMediaFileToServer(files[0], { kind: 'avatar', token: tok });
            if (uploaded.storedOnServer && uploaded.url) url = uploaded.url;
          } catch {}
          if (!url) url = await compressImageFile(files[0], { maxW: 512, maxH: 512, maxBytes: 185000 });
          const updated = await updateUserProfile(profile.id, { ...profile, avatar: url });
          if (updated) {
            profile.avatar = url;
            showToast('Profile picture updated', 'success');
            render();
          }
        } catch (err) {
          showToast(formatFriendlyError(err, 'Could not upload avatar.'));
        }
        e.target.value = '';
      } else if (e.target.id === 'nx-cover-upload-input') {
        const tok = currentUser ? await currentUser.getIdToken().catch(() => '') : '';
        try {
          let url = '';
          try {
            const uploaded = await uploadMediaFileToServer(files[0], { kind: 'cover', token: tok });
            if (uploaded.storedOnServer && uploaded.url) url = uploaded.url;
          } catch {}
          if (!url) url = await compressImageFile(files[0], { maxW: 1280, maxH: 540, maxBytes: 275000 });
          const updated = await updateUserProfile(profile.id, { ...profile, coverPhoto: url });
          if (updated) {
            profile.coverPhoto = url;
            showToast('Cover photo updated', 'success');
            render();
          }
        } catch (err) {
          showToast(formatFriendlyError(err, 'Could not upload cover photo.'));
        }
        e.target.value = '';
      }
    });

    // Global click actions for data-nx-act
    document.addEventListener('click', async (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      if (!target.closest('.nx-top-left')) {
        const drop = document.getElementById('nx-search-dropdown');
        if (drop) drop.hidden = true;
      }

      // Handle data-nx-nav clicks anywhere in the document
      const navEl = target.closest('[data-nx-nav]');
      if (navEl && !target.closest('#nx-left-nav')) {
        const navTarget = navEl.getAttribute('data-nx-nav');
        const productId = navEl.getAttribute('data-product-id') || undefined;
        if (navTarget) {
          navigateTo(navTarget, productId ? { productId } : {});
          return;
        }
      }

      const actEl = target.closest('[data-nx-act]');
      if (!actEl) return;
      const act = actEl.getAttribute('data-nx-act');

      switch (act) {
        case 'dismiss-welcome-tour':
          localStorage.setItem('nx_welcome_tour_dismissed', 'true');
          render();
          showToast('Platform Guide minimized. Reopen anytime from the right rail.');
          break;
        case 'restore-welcome-tour':
          localStorage.removeItem('nx_welcome_tour_dismissed');
          render();
          break;
        case 'toggle-welcome-tour': {
          const isDismissedNow = !shouldShowWelcomeTour(localStorage.getItem('nx_welcome_tour_dismissed'));
          if (isDismissedNow) {
            localStorage.removeItem('nx_welcome_tour_dismissed');
          } else {
            localStorage.setItem('nx_welcome_tour_dismissed', 'true');
          }
          render();
          break;
        }
        case 'focus-composer': {
          const composer = document.getElementById('nx-post-textarea');
          if (composer) {
            composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            composer.focus();
          }
          break;
        }
        case 'open-create-community': {
          navigateTo('communities');
          setTimeout(() => {
            document.querySelector('[data-action="open-create-server"]')?.click();
          }, 80);
          break;
        }
        case 'menu-goto-profile':
          closePopover();
          navigateTo('profile', { uid: profile.id });
          break;
        case 'menu-goto-saved':
          closePopover();
          navigateTo('saved');
          break;
        case 'menu-goto-settings':
          closePopover();
          navigateTo('settings');
          break;
        case 'menu-goto-admin':
          closePopover();
          navigateTo('admin');
          break;
        case 'search-pick-user': {
          const drop = document.getElementById('nx-search-dropdown');
          if (drop) drop.hidden = true;
          navigateTo('profile', { uid: actEl.getAttribute('data-uid') });
          break;
        }
        case 'search-pick-tag': {
          const drop = document.getElementById('nx-search-dropdown');
          if (drop) drop.hidden = true;
          navigateTo('home', { hashtag: actEl.getAttribute('data-tag') });
          break;
        }
        case 'search-pick-post': {
          const drop = document.getElementById('nx-search-dropdown');
          if (drop) drop.hidden = true;
          navigateTo('explore', { exploreQuery: actEl.getAttribute('data-query') || '' });
          break;
        }
        case 'open-photo-studio':
          openPhotoStudioModal();
          break;
        case 'open-create-story':
          pendingStoryStudioDataUrl = '';
          openModal('post-story-modal');
          break;
        case 'open-story-group':
          openStoryViewer(Number(actEl.getAttribute('data-group-idx') || 0), 0);
          break;
        case 'scroll-stories-right':
          document.getElementById('nx-stories-row')?.scrollBy({ left: 260, behavior: 'smooth' });
          break;
        case 'prev-story-slide':
          stepStorySlide(-1);
          break;
        case 'next-story-slide':
          stepStorySlide(1);
          break;
        case 'react-story': {
          const sid = actEl.getAttribute('data-story-id');
          const em = actEl.getAttribute('data-emoji');
          if (sid && em && currentUser) {
            try {
              await runTransaction(db, async (tx) => {
                const storyRef = doc(db, 'stories', sid);
                const snap = await tx.get(storyRef);
                if (!snap.exists()) return;
                const rx = { ...(snap.data().reactions || {}) };
                const cur = Array.isArray(rx[em]) ? rx[em] : [];
                if (!cur.includes(currentUser.uid)) {
                  rx[em] = [...cur, currentUser.uid].slice(-200);
                  tx.update(storyRef, { reactions: rx });
                }
              });
              showToast(`Reacted ${em}`);
              loadActiveStorySlide();
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `stories/${sid}`, { silent: true });
            }
          }
          break;
        }
        case 'delete-story': {
          const sid = actEl.getAttribute('data-story-id');
          if (sid) {
            await deleteDoc(doc(db, 'stories', sid)).catch(() => {});
            stopStoryTimer();
            closeAllModals();
            showToast('Story deleted');
          }
          break;
        }
        case 'toggle-feeling-picker': {
          const feelings = ['Happy 😊', 'Excited 🤩', 'Grateful 💜', 'Focused 💻', 'Inspired ✨', 'Chill 😌'];
          openPopoverNear(
            actEl,
            `<div class="menu-list">
              ${feelings
                .map((f) => `<button type="button" class="menu-item" data-nx-act="pick-feeling" data-val="${escapeHtml(f)}">${escapeHtml(f)}</button>`)
                .join('')}
            </div>`
          );
          break;
        }
        case 'pick-feeling':
          composerFeeling = actEl.getAttribute('data-val') || '';
          closePopover();
          render();
          break;
        case 'clear-composer-feeling':
          composerFeeling = '';
          render();
          break;
        case 'prompt-checkin': {
          openPopoverNear(
            actEl,
            `<form id="nx-checkin-form" style="display:flex;gap:6px;">
              <input type="text" id="nx-checkin-input" class="input" placeholder="City or place..." maxlength="100" required />
              <button type="submit" class="nx-btn-grad" style="height:36px;">Add</button>
            </form>`
          );
          break;
        }
        case 'clear-composer-location':
          composerLocation = '';
          render();
          break;
        case 'prompt-product-tag': {
          const anchor = actEl;
          void apiV1Fetch('/products?limit=8')
            .then((res) => {
              const items = Array.isArray(res?.products) ? res.products : [];
              openPopoverNear(
                anchor,
                `<div style="display:grid;gap:8px;min-width:240px;">
                  ${
                    items.length > 0
                      ? `<div style="display:grid;gap:4px;max-height:160px;overflow-y:auto;">
                          ${items
                            .map(
                              (p) =>
                                `<button type="button" class="menu-item" data-nx-act="pick-product-tag" data-product-id="${escapeHtml(p.id)}">${escapeHtml(p.title)} · $${(Number(p.priceCents || 0) / 100).toFixed(2)}</button>`
                            )
                            .join('')}
                        </div>`
                      : ''
                  }
                  <form id="nx-product-tag-form" style="display:flex;gap:6px;">
                    <input type="text" id="nx-product-tag-input" class="input" placeholder="Product IDs (comma-separated)..." value="${escapeHtml(composerProductTags)}" maxlength="120" />
                    <button type="submit" class="nx-btn-grad" style="height:36px;">Tag</button>
                  </form>
                </div>`
              );
            })
            .catch(() => {
              openPopoverNear(
                anchor,
                `<form id="nx-product-tag-form" style="display:flex;gap:6px;">
                  <input type="text" id="nx-product-tag-input" class="input" placeholder="Product IDs (comma-separated)..." value="${escapeHtml(composerProductTags)}" maxlength="120" />
                  <button type="submit" class="nx-btn-grad" style="height:36px;">Tag</button>
                </form>`
              );
            });
          break;
        }
        case 'pick-product-tag': {
          const pid = (actEl.getAttribute('data-product-id') || '').trim();
          if (pid) {
            const existing = composerProductTags
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            if (!existing.includes(pid)) existing.push(pid);
            composerProductTags = existing.join(', ');
          }
          closePopover();
          render();
          break;
        }
        case 'clear-composer-products':
          composerProductTags = '';
          render();
          break;
        case 'save-post-draft': {
          const curTxt = document.getElementById('nx-post-textarea')?.value || composerText;
          localStorage.setItem(
            'nx_post_draft_v1',
            JSON.stringify({
              text: curTxt,
              feeling: composerFeeling,
              location: composerLocation,
              visibility: composerVisibility,
              productTags: composerProductTags,
            })
          );
          showToast('Draft saved locally', 'success');
          render();
          break;
        }
        case 'load-post-draft': {
          try {
            const raw = JSON.parse(localStorage.getItem('nx_post_draft_v1') || 'null');
            if (raw) {
              composerText = String(raw.text || '');
              composerFeeling = String(raw.feeling || '');
              composerLocation = String(raw.location || '');
              composerVisibility = String(raw.visibility || 'public');
              composerProductTags = String(raw.productTags || '');
              render();
            }
          } catch {}
          break;
        }
        case 'remove-composer-media': {
          const idx = Number(actEl.getAttribute('data-idx'));
          composerMedia.splice(idx, 1);
          render();
          break;
        }
        case 'publish-post':
          await publishNewPost();
          break;
        case 'set-feed-tab':
          feedTab = actEl.getAttribute('data-tab') || 'for-you';
          render();
          void refreshServerFeed(false);
          break;
        case 'filter-hashtag': {
          const tag = actEl.getAttribute('data-tag') || '';
          activeHashtagFilter = tag.startsWith('#') ? tag.toLowerCase() : `#${tag.toLowerCase()}`;
          currentSection = 'home';
          render();
          void refreshServerFeed(false);
          break;
        }
        case 'clear-hashtag-filter':
          activeHashtagFilter = '';
          render();
          void refreshServerFeed(false);
          break;
        case 'open-mention': {
          const handle = (actEl.getAttribute('data-handle') || '').replace(/^@/, '').toLowerCase();
          const match = (state.directoryUsers || []).find((u) => String(u.username || '').toLowerCase() === handle);
          if (match) navigateTo('profile', { uid: match.id });
          else navigateTo('explore', { exploreQuery: handle });
          break;
        }
        case 'retry-feed-sync':
          postsError = '';
          postsLoading = true;
          subscribePublicPosts();
          if (currentUser) {
            subscribeFollowersPosts(currentUser.uid);
            subscribeOwnPosts(currentUser.uid);
          }
          void refreshServerFeed(false);
          render();
          break;
        case 'load-more-posts':
          feedLimit += FEED_PAGE_SIZE;
          if (feedLimit + FEED_PAGE_SIZE >= publicPostsMap.size && hasMoreServerPosts) {
            publicPostsLimit += 100;
            subscribePublicPosts();
          }
          void refreshServerFeed(true);
          render();
          break;
        case 'toggle-like-post':
          await toggleLikePost(actEl.getAttribute('data-post-id'));
          break;
        case 'toggle-comments-post': {
          const pid = actEl.getAttribute('data-post-id');
          if (!pid) break;
          if (expandedPostIds.has(pid)) {
            expandedPostIds.delete(pid);
          } else {
            expandedPostIds.add(pid);
            ensurePostCommentsSubscription(pid);
          }
          render();
          break;
        }
        case 'reply-comment': {
          const pid = actEl.getAttribute('data-post-id');
          const cid = actEl.getAttribute('data-comment-id');
          const authorName = actEl.getAttribute('data-author-name') || 'Member';
          if (pid && cid) {
            replyingToCommentMap.set(pid, { commentId: cid, authorName });
            editingCommentMap.delete(pid);
            render();
            const form = document.querySelector(`form[data-nx-comment-post="${CSS.escape(pid)}"] input[name="commentText"]`);
            if (form instanceof HTMLInputElement) form.focus();
          }
          break;
        }
        case 'cancel-reply-comment': {
          const pid = actEl.getAttribute('data-post-id');
          if (pid) {
            replyingToCommentMap.delete(pid);
            render();
          }
          break;
        }
        case 'edit-comment': {
          const pid = actEl.getAttribute('data-post-id');
          const cid = actEl.getAttribute('data-comment-id');
          if (pid && cid) {
            editingCommentMap.set(pid, cid);
            replyingToCommentMap.delete(pid);
            render();
          }
          break;
        }
        case 'cancel-edit-comment': {
          const pid = actEl.getAttribute('data-post-id');
          if (pid) {
            editingCommentMap.delete(pid);
            render();
          }
          break;
        }
        case 'delete-comment': {
          const pid = actEl.getAttribute('data-post-id');
          const cid = actEl.getAttribute('data-comment-id');
          if (pid && cid && currentUser) {
            try {
              const postRef = doc(db, 'posts', pid);
              const cmtRef = doc(db, 'posts', pid, 'comments', cid);
              await runTransaction(db, async (tx) => {
                const postSnap = await tx.get(postRef);
                tx.delete(cmtRef);
                if (postSnap.exists()) {
                  const prevCount = Math.max(0, Number(postSnap.data().commentsCount || 0));
                  tx.update(postRef, {
                    commentsCount: Math.max(0, prevCount - 1),
                    updatedAt: serverTimestamp(),
                  });
                }
              });
              showToast('Comment removed');
            } catch (err) {
              handleFirestoreError(err, OperationType.DELETE, `posts/${pid}/comments/${cid}`);
            }
          }
          break;
        }
        case 'bookmark-post': {
          if (!currentUser) break;
          const pid = actEl.getAttribute('data-post-id');
          const p = posts.find((x) => x.id === pid);
          const bmId = `bm-post-${pid}`;
          const existing = state.bookmarks.find((b) => b.id === bmId);
          if (existing) {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'bookmarks', bmId));
            showToast('Removed from Saved Posts');
          } else if (p) {
            await setDoc(doc(db, 'users', currentUser.uid, 'bookmarks', bmId), {
              id: bmId,
              sourceType: 'post',
              sourceId: pid,
              messageId: pid,
              authorName: String(p.authorName || 'Member').slice(0, 80),
              content: String(p.content || '').slice(0, 2000),
              createdAt: serverTimestamp(),
            });
            showToast('Saved to Bookmarks', 'success');
          }
          break;
        }
        case 'share-post': {
          const pid = actEl.getAttribute('data-post-id');
          const link = `${window.location.origin}/app.html#post-${pid}`;
          navigator.clipboard?.writeText(link).catch(() => {});
          if (pid) {
            runTransaction(db, async (tx) => {
              const postRef = doc(db, 'posts', pid);
              const snap = await tx.get(postRef);
              if (!snap.exists()) return;
              tx.update(postRef, {
                sharesCount: Math.max(0, Number(snap.data().sharesCount || 0)) + 1,
                updatedAt: serverTimestamp(),
              });
            }).catch(() => {});
          }
          showToast('Post link copied to clipboard', 'success');
          break;
        }
        case 'react-comment': {
          const pid = actEl.getAttribute('data-post-id');
          const cid = actEl.getAttribute('data-comment-id');
          const emoji = actEl.getAttribute('data-emoji') || '👍';
          if (pid && cid && currentUser) {
            try {
              await apiV1Fetch(`/posts/${encodeURIComponent(pid)}/comments/${encodeURIComponent(cid)}/react`, {
                method: 'POST',
                body: JSON.stringify({ emoji }),
              });
            } catch (err) {
              showToast(formatFriendlyError(err, 'Could not react to comment.'), 'error');
            }
          }
          break;
        }
        case 'post-menu': {
          e.stopPropagation();
          const pid = actEl.getAttribute('data-post-id');
          const p = posts.find((x) => x.id === pid);
          if (!p) break;
          const canEdit = p.authorId === profile.id;
          const canDelete = canEdit || isCurrentUserAdmin;
          openPopoverNear(
            actEl,
            `<div class="menu-list">
              ${canEdit ? `<button type="button" class="menu-item" data-nx-act="edit-post" data-post-id="${escapeHtml(pid)}"><span>Edit Post</span></button>` : ''}
              ${canDelete ? `<button type="button" class="menu-item" style="color:var(--danger);" data-nx-act="delete-post" data-post-id="${escapeHtml(pid)}"><span>Delete Post</span></button>` : ''}
              ${!canEdit ? `<button type="button" class="menu-item" data-nx-act="not-interested-post" data-post-id="${escapeHtml(pid)}" data-author-id="${escapeHtml(p.authorId)}"><span>Not Interested</span></button>` : ''}
              ${!canEdit ? `<button type="button" class="menu-item" data-action="open-report" data-target-type="post" data-target-id="${escapeHtml(pid)}"><span>Report Post</span></button>` : ''}
            </div>`
          );
          break;
        }
        case 'not-interested-post': {
          closePopover();
          const pid = actEl.getAttribute('data-post-id');
          const authorId = actEl.getAttribute('data-author-id') || '';
          if (pid) {
            hiddenPostIds.add(pid);
            render();
            apiV1Fetch('/feed/feedback', {
              method: 'POST',
              body: JSON.stringify({ postId: pid, authorId, action: 'not_interested' }),
            }).catch(() => {});
            showToast('Hidden from your feed');
          }
          break;
        }
        case 'edit-post':
          closePopover();
          editingPostId = actEl.getAttribute('data-post-id');
          render();
          break;
        case 'cancel-edit-post':
          editingPostId = null;
          render();
          break;
        case 'save-edit-post': {
          const pid = actEl.getAttribute('data-post-id');
          const val = document.getElementById('nx-edit-post-input')?.value?.trim();
          if (pid && val) {
            try {
              await updateDoc(doc(db, 'posts', pid), {
                content: val.slice(0, 4000),
                hashtags: extractHashtags(val),
                mentions: extractMentions(val),
                edited: true,
                updatedAt: serverTimestamp(),
              });
              editingPostId = null;
              showToast('Post updated');
              render();
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `posts/${pid}`);
            }
          }
          break;
        }
        case 'delete-post': {
          closePopover();
          const pid = actEl.getAttribute('data-post-id');
          if (pid && currentUser) {
            try {
              const postRef = doc(db, 'posts', pid);
              const postSnap = await getDoc(postRef);
              if (postSnap.exists()) {
                const authorId = postSnap.data().authorId;
                await deleteDoc(postRef);
                if (authorId === currentUser.uid) {
                  const meRef = doc(db, 'users', currentUser.uid);
                  await runTransaction(db, async (tx) => {
                    const meSnap = await tx.get(meRef);
                    if (!meSnap.exists()) return;
                    const cur = Math.max(0, Number(meSnap.data().postsCount || 0));
                    tx.update(meRef, { postsCount: Math.max(0, cur - 1), updatedAt: serverTimestamp() });
                  }).catch(() => {});
                }
              }
              showToast('Post removed');
            } catch (err) {
              handleFirestoreError(err, OperationType.DELETE, `posts/${pid}`);
            }
          }
          break;
        }
        case 'view-user-profile':
          navigateTo('profile', { uid: actEl.getAttribute('data-uid') });
          break;
        case 'toggle-follow':
          await toggleFollowUser(actEl.getAttribute('data-uid'));
          break;
        case 'open-dm-user':
          await openDirectMessageWithUser(actEl.getAttribute('data-uid'));
          navigateTo('messages');
          break;
        case 'call-dm-user':
          navigateTo('messages');
          await startDmCallWithUser(actEl.getAttribute('data-uid'), 'video');
          break;
        case 'see-all-people':
          exploreTab = 'people';
          navigateTo('explore');
          break;
        case 'goto-calls':
          navigateTo('calls');
          break;
        case 'goto-reels':
          navigateTo('reels');
          break;
        case 'goto-saved':
          navigateTo('saved');
          break;
        case 'goto-communities':
          navigateTo('communities');
          break;
        case 'set-explore-tab':
          exploreTab = actEl.getAttribute('data-tab') || 'all';
          render();
          if (exploreTab === 'nearby') {
            void refreshNearbyDiscovery();
          } else if (exploreTab === 'products') {
            void refreshExploreProducts();
          }
          break;
        case 'apply-search-history': {
          const q = actEl.getAttribute('data-query') || '';
          exploreQuery = q;
          render();
          if (exploreTab === 'products') void refreshExploreProducts();
          break;
        }
        case 'delete-search-history': {
          const id = actEl.getAttribute('data-id') || '';
          if (id) {
            searchHistoryItems = searchHistoryItems.filter((h) => h.id !== id);
            render();
            apiV1Fetch(`/search/history/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
          }
          break;
        }
        case 'toggle-mute-user': {
          const targetUid = actEl.getAttribute('data-uid') || '';
          if (targetUid && currentUser) {
            const alreadyMuted = mutedAuthorIds.has(targetUid);
            try {
              await apiV1Fetch(`/users/${encodeURIComponent(targetUid)}/mute`, {
                method: alreadyMuted ? 'DELETE' : 'POST',
              });
              if (alreadyMuted) mutedAuthorIds.delete(targetUid);
              else mutedAuthorIds.add(targetUid);
              showToast(alreadyMuted ? 'User unmuted' : 'User muted across your feed');
              render();
            } catch (err) {
              showToast(formatFriendlyError(err, 'Could not update mute state.'), 'error');
            }
          }
          break;
        }
        case 'respond-follow-request': {
          const requesterUid = actEl.getAttribute('data-uid') || '';
          const decision = actEl.getAttribute('data-decision') || 'decline';
          if (requesterUid && currentUser) {
            try {
              await apiV1Fetch(`/follow-requests/${encodeURIComponent(requesterUid)}/respond`, {
                method: 'POST',
                body: JSON.stringify({ action: decision }),
              });
              pendingFollowRequests = pendingFollowRequests.filter((r) => r.requesterUid !== requesterUid);
              showToast(decision === 'accept' ? 'Follow request accepted' : 'Follow request declined');
              render();
            } catch (err) {
              showToast(formatFriendlyError(err, 'Could not respond to follow request.'), 'error');
            }
          }
          break;
        }
        case 'remove-follower': {
          const followerUid = actEl.getAttribute('data-uid') || '';
          if (followerUid && currentUser) {
            try {
              await apiV1Fetch(`/users/me/followers/${encodeURIComponent(followerUid)}`, { method: 'DELETE' });
              viewedProfileFollowers = viewedProfileFollowers.filter((f) => (f.uid || f.id) !== followerUid);
              showToast('Follower removed');
              render();
            } catch (err) {
              showToast(formatFriendlyError(err, 'Could not remove follower.'), 'error');
            }
          }
          break;
        }
        case 'open-reel-at':
          activeReelIndex = Number(actEl.getAttribute('data-idx') || 0);
          navigateTo('reels');
          break;
        case 'open-upload-reel':
          openReelStudioModal();
          break;
        case 'prev-reel':
          if (activeReelIndex > 0) { activeReelIndex -= 1; render(); }
          break;
        case 'next-reel':
          if (activeReelIndex + 1 < reels.length) { activeReelIndex += 1; render(); }
          break;
        case 'toggle-reel-mute':
          reelMuted = !reelMuted;
          render();
          break;
        case 'toggle-reel-play': {
          const vid = document.getElementById('nx-active-reel-video');
          if (vid instanceof HTMLVideoElement) {
            if (vid.paused) vid.play().catch(() => {});
            else vid.pause();
          }
          break;
        }
        case 'export-active-reel': {
          const activeReel = reels[activeReelIndex] || null;
          if (!activeReel) break;
          await runReelExportForYouTube({
            videoEl: document.getElementById('nx-active-reel-video'),
            youtubeTitle: activeReel.caption || activeReel.audioTitle || 'NEXORA Reel',
            filterId: activeReel.filterName || 'none',
            textOverlays: activeReel.textOverlays || [],
            audioTrackId: activeReel.audioTrackId || 'original',
            audioDataUrl: activeReel.audioDataUrl || '',
            musicVolume: activeReel.musicVolume ?? 0.75,
            statusEl: document.getElementById('nx-feed-export-status'),
            triggerBtn: actEl instanceof HTMLButtonElement ? actEl : null,
          });
          break;
        }
        case 'toggle-like-reel': {
          const rid = actEl.getAttribute('data-reel-id');
          if (rid && currentUser && !pendingLikeReelIds.has(rid)) {
            pendingLikeReelIds.add(rid);
            try {
              const reelRef = doc(db, 'reels', rid);
              const likeRef = doc(db, 'reels', rid, 'likes', currentUser.uid);
              await runTransaction(db, async (tx) => {
                const [reelSnap, likeSnap] = await Promise.all([tx.get(reelRef), tx.get(likeRef)]);
                if (!reelSnap.exists()) return;
                const rData = reelSnap.data();
                const prevUids = Array.isArray(rData.likesUids) ? rData.likesUids : [];
                const hasLikeDoc = likeSnap.exists();
                const hasLegacyUid = prevUids.includes(currentUser.uid);
                const prevCount =
                  typeof rData.likesCount === 'number' && Number.isFinite(rData.likesCount)
                    ? Math.max(0, rData.likesCount)
                    : 0;

                if (hasLikeDoc || hasLegacyUid) {
                  if (hasLikeDoc) tx.delete(likeRef);
                  tx.update(reelRef, {
                    likesUids: prevUids.filter((id) => id !== currentUser.uid),
                    likesCount: Math.max(0, prevCount - 1),
                    updatedAt: serverTimestamp(),
                  });
                } else {
                  tx.set(likeRef, {
                    userId: currentUser.uid,
                    displayName: String(profile.displayName || 'Member').slice(0, 120),
                    username: String(profile.username || 'member').slice(0, 50),
                    createdAt: serverTimestamp(),
                  });
                  tx.update(reelRef, {
                    likesUids: prevUids.includes(currentUser.uid)
                      ? prevUids
                      : [...prevUids, currentUser.uid].slice(-500),
                    likesCount: prevCount + 1,
                    updatedAt: serverTimestamp(),
                  });
                }
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `reels/${rid}`);
            } finally {
              pendingLikeReelIds.delete(rid);
            }
          }
          break;
        }
        case 'bookmark-reel': {
          const rid = actEl.getAttribute('data-reel-id');
          const r = reels.find((x) => x.id === rid);
          if (rid && currentUser) {
            const bmId = `bm-reel-${rid}`;
            const existing = state.bookmarks.find((b) => b.id === bmId);
            try {
              if (existing) {
                await deleteDoc(doc(db, 'users', currentUser.uid, 'bookmarks', bmId));
                showToast('Removed reel from Bookmarks');
              } else if (r) {
                await setDoc(doc(db, 'users', currentUser.uid, 'bookmarks', bmId), {
                  id: bmId,
                  sourceType: 'reel',
                  sourceId: rid,
                  messageId: rid,
                  authorName: String(r.authorName || 'Creator').slice(0, 80),
                  content: String(r.caption || 'NEXORA Reel').slice(0, 2000),
                  createdAt: serverTimestamp(),
                });
                showToast('Reel saved to Bookmarks', 'success');
              }
            } catch (err) {
              handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}/bookmarks/${bmId}`);
            }
          }
          break;
        }
        case 'delete-reel': {
          const rid = actEl.getAttribute('data-reel-id');
          if (rid) {
            try {
              await deleteDoc(doc(db, 'reels', rid));
              showToast('Reel deleted');
            } catch (err) {
              handleFirestoreError(err, OperationType.DELETE, `reels/${rid}`);
            }
          }
          break;
        }
        case 'open-schedule-meeting':
          openModal('create-meeting-modal');
          break;
        case 'start-instant-meeting': {
          if (!currentUser) break;
          const mId = `mtg-${Date.now()}`;
          const code = generateMeetingCode();
          const callId = getRoomCallId('stage', mId);
          const payload = {
            id: mId,
            code,
            title: `${profile.displayName}'s Instant Meeting`,
            description: 'Live video & audio room on NEXORA',
            hostId: currentUser.uid,
            hostName: profile.displayName.slice(0, 120),
            scheduledFor: 'Live Now',
            scheduledAtMs: Date.now(),
            status: 'live',
            callId,
            participantIds: [currentUser.uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(doc(db, 'meetings', mId), payload);
          await startOrJoinMeeting(payload, true);
          break;
        }
        case 'join-meeting': {
          const mid = actEl.getAttribute('data-meeting-id');
          const mtg = meetings.find((m) => m.id === mid);
          if (mtg) {
            await startOrJoinMeeting(mtg, true);
          }
          break;
        }
        case 'leave-meeting':
          activeMeetingId = '';
          await rtc.leaveCall();
          render();
          break;
        case 'copy-meeting-code': {
          const code = actEl.getAttribute('data-code') || '';
          navigator.clipboard?.writeText(code).catch(() => {});
          showToast(`Copied meeting code ${code}`);
          break;
        }
        case 'end-meeting': {
          const mid = actEl.getAttribute('data-meeting-id');
          if (mid) {
            await updateDoc(doc(db, 'meetings', mid), { status: 'ended', updatedAt: serverTimestamp() });
            if (activeMeetingId === mid) {
              activeMeetingId = '';
              await rtc.leaveCall();
            }
            showToast('Meeting ended');
          }
          break;
        }
        case 'set-notif-filter':
          notifFilter = actEl.getAttribute('data-filter') || 'all';
          render();
          break;
        case 'mark-one-notif-read': {
          const nid = actEl.getAttribute('data-id');
          if (nid && currentUser) {
            await updateDoc(doc(db, 'users', currentUser.uid, 'notifications', nid), { unread: false });
          }
          break;
        }
        case 'mark-all-notifs-read':
          if (currentUser) {
            for (const n of state.notifications || []) {
              if (n.unread) {
                updateDoc(doc(db, 'users', currentUser.uid, 'notifications', n.id), { unread: false }).catch(() => {});
              }
            }
            showToast('All notifications marked read');
          }
          break;
        case 'toggle-profile-edit':
          profileEditing = !profileEditing;
          render();
          break;
        case 'set-profile-tab':
          profileTab = actEl.getAttribute('data-tab') || 'posts';
          render();
          break;
        case 'set-saved-tab':
          savedTab = actEl.getAttribute('data-tab') || 'all';
          render();
          break;
        case 'remove-saved': {
          const bId = actEl.getAttribute('data-id');
          if (bId && currentUser) {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'bookmarks', bId));
          }
          break;
        }
        case 'enable-geo-discovery':
          await enableGeoDiscovery();
          break;
        case 'refresh-nearby-discovery':
          await refreshNearbyDiscovery();
          break;
        case 'set-nearby-radius': {
          const km = Number(actEl.getAttribute('data-km') || 10);
          nearbyRadiusKm = Number.isFinite(km) && km > 0 ? km : 10;
          await refreshNearbyDiscovery();
          break;
        }
        case 'pause-nearby': {
          const mins = Number(actEl.getAttribute('data-minutes') || 15);
          await pauseNearbyDiscovery(mins);
          break;
        }
        case 'stop-nearby-discovery':
          await stopNearbyDiscovery();
          break;
        case 'rsvp-local-event': {
          const evId = actEl.getAttribute('data-event-id');
          if (evId && currentUser) {
            try {
              const token = await currentUser.getIdToken();
              const res = await fetch(`/api/discovery/events/${encodeURIComponent(evId)}/rsvp`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                await refreshNearbyDiscovery();
              }
            } catch {}
          }
          break;
        }
        case 'set-settings-tab':
          settingsTab = actEl.getAttribute('data-tab') || 'account';
          render();
          break;
        case 'toggle-pref': {
          const prefKey = actEl.getAttribute('data-pref');
          if (prefKey) {
            prefs[prefKey] = !Boolean(prefs[prefKey]);
            savePrefs();
            render();
            showToast('Preference updated', 'success');
          }
          break;
        }
        case 'switch-theme':
          prefs.theme = actEl.getAttribute('data-theme') || 'light';
          savePrefs();
          applyPrefsToDom();
          render();
          break;
        case 'switch-density':
          prefs.density = actEl.getAttribute('data-density') || 'cozy';
          savePrefs();
          applyPrefsToDom();
          render();
          break;
        case 'deactivate-account':
          try {
            await deactivateCurrentAccount();
          } catch (err) {
            showToast(formatFriendlyError(err, 'Could not deactivate account.'), 'error');
          }
          break;
        case 'prompt-delete-me':
          confirmDeleteOpen = true;
          render();
          break;
        case 'cancel-delete-me':
          confirmDeleteOpen = false;
          render();
          break;
        case 'confirm-delete-me':
          try {
            await deleteCurrentAccount();
          } catch (err) {
            showToast(formatFriendlyError(err, 'Site is busy right now. Could not delete account.'), 'error');
            confirmDeleteOpen = false;
            render();
          }
          break;
        case 'watch-live-stream': {
          const sid = actEl.getAttribute('data-stream-id');
          const st = liveStreams.find((s) => s.id === sid);
          if (st) {
            activeLiveStreamId = sid;
            subscribeLiveChat(sid);
            await rtc.joinCall({
              callId: st.callId || getRoomCallId('stage', sid),
              kind: 'stage',
              targetId: sid,
              title: st.title,
              currentUserProfile: profile,
              withVideo: false,
              withScreen: false,
            });
            render();
          }
          break;
        }
        case 'react-live-stream': {
          const sid = actEl.getAttribute('data-stream-id');
          if (sid) {
            runTransaction(db, async (tx) => {
              const ref = doc(db, 'live_streams', sid);
              const snap = await tx.get(ref);
              if (!snap.exists()) return;
              tx.update(ref, {
                reactionCount: Math.max(0, Number(snap.data().reactionCount || 0)) + 1,
                updatedAt: serverTimestamp(),
              });
            }).catch(() => {});
            showToast('Sent ❤️ cheer to live stream');
          }
          break;
        }
        case 'end-live-stream': {
          const sid = actEl.getAttribute('data-stream-id');
          if (sid) {
            await updateDoc(doc(db, 'live_streams', sid), { status: 'ended', updatedAt: serverTimestamp() });
            await rtc.leaveCall();
            showToast('Live broadcast ended');
          }
          break;
        }
        case 'set-admin-tab':
          adminTab = actEl.getAttribute('data-tab') || 'overview';
          render();
          break;
        case 'admin-toggle-verify': {
          const uid = actEl.getAttribute('data-uid');
          const val = actEl.getAttribute('data-val') === '1';
          if (uid && isCurrentUserAdmin) {
            await updateDoc(doc(db, 'users', uid), { verified: val, updatedAt: serverTimestamp() });
            showToast(val ? 'User verified' : 'Verification removed');
          }
          break;
        }
        case 'admin-toggle-suspend': {
          const uid = actEl.getAttribute('data-uid');
          const val = actEl.getAttribute('data-val') === '1';
          if (uid && isCurrentUserAdmin) {
            await updateDoc(doc(db, 'users', uid), { suspended: val, updatedAt: serverTimestamp() });
            showToast(val ? 'User suspended' : 'User restored');
          }
          break;
        }
      }
    });

    // Delegated form submissions for Social features & Modals
    document.addEventListener('submit', async (e) => {
      if (!(e.target instanceof HTMLFormElement) || !currentUser) return;

      if (e.target.id === 'nx-checkin-form') {
        e.preventDefault();
        composerLocation = document.getElementById('nx-checkin-input')?.value?.trim() || '';
        closePopover();
        render();
        return;
      }

      if (e.target.id === 'nx-product-tag-form') {
        e.preventDefault();
        composerProductTags = document.getElementById('nx-product-tag-input')?.value?.trim() || '';
        closePopover();
        render();
        return;
      }

      if (e.target.hasAttribute('data-nx-edit-comment-post')) {
        e.preventDefault();
        const postId = e.target.getAttribute('data-nx-edit-comment-post');
        const cid = e.target.getAttribute('data-comment-id');
        const input = e.target.elements.namedItem('editCommentText');
        const txt = input instanceof HTMLInputElement ? input.value.trim() : '';
        if (!postId || !cid || !txt) return;
        try {
          await updateDoc(doc(db, 'posts', postId, 'comments', cid), {
            content: txt.slice(0, 1500),
            edited: true,
            updatedAt: serverTimestamp(),
          });
          editingCommentMap.delete(postId);
          showToast('Comment updated');
          render();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `posts/${postId}/comments/${cid}`);
        }
        return;
      }

      if (e.target.hasAttribute('data-nx-comment-post')) {
        e.preventDefault();
        const postId = e.target.getAttribute('data-nx-comment-post');
        const input = e.target.elements.namedItem('commentText');
        const txt = input instanceof HTMLInputElement ? input.value.trim() : '';
        if (!postId || !txt) return;
        const cid = `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const replyState = replyingToCommentMap.get(postId) || null;
        const cmtPayload = {
          id: cid,
          parentId: postId,
          authorId: currentUser.uid,
          authorName: profile.displayName.slice(0, 120),
          authorInitials: profile.initials.slice(0, 16),
          authorAvatar: String(profile.avatar || '').slice(0, 200000),
          content: txt.slice(0, 1500),
          likesUids: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (replyState) {
          cmtPayload.replyToId = String(replyState.commentId).slice(0, 128);
          cmtPayload.replyToName = String(replyState.authorName).slice(0, 80);
        }

        try {
          const postRef = doc(db, 'posts', postId);
          const cmtRef = doc(db, 'posts', postId, 'comments', cid);
          const postAuthorId = await runTransaction(db, async (tx) => {
            const postSnap = await tx.get(postRef);
            if (!postSnap.exists()) throw new Error('Post no longer exists.');
            const prevCount = Math.max(0, Number(postSnap.data().commentsCount || 0));
            tx.set(cmtRef, cmtPayload);
            tx.update(postRef, {
              commentsCount: prevCount + 1,
              updatedAt: serverTimestamp(),
            });
            return postSnap.data().authorId;
          });
          replyingToCommentMap.delete(postId);
          if (postAuthorId && postAuthorId !== currentUser.uid) {
            sendUserNotification(postAuthorId, {
              category: 'comment',
              targetId: postId,
              title: replyState ? 'New Reply' : 'New Comment',
              body: `${profile.displayName} commented: "${txt.slice(0, 60)}"`,
            });
          }
          if (input instanceof HTMLInputElement) input.value = '';
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `posts/${postId}/comments/${cid}`);
        }
        return;
      }

      if (e.target.hasAttribute('data-nx-comment-reel')) {
        e.preventDefault();
        const reelId = e.target.getAttribute('data-nx-comment-reel');
        const input = e.target.elements.namedItem('commentText');
        const txt = input instanceof HTMLInputElement ? input.value.trim() : '';
        if (!reelId || !txt) return;
        const cid = `rcmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          const reelRef = doc(db, 'reels', reelId);
          const cmtRef = doc(db, 'reels', reelId, 'comments', cid);
          await runTransaction(db, async (tx) => {
            const reelSnap = await tx.get(reelRef);
            if (!reelSnap.exists()) return;
            const prevCount = Math.max(0, Number(reelSnap.data().commentsCount || 0));
            tx.set(cmtRef, {
              id: cid,
              parentId: reelId,
              authorId: currentUser.uid,
              authorName: profile.displayName.slice(0, 120),
              authorInitials: profile.initials.slice(0, 16),
              authorAvatar: String(profile.avatar || '').slice(0, 200000),
              content: txt.slice(0, 1500),
              likesUids: [],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            tx.update(reelRef, {
              commentsCount: prevCount + 1,
              updatedAt: serverTimestamp(),
            });
          });
          if (input instanceof HTMLInputElement) input.value = '';
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `reels/${reelId}/comments/${cid}`);
        }
        return;
      }

      if (e.target.id === 'post-story-form') {
        e.preventDefault();
        const content = document.getElementById('story-content-input')?.value?.trim() || '';
        const bgGradient = document.getElementById('story-bg-select')?.value || '';
        const sticker = document.getElementById('story-sticker-select')?.value || '';
        const storyFilter = document.getElementById('story-filter-select')?.value || 'none';
        const mediaEl = document.getElementById('story-media-input');
        const file = mediaEl instanceof HTMLInputElement ? mediaEl.files?.[0] : null;
        if (!content && !file && !pendingStoryStudioDataUrl) return;

        let mediaType = 'text';
        let mediaUrl = '';
        if (pendingStoryStudioDataUrl && !file) {
          mediaType = 'image';
          mediaUrl = pendingStoryStudioDataUrl;
        } else if (file) {
          try {
            if (file.type.startsWith('image/')) {
              mediaType = 'image';
              const rawImg = await compressImageFile(file, { maxBytes: 240000 });
              mediaUrl =
                storyFilter && storyFilter !== 'none'
                  ? await renderPhotoTemplateToDataUrl({
                      imageDataUrl: rawImg,
                      templateId: 'clean-filter',
                      filterId: storyFilter,
                      stickerText: sticker,
                      maxBytes: 240000,
                    })
                  : rawImg;
            } else {
              mediaType = 'video';
              mediaUrl = await readMediaFileBounded(file, 530000);
            }
          } catch (err) {
            showToast(formatFriendlyError(err, 'Could not process story media.'));
            return;
          }
        }
        pendingStoryStudioDataUrl = '';

        const sid = `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await setDoc(doc(db, 'stories', sid), {
          id: sid,
          userId: currentUser.uid,
          userName: profile.displayName.slice(0, 120),
          userAvatar: String(profile.avatar || '').slice(0, 200000),
          userInitials: profile.initials.slice(0, 16),
          mediaType,
          mediaUrl,
          content: (content || sticker || 'Story update').slice(0, 400),
          bgGradient: bgGradient.slice(0, 120),
          sticker: sticker.slice(0, 40),
          reactions: {},
          viewsCount: 0,
          createdAt: serverTimestamp(),
          expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
        });
        e.target.reset();
        closeAllModals();
        showToast('24-hour story published', 'success');
        return;
      }

      if (e.target.id === 'nx-story-reply-form') {
        e.preventDefault();
        const txt = document.getElementById('nx-story-reply-input')?.value?.trim();
        const authorId = e.target.getAttribute('data-author-id');
        if (txt && authorId) {
          await sendUserNotification(authorId, {
            category: 'story',
            targetId: currentUser.uid,
            title: 'Story Reply',
            body: `${profile.displayName} replied to your story: "${txt.slice(0, 100)}"`,
          });
          showToast('Reply sent', 'success');
          e.target.reset();
        }
        return;
      }

        if (e.target.id === 'nx-local-event-form') {
          e.preventDefault();
          if (!currentUser) return;
          const title = document.getElementById('nx-local-event-title')?.value?.trim() || '';
          const startsAt = document.getElementById('nx-local-event-starts')?.value?.trim() || '';
          const city = document.getElementById('nx-local-event-city')?.value?.trim() || 'Local Area';
          if (!title || !startsAt) return;
          try {
            const token = await currentUser.getIdToken();
            const res = await fetch('/api/discovery/events', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                title,
                startsAt,
                city,
                lat: nearbyCoords?.lat ?? 37.77,
                lon: nearbyCoords?.lon ?? -122.41,
              }),
            });
            if (res.ok) {
              showToast('Local community event published!', 'success');
              e.target.reset();
              await refreshNearbyDiscovery();
            } else {
              const err = await res.json().catch(() => ({}));
              showToast(err?.error || 'Could not publish local event.', 'error');
            }
          } catch {
            showToast('Unable to publish local event.', 'error');
          }
          return;
        }

        if (e.target.id === 'create-reel-form') {
        e.preventDefault();
        const fileEl = document.getElementById('reel-video-file');
        const urlEl = document.getElementById('reel-video-url');
        const cap = document.getElementById('reel-caption-input')?.value?.trim() || '';
        const audio = document.getElementById('reel-audio-input')?.value?.trim() || '';
        const typedUrl = urlEl instanceof HTMLInputElement ? urlEl.value.trim() : '';
        const ytId = parseYouTubeVideoId(typedUrl);

        let videoUrl = typedUrl;
        let sourceType = ytId ? 'youtube' : 'video';
        let posterUrl = ytId ? getYouTubeThumbUrl(ytId) : '';

        if (!videoUrl && reelStudio.videoDataUrl) {
          videoUrl = reelStudio.videoDataUrl;
        } else if (!videoUrl && fileEl instanceof HTMLInputElement && fileEl.files?.[0]) {
          try {
            const tok = currentUser ? await currentUser.getIdToken().catch(() => '') : '';
            try {
              const uploaded = await uploadMediaFileToServer(fileEl.files[0], { kind: 'reel', token: tok });
              if (uploaded.storedOnServer && uploaded.url) videoUrl = uploaded.url;
            } catch {}
            if (!videoUrl) {
              videoUrl = await readMediaFileBounded(fileEl.files[0], 450000);
            }
            reelStudio.videoDataUrl = videoUrl;
          } catch (err) {
            showToast(formatFriendlyError(err, 'Video file must be under 10 MB — or paste a YouTube/MP4 URL.'));
            return;
          }
        }

        if (!videoUrl) {
          showToast('Upload a video clip or paste a YouTube / MP4 URL.');
          return;
        }

        const safeOverlays = sanitizeReelTextOverlays(reelStudio.textOverlays);
        const trackMeta = getSoundtrackMeta(reelStudio.audioTrackId);
        const finalAudioTitle = audio || (trackMeta.id === 'original' ? `Original Audio — ${profile.displayName}` : `${trackMeta.title} — ${trackMeta.artist}`);

        const reelRevTs = String(Math.max(0, 9999999999999 - Date.now())).padStart(13, '0');
        const rid = `reel-0-${reelRevTs}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          await setDoc(doc(db, 'reels', rid), {
            id: rid,
            authorId: currentUser.uid,
            authorName: profile.displayName.slice(0, 120),
            authorUsername: profile.username.slice(0, 50),
            authorAvatar: String(profile.avatar || '').slice(0, 180000),
            authorInitials: profile.initials.slice(0, 16),
            caption: cap.slice(0, 1000),
            hashtags: extractHashtags(cap, 15),
            videoUrl: videoUrl.slice(0, 650000),
            sourceType,
            youtubeId: ytId,
            posterUrl: posterUrl.slice(0, 200000),
            audioTitle: finalAudioTitle.slice(0, 100),
            audioTrackId: String(reelStudio.audioTrackId || 'original').slice(0, 64),
            audioDataUrl: String(reelStudio.audioDataUrl || '').slice(0, 200000),
            musicVolume: Math.min(1, Math.max(0, Number(reelStudio.musicVolume))),
            videoVolume: Math.min(1, Math.max(0, Number(reelStudio.videoVolume))),
            filterName: String(reelStudio.filterName || 'none').slice(0, 32),
            playbackSpeed: Math.min(4, Math.max(0.25, Number(reelStudio.playbackSpeed || 1))),
            textOverlays: safeOverlays,
            likesUids: [],
            likesCount: 0,
            commentsCount: 0,
            viewsCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          resetReelStudio();
          closeAllModals();
          activeReelIndex = 0;
          lastFeedReelKey = '';
          showToast('Reel published to NEXORA!', 'success');
          navigateTo('reels');
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `reels/${rid}`, 'Could not publish Reel right now. Try a smaller clip or YouTube link.');
        }
        return;
      }

      if (e.target.id === 'create-meeting-form') {
        e.preventDefault();
        const title = document.getElementById('meeting-title-input')?.value?.trim() || '';
        const when = document.getElementById('meeting-when-input')?.value?.trim() || '';
        const desc = document.getElementById('meeting-desc-input')?.value?.trim() || '';
        if (title.length < 2) return;
        const mId = `mtg-${Date.now()}`;
        await setDoc(doc(db, 'meetings', mId), {
          id: mId,
          code: generateMeetingCode(),
          title: title.slice(0, 120),
          description: desc.slice(0, 300),
          hostId: currentUser.uid,
          hostName: profile.displayName.slice(0, 120),
          scheduledFor: when.slice(0, 64),
          scheduledAtMs: Date.now(),
          status: 'scheduled',
          callId: getRoomCallId('stage', mId),
          participantIds: [currentUser.uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        e.target.reset();
        closeAllModals();
        showToast(`Scheduled "${title}"`, 'success');
        return;
      }

      if (e.target.id === 'nx-join-code-form') {
        e.preventDefault();
        const code = document.getElementById('nx-meeting-code-input')?.value?.trim().toUpperCase();
        const found = meetings.find((m) => String(m.code || '').toUpperCase() === code && m.status !== 'ended');
        if (!found) {
          showToast('Meeting code not found or meeting already ended.');
          return;
        }
        await startOrJoinMeeting(found, true);
        return;
      }

      if (e.target.id === 'nx-meeting-chat-form' && activeMeetingId) {
        e.preventDefault();
        const input = document.getElementById('nx-meeting-chat-input');
        const txt = input instanceof HTMLInputElement ? input.value.trim() : '';
        if (!txt) return;
        const msgId = `mchat-${Date.now()}`;
        await setDoc(doc(db, 'meetings', activeMeetingId, 'chat', msgId), {
          id: msgId,
          meetingId: activeMeetingId,
          senderId: currentUser.uid,
          senderName: profile.displayName.slice(0, 120),
          content: txt.slice(0, 1000),
          createdAt: serverTimestamp(),
        });
        if (input instanceof HTMLInputElement) input.value = '';
        return;
      }

      if (e.target.id === 'nx-profile-inline-form' || e.target.id === 'nx-settings-account-form') {
        e.preventDefault();
        const isInline = e.target.id === 'nx-profile-inline-form';
        const displayName = document.getElementById(isInline ? 'nx-prof-name' : 'nx-set-name')?.value?.trim() || profile.displayName;
        const username = document.getElementById(isInline ? 'nx-prof-handle' : 'nx-set-handle')?.value?.trim() || profile.username;
        const customStatus = document.getElementById(isInline ? 'nx-prof-status' : 'nx-set-status')?.value?.trim() || '';
        const accountPrivacy = document.getElementById(isInline ? 'nx-prof-privacy' : 'nx-set-privacy')?.value || 'everyone';
        const locationLabel = document.getElementById(isInline ? 'nx-prof-location' : 'nx-set-location')?.value?.trim() || '';
        const website = document.getElementById(isInline ? 'nx-prof-website' : 'nx-set-website')?.value?.trim() || '';
        const interestsRaw = document.getElementById(isInline ? 'nx-prof-interests' : 'nx-set-interests')?.value || '';
        const interests = interestsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20);
        const bio = document.getElementById(isInline ? 'nx-prof-bio' : 'nx-set-bio')?.value?.trim() || '';
        const updated = await updateUserProfile(currentUser.uid, {
          ...profile,
          displayName,
          username,
          customStatus,
          accountPrivacy,
          locationLabel,
          website,
          interests,
          bio,
        });
        if (updated) {
          Object.assign(profile, { ...updated, customStatus, bio, locationLabel, website, interests });
          profileEditing = false;
          showToast('Profile saved', 'success');
          render();
        }
        return;
      }

      if (e.target.id === 'nx-sec-email-form') {
        e.preventDefault();
        const val = document.getElementById('nx-sec-email-input')?.value?.trim();
        if (val) {
          try {
            await changeAccountEmail(val);
            showToast(`Verification link sent to ${val}`, 'success');
          } catch (err) {
            showToast(formatFriendlyError(err, 'Please sign out and back in before updating email.'), 'error');
          }
        }
        return;
      }

      if (e.target.id === 'nx-sec-pw-form') {
        e.preventDefault();
        const val = document.getElementById('nx-sec-pw-input')?.value || '';
        if (val.length >= 6) {
          try {
            await changeAccountPassword(val);
            showToast('Password updated', 'success');
            e.target.reset();
          } catch (err) {
            showToast(formatFriendlyError(err, 'Please sign out and back in before changing password.'), 'error');
          }
        }
        return;
      }

      if (e.target.id === 'nx-go-live-form') {
        e.preventDefault();
        const title = document.getElementById('nx-live-title')?.value?.trim() || '';
        const category = document.getElementById('nx-live-category')?.value || 'Talk';
        const sourceMode = document.getElementById('nx-live-source')?.value || 'camera';
        if (title.length < 2) return;
        const streamId = `live-${Date.now()}`;
        const callId = getRoomCallId('stage', streamId);
        await setDoc(doc(db, 'live_streams', streamId), {
          id: streamId,
          hostId: currentUser.uid,
          hostName: profile.displayName.slice(0, 120),
          hostAvatar: String(profile.avatar || '').slice(0, 200000),
          hostInitials: profile.initials.slice(0, 16),
          title: title.slice(0, 120),
          category: category.slice(0, 40),
          status: 'live',
          sourceMode,
          viewerUids: [currentUser.uid],
          viewerCount: 1,
          reactionCount: 0,
          callId,
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        activeLiveStreamId = streamId;
        subscribeLiveChat(streamId);
        await rtc.joinCall({
          callId,
          kind: 'stage',
          targetId: streamId,
          title,
          currentUserProfile: profile,
          withVideo: sourceMode === 'camera',
          withScreen: sourceMode === 'screen',
        });
        showToast('You are LIVE on NEXORA!', 'success');
        render();
        return;
      }

      if (e.target.id === 'nx-live-chat-form') {
        e.preventDefault();
        const sid = e.target.getAttribute('data-stream-id');
        const input = document.getElementById('nx-live-chat-input');
        const txt = input instanceof HTMLInputElement ? input.value.trim() : '';
        if (!sid || !txt) return;
        const msgId = `lchat-${Date.now()}`;
        await setDoc(doc(db, 'live_streams', sid, 'chat', msgId), {
          id: msgId,
          streamId: sid,
          senderId: currentUser.uid,
          senderName: profile.displayName.slice(0, 120),
          content: txt.slice(0, 500),
          createdAt: serverTimestamp(),
        });
        if (input instanceof HTMLInputElement) input.value = '';
      }
    });

    // Reel Studio interactive controls & canvas overlay dragging
    const reelModal = document.getElementById('create-reel-modal');
    if (reelModal) {
      reelModal.addEventListener('click', async (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        if (target === reelModal || target.closest('[data-close-modal="create-reel-modal"]')) {
          studioAudioEngine.stop();
          return;
        }

        const tabBtn = target.closest('[data-reel-tab]');
        if (tabBtn) {
          setReelStudioTab(tabBtn.getAttribute('data-reel-tab') || 'source');
          return;
        }

        const songBtn = target.closest('[data-studio-pick-song]');
        if (songBtn) {
          const trackId = songBtn.getAttribute('data-studio-pick-song') || 'original';
          reelStudio.audioTrackId = trackId;
          const meta = getSoundtrackMeta(trackId);
          const audioInput = document.getElementById('reel-audio-input');
          if (audioInput instanceof HTMLInputElement) {
            audioInput.value = trackId === 'original' ? '' : `${meta.title} — ${meta.artist}`;
          }
          reelStudio.audioTitle = trackId === 'original' ? '' : `${meta.title} — ${meta.artist}`;
          renderReelStudioControls();
          syncReelStudioPreview();
          playStudioSongPreview();
          return;
        }

        if (target.closest('#studio-stop-song-btn')) {
          studioAudioEngine.stop();
          return;
        }

        if (target.closest('#reel-add-text-btn')) {
          if (reelStudio.textOverlays.length >= 12) {
            showToast('Maximum 12 text edits per Reel.');
            return;
          }
          const id = `txt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
          const offsetY = Math.min(82, 28 + reelStudio.textOverlays.length * 10);
          const newOv = {
            id,
            text: 'Tap to edit text',
            x: 50,
            y: offsetY,
            color: '#FFFFFF',
            style: 'modern',
            bgMode: 'pill',
            fontSize: 24,
          };
          reelStudio.textOverlays = [...reelStudio.textOverlays, newOv];
          reelStudio.selectedTextId = id;
          renderReelStudioControls();
          syncReelStudioPreview();
          const valInput = document.getElementById('studio-text-value-input');
          if (valInput instanceof HTMLInputElement) {
            valInput.focus();
            valInput.select();
          }
          return;
        }

        const chipBtn = target.closest('[data-select-overlay]');
        if (chipBtn) {
          reelStudio.selectedTextId = chipBtn.getAttribute('data-select-overlay') || '';
          renderReelStudioControls();
          syncReelStudioPreview();
          return;
        }

        const colorBtn = target.closest('[data-studio-text-color]');
        if (colorBtn) {
          const hex = colorBtn.getAttribute('data-studio-text-color') || '#FFFFFF';
          const ov = reelStudio.textOverlays.find((o) => o.id === reelStudio.selectedTextId);
          if (ov) {
            ov.color = hex;
            renderReelStudioControls();
            syncReelStudioPreview();
          }
          return;
        }

        if (target.closest('#studio-text-delete-btn')) {
          reelStudio.textOverlays = reelStudio.textOverlays.filter((o) => o.id !== reelStudio.selectedTextId);
          reelStudio.selectedTextId = reelStudio.textOverlays[0]?.id || '';
          renderReelStudioControls();
          syncReelStudioPreview();
          return;
        }

        const filterBtn = target.closest('[data-studio-filter]');
        if (filterBtn) {
          reelStudio.filterName = filterBtn.getAttribute('data-studio-filter') || 'none';
          renderReelStudioControls();
          syncReelStudioPreview();
          return;
        }

        const tplBtn = target.closest('[data-studio-template]');
        if (tplBtn) {
          const tpl = getReelTemplateMeta(tplBtn.getAttribute('data-studio-template'));
          if (tpl) {
            reelStudio.templateId = tpl.id;
            reelStudio.filterName = tpl.filterName;
            reelStudio.playbackSpeed = tpl.playbackSpeed;
            reelStudio.audioTrackId = tpl.audioTrackId;
            reelStudio.musicVolume = tpl.musicVolume;
            reelStudio.backdropColors = tpl.backdropColors || ['#101124', '#4C1D95', '#286BFF'];
            reelStudio.textOverlays = tpl.overlays.map((o) => ({ ...o }));
            reelStudio.selectedTextId = reelStudio.textOverlays[0]?.id || '';
            const meta = getSoundtrackMeta(tpl.audioTrackId);
            const audioInput = document.getElementById('reel-audio-input');
            if (audioInput instanceof HTMLInputElement) {
              audioInput.value = `${meta.title} — ${meta.artist}`;
            }
            reelStudio.audioTitle = `${meta.title} — ${meta.artist}`;
            const capInput = document.getElementById('reel-caption-input');
            if (capInput instanceof HTMLTextAreaElement && !capInput.value.trim()) {
              capInput.value = tpl.captionSeed;
            }
            renderReelStudioControls();
            syncReelStudioPreview();
            playStudioSongPreview();
            showToast(`Applied "${tpl.name}" template!`, 'success');
          }
          return;
        }

        if (target.closest('#studio-clear-template-btn')) {
          reelStudio.templateId = '';
          reelStudio.filterName = 'none';
          reelStudio.playbackSpeed = 1;
          reelStudio.backdropColors = ['#101124', '#4C1D95', '#286BFF'];
          reelStudio.textOverlays = [];
          reelStudio.selectedTextId = '';
          renderReelStudioControls();
          syncReelStudioPreview();
          return;
        }

        if (target.closest('#studio-render-template-btn')) {
          const btn = document.getElementById('studio-render-template-btn');
          const hintEl = document.getElementById('studio-template-clip-hint');
          if (btn instanceof HTMLButtonElement) btn.disabled = true;
          if (hintEl) hintEl.textContent = 'Generating 9:16 template video clip...';
          try {
            const cap = document.getElementById('reel-caption-input')?.value?.trim() || getStudioDisplaySongTitle();
            const { blob } = await exportEditedReelForYouTube({
              videoEl: null,
              youtubeTitle: cap,
              filterId: reelStudio.filterName,
              textOverlays: reelStudio.textOverlays,
              audioTrackId: reelStudio.audioTrackId,
              audioDataUrl: reelStudio.audioDataUrl,
              musicVolume: reelStudio.musicVolume,
              backdropColors: reelStudio.backdropColors,
              durationSec: 3,
              onProgress: (pct) => {
                if (hintEl) hintEl.textContent = `Generating template video (${pct}%)...`;
              },
            });
            const dataUrl = await blobToBoundedDataUrl(blob, 600000);
            if (reelStudio.blobObjectUrl) {
              try { URL.revokeObjectURL(reelStudio.blobObjectUrl); } catch {}
            }
            reelStudio.blobObjectUrl = URL.createObjectURL(blob);
            reelStudio.videoDataUrl = dataUrl;
            reelStudio.sourceType = 'video';
            reelStudio.youtubeId = '';
            if (hintEl) hintEl.textContent = `Template video clip ready (${Math.round(blob.size / 1024)} KB) — click Publish Reel!`;
            syncReelStudioPreview();
            showToast('Template video clip generated & ready to publish!', 'success');
          } catch (err) {
            const msg = formatFriendlyError(err, 'Could not synthesize template clip in this browser.');
            if (hintEl) hintEl.textContent = msg;
            showToast(msg);
          } finally {
            if (btn instanceof HTMLButtonElement) btn.disabled = false;
          }
          return;
        }

        const lensBtn = target.closest('[data-studio-lens]');
        if (lensBtn) {
          const lens = SNAP_LENS_STICKERS.find((l) => l.id === lensBtn.getAttribute('data-studio-lens'));
          if (lens) {
            const exists = reelStudio.textOverlays.some((o) => o.id === lens.id);
            if (exists) {
              reelStudio.textOverlays = reelStudio.textOverlays.filter((o) => o.id !== lens.id);
            } else if (reelStudio.textOverlays.length < 12) {
              reelStudio.textOverlays = [...reelStudio.textOverlays, { ...lens }];
              reelStudio.selectedTextId = lens.id;
            } else {
              showToast('Maximum 12 overlays per Reel.');
            }
            renderReelStudioControls();
            syncReelStudioPreview();
          }
          return;
        }

        const speedBtn = target.closest('[data-studio-speed]');
        if (speedBtn) {
          reelStudio.playbackSpeed = Number(speedBtn.getAttribute('data-studio-speed') || 1);
          renderReelStudioControls();
          syncReelStudioPreview();
          return;
        }

        if (target.closest('#studio-play-toggle')) {
          const vidEl = document.getElementById('reel-studio-video');
          if (vidEl instanceof HTMLVideoElement && !vidEl.hidden) {
            if (vidEl.paused) {
              vidEl.play().catch(() => {});
              playStudioSongPreview();
            } else {
              vidEl.pause();
              studioAudioEngine.stop();
            }
          } else {
            if (studioAudioEngine.stepTimer || studioAudioEngine.customAudio) {
              studioAudioEngine.stop();
            } else {
              playStudioSongPreview();
            }
          }
          return;
        }

        if (target.closest('#studio-mute-toggle')) {
          reelStudio.previewMuted = !reelStudio.previewMuted;
          syncReelStudioPreview();
          return;
        }

        if (target.closest('#reel-export-yt-btn') || target.closest('#reel-quick-export-btn')) {
          setReelStudioTab('youtube');
          const cap = document.getElementById('reel-caption-input')?.value?.trim() || getStudioDisplaySongTitle();
          await runReelExportForYouTube({
            videoEl: document.getElementById('reel-studio-video'),
            youtubeTitle: cap,
            filterId: reelStudio.filterName,
            textOverlays: reelStudio.textOverlays,
            audioTrackId: reelStudio.audioTrackId,
            audioDataUrl: reelStudio.audioDataUrl,
            musicVolume: reelStudio.musicVolume,
            statusEl: document.getElementById('reel-export-status'),
            triggerBtn: document.getElementById('reel-export-yt-btn'),
          });
        }
      });

      reelModal.addEventListener('input', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;

        if (t.id === 'reel-video-url' && t instanceof HTMLInputElement) {
          const urlVal = t.value.trim();
          const ytId = parseYouTubeVideoId(urlVal);
          reelStudio.videoUrl = urlVal;
          reelStudio.youtubeId = ytId;
          reelStudio.sourceType = ytId ? 'youtube' : 'video';
          renderReelStudioControls();
          syncReelStudioPreview();
          return;
        }

        if (t.id === 'reel-audio-input' && t instanceof HTMLInputElement) {
          reelStudio.audioTitle = t.value.trim();
          const songPill = document.getElementById('reel-studio-song-pill');
          if (songPill) songPill.textContent = `♪ ${getStudioDisplaySongTitle()}`;
          return;
        }

        if (t.id === 'studio-music-volume' && t instanceof HTMLInputElement) {
          reelStudio.musicVolume = Math.min(1, Math.max(0, Number(t.value) / 100));
          const lbl = document.getElementById('studio-music-vol-label');
          if (lbl) lbl.textContent = `${t.value}%`;
          studioAudioEngine.setVolume(reelStudio.musicVolume, reelStudio.previewMuted);
          return;
        }

        if (t.id === 'studio-video-volume' && t instanceof HTMLInputElement) {
          reelStudio.videoVolume = Math.min(1, Math.max(0, Number(t.value) / 100));
          const lbl = document.getElementById('studio-video-vol-label');
          if (lbl) lbl.textContent = `${t.value}%`;
          syncReelStudioPreview();
          return;
        }

        if (t.id === 'studio-text-value-input' && t instanceof HTMLInputElement) {
          const ov = reelStudio.textOverlays.find((o) => o.id === reelStudio.selectedTextId);
          if (ov) {
            ov.text = t.value.slice(0, 120) || ' ';
            renderReelStudioControls();
            syncReelStudioPreview();
          }
          return;
        }

        if (t.id === 'studio-text-size-range' && t instanceof HTMLInputElement) {
          const ov = reelStudio.textOverlays.find((o) => o.id === reelStudio.selectedTextId);
          if (ov) {
            ov.fontSize = Math.min(48, Math.max(14, Number(t.value) || 24));
            const lbl = document.getElementById('studio-text-size-label');
            if (lbl) lbl.textContent = `${ov.fontSize}px`;
            syncReelStudioPreview();
          }
        }
      });

      reelModal.addEventListener('change', async (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;

        if (t.id === 'reel-video-file' && t instanceof HTMLInputElement) {
          const file = t.files?.[0];
          if (!file) return;
          if (reelStudio.blobObjectUrl) {
            try { URL.revokeObjectURL(reelStudio.blobObjectUrl); } catch {}
          }
          reelStudio.blobObjectUrl = URL.createObjectURL(file);
          reelStudio.sourceType = 'video';
          reelStudio.youtubeId = '';
          reelStudio.videoDataUrl = '';
          try {
            const tok = currentUser ? await currentUser.getIdToken().catch(() => '') : '';
            const uploaded = await uploadMediaFileToServer(file, { kind: 'reel', token: tok });
            if (uploaded.storedOnServer && uploaded.url) {
              reelStudio.videoDataUrl = uploaded.url;
            } else {
              reelStudio.videoDataUrl = await readMediaFileBounded(file, 450000);
            }
          } catch {
            try {
              reelStudio.videoDataUrl = await readMediaFileBounded(file, 450000);
            } catch {
              reelStudio.videoDataUrl = '';
              showToast('Clip loaded in Studio preview! (Clips over 10 MB can be exported for YouTube, or paste a YouTube/MP4 URL.)');
            }
          }
          renderReelStudioControls();
          syncReelStudioPreview();
          return;
        }

        if (t.id === 'reel-song-file' && t instanceof HTMLInputElement) {
          const file = t.files?.[0];
          if (!file) return;
          try {
            const dataUrl = await readMediaFileBounded(file, 185000);
            const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 80);
            reelStudio.audioDataUrl = dataUrl;
            reelStudio.audioTrackId = 'custom';
            reelStudio.audioTitle = cleanName || 'Custom Uploaded Song';
            const audioInput = document.getElementById('reel-audio-input');
            if (audioInput instanceof HTMLInputElement) audioInput.value = reelStudio.audioTitle;
            renderReelStudioControls();
            syncReelStudioPreview();
            playStudioSongPreview();
            showToast(`Added song: ${reelStudio.audioTitle}`, 'success');
          } catch (err) {
            showToast(formatFriendlyError(err, 'Audio clip too large — select a song clip under 180 KB.'));
            t.value = '';
          }
          return;
        }

        if (t.id === 'studio-text-style-select' && t instanceof HTMLSelectElement) {
          const ov = reelStudio.textOverlays.find((o) => o.id === reelStudio.selectedTextId);
          if (ov) {
            ov.style = t.value;
            syncReelStudioPreview();
          }
          return;
        }

        if (t.id === 'studio-text-bg-select' && t instanceof HTMLSelectElement) {
          const ov = reelStudio.textOverlays.find((o) => o.id === reelStudio.selectedTextId);
          if (ov) {
            ov.bgMode = t.value;
            syncReelStudioPreview();
          }
        }
      });

      // Pointer drag-and-drop for text overlays on the 9:16 preview stage
      const overlayLayer = document.getElementById('reel-studio-overlay-layer');
      const stageEl = document.getElementById('reel-studio-stage');
      let draggingId = '';
      if (overlayLayer && stageEl) {
        overlayLayer.addEventListener('pointerdown', (ev) => {
          const item = ev.target instanceof Element ? ev.target.closest('.nx-reel-text-item[data-overlay-id]') : null;
          if (!item) return;
          draggingId = item.getAttribute('data-overlay-id') || '';
          reelStudio.selectedTextId = draggingId;
          const ytIframe = document.getElementById('reel-studio-youtube');
          if (ytIframe) ytIframe.style.pointerEvents = 'none';
          try { overlayLayer.setPointerCapture(ev.pointerId); } catch {}
          renderReelStudioControls();
          syncReelStudioPreview();
          ev.preventDefault();
        });

        overlayLayer.addEventListener('pointermove', (ev) => {
          if (!draggingId) return;
          const rect = stageEl.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const x = Math.min(92, Math.max(8, Math.round(((ev.clientX - rect.left) / rect.width) * 100)));
          const y = Math.min(90, Math.max(10, Math.round(((ev.clientY - rect.top) / rect.height) * 100)));
          const ov = reelStudio.textOverlays.find((o) => o.id === draggingId);
          if (ov) {
            ov.x = x;
            ov.y = y;
            const liveEl = overlayLayer.querySelector(`.nx-reel-text-item[data-overlay-id="${CSS.escape(draggingId)}"]`);
            if (liveEl instanceof HTMLElement) {
              liveEl.style.left = `${x}%`;
              liveEl.style.top = `${y}%`;
            }
          }
        });

        const endDrag = () => {
          if (!draggingId) return;
          draggingId = '';
          const ytIframe = document.getElementById('reel-studio-youtube');
          if (ytIframe) ytIframe.style.pointerEvents = '';
        };
        overlayLayer.addEventListener('pointerup', endDrag);
        overlayLayer.addEventListener('pointercancel', endDrag);
      }
    }

    // Photo Templates & Instagram/Snapchat Filter Studio Modal
    const photoModal = document.getElementById('photo-studio-modal');
    if (photoModal) {
      photoModal.addEventListener('click', async (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const tplBtn = target.closest('[data-photo-tpl]');
        if (tplBtn) {
          photoStudio.templateId = tplBtn.getAttribute('data-photo-tpl') || 'polaroid-frame';
          renderPhotoStudioControls();
          refreshPhotoStudioPreview();
          return;
        }

        const fltBtn = target.closest('[data-photo-filter]');
        if (fltBtn) {
          photoStudio.filterId = fltBtn.getAttribute('data-photo-filter') || 'none';
          renderPhotoStudioControls();
          refreshPhotoStudioPreview();
          return;
        }

        if (target.closest('#photo-studio-apply-btn')) {
          if (composerMedia.length >= 4) {
            showToast('Maximum 4 media items per post.');
            return;
          }
          await refreshPhotoStudioPreview();
          if (photoStudio.renderedDataUrl) {
            composerMedia.push({ type: 'image', url: photoStudio.renderedDataUrl });
            closeAllModals();
            render();
            showToast('Styled photo template attached to post!', 'success');
          }
          return;
        }

        if (target.closest('#photo-studio-to-story-btn')) {
          await refreshPhotoStudioPreview();
          if (photoStudio.renderedDataUrl) {
            pendingStoryStudioDataUrl = photoStudio.renderedDataUrl;
            closeAllModals();
            openModal('post-story-modal');
            const capEl = document.getElementById('story-content-input');
            if (capEl instanceof HTMLTextAreaElement && !capEl.value.trim()) {
              capEl.value = photoStudio.headline || 'Shared via NEXORA Photo Studio ✨';
            }
            showToast('Templated photo loaded into 24h Story!', 'success');
          }
        }
      });

      photoModal.addEventListener('input', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement)) return;
        if (t.id === 'photo-studio-headline') {
          photoStudio.headline = t.value;
          refreshPhotoStudioPreview();
        } else if (t.id === 'photo-studio-subline') {
          photoStudio.subline = t.value;
          refreshPhotoStudioPreview();
        }
      });

      photoModal.addEventListener('change', async (e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement && t.id === 'photo-studio-sticker') {
          photoStudio.stickerText = t.value;
          refreshPhotoStudioPreview();
          return;
        }
        if (t instanceof HTMLInputElement && t.id === 'photo-studio-file-input') {
          const file = t.files?.[0];
          if (!file) return;
          try {
            photoStudio.imageDataUrl = await compressImageFile(file, { maxBytes: 420000 });
            refreshPhotoStudioPreview();
          } catch (err) {
            showToast(formatFriendlyError(err, 'Could not load selected photo.'));
          }
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        studioAudioEngine.stop();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        const h = window.location.hash || '';
        if (h.startsWith('#template')) {
          templateStudio.handleDeepLink(h);
          navigateTo('templates');
          return;
        }
        const hashSectionMap = {
          '#features': 'features',
          '#admin-feature-health': 'admin-feature-health',
          '#marketplace': 'marketplace',
          '#exchange': 'marketplace',
          '#visual-search': 'visual-search',
          '#studio': 'studio',
          '#camera': 'camera',
          '#nearby': 'nearby',
        };
        if (hashSectionMap[h]) {
          navigateTo(hashSectionMap[h]);
        }
      });
    }
  }

  bindEvents();

  return {
    subscribeAll,
    cleanup,
    render,
    navigateTo,
    handleTemplateDeepLink: (hash) => templateStudio.handleDeepLink(hash),
    getSection: () => currentSection,
    getAdminStatus: () => isCurrentUserAdmin,
  };
}
