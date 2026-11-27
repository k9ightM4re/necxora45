import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Cpu,
  FileText,
  GitBranch,
  Pause,
  Play,
  RefreshCw,
  Send,
  UserPlus,
  Zap,
} from 'lucide-react';
import {
  AGENT_ROSTER,
  SCENARIOS,
  WORKFLOW_STEPS,
  createInitialSceneState,
  liveSceneReducer,
  type AgentId,
  type AgentMeta,
} from './engine.ts';

const GRAPH_POSITIONS: Record<AgentId, { x: number; y: number }> = {
  atlas: { x: 64, y: 54 },
  nova: { x: 216, y: 54 },
  iris: { x: 216, y: 162 },
  orion: { x: 64, y: 162 },
};

const GRAPH_EDGES: Array<{ from: AgentId; to: AgentId; d: string }> = [
  { from: 'atlas', to: 'nova', d: 'M 64 54 Q 140 30 216 54' },
  { from: 'nova', to: 'iris', d: 'M 216 54 Q 242 108 216 162' },
  { from: 'iris', to: 'orion', d: 'M 216 162 Q 140 186 64 162' },
  { from: 'atlas', to: 'orion', d: 'M 64 54 Q 38 108 64 162' },
  { from: 'orion', to: 'nova', d: 'M 64 162 Q 140 108 216 54' },
  { from: 'nova', to: 'atlas', d: 'M 216 54 Q 140 76 64 54' },
  { from: 'iris', to: 'atlas', d: 'M 216 162 Q 130 112 64 54' },
];

const CUBIC_EASE = [0.22, 1, 0.36, 1] as const;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

export interface LiveTeamSceneProps {
  composerInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function LiveTeamScene({ composerInputRef }: LiveTeamSceneProps) {
  const [state, dispatch] = useReducer(liveSceneReducer, undefined, createInitialSceneState);
  const [draft, setDraft] = useState('');
  const [mobileTab, setMobileTab] = useState<'roster' | 'channel' | 'graph'>('channel');
  const [liveModeNote, setLiveModeNote] = useState<string>('');
  const [isLoadingLiveAi, setIsLoadingLiveAi] = useState(false);

  const reducedMotion = usePrefersReducedMotion();
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const inputElRef = composerInputRef || internalInputRef;
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  // Listen for custom global focus events from CTA buttons ("Try the live scene")
  useEffect(() => {
    const onFocusScene = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      setMobileTab('channel');
      if (detail?.presetPrompt) {
        dispatch({ type: 'START_RUN', prompt: String(detail.presetPrompt) });
      }
      setTimeout(() => {
        inputElRef.current?.focus({ preventScroll: true });
      }, 80);
    };
    window.addEventListener('nexora:focus-live-scene', onFocusScene);
    return () => window.removeEventListener('nexora:focus-live-scene', onFocusScene);
  }, [inputElRef]);

  // Esc key closes open agent popover or clears node focus filter
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (state.hoveredAgentId) dispatch({ type: 'SET_HOVER_AGENT', agentId: null });
        else if (state.focusedAgentId) dispatch({ type: 'SELECT_NODE', agentId: null });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.hoveredAgentId, state.focusedAgentId]);

  // Deterministic rAF timeline scheduler
  useEffect(() => {
    if (reducedMotion || !state.isPlaying || state.isPaused) return;
    let frameId = 0;
    let lastTs = performance.now();
    let virtualElapsed = state.elapsedMs;

    const tick = (now: number) => {
      const dt = Math.min(80, Math.max(0, now - lastTs));
      lastTs = now;
      virtualElapsed += dt * state.speed;
      dispatch({ type: 'TICK_TO', elapsedMs: virtualElapsed });
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [reducedMotion, state.isPlaying, state.isPaused, state.speed, state.runId]);

  // Auto-scroll #launch feed cleanly
  useEffect(() => {
    const box = messagesScrollRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [state.messages.length, state.typingAgentId, state.pendingApproval]);

  async function triggerTaskRun(taskText: string) {
    const prompt = String(taskText || '').trim();
    if (!prompt) return;
    setMobileTab('channel');
    setLiveModeNote('');

    if (state.liveAiMode) {
      setIsLoadingLiveAi(true);
      try {
        const res = await fetch('/api/live-scene/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: prompt }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.ok && data?.steps) {
          dispatch({ type: 'START_RUN', prompt, liveAiSteps: data.steps });
          setLiveModeNote('AI-generated agent steps streamed from Nexora server.');
          setIsLoadingLiveAi(false);
          return;
        }
        setLiveModeNote(data?.error || 'Live mode unavailable — running deterministic simulation.');
      } catch {
        setLiveModeNote('Network error contacting Live AI — running deterministic simulation.');
      }
      setIsLoadingLiveAi(false);
    }

    dispatch({ type: 'START_RUN', prompt });
    if (reducedMotion) {
      // In reduced-motion mode, advance to step 1 immediately so the first result is visible
      dispatch({ type: 'SEEK_EVENT_INDEX', index: 2 });
    }
  }

  function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    setDraft('');
    void triggerTaskRun(clean);
  }

  const visibleMessages = useMemo(() => {
    if (!state.focusedAgentId) return state.messages;
    return state.messages.filter(
      (m) => m.authorId === state.focusedAgentId || m.authorId === 'user' || m.authorId === 'system'
    );
  }, [state.messages, state.focusedAgentId]);

  const activeEdgeObj = useMemo(() => {
    if (!state.activeHandoff) return null;
    const found = GRAPH_EDGES.find(
      (e) => e.from === state.activeHandoff!.from && e.to === state.activeHandoff!.to
    );
    if (found) return found;
    const p1 = GRAPH_POSITIONS[state.activeHandoff.from];
    const p2 = GRAPH_POSITIONS[state.activeHandoff.to];
    return {
      from: state.activeHandoff.from,
      to: state.activeHandoff.to,
      d: `M ${p1.x} ${p1.y} Q 140 108 ${p2.x} ${p2.y}`,
    };
  }, [state.activeHandoff]);

  const activeRosterMap = useMemo(() => {
    const map = new Map<AgentId, AgentMeta>();
    for (const a of AGENT_ROSTER) map.set(a.id, a);
    return map;
  }, []);

  const typingMeta = state.typingAgentId ? activeRosterMap.get(state.typingAgentId) : null;
  const focusedMeta = state.focusedAgentId ? activeRosterMap.get(state.focusedAgentId) : null;

  return (
    <div
      className={[
        'ls-window',
        state.isPlaying && !state.isPaused ? 'is-running' : '',
        state.completionGlowBurst ? 'is-complete-burst' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="live-team-scene"
    >
      {/* Faux Window Title Bar */}
      <div className="ls-titlebar">
        <div className="ls-title-left">
          <div className="ls-window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span className="ls-window-title">Nexora Workspace</span>
          <span className="ls-channel-tag">#launch</span>
        </div>

        <div className="ls-toolbar" role="toolbar" aria-label="Workspace simulation controls">
          {!reducedMotion && state.runId > 0 && (
            <>
              <button
                type="button"
                className="ls-ctrl-btn"
                onClick={() => dispatch({ type: state.isPaused ? 'RESUME' : 'PAUSE' })}
                aria-label={state.isPaused ? 'Resume simulation' : 'Pause simulation'}
              >
                {state.isPaused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
                <span>{state.isPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                type="button"
                className="ls-ctrl-btn"
                onClick={() => dispatch({ type: 'SET_SPEED', speed: state.speed === 1 ? 2 : 1 })}
                aria-label={`Playback speed ${state.speed}x`}
              >
                <Zap size={13} aria-hidden="true" />
                <span className="mono">{state.speed}x</span>
              </button>
            </>
          )}

          {state.runId > 0 && (
            <button
              type="button"
              className="ls-ctrl-btn"
              onClick={() => {
                dispatch({ type: 'REPLAY' });
                if (reducedMotion) dispatch({ type: 'SEEK_EVENT_INDEX', index: 2 });
              }}
              aria-label="Replay current run"
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span>Replay</span>
            </button>
          )}

          <button
            type="button"
            className={`ls-ctrl-btn ${state.teammatesInvited ? 'is-active' : ''}`}
            onClick={() => dispatch({ type: 'INVITE_TEAMMATES' })}
            aria-pressed={state.teammatesInvited}
          >
            <UserPlus size={13} aria-hidden="true" />
            <span>{state.teammatesInvited ? '2 Teammates Live' : 'Invite teammate'}</span>
          </button>

          <button
            type="button"
            className={`ls-ctrl-btn ${state.liveAiMode ? 'is-active' : ''}`}
            onClick={() => dispatch({ type: 'SET_LIVE_AI_MODE', enabled: !state.liveAiMode })}
            aria-pressed={state.liveAiMode}
            title="Optional server-side AI mode (simulation runs free by default)"
          >
            <Cpu size={13} aria-hidden="true" />
            <span>{state.liveAiMode ? 'Live AI' : 'Simulation'}</span>
          </button>
        </div>
      </div>

      {/* Reduced-Motion Step-by-Step Controller */}
      {reducedMotion && state.runId > 0 && (
        <div className="ls-reduced-bar" role="region" aria-label="Step-by-step simulation controls">
          <span className="ls-reduced-label">
            Reduced motion view · Event {state.appliedEventCount} of {state.timeline.length}
          </span>
          <div className="ls-reduced-actions">
            <button
              type="button"
              className="ls-ctrl-btn"
              disabled={state.appliedEventCount <= 1}
              onClick={() => dispatch({ type: 'SEEK_EVENT_INDEX', index: Math.max(1, state.appliedEventCount - 2) })}
            >
              Back
            </button>
            <button
              type="button"
              className="ls-ctrl-btn"
              disabled={state.appliedEventCount >= state.timeline.length}
              onClick={() =>
                dispatch({ type: 'SEEK_EVENT_INDEX', index: Math.min(state.timeline.length, state.appliedEventCount + 2) })
              }
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Mobile Stacked Tab Switcher (< 768px) */}
      <div className="ls-mobile-tabs" role="tablist" aria-label="Workspace panes">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'roster'}
          className={`ls-mobile-tab ${mobileTab === 'roster' ? 'is-active' : ''}`}
          onClick={() => setMobileTab('roster')}
        >
          Agents (4)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'channel'}
          className={`ls-mobile-tab ${mobileTab === 'channel' ? 'is-active' : ''}`}
          onClick={() => setMobileTab('channel')}
        >
          #launch
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'graph'}
          className={`ls-mobile-tab ${mobileTab === 'graph' ? 'is-active' : ''}`}
          onClick={() => setMobileTab('graph')}
        >
          Handoff Graph
        </button>
      </div>

      {/* 3-Column Desktop / 2-Column Tablet / Tabbed Mobile Grid */}
      <div className="ls-columns" style={{ position: 'relative' }}>
        {/* Simulated Multiplayer Teammate Cursors */}
        {state.teammatesInvited &&
          !reducedMotion &&
          state.teammateCursors.map((cursor) => (
            <motion.div
              key={cursor.id}
              className="ls-cursor"
              aria-hidden="true"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{
                opacity: 1,
                scale: 1,
                left: [`${cursor.xPct}%`, `${cursor.xPct + 4}%`, `${cursor.xPct - 2}%`],
                top: [`${cursor.yPct}%`, `${cursor.yPct - 4}%`, `${cursor.yPct + 2}%`],
              }}
              transition={{ duration: 5, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
              style={{ color: cursor.color }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 1l11 6.5-4.7 1.4-2.1 4.6L2 1z" />
              </svg>
              <span className="ls-cursor-tag" style={{ backgroundColor: cursor.color }}>
                {cursor.name}
              </span>
            </motion.div>
          ))}

        {/* LEFT COLUMN: Agent Roster */}
        <aside className={`ls-pane ls-roster-pane ${mobileTab === 'roster' ? 'is-mob-open' : ''}`} aria-label="Agent roster">
          <div className="ls-pane-head">
            <span>Team Roster</span>
            <span className="ls-pane-meta">4 active roles</span>
          </div>

          <div className="ls-roster-list">
            {AGENT_ROSTER.map((meta) => {
              const runtime = state.agents[meta.id];
              const isPopoverOpen = state.hoveredAgentId === meta.id;
              const isFocused = state.focusedAgentId === meta.id;

              return (
                <div
                  key={meta.id}
                  className={`ls-agent-card ${isFocused ? 'is-focused' : ''}`}
                  onMouseEnter={() => dispatch({ type: 'SET_HOVER_AGENT', agentId: meta.id })}
                  onMouseLeave={() => {
                    if (state.hoveredAgentId === meta.id) dispatch({ type: 'SET_HOVER_AGENT', agentId: null });
                  }}
                >
                  <div className="ls-agent-top">
                    <div className="ls-agent-identity">
                      <div
                        className={`ls-avatar-ring status-${runtime.status}`}
                        style={{ '--agent-accent': meta.accentColor } as React.CSSProperties}
                      >
                        <span className="ls-avatar-core">{meta.initials}</span>
                      </div>
                      <div className="ls-agent-titles">
                        <div className="ls-agent-name-row">
                          <strong>{meta.name}</strong>
                          <span className="ls-agent-role">{meta.role}</span>
                        </div>
                        <div className="ls-agent-status-text">
                          Status: <span>{runtime.status}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="ls-info-trigger"
                      aria-label={`Inspect ${meta.name} instructions and files`}
                      aria-expanded={isPopoverOpen}
                      onFocus={() => dispatch({ type: 'SET_HOVER_AGENT', agentId: meta.id })}
                      onClick={() =>
                        dispatch({
                          type: 'SET_HOVER_AGENT',
                          agentId: isPopoverOpen ? null : meta.id,
                        })
                      }
                    >
                      ?
                    </button>
                  </div>

                  <div className="ls-agent-badges">
                    <span className="ls-chip ls-chip-model" data-testid={`model-badge-${meta.id}`}>
                      {runtime.model}
                    </span>
                    <span className="ls-chip ls-chip-memory" data-testid={`memory-chip-${meta.id}`}>
                      {runtime.memoryLabel}
                    </span>
                    <button
                      type="button"
                      className="ls-swap-btn"
                      data-testid={`swap-model-${meta.id}`}
                      onClick={() => dispatch({ type: 'SWAP_MODEL', agentId: meta.id })}
                    >
                      Swap model
                    </button>
                  </div>

                  {/* Agent Detail Popover */}
                  {isPopoverOpen && (
                    <div className="ls-agent-popover" role="dialog" aria-label={`${meta.name} details`}>
                      <div className="ls-popover-head">
                        <strong>
                          {meta.name} · {meta.role}
                        </strong>
                        <button
                          type="button"
                          className="ls-popover-close"
                          aria-label="Close details"
                          onClick={() => dispatch({ type: 'SET_HOVER_AGENT', agentId: null })}
                        >
                          ×
                        </button>
                      </div>
                      <p className="ls-popover-desc">{meta.instructions}</p>
                      <div className="ls-popover-files">
                        <span className="ls-popover-label">Workspace files:</span>
                        <div className="ls-popover-file-row">
                          {meta.workspaceFiles.map((f) => (
                            <span key={f} className="ls-file-chip">
                              <FileText size={11} aria-hidden="true" />
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* CENTER COLUMN: #launch Channel */}
        <section
          className={`ls-pane ls-channel-pane ${mobileTab === 'channel' ? 'is-mob-open' : ''}`}
          aria-label="Launch channel conversation"
        >
          <div className="ls-pane-head">
            <div className="ls-channel-head-left">
              <strong>#launch</strong>
              <span className="ls-pane-meta">Structured handoffs and human approvals</span>
            </div>
            {focusedMeta && (
              <button
                type="button"
                className="ls-filter-reset"
                onClick={() => dispatch({ type: 'SELECT_NODE', agentId: null })}
              >
                Focused: {focusedMeta.name} ×
              </button>
            )}
          </div>

          {liveModeNote && (
            <div className="ls-live-banner" role="status">
              {liveModeNote}
            </div>
          )}

          {/* Active Moving Task Card */}
          {state.activeTaskCard && (
            <motion.div
              layout={!reducedMotion}
              className="ls-floating-task-card"
              whileHover={reducedMotion ? undefined : { rotateX: -2, rotateY: 2, y: -2 }}
              transition={{ duration: 0.25, ease: CUBIC_EASE }}
            >
              <div className="ls-task-card-meta">
                <span>Active Task</span>
                <span>Stage: {state.activeTaskCard.stage}</span>
              </div>
              <div className="ls-task-card-row">
                <strong>{state.activeTaskCard.title}</strong>
                <span className="ls-owner-tag">
                  Owner: {activeRosterMap.get(state.activeTaskCard.owner)?.name || 'Team'}
                </span>
              </div>
            </motion.div>
          )}

          {/* Channel Message Feed (aria-live="polite") */}
          <div
            className="ls-messages"
            ref={messagesScrollRef}
            aria-live="polite"
            aria-relevant="additions text"
            data-testid="live-scene-feed"
          >
            <AnimatePresence initial={false}>
              {visibleMessages.map((msg) => {
                const isAgent = msg.authorId in GRAPH_POSITIONS;
                const agentMeta = isAgent ? activeRosterMap.get(msg.authorId as AgentId) : null;
                return (
                  <motion.article
                    key={msg.id}
                    initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28, ease: CUBIC_EASE }}
                    className={`ls-msg ls-msg-${msg.kind} ${
                      state.focusedAgentId === msg.authorId ? 'is-highlighted' : ''
                    }`}
                  >
                    <div
                      className="ls-msg-avatar"
                      style={agentMeta ? { borderColor: agentMeta.accentColor } : undefined}
                    >
                      {agentMeta ? agentMeta.initials : msg.authorName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="ls-msg-body">
                      <div className="ls-msg-meta">
                        <strong>{msg.authorName}</strong>
                        <span>{msg.authorRole}</span>
                        <span>·</span>
                        <span className="mono">{msg.tsLabel}</span>
                        {msg.aiGenerated && <span className="ls-ai-badge">AI-generated</span>}
                      </div>
                      <p className="ls-msg-text">{msg.text}</p>
                      {msg.fileChip && (
                        <div className="ls-inline-file">
                          <FileText size={13} aria-hidden="true" />
                          <span className="mono">{msg.fileChip}</span>
                          {msg.fileMeta && <span className="ls-file-sub">{msg.fileMeta}</span>}
                        </div>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>

            {/* Typing indicator */}
            {typingMeta && (
              <div className="ls-typing-row" aria-label={`${typingMeta.name} is working`}>
                <span className="ls-typing-name">{typingMeta.name}</span>
                <span>is working</span>
                <span className="ls-typing-dots" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                </span>
              </div>
            )}

            {/* Approval Card */}
            {state.pendingApproval && (
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: CUBIC_EASE }}
                className="ls-approval-card"
                data-testid="approval-card"
              >
                <div className="ls-approval-head">
                  <strong>{state.pendingApproval.title}</strong>
                  <span className="ls-approval-tag">Human sign-off required</span>
                </div>
                <p>{state.pendingApproval.detail}</p>
                <div className="ls-approval-actions">
                  <button
                    type="button"
                    className="ls-btn-approve"
                    data-testid="approve-run-btn"
                    onClick={() => dispatch({ type: 'APPROVE_RUN' })}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ls-btn-reject"
                    data-testid="reject-run-btn"
                    onClick={() => dispatch({ type: 'REJECT_RUN' })}
                  >
                    Reject
                  </button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Bottom Composer + 3 Presets */}
          <div className="ls-composer-wrap">
            <div className="ls-presets" role="group" aria-label="Task presets">
              {SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  className={`ls-preset-chip ${state.scenarioId === sc.id && state.runId > 0 ? 'is-selected' : ''}`}
                  data-testid={`preset-${sc.id}`}
                  onClick={() => void triggerTaskRun(sc.defaultPrompt)}
                >
                  {sc.label}
                </button>
              ))}
            </div>

            <form className="ls-composer-form" onSubmit={handleComposerSubmit}>
              <input
                ref={inputElRef}
                id="live-scene-composer-input"
                type="text"
                className="ls-composer-input"
                placeholder="Describe a task for Atlas, Nova, Iris, and Orion..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Describe a task for the agent team"
                maxLength={220}
              />
              <button
                type="submit"
                className="ls-composer-send"
                disabled={isLoadingLiveAi || !draft.trim()}
              >
                <Send size={14} aria-hidden="true" />
                <span>{isLoadingLiveAi ? 'Running...' : 'Run'}</span>
              </button>
            </form>
          </div>
        </section>

        {/* RIGHT COLUMN: Handoff Graph & Workflow Strip */}
        <aside
          className={`ls-pane ls-graph-pane ${mobileTab === 'graph' ? 'is-mob-open' : ''}`}
          aria-label="Agent handoff graph and workflow progress"
        >
          <div className="ls-pane-head">
            <span>Handoff Graph</span>
            <span className="ls-pane-meta">Click node to focus</span>
          </div>

          <div className="ls-graph-box">
            <svg viewBox="0 0 280 216" className="ls-graph-svg" role="img" aria-label="Agent collaboration network">
              <defs>
                <filter id="ls-packet-glow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Base connecting paths */}
              {GRAPH_EDGES.map((edge) => {
                const isActive =
                  activeEdgeObj && activeEdgeObj.from === edge.from && activeEdgeObj.to === edge.to;
                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={edge.d}
                    fill="none"
                    stroke={isActive ? 'var(--primary)' : 'var(--border-strong)'}
                    strokeWidth={isActive ? 2.2 : 1.2}
                    strokeOpacity={isActive ? 0.95 : 0.35}
                    strokeDasharray={isActive ? '5 4' : undefined}
                  />
                );
              })}

              {/* Animated SVG path offset packet on active handoff */}
              {activeEdgeObj && !reducedMotion && (
                <motion.path
                  key={state.activeHandoff?.id}
                  d={activeEdgeObj.d}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeDasharray="16 260"
                  initial={{ strokeDashoffset: 240 }}
                  animate={{ strokeDashoffset: 0 }}
                  transition={{ duration: 0.78, ease: CUBIC_EASE }}
                  filter="url(#ls-packet-glow)"
                />
              )}

              {/* Graph Agent Nodes */}
              {AGENT_ROSTER.map((meta) => {
                const pos = GRAPH_POSITIONS[meta.id];
                const runtime = state.agents[meta.id];
                const isPulsing = state.pulsingNodeId === meta.id && !reducedMotion;
                const isFocused = state.focusedAgentId === meta.id;

                return (
                  <g
                    key={meta.id}
                    className="ls-graph-node"
                    transform={`translate(${pos.x}, ${pos.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Filter channel messages by ${meta.name}`}
                    aria-pressed={isFocused}
                    onClick={() => {
                      dispatch({ type: 'SELECT_NODE', agentId: meta.id });
                      setMobileTab('channel');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        dispatch({ type: 'SELECT_NODE', agentId: meta.id });
                      }
                    }}
                  >
                    {isPulsing && (
                      <motion.circle
                        r={24}
                        fill="none"
                        stroke={meta.accentColor}
                        strokeWidth={2}
                        initial={{ r: 22, opacity: 0.85 }}
                        animate={{ r: 34, opacity: 0 }}
                        transition={{ duration: 0.85, repeat: Infinity }}
                      />
                    )}
                    <circle
                      r={22}
                      fill="var(--surface)"
                      stroke={isFocused || runtime.status !== 'idle' ? meta.accentColor : 'var(--border-strong)'}
                      strokeWidth={isFocused ? 2.6 : 1.6}
                    />
                    <text
                      y={-1}
                      textAnchor="middle"
                      fill="var(--text)"
                      fontSize="10.5"
                      fontWeight="700"
                      fontFamily="var(--font-display)"
                    >
                      {meta.name}
                    </text>
                    <text
                      y={11}
                      textAnchor="middle"
                      fill="var(--muted)"
                      fontSize="8"
                      fontFamily="var(--font-mono)"
                    >
                      {runtime.model}
                    </text>
                  </g>
                );
              })}
            </svg>

            {state.activeHandoff && (
              <div className="ls-handoff-caption" role="status">
                <GitBranch size={12} aria-hidden="true" />
                <span>
                  {activeRosterMap.get(state.activeHandoff.from)?.name} →{' '}
                  {activeRosterMap.get(state.activeHandoff.to)?.name}: {state.activeHandoff.label}
                </span>
              </div>
            )}
          </div>

          {/* Workflow Strip */}
          <div className="ls-workflow-wrap" aria-label="Workflow stages">
            <div className="ls-workflow-title">Workflow</div>
            <ol className="ls-workflow-strip">
              {WORKFLOW_STEPS.map((step) => {
                const st = state.workflow[step.id];
                return (
                  <li key={step.id} className={`ls-wf-step is-${st}`} data-testid={`wf-step-${step.id}`}>
                    <span className="ls-wf-dot" aria-hidden="true">
                      {st === 'done' ? <Check size={11} /> : null}
                    </span>
                    <span className="ls-wf-label">{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
