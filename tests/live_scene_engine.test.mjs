import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_ROSTER,
  SCENARIOS,
  createInitialSceneState,
  liveSceneReducer,
  matchScenarioForPrompt,
} from '../src/live_scene/engine.ts';

test('Live Scene Engine: scenario matcher routes free-text prompts and preserves personal topic', () => {
  const bugMatch = matchScenarioForPrompt('Fix webhook retry race in production sync');
  assert.equal(bugMatch.scenario.id, 'fix-bug');
  assert.ok(bugMatch.topic.includes('Fix webhook retry race'));

  const reportMatch = matchScenarioForPrompt('Compile weekly KPI metrics dashboard');
  assert.equal(reportMatch.scenario.id, 'weekly-report');

  const launchMatch = matchScenarioForPrompt('Prepare spring product launch checklist');
  assert.equal(launchMatch.scenario.id, 'launch-plan');
});

test('Live Scene Engine: runs deterministic timeline to approval and completes with summary on Approve', () => {
  let state = createInitialSceneState();
  assert.equal(AGENT_ROSTER.length, 4);
  assert.equal(SCENARIOS.length, 3);

  state = liveSceneReducer(state, { type: 'START_RUN', prompt: 'Launch plan for Q4 mobile rollout' });
  assert.equal(state.isPlaying, true);
  assert.equal(state.agents.atlas.status, 'thinking');
  assert.equal(state.workflow.atlas, 'active');

  // Advance halfway to observe Nova handoff & file attachment
  state = liveSceneReducer(state, { type: 'TICK_TO', elapsedMs: 2500 });
  assert.equal(state.workflow.nova, 'active');
  assert.ok(state.messages.some((m) => m.fileChip === 'launch-checklist.md'));
  assert.ok(state.messages.some((m) => m.text.includes('Launch plan for Q4 mobile rollout')));

  // Advance past approval event
  state = liveSceneReducer(state, { type: 'TICK_TO', elapsedMs: 6000 });
  assert.ok(state.pendingApproval);
  assert.equal(state.approvalStatus, 'pending');
  assert.equal(state.workflow.approval, 'active');
  assert.equal(state.isPlaying, false);

  // Approve completes run cleanly
  state = liveSceneReducer(state, { type: 'APPROVE_RUN' });
  assert.equal(state.approvalStatus, 'approved');
  assert.equal(state.completionGlowBurst, true);
  assert.equal(state.workflow.approval, 'done');
  assert.ok(state.messages.some((m) => m.kind === 'summary'));
});

test('Live Scene Engine: swap model keeps Memory and posts system confirmation note', () => {
  let state = createInitialSceneState();
  const initialMemoryVersion = state.agents.atlas.memoryVersion;
  assert.equal(state.agents.atlas.model, 'Model A');

  state = liveSceneReducer(state, { type: 'SWAP_MODEL', agentId: 'atlas' });
  assert.equal(state.agents.atlas.model, 'Model B');
  assert.equal(state.agents.atlas.memoryVersion, initialMemoryVersion);
  assert.equal(state.agents.atlas.memoryLabel, 'Memory');
  assert.ok(
    state.messages.some((m) => m.text === 'Atlas moved to Model B, memory and workspace kept')
  );
});

test('Live Scene Engine: invite teammates, reject gate, seek step, pause/speed, node filter, and replay work deterministically', () => {
  let state = createInitialSceneState();
  state = liveSceneReducer(state, { type: 'START_RUN', prompt: 'Fix payment webhook bug' });
  state = liveSceneReducer(state, { type: 'PAUSE' });
  assert.equal(state.isPaused, true);
  state = liveSceneReducer(state, { type: 'SET_SPEED', speed: 2 });
  assert.equal(state.speed, 2);
  state = liveSceneReducer(state, { type: 'RESUME' });
  assert.equal(state.isPaused, false);

  // Seek step-by-step (reduced motion controller)
  state = liveSceneReducer(state, { type: 'SEEK_EVENT_INDEX', index: 5 });
  assert.equal(state.appliedEventCount, 5);
  assert.equal(state.isPaused, true);

  // Invite teammates adds cursors & @mentions
  state = liveSceneReducer(state, { type: 'INVITE_TEAMMATES' });
  assert.equal(state.teammatesInvited, true);
  assert.equal(state.teammateCursors.length, 2);
  assert.ok(state.messages.some((m) => m.mentions?.includes('Maya')));

  // Node click toggles focused agent
  state = liveSceneReducer(state, { type: 'SELECT_NODE', agentId: 'nova' });
  assert.equal(state.focusedAgentId, 'nova');
  state = liveSceneReducer(state, { type: 'SELECT_NODE', agentId: 'nova' });
  assert.equal(state.focusedAgentId, null);

  // Replay restarts cleanly while preserving swapped models
  state = liveSceneReducer(state, { type: 'SWAP_MODEL', agentId: 'nova' });
  state = liveSceneReducer(state, { type: 'REPLAY' });
  assert.equal(state.agents.nova.model, 'Model B');
  assert.equal(state.isPlaying, true);

  // Reject transitions approval gate cleanly
  state = liveSceneReducer(state, { type: 'TICK_TO', elapsedMs: 6000 });
  state = liveSceneReducer(state, { type: 'REJECT_RUN' });
  assert.equal(state.approvalStatus, 'rejected');
  assert.equal(state.workflow.approval, 'rejected');
});
