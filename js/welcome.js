import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase.js';
import { requireAuth, signOutSession } from './session.js';
import { formatFriendlyError, notifyUser } from './notifications.js';
import { getInitials } from './profile.js';
import { sanitizeInviteCode, validateInviteRecord } from './comms.js';
import { svgIcon } from './icons.js';
import { initThemeSync } from './theme.js';

initThemeSync();

let currentUser = null;
let currentProfile = null;
let previewState = null; // { kind: 'invite' | 'server', invite, server }
let unsubRequests = null;

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showBanner(msg, type = 'info') {
  const el = document.getElementById('welcome-feedback');
  if (el) {
    el.textContent = msg;
    el.className = `w-status-banner${type === 'error' ? ' error' : type === 'success' ? ' success' : ''}`;
    el.hidden = false;
  }
  if (type === 'error' && msg) {
    notifyUser(msg, 'error');
  }
}

function hideBanner() {
  const el = document.getElementById('welcome-feedback');
  if (el) el.hidden = true;
}

function renderInvitePreview() {
  const container = document.getElementById('invite-preview-container');
  if (!container) return;

  if (!previewState) {
    container.innerHTML = `
      <div style="padding:14px;border-radius:var(--radius-sm);border:1px dashed var(--slate-border-strong);color:var(--ink-muted);font-size:0.86rem;line-height:1.5;">
        Enter an invite code from a friend above to inspect community details, review community guidelines, and join securely.
      </div>
    `;
    return;
  }

  const { invite, server, validation, existingMembership, existingJoinReq } = previewState;
  const title = invite?.serverName || server?.name || 'Community Space';
  const category = invite?.serverCategory || server?.category || 'Community';
  const description = invite?.serverDescription || server?.description || 'Invited community workspace on NEXORA.';
  const rules =
    invite?.serverRules ||
    server?.rules ||
    '1. Be respectful and constructive.\n2. Keep conversations on-topic.\n3. Follow moderator guidance.';
  const invitedBy = invite?.createdByName || 'Community Owner';
  const targetServerId = invite?.serverId || server?.id || '';

  let actionBlock = '';
  if (existingMembership) {
    actionBlock = `
      <a href="/app.html?server=${encodeURIComponent(targetServerId)}" class="w-btn w-btn-primary">Already a Member — Enter Community</a>
    `;
  } else if (invite && !validation.valid) {
    actionBlock = `
      <div class="w-status-banner error">${escapeHtml(validation.reason)}</div>
    `;
  } else if (existingJoinReq?.status === 'pending') {
    actionBlock = `
      <div class="w-status-banner">Your join request for this community is pending moderator approval.</div>
    `;
  } else {
    const canAcceptDirectly = Boolean(invite && validation?.valid) || existingJoinReq?.status === 'approved';
    actionBlock = `
      <label class="rules-consent">
        <input type="checkbox" id="rules-accept-checkbox" />
        <span>I have read and agree to follow the community guidelines above.</span>
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${
          canAcceptDirectly
            ? `<button type="button" class="w-btn w-btn-primary" id="accept-invite-btn" disabled>
                ${svgIcon('check', 15)} <span>Accept Invite &amp; Enter Community</span>
               </button>`
            : `<button type="button" class="w-btn w-btn-primary" id="request-join-btn" disabled>
                ${svgIcon('userPlus', 15)} <span>Request to Join Community</span>
               </button>`
        }
      </div>
    `;
  }

  container.innerHTML = `
    <div class="invite-preview-box">
      <div class="invite-community-head">
        <div class="community-glyph">${escapeHtml(getInitials(title))}</div>
        <div>
          <strong style="font-size:1.05rem;display:block;">${escapeHtml(title)}</strong>
          <div class="community-meta-line">
            <span>${escapeHtml(category)}</span>
            ${invite ? `<span>Invited by ${escapeHtml(invitedBy)}</span>` : ''}
            ${invite?.code ? `<span class="mono">Code: ${escapeHtml(invite.code)}</span>` : ''}
          </div>
        </div>
      </div>

      <p style="margin:0;font-size:0.88rem;line-height:1.5;color:var(--ink-secondary);">${escapeHtml(description)}</p>

      <div>
        <div style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--ink-muted);margin-bottom:6px;">
          Community Guidelines Screening
        </div>
        <div class="rules-box">${escapeHtml(rules)}</div>
      </div>

      ${actionBlock}
    </div>
  `;

  const checkbox = document.getElementById('rules-accept-checkbox');
  const acceptBtn = document.getElementById('accept-invite-btn');
  const requestBtn = document.getElementById('request-join-btn');
  checkbox?.addEventListener('change', () => {
    const checked = checkbox instanceof HTMLInputElement && checkbox.checked;
    if (acceptBtn instanceof HTMLButtonElement) acceptBtn.disabled = !checked;
    if (requestBtn instanceof HTMLButtonElement) requestBtn.disabled = !checked;
  });

  acceptBtn?.addEventListener('click', handleAcceptInvite);
  requestBtn?.addEventListener('click', handleRequestJoin);
}

async function lookupInviteCode(rawInput) {
  hideBanner();
  const code = sanitizeInviteCode(rawInput);
  if (!code) {
    showBanner('Enter a valid invite code or link.', 'error');
    return;
  }

  let inviteDoc = null;
  let serverDoc = null;

  try {
    const invSnap = await getDoc(doc(db, 'invites', code));
    if (invSnap.exists()) {
      inviteDoc = { code: invSnap.id, ...invSnap.data() };
    }
  } catch (err) {
    console.warn('Invite lookup note:', err?.message);
  }

  // Fallback search among public servers matching inviteCode or document ID
  if (!inviteDoc) {
    try {
      const publicSnap = await getDocs(query(collection(db, 'servers'), where('visibility', '==', 'public')));
      publicSnap.forEach((d) => {
        const data = d.data();
        if (
          String(data.inviteCode || '').toLowerCase() === code.toLowerCase() ||
          d.id.toLowerCase() === code.toLowerCase()
        ) {
          serverDoc = { id: d.id, ...data };
        }
      });
    } catch (err) {
      console.warn('Server fallback lookup note:', err?.message);
    }
  }

  if (!inviteDoc && !serverDoc) {
    previewState = null;
    renderInvitePreview();
    showBanner(`No active community invite matched "${code}".`, 'error');
    return;
  }

  const targetServerId = inviteDoc?.serverId || serverDoc?.id;
  let existingMembership = false;
  let existingJoinReq = null;

  if (targetServerId && currentUser) {
    try {
      const memSnap = await getDoc(doc(db, 'servers', targetServerId, 'members', currentUser.uid));
      existingMembership = memSnap.exists();
    } catch {}
    try {
      const reqSnap = await getDoc(doc(db, 'servers', targetServerId, 'join_requests', currentUser.uid));
      if (reqSnap.exists()) existingJoinReq = reqSnap.data();
    } catch {}
  }

  const validation = inviteDoc ? validateInviteRecord(inviteDoc) : { valid: true, reason: '' };
  previewState = {
    invite: inviteDoc,
    server: serverDoc,
    validation,
    existingMembership,
    existingJoinReq,
  };
  renderInvitePreview();
}

async function handleAcceptInvite() {
  if (!previewState || !currentUser) return;
  const { invite, server, existingJoinReq } = previewState;
  const serverId = invite?.serverId || server?.id;
  if (!serverId) return;

  const btn = document.getElementById('accept-invite-btn');
  if (btn instanceof HTMLButtonElement) btn.disabled = true;

  try {
    const memberPayload = {
      userId: currentUser.uid,
      displayName: String(currentProfile?.displayName || currentUser.displayName || 'Member').slice(0, 50),
      role: 'member',
      joinedAt: serverTimestamp(),
    };
    if (invite?.code) {
      memberPayload.inviteCode = invite.code;
    }

    await setDoc(doc(db, 'servers', serverId, 'members', currentUser.uid), memberPayload);

    if (invite?.code && existingJoinReq?.status !== 'approved') {
      await updateDoc(doc(db, 'invites', invite.code), {
        uses: Number(invite.uses || 0) + 1,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }

    await setDoc(doc(db, 'users', currentUser.uid, 'joined_servers', serverId), {
      serverId,
      joinedAt: serverTimestamp(),
    });

    window.location.replace(`/app.html?server=${encodeURIComponent(serverId)}`);
  } catch (err) {
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
    const msg = formatFriendlyError(err, 'You cannot enter this community right now. Please check back shortly.');
    showBanner(msg, 'error');
    handleFirestoreError(err, OperationType.WRITE, `servers/${serverId}/members/${currentUser.uid}`, {
      fallback: msg,
      silent: true,
    });
  }
}

async function handleRequestJoin() {
  if (!previewState?.server || !currentUser) return;
  const srv = previewState.server;
  const btn = document.getElementById('request-join-btn');
  if (btn instanceof HTMLButtonElement) btn.disabled = true;

  try {
    await setDoc(doc(db, 'servers', srv.id, 'join_requests', currentUser.uid), {
      userId: currentUser.uid,
      serverId: srv.id,
      ownerId: srv.ownerId,
      displayName: String(currentProfile?.displayName || 'NEXORA Member').slice(0, 80),
      username: String(currentProfile?.username || 'member').slice(0, 50),
      initials: String(currentProfile?.initials || 'NM').slice(0, 16),
      inviteCode: sanitizeInviteCode(document.getElementById('invite-code-input')?.value || ''),
      rulesAccepted: true,
      note: 'Requested access from Community Welcome screen',
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showBanner(`Join request submitted to ${srv.name}. You will enter once approved by the owner.`, 'success');
    await lookupInviteCode(srv.inviteCode || srv.id);
  } catch (err) {
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
    const msg = formatFriendlyError(err, 'Site is busy right now. Could not submit join request.');
    showBanner(msg, 'error');
    handleFirestoreError(err, OperationType.CREATE, `servers/${srv.id}/join_requests/${currentUser.uid}`, {
      fallback: msg,
      silent: true,
    });
  }
}

function subscribeConnectionRequests(uid) {
  if (unsubRequests) {
    unsubRequests();
    unsubRequests = null;
  }
  const container = document.getElementById('incoming-requests-list');
  if (!container || !uid) return;
  if (currentUser?.isNexoraAccount || !auth.currentUser) {
    container.innerHTML = `<p style="margin:0;color:var(--ink-muted);font-size:0.86rem;">No pending chat or call requests right now.</p>`;
    return;
  }

  const q = query(collection(db, 'connection_requests'), where('participantIds', 'array-contains', uid));
  unsubRequests = onSnapshot(
    q,
    (snap) => {
      const pendingIncoming = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.status === 'pending' && d.toUid === uid) {
          pendingIncoming.push({ id: docSnap.id, ...d });
        }
      });

      if (pendingIncoming.length === 0) {
        container.innerHTML = `<p style="margin:0;color:var(--ink-muted);font-size:0.86rem;">No pending chat or call requests right now.</p>`;
        return;
      }

      container.innerHTML = pendingIncoming
        .map(
          (req) => `
            <div class="req-item">
              <div>
                <strong style="display:block;font-size:0.9rem;">${escapeHtml(req.fromName || 'NEXORA Member')}</strong>
                <span style="font-size:0.78rem;color:var(--ink-muted);">${escapeHtml(req.note || 'Wants to start a 1-on-1 chat & call connection.')}</span>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="w-btn w-btn-primary" data-req-action="accept" data-req-id="${escapeHtml(req.id)}" data-from-uid="${escapeHtml(req.fromUid)}" data-from-name="${escapeHtml(req.fromName || 'Member')}">Accept</button>
                <button type="button" class="w-btn w-btn-secondary" data-req-action="decline" data-req-id="${escapeHtml(req.id)}">Decline</button>
              </div>
            </div>
          `
        )
        .join('');
    },
    () => {}
  );
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const initialInvite = sanitizeInviteCode(params.get('invite') || '');
  const redirectTarget = initialInvite
    ? `/login.html?invite=${encodeURIComponent(initialInvite)}`
    : '/login.html';

  document.getElementById('welcome-signout-btn')?.addEventListener('click', () => {
    signOutSession('/login.html');
  });

  document.getElementById('invite-lookup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('invite-code-input');
    if (input instanceof HTMLInputElement) {
      await lookupInviteCode(input.value);
    }
  });

  document.getElementById('incoming-requests-list')?.addEventListener('click', async (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-req-action]') : null;
    if (!btn || !currentUser) return;
    const action = btn.getAttribute('data-req-action');
    const reqId = btn.getAttribute('data-req-id');
    if (!reqId) return;

    try {
      await updateDoc(doc(db, 'connection_requests', reqId), {
        status: action === 'accept' ? 'accepted' : 'declined',
        updatedAt: serverTimestamp(),
      });
      if (action === 'accept') {
        const fromUid = btn.getAttribute('data-from-uid') || '';
        const fromName = btn.getAttribute('data-from-name') || 'Member';
        if (fromUid) {
          const participants = [currentUser.uid, fromUid].sort();
          await setDoc(
            doc(db, 'dm_threads', reqId),
            {
              id: reqId,
              participants,
              participantMeta: {
                [currentUser.uid]: {
                  displayName: String(currentProfile?.displayName || 'Member').slice(0, 80),
                  username: String(currentProfile?.username || 'member').slice(0, 50),
                  initials: String(currentProfile?.initials || 'MB').slice(0, 16),
                },
                [fromUid]: {
                  displayName: String(fromName).slice(0, 80),
                  username: 'member',
                  initials: getInitials(fromName),
                },
              },
              lastMessage: '',
              createdBy: currentUser.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
        showBanner('Connection request accepted. You can now chat and call in Workspace.', 'success');
      } else {
        showBanner('Connection request declined.');
      }
    } catch (err) {
      showBanner(formatFriendlyError(err, 'Site is busy right now. Could not update request.'), 'error');
    }
  });

  document.getElementById('welcome-create-server-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const nameEl = document.getElementById('w-srv-name');
    const catEl = document.getElementById('w-srv-category');
    const visEl = document.getElementById('w-srv-visibility');
    const descEl = document.getElementById('w-srv-desc');
    const rulesEl = document.getElementById('w-srv-rules');
    const welcomeEl = document.getElementById('w-srv-welcome');
    const submitBtn = document.getElementById('welcome-create-btn');

    const name = nameEl instanceof HTMLInputElement ? nameEl.value.trim() : '';
    if (name.length < 2) return;

    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;

    const srvId = `srv-${Date.now()}`;
    const chGeneral = `chn-${Date.now()}-gen`;
    const chVoice = `chn-${Date.now()}-voc`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'nex';
    const inviteCode = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const category = catEl instanceof HTMLSelectElement ? catEl.value : 'Technology';
    const visibility = visEl instanceof HTMLSelectElement && visEl.value === 'public' ? 'public' : 'private';
    const description =
      descEl instanceof HTMLTextAreaElement && descEl.value.trim()
        ? descEl.value.trim().slice(0, 300)
        : 'NEXORA community workspace.';
    const rules = rulesEl instanceof HTMLTextAreaElement ? rulesEl.value.trim().slice(0, 1000) : '';
    const welcomeMessage =
      welcomeEl instanceof HTMLInputElement && welcomeEl.value.trim()
        ? welcomeEl.value.trim().slice(0, 400)
        : `Welcome to ${name}!`;

    try {
      await setDoc(doc(db, 'servers', srvId), {
        id: srvId,
        name: name.slice(0, 50),
        glyph: getInitials(name),
        category,
        description,
        rules,
        welcomeMessage,
        inviteCode,
        visibility,
        ownerId: currentUser.uid,
        defaultChannelId: chGeneral,
        categories: [
          { id: `cat-${Date.now()}-1`, name: 'Text Channels', channelIds: [chGeneral] },
          { id: `cat-${Date.now()}-2`, name: 'Voice & Video', channelIds: [chVoice] },
        ],
        guard: { active: true, purgeUnverified: false, purgeDays: 7, antiSpamLinks: true, blockedWords: [] },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'servers', srvId, 'channels', chGeneral), {
        id: chGeneral,
        serverId: srvId,
        name: 'general',
        type: 'text',
        topic: welcomeMessage.slice(0, 200),
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'servers', srvId, 'channels', chVoice), {
        id: chVoice,
        serverId: srvId,
        name: 'voice-lounge',
        type: 'voice',
        topic: 'Live voice, video & screen-share lounge.',
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'servers', srvId, 'members', currentUser.uid), {
        userId: currentUser.uid,
        displayName: String(currentProfile?.displayName || 'Owner').slice(0, 50),
        role: 'owner',
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'invites', inviteCode), {
        code: inviteCode,
        serverId: srvId,
        serverName: name.slice(0, 50),
        serverCategory: category,
        serverDescription: description,
        serverRules: rules,
        ownerId: currentUser.uid,
        createdBy: currentUser.uid,
        createdByName: String(currentProfile?.displayName || 'Owner').slice(0, 80),
        active: true,
        expiresAtMs: 0,
        maxUses: 0,
        uses: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'users', currentUser.uid, 'joined_servers', srvId), {
        serverId: srvId,
        joinedAt: serverTimestamp(),
      });

      window.location.replace(`/app.html?server=${encodeURIComponent(srvId)}`);
    } catch (err) {
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
      const msg = formatFriendlyError(err, 'Site is busy right now. Could not create community.');
      showBanner(msg, 'error');
      handleFirestoreError(err, OperationType.CREATE, `servers/${srvId}`, {
        fallback: msg,
        silent: true,
      });
    }
  });

  requireAuth({
    requireVerified: false,
    redirectUnauthenticated: redirectTarget,
    onAuthenticated: async (fbUser, loadedProfile) => {
      currentUser = fbUser;
      currentProfile = loadedProfile;

      const greet = document.getElementById('welcome-greeting');
      const userChip = document.getElementById('welcome-user-chip');
      if (greet) greet.textContent = `Welcome, ${loadedProfile?.displayName || 'Member'}`;
      if (userChip) userChip.textContent = `@${loadedProfile?.username || 'member'}`;

      subscribeConnectionRequests(fbUser.uid);

      const input = document.getElementById('invite-code-input');
      if (initialInvite && input instanceof HTMLInputElement) {
        input.value = initialInvite;
        await lookupInviteCode(initialInvite);
      } else {
        renderInvitePreview();
      }
    },
  });
});
