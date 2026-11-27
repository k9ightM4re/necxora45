import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { formatRelativeTime } from './social_utils.js';
import { formatFriendlyError } from './notifications.js';

function computeInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'NX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const CALL_RATING_TAGS = [
  'Clear Audio',
  'Smooth Video',
  'Fast Connect',
  'No Lag',
  'Background Noise',
  'Video Freeze',
  'Audio Echo',
  'Call Dropped',
];

export const CALL_RATING_LABELS = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};

export function formatCallDuration(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hrs > 0) return `${pad(hrs)}:${pad(mins)}:${pad(rem)}`;
  return `${pad(mins)}:${pad(rem)}`;
}

export function buildCallChatMessagePayload({
  callId,
  sessionId = '',
  senderId,
  senderName,
  senderInitials = '',
  content,
  id = '',
}) {
  const cleanCallId = String(callId || '').trim().slice(0, 128);
  const cleanSenderId = String(senderId || '').trim().slice(0, 128);
  const cleanContent = String(content || '').trim().slice(0, 2000);
  if (!cleanCallId || !cleanSenderId || !cleanContent) {
    return null;
  }
  const cleanName = String(senderName || 'Member').trim().slice(0, 80) || 'Member';
  const cleanInit = String(senderInitials || computeInitials(cleanName)).trim().slice(0, 16) || 'NX';
  const msgId =
    String(id || '').trim().slice(0, 128) ||
    `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const payload = {
    id: msgId,
    callId: cleanCallId,
    senderId: cleanSenderId,
    senderName: cleanName,
    senderInitials: cleanInit,
    content: cleanContent,
  };
  const cleanSession = String(sessionId || '').trim().slice(0, 64);
  if (cleanSession) {
    payload.sessionId = cleanSession;
  }
  return payload;
}

export function sanitizeCallRatingPayload({
  id = '',
  callId,
  sessionId = '',
  callKind = 'dm',
  mode = 'audio',
  peerUserId = '',
  peerName = '',
  reviewerId,
  reviewerName,
  rating,
  tags = [],
  comment = '',
  durationSec = 0,
}) {
  const cleanCallId = String(callId || '').trim().slice(0, 128);
  const cleanReviewerId = String(reviewerId || '').trim().slice(0, 128);
  const numRating = Math.round(Number(rating) || 0);
  if (!cleanCallId || !cleanReviewerId || numRating < 1 || numRating > 5) {
    return null;
  }

  const allowedKinds = new Set(['dm', 'voice', 'stage', 'meeting']);
  const allowedModes = new Set(['audio', 'video', 'screen']);
  const ratingId =
    String(id || '').trim().slice(0, 128) ||
    `crate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const cleanTags = Array.isArray(tags)
    ? Array.from(new Set(tags.map((t) => String(t || '').trim().slice(0, 40)).filter(Boolean))).slice(0, 8)
    : [];

  const payload = {
    id: ratingId,
    callId: cleanCallId,
    callKind: allowedKinds.has(callKind) ? callKind : 'dm',
    mode: allowedModes.has(mode) ? mode : 'audio',
    reviewerId: cleanReviewerId,
    reviewerName: String(reviewerName || 'Member').trim().slice(0, 120) || 'Member',
    rating: numRating,
    durationSec: Math.max(0, Math.min(86400, Math.round(Number(durationSec) || 0))),
  };

  const cleanSession = String(sessionId || '').trim().slice(0, 64);
  if (cleanSession) payload.sessionId = cleanSession;
  const cleanPeerId = String(peerUserId || '').trim().slice(0, 128);
  if (cleanPeerId) payload.peerUserId = cleanPeerId;
  const cleanPeerName = String(peerName || '').trim().slice(0, 120);
  if (cleanPeerName) payload.peerName = cleanPeerName;
  if (cleanTags.length > 0) payload.tags = cleanTags;
  const cleanComment = String(comment || '').trim().slice(0, 600);
  if (cleanComment) payload.comment = cleanComment;

  return payload;
}

export function createCallTabManager({
  db,
  rtc,
  getProfile,
  getRtcState,
  getMember,
  showToast,
  escapeHtml,
  svgIcon,
  renderDeviceControlsBar,
  summarizeMediaState,
  onToggleMute,
  onToggleCamera,
  onFlipCamera,
  onToggleScreenShare,
  onOpenShareOptions,
  onLeaveCall,
  onVisibilityChange,
}) {
  let minimized = false;
  let mobilePane = 'stage'; // 'stage' | 'chat'
  let subscribedCallId = '';
  let subscribedSessionId = '';
  let unsubChat = null;
  let chatMessages = [];
  let timerHandle = null;

  // Rating state
  let reviewCallKey = '';
  let selectedRating = 0;
  let hoverRating = 0;
  let selectedTags = new Set();
  let reviewComment = '';
  let submittingReview = false;
  let sendingChat = false;

  function stopTimer() {
    if (timerHandle) {
      window.clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function startTimer(startedAtMs) {
    stopTimer();
    const tick = () => {
      const timerEl = document.getElementById('nx-call-tab-timer');
      if (!timerEl) return;
      const elapsed = Math.max(0, Math.round((Date.now() - (startedAtMs || Date.now())) / 1000));
      timerEl.textContent = formatCallDuration(elapsed);
    };
    tick();
    timerHandle = window.setInterval(tick, 1000);
  }

  function stopChatSubscription() {
    if (unsubChat) {
      unsubChat();
      unsubChat = null;
    }
    subscribedCallId = '';
    subscribedSessionId = '';
    chatMessages = [];
  }

  function ensureChatSubscription(callId, sessionId) {
    if (!callId) {
      stopChatSubscription();
      return;
    }
    if (subscribedCallId === callId && subscribedSessionId === (sessionId || '') && unsubChat) {
      return;
    }
    stopChatSubscription();
    subscribedCallId = callId;
    subscribedSessionId = sessionId || '';

    const q = query(collection(db, 'calls', callId, 'messages'), where('callId', '==', callId));
    unsubChat = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (subscribedSessionId && d.sessionId && d.sessionId !== subscribedSessionId) {
            return;
          }
          const createdAtMs =
            typeof d.createdAt?.toMillis === 'function'
              ? d.createdAt.toMillis()
              : Number(d.createdAtMs || Date.now());
          list.push({
            id: docSnap.id,
            ...d,
            createdAtMs,
          });
        });
        list.sort((a, b) => a.createdAtMs - b.createdAtMs);
        chatMessages = list;
        updateChatMessagesDomOnly();
      },
      () => {}
    );
  }

  function isTabShowing() {
    const rtcState = getRtcState();
    const activeCall = rtcState.activeCall;
    const endedCall = rtcState.lastEndedCall;
    if (activeCall && activeCall.kind === 'dm') {
      return !minimized;
    }
    if (!activeCall && endedCall) {
      return true;
    }
    return false;
  }

  function isMinimizedDmCall() {
    const rtcState = getRtcState();
    return Boolean(rtcState.activeCall && rtcState.activeCall.kind === 'dm' && minimized);
  }

  function resetReviewDraft(nextKey = '') {
    reviewCallKey = nextKey;
    selectedRating = 0;
    hoverRating = 0;
    selectedTags = new Set();
    reviewComment = '';
    submittingReview = false;
  }

  function syncWithRtcState(rtcState) {
    const active = rtcState?.activeCall;
    const ended = rtcState?.lastEndedCall;

    if (active && active.kind === 'dm') {
      ensureChatSubscription(active.id, active.sessionId || '');
      startTimer(active.startedAtMs || Date.now());
      resetReviewDraft('');
    } else if (!active && ended) {
      stopTimer();
      stopChatSubscription();
      minimized = false; // Always open Call Tab to show rating when call ends
      const nextKey = `${ended.id}:${ended.endedAtMs || ''}`;
      if (reviewCallKey !== nextKey) {
        resetReviewDraft(nextKey);
      }
    } else {
      stopTimer();
      stopChatSubscription();
      minimized = false;
      resetReviewDraft('');
    }

    render();
    if (typeof onVisibilityChange === 'function') {
      onVisibilityChange(isTabShowing());
    }
  }

  function renderChatMessagesHtml() {
    const profile = getProfile();
    if (chatMessages.length === 0) {
      return `
        <div class="nx-call-chat-empty">
          <div style="font-weight:700;margin-bottom:4px;">New Chat Started for This Call</div>
          <div class="member-sub" style="white-space:normal;line-height:1.45;">
            Send notes, links, or quick replies while you talk. This chat stays in this call tab and is separate from your main chat history.
          </div>
        </div>
      `;
    }
    return chatMessages
      .map((m) => {
        const isMe = m.senderId === profile.id;
        return `
          <div class="nx-call-chat-msg ${isMe ? 'mine' : ''}">
            <div class="nx-call-chat-msg-meta">
              <strong>${escapeHtml(isMe ? 'You' : m.senderName || 'Member')}</strong>
              <span>${escapeHtml(formatRelativeTime(m.createdAtMs))}</span>
            </div>
            <div class="nx-call-chat-bubble">${escapeHtml(m.content || '')}</div>
          </div>
        `;
      })
      .join('');
  }

  function updateChatMessagesDomOnly() {
    const listEl = document.getElementById('nx-call-chat-list');
    if (!listEl) return;
    listEl.innerHTML = renderChatMessagesHtml();
    listEl.scrollTop = listEl.scrollHeight;
  }

  function updateRatingStarsDomOnly() {
    const displayScore = hoverRating || selectedRating;
    document.querySelectorAll('.nx-star-btn[data-star]').forEach((btn) => {
      const val = Number(btn.getAttribute('data-star') || 0);
      btn.classList.toggle('active', val <= displayScore);
      btn.setAttribute('aria-pressed', val <= selectedRating ? 'true' : 'false');
    });
    const labelEl = document.getElementById('nx-rating-score-label');
    if (labelEl) {
      labelEl.textContent = displayScore ? `${displayScore}/5 · ${CALL_RATING_LABELS[displayScore]}` : 'Tap a star to rate (1–5)';
    }
    const submitBtn = document.getElementById('nx-submit-call-rating-btn');
    if (submitBtn instanceof HTMLButtonElement) {
      submitBtn.disabled = submittingReview || selectedRating < 1;
    }
  }

  async function sendCallChatMessage(rawText) {
    if (sendingChat) return;
    const rtcState = getRtcState();
    const activeCall = rtcState.activeCall;
    const profile = getProfile();
    if (!activeCall || !profile?.id) return;

    const payload = buildCallChatMessagePayload({
      callId: activeCall.id,
      sessionId: activeCall.sessionId || '',
      senderId: profile.id,
      senderName: profile.displayName,
      senderInitials: profile.initials,
      content: rawText,
    });
    if (!payload) return;

    sendingChat = true;
    try {
      await setDoc(doc(db, 'calls', activeCall.id, 'messages', payload.id), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      const inputEl = document.getElementById('nx-call-chat-input');
      if (inputEl instanceof HTMLInputElement) {
        inputEl.value = '';
        inputEl.focus();
      }
    } catch (err) {
      showToast(formatFriendlyError(err, 'Could not send call chat message.'));
    } finally {
      sendingChat = false;
    }
  }

  async function submitCallReviewAndClose() {
    const rtcState = getRtcState();
    const ended = rtcState.lastEndedCall;
    const profile = getProfile();
    if (!ended || !profile?.id || submittingReview) return;

    if (selectedRating < 1) {
      showToast('Please select a star rating from 1 to 5 before submitting.');
      return;
    }

    const commentEl = document.getElementById('nx-call-review-comment');
    const latestComment = commentEl instanceof HTMLTextAreaElement ? commentEl.value : reviewComment;

    const payload = sanitizeCallRatingPayload({
      callId: ended.id,
      sessionId: ended.sessionId || '',
      callKind: ended.kind || 'dm',
      mode: ended.mode || 'audio',
      peerUserId: ended.peerUserId || '',
      peerName: ended.title || 'Member',
      reviewerId: profile.id,
      reviewerName: profile.displayName || 'Member',
      rating: selectedRating,
      tags: Array.from(selectedTags),
      comment: latestComment,
      durationSec: ended.durationSec || 0,
    });

    if (!payload) {
      showToast('Please choose a star rating first.');
      return;
    }

    submittingReview = true;
    updateRatingStarsDomOnly();
    try {
      await setDoc(doc(db, 'call_ratings', payload.id), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      showToast('Thanks for rating your call!', 'success');
      closeReviewTab();
    } catch (err) {
      submittingReview = false;
      updateRatingStarsDomOnly();
      showToast(formatFriendlyError(err, 'Could not save your rating right now.'));
    }
  }

  function closeReviewTab() {
    resetReviewDraft('');
    stopTimer();
    stopChatSubscription();
    minimized = false;
    rtc.clearLastEndedCall();
    render();
    if (typeof onVisibilityChange === 'function') {
      onVisibilityChange(false);
    }
  }

  function openCallTab() {
    minimized = false;
    render();
    if (typeof onVisibilityChange === 'function') {
      onVisibilityChange(isTabShowing());
    }
  }

  function minimizeCallTab() {
    const rtcState = getRtcState();
    if (!rtcState.activeCall) return;
    minimized = true;
    render();
    if (typeof onVisibilityChange === 'function') {
      onVisibilityChange(false);
    }
  }

  function render() {
    const container = document.getElementById('nx-call-tab-workspace');
    const miniPill = document.getElementById('nx-call-mini-pill');
    const miniLabel = document.getElementById('nx-call-mini-label');

    const rtcState = getRtcState();
    const activeCall = rtcState.activeCall;
    const endedCall = rtcState.lastEndedCall;
    const profile = getProfile();

    if (miniPill) {
      const showMini = isMinimizedDmCall();
      miniPill.hidden = !showMini;
      if (showMini && miniLabel && activeCall) {
        miniLabel.textContent = `On Call · ${activeCall.title || 'Live'}`;
      }
    }

    if (!container) return;

    if (!isTabShowing()) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    container.hidden = false;

    // Phase 2: Post-Call Rating View inside the Call Tab
    if (!activeCall && endedCall) {
      const peer = endedCall.peerUserId ? getMember?.(endedCall.peerUserId) : null;
      const peerName = peer?.displayName || endedCall.title || 'Call';
      const peerInitials = peer?.initials || computeInitials(peerName);
      const modeText =
        endedCall.mode === 'screen'
          ? 'Screen Share Call'
          : endedCall.mode === 'video'
            ? 'Video Call'
            : endedCall.kind === 'meeting'
              ? 'Video Meeting'
              : 'Voice Call';
      const durationText = formatCallDuration(endedCall.durationSec || 0);
      const displayScore = hoverRating || selectedRating;

      container.innerHTML = `
        <div class="nx-call-tab-bar">
          <div class="nx-call-tab-strip">
            <div class="nx-call-tab-pill review">
              <span class="nx-call-tab-star">★</span>
              <span>Rate ${escapeHtml(peerName)}</span>
              <button type="button" class="nx-call-tab-close" data-calltab-act="skip-review" aria-label="Skip review and close call tab" title="Close Call Tab">×</button>
            </div>
          </div>
          <button type="button" class="btn btn-secondary" data-calltab-act="skip-review">Skip &amp; Close Tab</button>
        </div>

        <div class="nx-call-rating-stage">
          <div class="nx-call-rating-card">
            <div class="nx-call-rating-head">
              <div class="nx-call-rating-avatar">${escapeHtml(peerInitials)}</div>
              <div>
                <div class="nx-call-ended-badge">${endedCall.endedByRemote ? 'Call Ended by Peer' : 'Call Ended'} · ${escapeHtml(modeText)} · ${escapeHtml(durationText)}</div>
                <h2 style="margin:6px 0 2px;font-size:1.3rem;font-weight:800;">How was your call with ${escapeHtml(peerName)}?</h2>
                <p class="member-sub" style="margin:0;white-space:normal;">Your rating helps improve call audio, video clarity, and connection speed. This tab will close automatically after review.</p>
              </div>
            </div>

            <div class="nx-call-stars-wrap">
              <div class="nx-call-stars-row" role="group" aria-label="Call quality rating 1 to 5 stars">
                ${[1, 2, 3, 4, 5]
                  .map(
                    (star) => `
                  <button
                    type="button"
                    class="nx-star-btn ${star <= displayScore ? 'active' : ''}"
                    data-calltab-act="select-star"
                    data-star="${star}"
                    aria-label="Rate ${star} out of 5 stars"
                    aria-pressed="${star <= selectedRating ? 'true' : 'false'}"
                  >★</button>
                `
                  )
                  .join('')}
              </div>
              <div class="nx-rating-score-label" id="nx-rating-score-label">
                ${displayScore ? `${displayScore}/5 · ${CALL_RATING_LABELS[displayScore]}` : 'Tap a star to rate (1–5)'}
              </div>
            </div>

            <div>
              <div class="member-sub" style="font-weight:700;margin-bottom:8px;">What went well or had issues? (optional)</div>
              <div class="nx-rating-tags-grid">
                ${CALL_RATING_TAGS.map(
                  (tag) => `
                  <button
                    type="button"
                    class="nx-rating-tag ${selectedTags.has(tag) ? 'active' : ''}"
                    data-calltab-act="toggle-rating-tag"
                    data-tag="${escapeHtml(tag)}"
                  >${escapeHtml(tag)}</button>
                `
                ).join('')}
              </div>
            </div>

            <label style="display:grid;gap:6px;">
              <span class="member-sub" style="font-weight:700;">Review Comment (optional)</span>
              <textarea
                id="nx-call-review-comment"
                class="textarea"
                rows="3"
                maxlength="600"
                placeholder="Share feedback about audio clarity, video, or connection..."
              >${escapeHtml(reviewComment)}</textarea>
            </label>

            <div class="nx-call-rating-actions">
              <button type="button" class="btn btn-secondary" data-calltab-act="skip-review">Skip &amp; Close Tab</button>
              <button
                type="button"
                class="btn btn-primary"
                id="nx-submit-call-rating-btn"
                data-calltab-act="submit-review"
                ${submittingReview || selectedRating < 1 ? 'disabled' : ''}
              >${submittingReview ? 'Submitting...' : 'Submit Review & Close Tab'}</button>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Phase 1: Live Call Tab + New Call Chat
    const activeInputEl = document.getElementById('nx-call-chat-input');
    const hadChatFocus = activeInputEl && document.activeElement === activeInputEl;
    const savedChatDraft = activeInputEl instanceof HTMLInputElement ? activeInputEl.value : '';

    const peers =
      rtcState.peers.length > 0
        ? rtcState.peers
        : [
            {
              userId: profile.id,
              displayName: profile.displayName,
              initials: profile.initials,
              muted: rtcState.muted,
              videoOn: rtcState.videoOn,
              screenSharing: rtcState.screenSharing,
            },
          ];
    const remoteConnected = peers.some((p) => p.userId !== profile.id);
    const elapsedSec = Math.max(0, Math.round((Date.now() - (activeCall.startedAtMs || Date.now())) / 1000));

    container.innerHTML = `
      <div class="nx-call-tab-bar">
        <div class="nx-call-tab-strip">
          <button type="button" class="nx-call-back-btn" data-calltab-act="minimize" title="Minimize call tab and keep call active">
            ← Back to App
          </button>
          <div class="nx-call-tab-pill live">
            <span class="nx-call-tab-dot"></span>
            <span>Call: ${escapeHtml(activeCall.title)} · New Call Chat</span>
            <span class="nx-call-tab-timer mono" id="nx-call-tab-timer">${formatCallDuration(elapsedSec)}</span>
            <button type="button" class="nx-call-tab-close" data-calltab-act="end-call" aria-label="End call" title="End Call">×</button>
          </div>
        </div>
        <div class="nx-call-mobile-switcher">
          <button type="button" class="nx-tab-chip ${mobilePane === 'stage' ? 'active' : ''}" data-calltab-act="switch-pane" data-pane="stage">Call Stage</button>
          <button type="button" class="nx-tab-chip ${mobilePane === 'chat' ? 'active' : ''}" data-calltab-act="switch-pane" data-pane="chat">New Chat (${chatMessages.length})</button>
        </div>
      </div>

      <div class="nx-call-tab-grid" data-mobile-pane="${mobilePane}">
        <div class="nx-call-stage-pane">
          <div class="nx-call-stage-top">
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="voice-eq-bars" aria-hidden="true"><span></span><span></span><span></span></span>
              <div>
                <strong style="font-size:1rem;">${escapeHtml(activeCall.title)}</strong>
                <div class="member-sub" style="color:#a9bbd8;">
                  ${
                    rtcState.mediaNotice
                      ? escapeHtml(rtcState.mediaNotice)
                      : remoteConnected
                        ? `${peers.length} participants connected live via WebRTC`
                        : 'Calling... waiting for participant to join'
                  }
                </div>
              </div>
            </div>
            <button type="button" class="btn btn-danger" data-calltab-act="end-call">
              ${svgIcon('phoneOff', 14)} <span>End Call</span>
            </button>
          </div>

          <div class="rtc-stage-grid nx-call-video-grid" id="nx-call-tab-rtc-grid">
            ${peers
              .map((p) => {
                const isMe = p.userId === profile.id;
                const hasStream = isMe
                  ? Boolean(rtcState.screenStream || rtcState.localStream?.getVideoTracks().length)
                  : Boolean(rtcState.remoteStreams?.get(p.userId)?.getVideoTracks().length);
                const summary = summarizeMediaState(p);
                const statusLabel =
                  isMe && rtcState.screenSharing && rtcState.screenShareKind === 'board'
                    ? 'Sharing Whiteboard'
                    : isMe && rtcState.screenSharing && rtcState.screenShareKind === 'photo'
                      ? 'Sharing Photo'
                      : summary.label;
                return `
                  <div class="rtc-video-card nx-call-video-card ${p.screenSharing ? 'screen-active' : ''}">
                    ${
                      hasStream
                        ? `<video class="rtc-video-el" data-rtc-video="${escapeHtml(p.userId)}" data-rtc-local="${isMe ? 'true' : 'false'}" autoplay playsinline ${isMe ? 'muted' : ''}></video>`
                        : `<div class="speaker-avatar-lg">${escapeHtml(p.initials || computeInitials(p.displayName || 'MB'))}</div>`
                    }
                    ${!isMe ? `<audio data-rtc-remote-audio="${escapeHtml(p.userId)}" autoplay></audio>` : ''}
                    <div class="rtc-card-overlay">
                      <span class="rtc-name-pill">${escapeHtml(p.displayName)}${isMe ? ' (You)' : ''}</span>
                      <span class="rtc-status-pill">${escapeHtml(statusLabel)}</span>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>

          <div class="nx-call-controls-dock">
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn ${rtcState.muted ? 'btn-danger' : 'btn-secondary'}" data-calltab-act="toggle-mute">${rtcState.muted ? svgIcon('micOff', 14) : svgIcon('mic', 14)} <span>${rtcState.muted ? 'Unmute' : 'Mute'}</span></button>
              <button type="button" class="btn ${rtcState.videoOn ? 'btn-primary' : 'btn-secondary'}" data-calltab-act="toggle-camera">${rtcState.videoOn ? svgIcon('videoOff', 14) : svgIcon('video', 14)} <span>${rtcState.videoOn ? 'Camera Off' : 'Camera'}</span></button>
              <button type="button" class="btn btn-secondary" data-calltab-act="flip-camera">${svgIcon('cameraFlip', 14)} <span>${rtcState.cameraFacing === 'environment' ? 'Front Cam' : 'Rear Cam'}</span></button>
              <button type="button" class="btn ${rtcState.screenSharing ? 'btn-primary' : 'btn-secondary'}" data-calltab-act="toggle-screen-share">${svgIcon('screen', 14)} <span>${rtcState.screenSharing ? 'Stop Share' : 'Share Screen'}</span></button>
              <button type="button" class="btn btn-secondary" data-calltab-act="open-share-options">${svgIcon('image', 14)} <span>Share Options</span></button>
            </div>
            ${renderDeviceControlsBar(true)}
          </div>
        </div>

        <aside class="nx-call-chat-panel" aria-label="New Call Session Chat">
          <div class="nx-call-chat-head">
            <div>
              <strong>New Call Chat</strong>
              <div class="member-sub" style="color:#a9bbd8;">Live session chat with ${escapeHtml(activeCall.title)}</div>
            </div>
            <span class="nx-meta-chip">Live</span>
          </div>

          <div class="nx-call-chat-list" id="nx-call-chat-list">
            ${renderChatMessagesHtml()}
          </div>

          <div class="nx-call-quick-chips">
            <button type="button" class="nx-tab-chip" data-calltab-act="quick-chat" data-text="Hey! Can you hear me clearly?">Can you hear me?</button>
            <button type="button" class="nx-tab-chip" data-calltab-act="quick-chat" data-text="One second, switching camera/mic.">One sec</button>
            <button type="button" class="nx-tab-chip" data-calltab-act="quick-chat" data-text="👍">👍</button>
          </div>

          <form id="nx-call-chat-form" class="nx-call-chat-form">
            <input
              type="text"
              id="nx-call-chat-input"
              class="input"
              maxlength="1000"
              placeholder="Message in this call tab..."
              autocomplete="off"
              required
            />
            <button type="submit" class="btn btn-primary">Send</button>
          </form>
        </aside>
      </div>
    `;

    rtc.attachMediaElements(container);
    const listEl = document.getElementById('nx-call-chat-list');
    if (listEl) listEl.scrollTop = listEl.scrollHeight;

    if (savedChatDraft) {
      const nextInput = document.getElementById('nx-call-chat-input');
      if (nextInput instanceof HTMLInputElement) {
        nextInput.value = savedChatDraft;
        if (hadChatFocus) nextInput.focus();
      }
    }
  }

  function bindEvents() {
    const container = document.getElementById('nx-call-tab-workspace');
    if (!container || container.dataset.bound === '1') return;
    container.dataset.bound = '1';

    container.addEventListener('click', async (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const actEl = target.closest('[data-calltab-act]');
      if (!actEl) return;
      const act = actEl.getAttribute('data-calltab-act');

      switch (act) {
        case 'minimize':
          minimizeCallTab();
          break;
        case 'switch-pane':
          mobilePane = actEl.getAttribute('data-pane') === 'chat' ? 'chat' : 'stage';
          render();
          break;
        case 'end-call':
          if (typeof onLeaveCall === 'function') await onLeaveCall();
          break;
        case 'toggle-mute':
          if (typeof onToggleMute === 'function') await onToggleMute();
          break;
        case 'toggle-camera':
          if (typeof onToggleCamera === 'function') await onToggleCamera();
          break;
        case 'flip-camera':
          if (typeof onFlipCamera === 'function') await onFlipCamera();
          break;
        case 'toggle-screen-share':
          if (typeof onToggleScreenShare === 'function') await onToggleScreenShare();
          break;
        case 'open-share-options':
          if (typeof onOpenShareOptions === 'function') onOpenShareOptions();
          break;
        case 'quick-chat': {
          const text = actEl.getAttribute('data-text') || '';
          if (text) await sendCallChatMessage(text);
          break;
        }
        case 'select-star': {
          const val = Number(actEl.getAttribute('data-star') || 0);
          if (val >= 1 && val <= 5) {
            selectedRating = val;
            updateRatingStarsDomOnly();
          }
          break;
        }
        case 'toggle-rating-tag': {
          const tag = actEl.getAttribute('data-tag') || '';
          if (!tag) break;
          if (selectedTags.has(tag)) selectedTags.delete(tag);
          else if (selectedTags.size < 8) selectedTags.add(tag);
          actEl.classList.toggle('active', selectedTags.has(tag));
          break;
        }
        case 'submit-review':
          await submitCallReviewAndClose();
          break;
        case 'skip-review':
          closeReviewTab();
          break;
      }
    });

    container.addEventListener('mouseover', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const starEl = target.closest('.nx-star-btn[data-star]');
      if (starEl) {
        hoverRating = Number(starEl.getAttribute('data-star') || 0);
        updateRatingStarsDomOnly();
      }
    });

    container.addEventListener('mouseout', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.nx-call-stars-row') && !container.querySelector('.nx-call-stars-row:hover')) {
        hoverRating = 0;
        updateRatingStarsDomOnly();
      }
    });

    container.addEventListener('input', (e) => {
      const target = e.target;
      if (target instanceof HTMLTextAreaElement && target.id === 'nx-call-review-comment') {
        reviewComment = target.value;
      }
    });

    container.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form instanceof HTMLFormElement && form.id === 'nx-call-chat-form') {
        e.preventDefault();
        const inputEl = document.getElementById('nx-call-chat-input');
        if (inputEl instanceof HTMLInputElement && inputEl.value.trim()) {
          await sendCallChatMessage(inputEl.value);
        }
      }
    });
  }

  function destroy() {
    stopTimer();
    stopChatSubscription();
  }

  return {
    bindEvents,
    syncWithRtcState,
    openCallTab,
    minimizeCallTab,
    closeReviewTab,
    isTabShowing,
    isMinimizedDmCall,
    render,
    destroy,
  };
}
