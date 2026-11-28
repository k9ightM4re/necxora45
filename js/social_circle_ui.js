/**
 * Social Circle Engine (M1) — Consent-First OAuth Connectors & Hybrid RAG Workspace View.
 */
import { getActiveIdToken } from './session.js';

const PROVIDERS = [
  {
    id: 'instagram',
    name: 'Instagram Graph API',
    subtitle: 'Business & Creator accounts via official Meta Login',
    defaultScopes: ['instagram_basic', 'pages_show_list'],
    optionalScope: 'instagram_manage_comments',
    optionalLabel: 'Include authorized media captions & comments for topic indexing',
    envHint: 'INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET',
  },
  {
    id: 'slack',
    name: 'Slack OAuth v2',
    subtitle: 'Minimum scopes (channels:read, users:read) + verified Events API',
    defaultScopes: ['channels:read', 'users:read'],
    optionalScope: 'channels:history',
    optionalLabel: 'Include public channel history (only if workspace admin approves)',
    envHint: 'SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET',
  },
  {
    id: 'discord',
    name: 'Discord OAuth2 Bot',
    subtitle: 'Invited servers only + Ed25519 slash command interactions',
    defaultScopes: ['identify', 'guilds', 'bot', 'applications.commands'],
    optionalScope: 'MESSAGE_CONTENT',
    optionalLabel: 'Request MESSAGE_CONTENT intent for consented guild channels',
    envHint: 'DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY',
  },
];

export function createSocialCircleUi({ auth, showToast, escapeHtml }) {
  let cachedStatus = null;
  let loading = false;
  let lastError = '';
  let oauthBanner = '';

  const draftConsent = {
    instagram: { consented: false, includeMessageContent: false, retentionDays: 90 },
    slack: { consented: false, includeMessageContent: false, retentionDays: 90 },
    discord: { consented: false, includeMessageContent: false, retentionDays: 90 },
  };

  async function getIdToken() {
    return getActiveIdToken();
  }

  async function fetchStatus(rerender) {
    if (loading) return;
    loading = true;
    lastError = '';
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/social-circle/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load Social Circle status.');
      cachedStatus = data;
      for (const p of PROVIDERS) {
        const c = data?.consents?.[p.id];
        if (c) {
          draftConsent[p.id] = {
            consented: Boolean(c.consented),
            includeMessageContent: Boolean(c.includeMessageContent),
            retentionDays: Number(c.retentionDays || 90),
          };
        }
      }
    } catch (err) {
      lastError = err?.message || 'Unable to load connector status.';
    } finally {
      loading = false;
      if (typeof rerender === 'function') rerender();
    }
  }

  function renderHtml() {
    const counts = cachedStatus?.counts || { persons: 0, interactions: 0, contents: 0 };
    const jobs = Array.isArray(cachedStatus?.jobs) ? cachedStatus.jobs : [];
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    return `
      <div class="nx-sc-shell" style="display:grid;gap:20px;max-width:1060px;margin:0 auto;padding:8px 4px 36px;">
        <section class="nx-card" style="padding:22px;display:grid;gap:10px;border:1px solid var(--border);border-radius:16px;background:var(--surface);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">
            <div>
              <h1 style="margin:0;font-size:1.35rem;font-family:var(--font-display);">Social Circle Engine · Milestone 1</h1>
              <p style="margin:6px 0 0;color:var(--muted);font-size:0.9rem;max-width:72ch;">
                Consent-first, official API connectors with AES-256-GCM envelope token encryption, zero PII logging, 90-day automatic retention expiry, and one-click disconnect + full deletion.
              </p>
            </div>
            <button type="button" class="btn btn-secondary" data-sc-action="refresh">Refresh Status</button>
          </div>

          <div style="display:flex;gap:16px;flex-wrap:wrap;font-family:var(--font-mono);font-size:0.8rem;color:var(--muted);padding-top:6px;border-top:1px solid var(--border);">
            <span>Normalized Persons: <strong style="color:var(--text);">${counts.persons}</strong></span>
            <span>Interactions: <strong style="color:var(--text);">${counts.interactions}</strong></span>
            <span>Consented Contents: <strong style="color:var(--text);">${counts.contents}</strong></span>
            <span>Non-User Profiling: <strong style="color:var(--success);">Disabled</strong></span>
          </div>

          ${lastError ? `<div style="padding:10px 12px;border-radius:10px;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.35);font-size:0.84rem;">${escapeHtml(lastError)}</div>` : ''}
          ${oauthBanner ? `<div style="padding:10px 12px;border-radius:10px;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.35);font-size:0.84rem;">${escapeHtml(oauthBanner)}</div>` : ''}
        </section>

        <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;">
          ${PROVIDERS.map((p) => {
            const c = cachedStatus?.consents?.[p.id] || {};
            const d = draftConsent[p.id];
            const isConnected = c.status === 'connected';
            return `
              <article class="nx-card" style="padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--surface);display:grid;gap:12px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                  <div>
                    <h2 style="margin:0;font-size:1.05rem;">${escapeHtml(p.name)}</h2>
                    <p style="margin:4px 0 0;font-size:0.82rem;color:var(--muted);">${escapeHtml(p.subtitle)}</p>
                  </div>
                  <span style="font-family:var(--font-mono);font-size:0.74rem;padding:3px 8px;border-radius:7px;border:1px solid var(--border);color:${isConnected ? 'var(--success)' : 'var(--muted)'};">
                    ${isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>

                <div style="font-size:0.78rem;color:var(--muted);background:var(--bg);padding:10px;border-radius:10px;border:1px solid var(--border);display:grid;gap:4px;">
                  <span>Callback URL: <code style="font-family:var(--font-mono);word-break:break-all;">${escapeHtml(origin)}/api/social-circle/oauth/${p.id}/callback</code></span>
                  <span>Scopes: <code style="font-family:var(--font-mono);">${escapeHtml(p.defaultScopes.join(', '))}</code></span>
                </div>

                <label style="display:flex;align-items:flex-start;gap:8px;font-size:0.82rem;cursor:pointer;">
                  <input type="checkbox" data-sc-consent="${p.id}" ${d.consented ? 'checked' : ''} />
                  <span>I explicitly authorize ${escapeHtml(p.name)} read-only sync for my account and understand I can delete all synced data anytime.</span>
                </label>

                <label style="display:flex;align-items:flex-start;gap:8px;font-size:0.8rem;color:var(--muted);cursor:pointer;">
                  <input type="checkbox" data-sc-content="${p.id}" ${d.includeMessageContent ? 'checked' : ''} />
                  <span>${escapeHtml(p.optionalLabel)}</span>
                </label>

                <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.8rem;color:var(--muted);">
                  <span>Data retention window</span>
                  <select class="select" data-sc-retention="${p.id}" style="width:auto;min-width:120px;">
                    <option value="30" ${d.retentionDays === 30 ? 'selected' : ''}>30 days</option>
                    <option value="60" ${d.retentionDays === 60 ? 'selected' : ''}>60 days</option>
                    <option value="90" ${d.retentionDays === 90 ? 'selected' : ''}>90 days (Default)</option>
                    <option value="180" ${d.retentionDays === 180 ? 'selected' : ''}>180 days</option>
                  </select>
                </label>

                <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:4px;">
                  <button type="button" class="btn btn-primary" data-sc-connect="${p.id}">
                    ${isConnected ? 'Reconnect OAuth' : 'Authorize & Connect'}
                  </button>
                  ${isConnected ? `<button type="button" class="btn btn-secondary" data-sc-sync="${p.id}">Queue Sync</button>` : ''}
                  ${isConnected || c.consented ? `<button type="button" class="btn btn-danger" data-sc-disconnect="${p.id}">Disconnect &amp; Delete All</button>` : ''}
                </div>
              </article>
            `;
          }).join('')}
        </section>

        <section class="nx-card" style="padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--surface);display:grid;gap:12px;">
          <h2 style="margin:0;font-size:1.05rem;">Ask Social Circle (Hybrid RAG · Grounded with Citations)</h2>
          <form id="sc-rag-form" style="display:flex;gap:8px;flex-wrap:wrap;">
            <input type="text" id="sc-rag-input" class="input" style="flex:1;min-width:220px;" placeholder="Ask about your connected channels, topics, or privacy architecture..." />
            <button type="submit" class="btn btn-primary">Ask AI</button>
          </form>
          <div id="sc-rag-output" aria-live="polite" style="font-size:0.88rem;color:var(--muted);">
            Answers stay isolated to your user account and always cite retrieved source IDs.
          </div>
        </section>

        <section class="nx-card" style="padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--surface);display:grid;gap:10px;">
          <h2 style="margin:0;font-size:1.05rem;">Sync Queue History (Idempotent · Retries + Backoff)</h2>
          ${
            jobs.length
              ? `<div style="display:grid;gap:8px;">${jobs
                  .map(
                    (j) => `
                  <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:var(--bg);border:1px solid var(--border);font-size:0.8rem;">
                    <span><strong>${escapeHtml(j.source.toUpperCase())}</strong> · status: <code style="font-family:var(--font-mono);">${escapeHtml(j.status)}</code></span>
                    <span style="font-family:var(--font-mono);color:var(--muted);">attempt ${j.attempt}/${j.maxAttempts} · key ${escapeHtml(String(j.idempotencyKey || '').slice(0, 22))}</span>
                  </div>`
                  )
                  .join('')}</div>`
              : `<p style="margin:0;font-size:0.84rem;color:var(--muted);">No sync jobs queued yet. Authorize a connector above to queue your first cursor sync.</p>`
          }
        </section>
      </div>
    `;
  }

  function afterRender(root, rerender) {
    if (!cachedStatus && !loading) {
      void fetchStatus(rerender);
    }

    root.querySelector('[data-sc-action="refresh"]')?.addEventListener('click', () => {
      void fetchStatus(rerender);
    });

    root.querySelectorAll('[data-sc-consent]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const src = el.getAttribute('data-sc-consent');
        if (src && draftConsent[src]) draftConsent[src].consented = Boolean(e.target.checked);
      });
    });

    root.querySelectorAll('[data-sc-content]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const src = el.getAttribute('data-sc-content');
        if (src && draftConsent[src]) draftConsent[src].includeMessageContent = Boolean(e.target.checked);
      });
    });

    root.querySelectorAll('[data-sc-retention]').forEach((el) => {
      el.addEventListener('change', async (e) => {
        const src = el.getAttribute('data-sc-retention');
        const days = Number(e.target.value || 90);
        if (src && draftConsent[src]) draftConsent[src].retentionDays = days;
        const token = await getIdToken();
        if (!token) return;
        await fetch('/api/social-circle/retention', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ source: src, retentionDays: days }),
        });
        showToast(`Retention window set to ${days} days for ${src}.`, 'success');
      });
    });

    root.querySelectorAll('[data-sc-connect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const src = btn.getAttribute('data-sc-connect');
        if (!src) return;
        const d = draftConsent[src];
        if (!d.consented) {
          showToast('Please check the explicit consent box first.', 'warning');
          return;
        }
        const token = await getIdToken();
        if (!token) {
          showToast('Please sign in first.', 'error');
          return;
        }

        const providerMeta = PROVIDERS.find((p) => p.id === src);
        const scopes = [...(providerMeta?.defaultScopes || [])];
        if (d.includeMessageContent && providerMeta?.optionalScope) {
          scopes.push(providerMeta.optionalScope);
        }

        const res = await fetch('/api/social-circle/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            source: src,
            consented: true,
            includeMessageContent: d.includeMessageContent,
            retentionDays: d.retentionDays,
            scopes,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Could not initialize OAuth authorization.', 'error');
          return;
        }
        if (!data.configured) {
          oauthBanner = `${providerMeta?.name} credentials are not configured yet (${(data.missingEnvVars || []).join(', ')}). Register callback URI: ${data.redirectUri}`;
          rerender();
          showToast('Consent saved. Configure OAuth env credentials to launch authorization.', 'info');
          return;
        }

        const popup = window.open(data.authUrl, `nexora_oauth_${src}`, 'width=560,height=680');
        const onMsg = (ev) => {
          if (ev?.data?.type === 'OAUTH_AUTH_SUCCESS' && ev?.data?.provider === src) {
            window.removeEventListener('message', onMsg);
            showToast(`${providerMeta?.name} connected cleanly.`, 'success');
            void fetchStatus(rerender);
          } else if (ev?.data?.type === 'OAUTH_AUTH_ERROR' && ev?.data?.provider === src) {
            window.removeEventListener('message', onMsg);
            showToast(ev?.data?.error || 'OAuth authorization declined.', 'error');
          }
        };
        window.addEventListener('message', onMsg);
        if (!popup) {
          showToast('Allow popups to complete OAuth sign-in.', 'warning');
        }
      });
    });

    root.querySelectorAll('[data-sc-sync]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const src = btn.getAttribute('data-sc-sync');
        const token = await getIdToken();
        if (!src || !token) return;
        const res = await fetch(`/api/social-circle/sync/${src}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data?.error || 'Sync failed.', 'error');
          return;
        }
        showToast(`Sync ${data.job?.status || 'completed'} for ${src}.`, 'success');
        void fetchStatus(rerender);
      });
    });

    root.querySelectorAll('[data-sc-disconnect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const src = btn.getAttribute('data-sc-disconnect');
        const token = await getIdToken();
        if (!src || !token) return;
        const res = await fetch(`/api/social-circle/disconnect/${src}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          showToast('Disconnect failed.', 'error');
          return;
        }
        draftConsent[src].consented = false;
        draftConsent[src].includeMessageContent = false;
        showToast(`Disconnected ${src} and deleted all associated records.`, 'success');
        void fetchStatus(rerender);
      });
    });

    const ragForm = root.querySelector('#sc-rag-form');
    const ragInput = root.querySelector('#sc-rag-input');
    const ragOut = root.querySelector('#sc-rag-output');
    ragForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = String(ragInput?.value || '').trim();
      if (!q || !ragOut) return;
      ragOut.textContent = 'Searching grounded records...';
      const token = await getIdToken();
      const res = await fetch('/api/rag/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        ragOut.textContent = data?.error || 'Could not query Social Circle.';
        return;
      }
      const cites = (data.citations || []).map((c) => `[${c.id}] ${c.title}`).join(' · ');
      ragOut.innerHTML = `<div style="display:grid;gap:6px;"><span style="font-family:var(--font-mono);font-size:0.74rem;color:var(--secondary);">AI-generated · Grounded with Citations</span><strong style="color:var(--text);font-weight:500;">${escapeHtml(data.answer || '')}</strong>${cites ? `<span style="font-size:0.78rem;color:var(--muted);">Sources: ${escapeHtml(cites)}</span>` : ''}</div>`;
    });
  }

  return { renderHtml, afterRender, refresh: fetchStatus };
}
