/**
 * Global Cmd/Ctrl+K RAG Assistant & Semantic Search Palette for Nexora.
 * Works across both index.html (public knowledge + quick jump) and app.html (authenticated Social Circle RAG).
 */

export function initRagAssistant({ getAuthToken = null, customTargets = [] } = {}) {
  if (typeof document === 'undefined') return null;

  let overlay = document.getElementById('nx-command');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'nx-command';
    overlay.className = 'nx-command';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Nexora Command and RAG Assistant');
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="nx-command-panel">
      <div class="nx-cmd-tabs" role="tablist" aria-label="Command assistant modes">
        <button type="button" role="tab" class="nx-cmd-tab is-active" data-cmd-tab="jump" aria-selected="true">Quick Jump</button>
        <button type="button" role="tab" class="nx-cmd-tab" data-cmd-tab="ask" aria-selected="false">Ask AI (RAG)</button>
        <button type="button" role="tab" class="nx-cmd-tab" data-cmd-tab="search" aria-selected="false">Semantic Search</button>
        <span class="nx-cmd-esc">ESC</span>
      </div>
      <form id="nx-command-form" class="nx-cmd-form">
        <input class="nx-command-input" id="nx-command-input" type="search" placeholder="Jump to a section, search docs, or ask Nexora AI..." autocomplete="off" aria-label="Command or query input" />
        <button type="submit" id="nx-command-ask-btn" class="nx-cmd-submit" hidden>Ask</button>
      </form>
      <div class="nx-command-list" id="nx-command-list" role="listbox" aria-label="Quick jump targets"></div>
      <div class="nx-cmd-ai-pane" id="nx-cmd-ai-pane" hidden>
        <div class="nx-cmd-ai-badge">AI-generated · Grounded with Citations</div>
        <div class="nx-cmd-ai-answer" id="nx-cmd-ai-answer" aria-live="polite">
          Ask a question about Nexora workspaces, approvals, or your connected Social Circle data.
        </div>
        <div class="nx-cmd-citations" id="nx-cmd-citations"></div>
      </div>
    </div>
  `;

  const input = document.getElementById('nx-command-input');
  const list = document.getElementById('nx-command-list');
  const aiPane = document.getElementById('nx-cmd-ai-pane');
  const aiAnswer = document.getElementById('nx-cmd-ai-answer');
  const citationsBox = document.getElementById('nx-cmd-citations');
  const askBtn = document.getElementById('nx-command-ask-btn');
  const form = document.getElementById('nx-command-form');
  const tabs = Array.from(overlay.querySelectorAll('[data-cmd-tab]'));

  const defaultTargets = [
    { label: 'Try Live Team Scene', hint: 'Interactive workspace', href: '#live-scene' },
    { label: 'Agents work as a team', hint: 'Roster & memory', href: '#agents-team' },
    { label: 'Any model, same agent', hint: 'Swap models freely', href: '#any-model' },
    { label: 'Workflows with approvals', hint: 'Human sign-off gates', href: '#workflows' },
    { label: 'FAQ', hint: 'Common questions', href: '#faq' },
    { label: 'Log in', hint: 'Workspace sign in', href: '/login.html' },
    { label: 'Get Started', hint: 'Create account', href: '/signup.html' },
    { label: 'Join Invite', hint: 'Welcome hub', href: '/welcome.html' },
  ];

  const targets = customTargets.length ? customTargets : defaultTargets;
  let mode = 'jump';
  let filtered = targets.slice();
  let activeIndex = 0;

  function setMode(nextMode) {
    mode = nextMode;
    tabs.forEach((t) => {
      const match = t.getAttribute('data-cmd-tab') === nextMode;
      t.classList.toggle('is-active', match);
      t.setAttribute('aria-selected', String(match));
    });
    if (list) list.hidden = nextMode === 'ask';
    if (aiPane) aiPane.hidden = nextMode !== 'ask';
    if (askBtn) askBtn.hidden = nextMode !== 'ask';
    if (input) {
      input.placeholder =
        nextMode === 'ask'
          ? 'Ask a grounded question (press Enter)...'
          : nextMode === 'search'
          ? 'Semantic search across Nexora & consented docs...'
          : 'Jump to a section or page...';
      input.focus();
    }
    if (nextMode === 'jump') renderJumpList();
    if (nextMode === 'search') void runSemanticSearch(input?.value || 'nexora');
  }

  function close() {
    overlay.classList.remove('is-open');
    document.body.classList.remove('nx-command-open');
  }

  function open(initialMode = 'jump') {
    overlay.classList.add('is-open');
    document.body.classList.add('nx-command-open');
    if (input) input.value = '';
    filtered = targets.slice();
    activeIndex = 0;
    setMode(initialMode);
    requestAnimationFrame(() => input?.focus({ preventScroll: true }));
  }

  function selectTarget(item) {
    close();
    if (typeof item.onSelect === 'function') {
      item.onSelect();
      return;
    }
    if (item.href && item.href.startsWith('#')) {
      const target = document.querySelector(item.href);
      if (target) {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        if (item.href === '#live-scene') {
          window.dispatchEvent(new CustomEvent('nexora:focus-live-scene'));
        }
        return;
      }
    }
    if (item.href) window.location.href = item.href;
  }

  function renderJumpList() {
    if (!list) return;
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'nx-command-empty';
      empty.textContent = 'No matching targets. Switch to "Ask AI (RAG)" for grounded answers.';
      list.appendChild(empty);
      return;
    }
    filtered.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nx-command-item' + (index === activeIndex ? ' is-active' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(index === activeIndex));
      const label = document.createElement('strong');
      label.textContent = item.label;
      const hint = document.createElement('span');
      hint.textContent = item.hint || '';
      btn.append(label, hint);
      btn.addEventListener('click', () => selectTarget(item));
      list.appendChild(btn);
    });
  }

  async function runSemanticSearch(queryText) {
    if (!list) return;
    const q = String(queryText || '').trim();
    if (!q) {
      list.innerHTML = '<div class="nx-command-empty">Type keywords to run hybrid semantic search.</div>';
      return;
    }
    list.innerHTML = '<div class="nx-command-empty">Searching hybrid index...</div>';
    try {
      const headers = {};
      if (typeof getAuthToken === 'function') {
        const tok = await getAuthToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
      }
      const res = await fetch(`/api/rag/search?q=${encodeURIComponent(q)}&topK=5`, { headers });
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      list.replaceChildren();
      if (!results.length) {
        list.innerHTML = '<div class="nx-command-empty">No matching documents found.</div>';
        return;
      }
      results.forEach((r, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nx-command-item' + (idx === 0 ? ' is-active' : '');
        const left = document.createElement('div');
        left.style.display = 'grid';
        left.style.gap = '2px';
        const t = document.createElement('strong');
        t.textContent = r.title;
        const snip = document.createElement('small');
        snip.style.opacity = '0.78';
        snip.textContent = r.snippet;
        left.append(t, snip);
        const badge = document.createElement('span');
        badge.textContent = r.source;
        btn.append(left, badge);
        btn.addEventListener('click', () => {
          close();
          if (r.url && r.url.startsWith('#')) {
            document.querySelector(r.url)?.scrollIntoView({ behavior: 'smooth' });
          } else if (r.url) {
            window.location.href = r.url;
          }
        });
        list.appendChild(btn);
      });
    } catch {
      list.innerHTML = '<div class="nx-command-empty">Search temporarily unavailable.</div>';
    }
  }

  async function runRagAsk(queryText) {
    if (!aiAnswer || !citationsBox) return;
    const q = String(queryText || '').trim();
    if (!q) return;

    aiAnswer.textContent = 'Retrieving grounded context...';
    citationsBox.replaceChildren();

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof getAuthToken === 'function') {
        const tok = await getAuthToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
      }
      const res = await fetch('/api/rag/query', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: q, stream: true }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        aiAnswer.textContent = err?.error || 'Could not answer that right now.';
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let textOut = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data:')) continue;
          const payload = JSON.parse(line.slice(5).trim());
          if (payload.type === 'delta') {
            textOut += payload.text;
            aiAnswer.textContent = textOut;
          } else if (payload.type === 'done') {
            renderCitations(payload.citations || []);
          }
        }
      }
    } catch {
      aiAnswer.textContent = 'Unable to stream response right now.';
    }
  }

  function renderCitations(citations) {
    if (!citationsBox) return;
    citationsBox.replaceChildren();
    if (!citations.length) return;
    for (const c of citations) {
      const card = document.createElement('div');
      card.className = 'nx-cmd-citation';
      const title = document.createElement('strong');
      title.textContent = `[${c.id}] ${c.title}`;
      const snip = document.createElement('p');
      snip.textContent = c.snippet;
      card.append(title, snip);
      citationsBox.appendChild(card);
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const nextMode = tab.getAttribute('data-cmd-tab');
      if (nextMode) setMode(nextMode);
    });
  });

  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (mode === 'jump') {
      filtered = targets.filter((t) => `${t.label} ${t.hint || ''}`.toLowerCase().includes(q));
      activeIndex = 0;
      renderJumpList();
    } else if (mode === 'search') {
      void runSemanticSearch(q);
    }
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (mode === 'ask') {
      void runRagAsk(input?.value || '');
    } else if (mode === 'jump' && filtered[activeIndex]) {
      selectTarget(filtered[activeIndex]);
    }
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (mode === 'jump') {
      const count = Math.max(1, filtered.length);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % count;
        renderJumpList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + count) % count;
        renderJumpList();
      }
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (overlay.classList.contains('is-open')) close();
      else open('jump');
    } else if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !overlay.classList.contains('is-open')) {
      e.preventDefault();
      open('jump');
    }
  });

  document.querySelectorAll('[data-open-rag-assistant]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.getAttribute('data-open-rag-assistant') || 'ask';
      open(m);
    });
  });

  return { open, close };
}
