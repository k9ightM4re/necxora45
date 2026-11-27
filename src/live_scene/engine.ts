export type AgentId = 'atlas' | 'nova' | 'iris' | 'orion';
export type ModelTier = 'Model A' | 'Model B';
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting';
export type WorkflowStepId = 'trigger' | 'atlas' | 'nova' | 'iris' | 'approval';
export type WorkflowStepState = 'pending' | 'active' | 'done' | 'rejected';

export interface AgentMeta {
  id: AgentId;
  name: string;
  role: string;
  defaultModel: ModelTier;
  accentColor: string;
  initials: string;
  instructions: string;
  workspaceFiles: string[];
}

export interface AgentRuntimeState {
  id: AgentId;
  status: AgentStatus;
  model: ModelTier;
  memoryLabel: string;
  memoryVersion: number;
}

export interface SceneMessage {
  id: string;
  authorId: AgentId | 'system' | 'user' | 'maya' | 'liam';
  authorName: string;
  authorRole: string;
  kind: 'message' | 'system' | 'file' | 'task' | 'approval' | 'summary' | 'teammate';
  text: string;
  fileChip?: string;
  fileMeta?: string;
  taskCard?: {
    id: string;
    title: string;
    owner: AgentId;
    stage: string;
  };
  aiGenerated?: boolean;
  tsLabel: string;
  mentions?: string[];
}

export interface ActiveHandoffEdge {
  id: string;
  from: AgentId;
  to: AgentId;
  label: string;
  startedAtMs: number;
}

export interface TeammateCursor {
  id: 'maya' | 'liam';
  name: string;
  role: string;
  color: string;
  xPct: number;
  yPct: number;
  note: string;
}

export interface ScenarioTimelineEvent {
  t: number;
  type: 'status' | 'message' | 'handoff' | 'file' | 'approval' | 'swap' | 'summary';
  from?: AgentId | 'trigger' | 'user';
  to?: AgentId | 'approval' | 'channel';
  payload: Record<string, any>;
}

export interface ScenarioTemplate {
  id: 'launch-plan' | 'fix-bug' | 'weekly-report';
  label: string;
  defaultPrompt: string;
  keywords: string[];
  descriptor: string;
  events: ScenarioTimelineEvent[];
}

export const AGENT_ROSTER: AgentMeta[] = [
  {
    id: 'atlas',
    name: 'Atlas',
    role: 'Planner',
    defaultModel: 'Model A',
    accentColor: '#4777DF',
    initials: 'AT',
    instructions: 'Decompose goals into crisp milestones, assign owners, and track dependencies.',
    workspaceFiles: ['launch-brief.md', 'milestones.json'],
  },
  {
    id: 'nova',
    name: 'Nova',
    role: 'Builder',
    defaultModel: 'Model A',
    accentColor: '#C49A52',
    initials: 'NV',
    instructions: 'Draft deliverables, assemble patches, and attach reproducible workspace files.',
    workspaceFiles: ['implementation.ts', 'release-notes.md'],
  },
  {
    id: 'iris',
    name: 'Iris',
    role: 'Reviewer',
    defaultModel: 'Model B',
    accentColor: '#6D95EB',
    initials: 'IR',
    instructions: 'Verify edge cases, WCAG AA legibility, and approval readiness.',
    workspaceFiles: ['qa-checklist.md', 'security-pass.txt'],
  },
  {
    id: 'orion',
    name: 'Orion',
    role: 'Analyst',
    defaultModel: 'Model A',
    accentColor: '#34D399',
    initials: 'OR',
    instructions: 'Quantify KPI impact, latency targets, and post-run summaries.',
    workspaceFiles: ['metrics-weekly.csv', 'cohort-delta.json'],
  },
];

export const WORKFLOW_STEPS: { id: WorkflowStepId; label: string }[] = [
  { id: 'trigger', label: 'Trigger' },
  { id: 'atlas', label: 'Atlas' },
  { id: 'nova', label: 'Nova' },
  { id: 'iris', label: 'Iris' },
  { id: 'approval', label: 'Approval' },
];

export const SCENARIOS: ScenarioTemplate[] = [
  {
    id: 'launch-plan',
    label: 'Launch plan',
    defaultPrompt: 'Prepare launch checklist and rollout assets for Nexora v2.4',
    keywords: ['launch', 'plan', 'release', 'rollout', 'campaign', 'checklist', 'announce', 'go-live', 'product'],
    descriptor: 'product launch plan release schedule checklist marketing milestones rollout',
    events: [
      {
        t: 0,
        type: 'status',
        to: 'atlas',
        payload: { status: 'thinking', workflowStep: 'atlas' },
      },
      {
        t: 450,
        type: 'message',
        from: 'atlas',
        to: 'channel',
        payload: {
          text: 'Scoped "{{topic}}" into three milestones: spec alignment, asset build, and sign-off gate.',
          taskCard: { id: 'task-1', title: 'Scope: {{topic}}', owner: 'atlas', stage: 'Planning' },
        },
      },
      {
        t: 1100,
        type: 'handoff',
        from: 'atlas',
        to: 'nova',
        payload: { label: 'Build pack', nextStatus: 'working', workflowStep: 'nova' },
      },
      {
        t: 1450,
        type: 'status',
        from: 'atlas',
        to: 'atlas',
        payload: { status: 'idle' },
      },
      {
        t: 2100,
        type: 'file',
        from: 'nova',
        to: 'channel',
        payload: {
          text: 'Drafted rollout sequence and owner matrix for "{{topic}}". Ready for review.',
          fileChip: 'launch-checklist.md',
          fileMeta: '4.2 KB · Spec',
          taskCard: { id: 'task-1', title: 'Draft: {{topic}}', owner: 'nova', stage: 'Built' },
        },
      },
      {
        t: 2700,
        type: 'handoff',
        from: 'nova',
        to: 'iris',
        payload: { label: 'QA verify', nextStatus: 'thinking', workflowStep: 'iris' },
      },
      {
        t: 3000,
        type: 'status',
        to: 'nova',
        payload: { status: 'idle' },
      },
      {
        t: 3500,
        type: 'handoff',
        from: 'iris',
        to: 'orion',
        payload: { label: 'Check targets', nextStatus: 'working' },
      },
      {
        t: 4100,
        type: 'message',
        from: 'orion',
        to: 'channel',
        payload: {
          text: 'Baseline readiness is green across staging cohorts; rollback timer verified at < 30s.',
          fileChip: 'readiness-metrics.csv',
          fileMeta: '1.8 KB · Telemetry',
        },
      },
      {
        t: 4650,
        type: 'status',
        to: 'orion',
        payload: { status: 'idle' },
      },
      {
        t: 4950,
        type: 'approval',
        from: 'iris',
        to: 'approval',
        payload: {
          title: 'Approve "{{topic}}" rollout',
          detail: 'All milestones drafted, metrics attached, and checklist verified. Confirm to publish.',
          workflowStep: 'approval',
        },
      },
    ],
  },
  {
    id: 'fix-bug',
    label: 'Fix a bug',
    defaultPrompt: 'Trace and patch intermittent webhook retry race in sync worker',
    keywords: ['bug', 'fix', 'error', 'patch', 'crash', 'issue', 'race', 'debug', 'webhook', 'latency', 'broken'],
    descriptor: 'debug trace patch bug fix regression test error handling race condition',
    events: [
      {
        t: 0,
        type: 'status',
        to: 'atlas',
        payload: { status: 'thinking', workflowStep: 'atlas' },
      },
      {
        t: 450,
        type: 'message',
        from: 'atlas',
        to: 'channel',
        payload: {
          text: 'Isolated root-cause area for "{{topic}}" — assigning patch implementation and regression check.',
          taskCard: { id: 'task-bug', title: 'Triage: {{topic}}', owner: 'atlas', stage: 'Triaged' },
        },
      },
      {
        t: 1100,
        type: 'handoff',
        from: 'atlas',
        to: 'nova',
        payload: { label: 'Apply patch', nextStatus: 'working', workflowStep: 'nova' },
      },
      {
        t: 1400,
        type: 'status',
        to: 'atlas',
        payload: { status: 'idle' },
      },
      {
        t: 2150,
        type: 'file',
        from: 'nova',
        to: 'channel',
        payload: {
          text: 'Applied idempotency guard and deterministic backoff test for "{{topic}}".',
          fileChip: 'fix-worker.patch',
          fileMeta: '+48 / -12 lines',
          taskCard: { id: 'task-bug', title: 'Patch: {{topic}}', owner: 'nova', stage: 'Patched' },
        },
      },
      {
        t: 2800,
        type: 'handoff',
        from: 'nova',
        to: 'iris',
        payload: { label: 'Security audit', nextStatus: 'working', workflowStep: 'iris' },
      },
      {
        t: 3050,
        type: 'status',
        to: 'nova',
        payload: { status: 'idle' },
      },
      {
        t: 3700,
        type: 'message',
        from: 'iris',
        to: 'channel',
        payload: {
          text: 'Verified edge cases and replay safety. Zero regressions across 18 assertions.',
          fileChip: 'regression-report.txt',
          fileMeta: '18/18 passed',
        },
      },
      {
        t: 4400,
        type: 'approval',
        from: 'iris',
        to: 'approval',
        payload: {
          title: 'Approve hotfix merge for "{{topic}}"',
          detail: 'Patch diff and regression log attached. Ready for human merge confirmation.',
          workflowStep: 'approval',
        },
      },
    ],
  },
  {
    id: 'weekly-report',
    label: 'Weekly report',
    defaultPrompt: 'Compile weekly community growth and workspace latency summary',
    keywords: ['weekly', 'report', 'metrics', 'summary', 'analytics', 'kpi', 'growth', 'digest', 'dashboard', 'stats'],
    descriptor: 'weekly analytics report kpi metrics cohort growth latency summary digest',
    events: [
      {
        t: 0,
        type: 'status',
        to: 'atlas',
        payload: { status: 'thinking', workflowStep: 'atlas' },
      },
      {
        t: 450,
        type: 'message',
        from: 'atlas',
        to: 'channel',
        payload: {
          text: 'Organizing data collection sections for "{{topic}}" across engagement and reliability metrics.',
          taskCard: { id: 'task-rep', title: 'Outline: {{topic}}', owner: 'atlas', stage: 'Structured' },
        },
      },
      {
        t: 1100,
        type: 'handoff',
        from: 'atlas',
        to: 'orion',
        payload: { label: 'Query telemetry', nextStatus: 'working', workflowStep: 'nova' },
      },
      {
        t: 1400,
        type: 'status',
        to: 'atlas',
        payload: { status: 'idle' },
      },
      {
        t: 2100,
        type: 'file',
        from: 'orion',
        to: 'channel',
        payload: {
          text: 'Compiled 7-day deltas for "{{topic}}": active threads +18%, median response 142ms.',
          fileChip: 'weekly-kpis.csv',
          fileMeta: '3.1 KB · Data',
          taskCard: { id: 'task-rep', title: 'Metrics: {{topic}}', owner: 'nova', stage: 'Compiled' },
        },
      },
      {
        t: 2700,
        type: 'handoff',
        from: 'orion',
        to: 'nova',
        payload: { label: 'Format brief', nextStatus: 'working' },
      },
      {
        t: 3000,
        type: 'status',
        to: 'orion',
        payload: { status: 'idle' },
      },
      {
        t: 3500,
        type: 'handoff',
        from: 'nova',
        to: 'iris',
        payload: { label: 'Verify numbers', nextStatus: 'thinking', workflowStep: 'iris' },
      },
      {
        t: 3750,
        type: 'status',
        to: 'nova',
        payload: { status: 'idle' },
      },
      {
        t: 4250,
        type: 'message',
        from: 'iris',
        to: 'channel',
        payload: {
          text: 'Cross-checked citations and removed PII before external distribution.',
          fileChip: 'executive-brief.md',
          fileMeta: '2.4 KB · Ready',
        },
      },
      {
        t: 4750,
        type: 'approval',
        from: 'iris',
        to: 'approval',
        payload: {
          title: 'Approve distribution of "{{topic}}"',
          detail: 'Executive summary audited and PII-scrubbed. Confirm to publish to #announcements.',
          workflowStep: 'approval',
        },
      },
    ],
  },
];

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function vectorize(text: string, dims = 48): number[] {
  const vec = new Array<number>(dims).fill(0);
  for (const tok of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += (h & 1 ? 1 : -1) * 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function extractPersonalTopic(promptText: string, fallback: string): string {
  const clean = String(promptText || '').trim().replace(/\s+/g, ' ');
  if (!clean) return fallback;
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

export function matchScenarioForPrompt(promptText: string): {
  scenario: ScenarioTemplate;
  topic: string;
  score: number;
} {
  const clean = String(promptText || '').trim();
  if (!clean) {
    return {
      scenario: SCENARIOS[0],
      topic: SCENARIOS[0].defaultPrompt,
      score: 1,
    };
  }

  const tokens = tokenize(clean);
  const qVec = vectorize(clean);

  let best = SCENARIOS[0];
  let bestScore = -Infinity;

  for (const sc of SCENARIOS) {
    let kwHits = 0;
    for (const kw of sc.keywords) {
      if (tokens.includes(kw) || clean.toLowerCase().includes(kw)) kwHits += 1;
    }
    const vecSim = cosine(qVec, vectorize(`${sc.label} ${sc.descriptor} ${sc.keywords.join(' ')}`));
    const score = kwHits * 1.4 + vecSim;
    if (score > bestScore) {
      bestScore = score;
      best = sc;
    }
  }

  return {
    scenario: best,
    topic: extractPersonalTopic(clean, best.defaultPrompt),
    score: Number(bestScore.toFixed(3)),
  };
}

export function interpolateTemplateText(template: string, topic: string): string {
  return String(template || '').replace(/\{\{topic\}\}/g, topic);
}

export interface LiveSceneState {
  runId: number;
  scenarioId: ScenarioTemplate['id'];
  taskPrompt: string;
  topic: string;
  timeline: ScenarioTimelineEvent[];
  appliedEventCount: number;
  elapsedMs: number;
  isPlaying: boolean;
  isPaused: boolean;
  speed: 1 | 2;
  liveAiMode: boolean;
  agents: Record<AgentId, AgentRuntimeState>;
  messages: SceneMessage[];
  typingAgentId: AgentId | null;
  activeTaskCard: SceneMessage['taskCard'] | null;
  activeHandoff: ActiveHandoffEdge | null;
  pulsingNodeId: AgentId | null;
  focusedAgentId: AgentId | null;
  workflow: Record<WorkflowStepId, WorkflowStepState>;
  pendingApproval: { title: string; detail: string } | null;
  approvalStatus: 'none' | 'pending' | 'approved' | 'rejected';
  completionGlowBurst: boolean;
  teammatesInvited: boolean;
  teammateCursors: TeammateCursor[];
  hoveredAgentId: AgentId | null;
}

function createInitialAgents(): Record<AgentId, AgentRuntimeState> {
  return {
    atlas: { id: 'atlas', status: 'idle', model: 'Model A', memoryLabel: 'Memory', memoryVersion: 1 },
    nova: { id: 'nova', status: 'idle', model: 'Model A', memoryLabel: 'Memory', memoryVersion: 1 },
    iris: { id: 'iris', status: 'idle', model: 'Model B', memoryLabel: 'Memory', memoryVersion: 1 },
    orion: { id: 'orion', status: 'idle', model: 'Model A', memoryLabel: 'Memory', memoryVersion: 1 },
  };
}

function createInitialWorkflow(): Record<WorkflowStepId, WorkflowStepState> {
  return {
    trigger: 'done',
    atlas: 'pending',
    nova: 'pending',
    iris: 'pending',
    approval: 'pending',
  };
}

function findAgentMeta(id: string): AgentMeta {
  return AGENT_ROSTER.find((a) => a.id === id) || AGENT_ROSTER[0];
}

export function personalizeTimeline(
  scenario: ScenarioTemplate,
  topic: string,
  liveAiSteps?: {
    atlasPlan?: string;
    novaBuild?: string;
    fileChip?: string;
    irisReview?: string;
    orionSummary?: string;
  }
): ScenarioTimelineEvent[] {
  return scenario.events.map((ev) => {
    const p = { ...ev.payload };
    if (typeof p.text === 'string') p.text = interpolateTemplateText(p.text, topic);
    if (typeof p.title === 'string') p.title = interpolateTemplateText(p.title, topic);
    if (typeof p.detail === 'string') p.detail = interpolateTemplateText(p.detail, topic);
    if (p.taskCard) {
      p.taskCard = {
        ...p.taskCard,
        title: interpolateTemplateText(p.taskCard.title, topic),
      };
    }

    if (liveAiSteps) {
      if (ev.type === 'message' && ev.from === 'atlas' && liveAiSteps.atlasPlan) {
        p.text = liveAiSteps.atlasPlan;
        p.aiGenerated = true;
      }
      if (ev.type === 'file' && ev.from === 'nova' && liveAiSteps.novaBuild) {
        p.text = liveAiSteps.novaBuild;
        if (liveAiSteps.fileChip) p.fileChip = liveAiSteps.fileChip;
        p.aiGenerated = true;
      }
      if ((ev.from === 'iris' || ev.from === 'orion') && ev.type === 'message') {
        p.text = ev.from === 'iris' && liveAiSteps.irisReview ? liveAiSteps.irisReview : liveAiSteps.orionSummary || p.text;
        p.aiGenerated = true;
      }
    }

    return { ...ev, payload: p };
  });
}

export function createInitialSceneState(): LiveSceneState {
  const initialScenario = SCENARIOS[0];
  return {
    runId: 0,
    scenarioId: initialScenario.id,
    taskPrompt: initialScenario.defaultPrompt,
    topic: initialScenario.defaultPrompt,
    timeline: personalizeTimeline(initialScenario, initialScenario.defaultPrompt),
    appliedEventCount: 0,
    elapsedMs: 0,
    isPlaying: false,
    isPaused: false,
    speed: 1,
    liveAiMode: false,
    agents: createInitialAgents(),
    messages: [
      {
        id: 'welcome-msg',
        authorId: 'atlas',
        authorName: 'Atlas',
        authorRole: 'Planner',
        kind: 'message',
        text: 'Workspace ready in #launch. Pick a preset or describe a task below to watch Atlas, Nova, Iris, and Orion coordinate live.',
        tsLabel: 'Ready',
      },
    ],
    typingAgentId: null,
    activeTaskCard: null,
    activeHandoff: null,
    pulsingNodeId: null,
    focusedAgentId: null,
    workflow: {
      trigger: 'pending',
      atlas: 'pending',
      nova: 'pending',
      iris: 'pending',
      approval: 'pending',
    },
    pendingApproval: null,
    approvalStatus: 'none',
    completionGlowBurst: false,
    teammatesInvited: false,
    teammateCursors: [],
    hoveredAgentId: null,
  };
}

function setWorkflowActiveStep(
  workflow: Record<WorkflowStepId, WorkflowStepState>,
  step: WorkflowStepId
): Record<WorkflowStepId, WorkflowStepState> {
  const order: WorkflowStepId[] = ['trigger', 'atlas', 'nova', 'iris', 'approval'];
  const idx = order.indexOf(step);
  const next = { ...workflow };
  order.forEach((s, i) => {
    if (i < idx) next[s] = 'done';
    else if (i === idx) next[s] = 'active';
    else if (next[s] !== 'done') next[s] = 'pending';
  });
  return next;
}

function applySingleTimelineEvent(
  state: LiveSceneState,
  ev: ScenarioTimelineEvent,
  eventIndex: number
): LiveSceneState {
  let next: LiveSceneState = {
    ...state,
    agents: { ...state.agents },
    messages: [...state.messages],
    workflow: { ...state.workflow },
  };

  const timeSec = (ev.t / 1000).toFixed(1) + 's';

  if (ev.type === 'status' && ev.to && ev.to in next.agents) {
    const id = ev.to as AgentId;
    const status = (ev.payload.status || 'idle') as AgentStatus;
    next.agents[id] = { ...next.agents[id], status };
    next.typingAgentId = status === 'thinking' || status === 'working' ? id : next.typingAgentId === id ? null : next.typingAgentId;
    if (ev.payload.workflowStep) {
      next.workflow = setWorkflowActiveStep(next.workflow, ev.payload.workflowStep);
    }
  } else if ((ev.type === 'message' || ev.type === 'file') && ev.from && ev.from in next.agents) {
    const meta = findAgentMeta(ev.from);
    next.typingAgentId = null;
    const msg: SceneMessage = {
      id: `run-${next.runId}-ev-${eventIndex}`,
      authorId: meta.id,
      authorName: meta.name,
      authorRole: meta.role,
      kind: ev.type === 'file' ? 'file' : 'message',
      text: String(ev.payload.text || ''),
      fileChip: ev.payload.fileChip ? String(ev.payload.fileChip) : undefined,
      fileMeta: ev.payload.fileMeta ? String(ev.payload.fileMeta) : undefined,
      taskCard: ev.payload.taskCard || undefined,
      aiGenerated: Boolean(ev.payload.aiGenerated),
      tsLabel: timeSec,
      mentions: next.teammatesInvited ? ['Maya'] : undefined,
    };
    if (ev.payload.taskCard) {
      next.activeTaskCard = ev.payload.taskCard;
    }
    next.messages.push(msg);
  } else if (ev.type === 'handoff' && ev.from && ev.to && ev.from in next.agents && ev.to in next.agents) {
    const fromId = ev.from as AgentId;
    const toId = ev.to as AgentId;
    const nextStatus = (ev.payload.nextStatus || 'working') as AgentStatus;
    next.agents[toId] = { ...next.agents[toId], status: nextStatus };
    next.typingAgentId = toId;
    next.activeHandoff = {
      id: `edge-${next.runId}-${eventIndex}`,
      from: fromId,
      to: toId,
      label: String(ev.payload.label || 'Handoff'),
      startedAtMs: ev.t,
    };
    next.pulsingNodeId = toId;
    if (ev.payload.workflowStep) {
      next.workflow = setWorkflowActiveStep(next.workflow, ev.payload.workflowStep);
    }
  } else if (ev.type === 'approval') {
    for (const id of Object.keys(next.agents) as AgentId[]) {
      next.agents[id] = { ...next.agents[id], status: id === 'iris' ? 'waiting' : 'idle' };
    }
    next.typingAgentId = null;
    next.workflow = setWorkflowActiveStep(next.workflow, 'approval');
    next.pendingApproval = {
      title: String(ev.payload.title || 'Approval required'),
      detail: String(ev.payload.detail || 'Confirm to finalize this run.'),
    };
    next.approvalStatus = 'pending';
    next.isPlaying = false;
    next.messages.push({
      id: `run-${next.runId}-approval-${eventIndex}`,
      authorId: 'iris',
      authorName: 'Iris',
      authorRole: 'Reviewer',
      kind: 'approval',
      text: next.pendingApproval.detail,
      tsLabel: timeSec,
    });
  }

  next.appliedEventCount = eventIndex + 1;
  return next;
}

export type LiveSceneAction =
  | {
      type: 'START_RUN';
      prompt: string;
      liveAiSteps?: Parameters<typeof personalizeTimeline>[2];
    }
  | { type: 'TICK_TO'; elapsedMs: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SET_SPEED'; speed: 1 | 2 }
  | { type: 'REPLAY' }
  | { type: 'SEEK_EVENT_INDEX'; index: number }
  | { type: 'APPROVE_RUN' }
  | { type: 'REJECT_RUN' }
  | { type: 'SWAP_MODEL'; agentId: AgentId }
  | { type: 'INVITE_TEAMMATES' }
  | { type: 'SELECT_NODE'; agentId: AgentId | null }
  | { type: 'SET_HOVER_AGENT'; agentId: AgentId | null }
  | { type: 'SET_LIVE_AI_MODE'; enabled: boolean };

export function liveSceneReducer(state: LiveSceneState, action: LiveSceneAction): LiveSceneState {
  switch (action.type) {
    case 'START_RUN': {
      const matched = matchScenarioForPrompt(action.prompt);
      const timeline = personalizeTimeline(matched.scenario, matched.topic, action.liveAiSteps);
      const runId = state.runId + 1;
      const freshAgents = createInitialAgents();
      // Preserve existing swapped model assignments & memory across runs!
      for (const id of Object.keys(freshAgents) as AgentId[]) {
        freshAgents[id].model = state.agents[id].model;
        freshAgents[id].memoryVersion = state.agents[id].memoryVersion;
      }
      const userMsg: SceneMessage = {
        id: `run-${runId}-user`,
        authorId: 'user',
        authorName: 'You',
        authorRole: 'Workspace Lead',
        kind: 'message',
        text: matched.topic,
        tsLabel: 'Now',
      };
      const base: LiveSceneState = {
        ...state,
        runId,
        scenarioId: matched.scenario.id,
        taskPrompt: action.prompt || matched.topic,
        topic: matched.topic,
        timeline,
        appliedEventCount: 0,
        elapsedMs: 0,
        isPlaying: true,
        isPaused: false,
        agents: freshAgents,
        messages: [userMsg],
        typingAgentId: 'atlas',
        activeTaskCard: null,
        activeHandoff: null,
        pulsingNodeId: 'atlas',
        focusedAgentId: null,
        workflow: createInitialWorkflow(),
        pendingApproval: null,
        approvalStatus: 'none',
        completionGlowBurst: false,
      };
      return liveSceneReducer(base, { type: 'TICK_TO', elapsedMs: 0 });
    }

    case 'TICK_TO': {
      let next: LiveSceneState = { ...state, elapsedMs: action.elapsedMs };
      while (
        next.appliedEventCount < next.timeline.length &&
        next.timeline[next.appliedEventCount].t <= action.elapsedMs
      ) {
        next = applySingleTimelineEvent(next, next.timeline[next.appliedEventCount], next.appliedEventCount);
      }
      if (next.activeHandoff && action.elapsedMs - next.activeHandoff.startedAtMs > 1050) {
        next.activeHandoff = null;
        next.pulsingNodeId = null;
      }
      return next;
    }

    case 'PAUSE':
      return { ...state, isPaused: true };

    case 'RESUME':
      return { ...state, isPaused: false };

    case 'SET_SPEED':
      return { ...state, speed: action.speed };

    case 'REPLAY': {
      return liveSceneReducer(state, { type: 'START_RUN', prompt: state.taskPrompt });
    }

    case 'SEEK_EVENT_INDEX': {
      const clampedIdx = Math.max(0, Math.min(state.timeline.length, action.index));
      const freshAgents = createInitialAgents();
      for (const id of Object.keys(freshAgents) as AgentId[]) {
        freshAgents[id].model = state.agents[id].model;
        freshAgents[id].memoryVersion = state.agents[id].memoryVersion;
      }
      let next: LiveSceneState = {
        ...state,
        appliedEventCount: 0,
        elapsedMs: clampedIdx > 0 ? state.timeline[clampedIdx - 1].t : 0,
        isPlaying: false,
        isPaused: true,
        agents: freshAgents,
        messages: [
          {
            id: `run-${state.runId}-user`,
            authorId: 'user',
            authorName: 'You',
            authorRole: 'Workspace Lead',
            kind: 'message',
            text: state.topic,
            tsLabel: 'Step 0',
          },
        ],
        typingAgentId: null,
        activeTaskCard: null,
        activeHandoff: null,
        pulsingNodeId: null,
        workflow: createInitialWorkflow(),
        pendingApproval: null,
        approvalStatus: 'none',
        completionGlowBurst: false,
      };
      for (let i = 0; i < clampedIdx; i++) {
        next = applySingleTimelineEvent(next, next.timeline[i], i);
      }
      return next;
    }

    case 'APPROVE_RUN': {
      const clearedAgents = { ...state.agents };
      for (const id of Object.keys(clearedAgents) as AgentId[]) {
        clearedAgents[id] = { ...clearedAgents[id], status: 'idle' };
      }
      return {
        ...state,
        agents: clearedAgents,
        isPlaying: false,
        isPaused: false,
        pendingApproval: null,
        approvalStatus: 'approved',
        completionGlowBurst: true,
        activeHandoff: null,
        pulsingNodeId: 'orion',
        workflow: {
          trigger: 'done',
          atlas: 'done',
          nova: 'done',
          iris: 'done',
          approval: 'done',
        },
        messages: [
          ...state.messages,
          {
            id: `run-${state.runId}-approved-${Date.now()}`,
            authorId: 'orion',
            authorName: 'Orion',
            authorRole: 'Analyst',
            kind: 'summary',
            text: `Run approved for "${state.topic}". Summary logged to #launch, workspace files locked, and team memory updated.`,
            tsLabel: 'Done',
          },
        ],
      };
    }

    case 'REJECT_RUN': {
      const clearedAgents = { ...state.agents };
      clearedAgents.iris = { ...clearedAgents.iris, status: 'idle' };
      clearedAgents.nova = { ...clearedAgents.nova, status: 'waiting' };
      return {
        ...state,
        agents: clearedAgents,
        isPlaying: false,
        pendingApproval: null,
        approvalStatus: 'rejected',
        completionGlowBurst: false,
        workflow: {
          ...state.workflow,
          approval: 'rejected',
        },
        messages: [
          ...state.messages,
          {
            id: `run-${state.runId}-rejected-${Date.now()}`,
            authorId: 'system',
            authorName: 'Approval Gate',
            authorRole: 'System',
            kind: 'system',
            text: `Changes requested on "${state.topic}". Nova queued a revision pass; click Replay or submit a refined task.`,
            tsLabel: 'Paused',
          },
        ],
      };
    }

    case 'SWAP_MODEL': {
      const current = state.agents[action.agentId];
      if (!current) return state;
      const meta = findAgentMeta(action.agentId);
      const nextModel: ModelTier = current.model === 'Model A' ? 'Model B' : 'Model A';
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.agentId]: {
            ...current,
            model: nextModel,
            // Memory & workspace explicitly preserved unchanged!
          },
        },
        messages: [
          ...state.messages,
          {
            id: `swap-${action.agentId}-${Date.now()}-${state.messages.length}`,
            authorId: 'system',
            authorName: 'Workspace',
            authorRole: 'Model Switch',
            kind: 'system',
            text: `${meta.name} moved to ${nextModel}, memory and workspace kept`,
            tsLabel: 'Just now',
          },
        ],
      };
    }

    case 'INVITE_TEAMMATES': {
      if (state.teammatesInvited) return state;
      const cursors: TeammateCursor[] = [
        {
          id: 'maya',
          name: 'Maya Chen',
          role: 'Product Lead',
          color: '#4777DF',
          xPct: 62,
          yPct: 28,
          note: 'Reviewing spec',
        },
        {
          id: 'liam',
          name: 'Liam Patel',
          role: 'Staff Engineer',
          color: '#C49A52',
          xPct: 34,
          yPct: 72,
          note: 'Checking graph',
        },
      ];
      const addedMsgs: SceneMessage[] = [
        {
          id: `tm-maya-${Date.now()}`,
          authorId: 'maya',
          authorName: 'Maya Chen',
          authorRole: 'Product Lead · Teammate',
          kind: 'teammate',
          text: `Joined #launch — looks crisp. @Nova can we keep the rollback timer note prominent in "${state.topic}"?`,
          tsLabel: 'Live',
        },
        {
          id: `tm-liam-${Date.now() + 1}`,
          authorId: 'liam',
          authorName: 'Liam Patel',
          authorRole: 'Staff Engineer · Teammate',
          kind: 'teammate',
          text: '@Iris confirming telemetry looks clean on staging. Ready to sign off once Iris finishes review.',
          tsLabel: 'Live',
        },
        {
          id: `tm-iris-reply-${Date.now() + 2}`,
          authorId: 'iris',
          authorName: 'Iris',
          authorRole: 'Reviewer',
          kind: 'message',
          text: '@Maya @Liam acknowledged — rollback threshold and staging audit pinned to the Approval card.',
          mentions: ['Maya', 'Liam'],
          tsLabel: 'Live',
        },
      ];
      return {
        ...state,
        teammatesInvited: true,
        teammateCursors: cursors,
        messages: [...state.messages, ...addedMsgs],
      };
    }

    case 'SELECT_NODE': {
      return {
        ...state,
        focusedAgentId: state.focusedAgentId === action.agentId ? null : action.agentId,
      };
    }

    case 'SET_HOVER_AGENT':
      return { ...state, hoveredAgentId: action.agentId };

    case 'SET_LIVE_AI_MODE':
      return { ...state, liveAiMode: action.enabled };

    default:
      return state;
  }
}
