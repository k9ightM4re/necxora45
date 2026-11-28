# NEXORA — Database Design (Firestore Schema & Indexes)

**Engine:** Firebase Cloud Firestore (`ai-studio-remixnexoracommu-8c1b32d7-e98f-4a2a-abc8-811570610cac`)  
**Source of Truth:** `/firebase-blueprint.json` + `/firestore.rules`

---

## 1. Core Identity & Social Graph Collections

| Collection Path | Purpose | Key Fields & Constraints |
|---|---|---|
| `/users/{userId}` | Public profile (no PII) | `id`, `username` (unique/searchable lowercase), `displayName`, `initials`, `avatar`, `coverPhoto`, `bio`, `website`, `locationLabel`, `interests[]`, `accountPrivacy` (`everyone` \| `requests_only` \| `private`), `followersCount`, `followingCount`, `postsCount`, `suspended`, `verified`, `createdAt`, `updatedAt` |
| `/users/{userId}/private/{docId}` | Isolated PII (owner-only) | `email`, `phoneNumber`, `authProvider`, `deactivated`, `updatedAt` |
| `/users/{userId}/followers/{followerUid}` | Followers edge | `uid`, `displayName`, `username`, `avatar`, `createdAt` |
| `/users/{userId}/following/{targetUid}` | Following edge | `uid`, `displayName`, `username`, `avatar`, `createdAt` |
| `/users/{userId}/follow_requests/{requesterUid}` | Incoming follow requests (private accounts) | `requesterUid`, `targetUid`, `displayName`, `username`, `avatar`, `status` (`pending` \| `accepted` \| `declined`), `createdAt`, `updatedAt` |
| `/users/{userId}/blocks/{blockedUid}` | Blocked users | `blockedUid`, `blockedName`, `createdAt` |
| `/users/{userId}/mutes/{mutedUid}` | Muted users (hidden from feeds) | `mutedUid`, `mutedName`, `createdAt` |
| `/users/{userId}/bookmarks/{bookmarkId}` | Saved posts, reels, messages, products | `id`, `sourceType` (`channel` \| `dm` \| `post` \| `reel` \| `product`), `sourceId`, `messageId`, `authorName`, `content`, `mediaUrl`, `createdAt` |
| `/users/{userId}/search_history/{entryId}` | Recent user searches (owner-only) | `id`, `query`, `category`, `createdAt` |
| `/users/{userId}/notifications/{notifId}` | User notifications | `id`, `senderId`, `category`, `targetId`, `title`, `body`, `dedupKey`, `unread`, `createdAt` |

## 2. Posts, Stories, Reels & Engagement

| Collection Path | Purpose | Key Fields & Constraints |
|---|---|---|
| `/posts/{postId}` | Text, image, carousel, video, shared, product-linked posts | `id`, `authorId`, `content`, `mediaType` (`none` \| `image` \| `video` \| `carousel`), `mediaItems[]` (max 4), `visibility` (`public` \| `followers` \| `private`), `isDraft`, `repostOfId`, `productIds[]`, `hashtags[]`, `mentions[]`, `likesCount`, `commentsCount`, `sharesCount`, `edited`, `createdAt`, `updatedAt` |
| `/posts/{postId}/likes/{userId}` | Per-user post likes | `userId`, `displayName`, `username`, `createdAt` |
| `/posts/{postId}/comments/{commentId}` | Comments & bounded nested replies | `id`, `parentId`, `replyToId`, `depth` (`0`..`2`), `authorId`, `content`, `reactions`, `likesUids[]`, `edited`, `createdAt`, `updatedAt` |
| `/stories/{storyId}` | 24-hour expiring stories | `id`, `userId`, `mediaType`, `mediaUrl`, `content`, `reactions`, `viewsCount`, `expiresAtMs`, `createdAt` |
| `/stories/{storyId}/viewers/{viewerUid}` | Story viewer receipts | `viewerUid`, `displayName`, `viewedAt` |

## 3. Messaging & Communities

| Collection Path | Purpose | Key Fields & Constraints |
|---|---|---|
| `/dm_threads/{threadId}` | 1-on-1 & group threads | `id`, `type` (`dm` \| `group`), `groupName`, `participants[]`, `memberRoles` (map uid -> `admin` \| `member`), `archivedBy[]`, `mutedBy[]`, `deletedFor` (map uid -> timestampMs), `lastMessage`, `lastSenderId`, `seenBy[]`, `updatedAt` |
| `/dm_threads/{threadId}/messages/{messageId}` | Persistent messages | `id`, `threadId`, `clientMutationId` (idempotency), `senderId`, `content`, `attachment`, `replyToId`, `reactions[]`, `deliveredTo[]`, `seenBy[]`, `edited`, `pinned`, `deleted`, `createdAt`, `updatedAt` |
| `/servers/{serverId}` | Communities | `id`, `name`, `category`, `description`, `rules`, `visibility` (`public` \| `private`), `ownerId`, `createdAt`, `updatedAt` |
| `/servers/{serverId}/members/{memberId}` | Community roles | `userId`, `displayName`, `role` (`owner` \| `administrator` \| `moderator` \| `member`), `joinedAt` |
| `/servers/{serverId}/channels/{channelId}` | Community channels | `id`, `serverId`, `name`, `type` (`text` \| `general` \| `announcement` \| `questions` \| `events` \| `media` \| `voice` \| `stage`), `topic`, `createdAt` |
| `/servers/{serverId}/moderation_logs/{logId}` | Audit trail | `id`, `actorId`, `actorName`, `action`, `createdAt` |

## 4. Social Commerce, Studio & Moderation

| Collection Path | Purpose | Key Fields & Constraints |
|---|---|---|
| `/merchants/{merchantId}` | Verified merchant profiles | `id`, `ownerId`, `name`, `domain`, `verified`, `feedConfigured`, `createdAt`, `updatedAt` |
| `/products/{productId}` | Merchant-linked catalog products | `id`, `merchantId`, `merchantName`, `title`, `description`, `category`, `priceCents`, `currency`, `externalUrl`, `imageUrl`, `tags[]`, `priceLastCheckedAtMs`, `inStock`, `createdAt`, `updatedAt` |
| `/users/{userId}/product_collections/{collectionId}` | User saved product boards & outfits | `id`, `title`, `description`, `productIds[]`, `createdAt`, `updatedAt` |
| `/users/{userId}/studio_photos/{photoId}` | Consented personal Studio photos | `id`, `userId`, `mediaUrl`, `consentAccepted`, `consentAt`, `createdAt` |
| `/users/{userId}/studio_outfits/{outfitId}` | Outfit builder & try-on job history | `id`, `userId`, `name`, `photoId`, `productIds[]`, `jobStatus` (`draft` \| `unconfigured` \| `queued` \| `completed` \| `failed`), `providerMessage`, `createdAt`, `updatedAt` |
| `/reports/{reportId}` | Moderation queue cases | `id`, `reporterId`, `targetType`, `targetId`, `reason`, `status` (`open` \| `under_review` \| `resolved` \| `dismissed`), `reviewedBy`, `actionTaken`, `createdAt`, `updatedAt` |

## 5. Indexing & Pagination Strategy

- All list endpoints accept `cursor` (encoded `updatedAtMs`/`createdAtMs` + `docId`) and `limit` (`1..50`).
- Firestore rules strictly block unbounded collection scraping on private user subcollections and enforce owner/participant gates on `allow get` and `allow list`.
