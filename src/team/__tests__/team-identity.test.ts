import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { TEAM_NAME_SAFE_PATTERN } from '../contracts.js';
import { initTeamState } from '../state.js';
import type { TeamConfig } from '../types.js';
import { buildInternalTeamName, resolveTeamIdentityScope, resolveTeamNameForCurrentContext, TeamLookupAmbiguityError } from '../team-identity.js';

const longDisplay = 'this-is-a-very-long-team-display-name-that-would-overflow';

function teamConfig(teamName: string, displayName: string, sessionId: string): TeamConfig & Record<string, unknown> {
  return {
    name: teamName,
    task: 'task',
    agent_type: 'executor',
    worker_launch_mode: 'prompt',
    worker_count: 1,
    max_workers: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    tmux_session: 'test-session',
    next_task_id: 1,
    leader_pane_id: null,
    hud_pane_id: null,
    resize_hook_name: null,
    resize_hook_target: null,
    workers: [],
    leader: { session_id: sessionId, worker_id: 'leader-fixed', role: 'leader' },
    display_name: displayName,
    requested_name: displayName,
    identity_source: 'env-session',
  };
}

async function initNamedTeam(cwd: string, teamName: string, displayName: string, sessionId: string): Promise<void> {
  await initTeamState(teamConfig(teamName, displayName, sessionId), cwd);
}

async function writePhase(cwd: string, teamName: string, currentPhase: string, updatedAt: string): Promise<void> {
  await writeFile(join(cwd, '.omc', 'state', 'team', teamName, 'phase.json'), JSON.stringify({
    current_phase: currentPhase,
    max_fix_attempts: 3,
    current_fix_attempt: 0,
    transitions: [],
    updated_at: updatedAt,
  }, null, 2));
}

describe('team identity OMX parity adapter', () => {
  it('builds stable valid internal names for same display and distinct sessions', () => {
    const a = buildInternalTeamName(longDisplay, { sessionId: 'session-a', paneId: '', tmuxTarget: '', runId: '', source: 'env-session' });
    const b = buildInternalTeamName(longDisplay, { sessionId: 'session-b', paneId: '', tmuxTarget: '', runId: '', source: 'env-session' });
    const a2 = buildInternalTeamName(longDisplay, { sessionId: 'session-a', paneId: '', tmuxTarget: '', runId: '', source: 'env-session' });
    const runA = buildInternalTeamName('demo', { sessionId: '', paneId: '', tmuxTarget: '', runId: 'run-a', source: 'run-id' });
    const runB = buildInternalTeamName('demo', { sessionId: '', paneId: '', tmuxTarget: '', runId: 'run-b', source: 'run-id' });

    assert.notEqual(a, b);
    assert.notEqual(runA, runB);
    assert.equal(a, a2);
    assert.equal(a.length <= 30, true);
    assert.match(a, TEAM_NAME_SAFE_PATTERN);
  });

  it('does not use cwd session.json as the identity source when env is absent', () => {
    const scope = resolveTeamIdentityScope({ TMUX: '/tmp/tmux,1,0', TMUX_PANE: '%42' });
    assert.equal(scope.source, 'tmux-pane');
    assert.equal(scope.paneId, '%42');
  });

  it('resolves display names from OMC_TEAM_STATE_ROOT when cwd has no local team state', async () => {
    const leaderCwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-leader-'));
    const workerCwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-worker-'));
    try {
      await initNamedTeam(leaderCwd, 'shared-demo-aaaaaaaa', 'shared-demo', 'session-shared');

      assert.equal(
        resolveTeamNameForCurrentContext('shared-demo', workerCwd, {
          OMC_SESSION_ID: 'session-shared',
          OMC_TEAM_STATE_ROOT: join(leaderCwd, '.omc', 'state'),
        }),
        'shared-demo-aaaaaaaa',
      );
    } finally {
      await rm(leaderCwd, { recursive: true, force: true });
      await rm(workerCwd, { recursive: true, force: true });
    }
  });

  it('accepts OMX env aliases while preserving OMC storage', async () => {
    const leaderCwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-omx-alias-'));
    const workerCwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-worker-'));
    try {
      await initNamedTeam(leaderCwd, 'alias-demo-aaaaaaaa', 'alias-demo', 'session-shared');

      assert.equal(
        resolveTeamNameForCurrentContext('alias-demo', workerCwd, {
          OMX_SESSION_ID: 'session-shared',
          OMX_TEAM_STATE_ROOT: join(leaderCwd, '.omc', 'state'),
        }),
        'alias-demo-aaaaaaaa',
      );
    } finally {
      await rm(leaderCwd, { recursive: true, force: true });
      await rm(workerCwd, { recursive: true, force: true });
    }
  });

  it('prefers active display-name candidates over retained terminal states', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-active-'));
    try {
      await initNamedTeam(cwd, 'demo-active', 'demo', 'session-active');
      await initNamedTeam(cwd, 'demo-terminal', 'demo', 'session-terminal');
      await writePhase(cwd, 'demo-terminal', 'complete', '2026-01-01T00:00:00.000Z');

      assert.equal(resolveTeamNameForCurrentContext('demo', cwd, {}), 'demo-active');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('uses current leader identity to break active display-name ties', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-current-'));
    try {
      await initNamedTeam(cwd, 'demo-aaaaaaaa', 'demo', 'session-a');
      await initNamedTeam(cwd, 'demo-bbbbbbbb', 'demo', 'session-b');

      assert.equal(resolveTeamNameForCurrentContext('demo', cwd, { OMC_SESSION_ID: 'session-b' }), 'demo-bbbbbbbb');
      assert.equal(resolveTeamNameForCurrentContext('demo', cwd, { OMX_SESSION_ID: 'session-a' }), 'demo-aaaaaaaa');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('resolves the latest retained terminal display-name state only when unambiguous', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-latest-terminal-'));
    try {
      await initNamedTeam(cwd, 'demo-old', 'demo', 'session-old');
      await initNamedTeam(cwd, 'demo-new', 'demo', 'session-new');
      await writePhase(cwd, 'demo-old', 'failed', '2026-01-01T00:00:00.000Z');
      await writePhase(cwd, 'demo-new', 'complete', '2026-01-03T00:00:00.000Z');

      assert.equal(resolveTeamNameForCurrentContext('demo', cwd, {}), 'demo-new');

      await writePhase(cwd, 'demo-old', 'failed', '2026-01-03T00:00:00.000Z');
      assert.throws(() => resolveTeamNameForCurrentContext('demo', cwd, {}), TeamLookupAmbiguityError);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('sanitizes unsafe lookup input instead of returning raw path-like names', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'omc-team-identity-unsafe-'));
    try {
      assert.equal(resolveTeamNameForCurrentContext('../../victim', cwd, {}), 'victim');
      assert.equal(resolveTeamNameForCurrentContext('Demo Team', cwd, {}), 'demo-team');
      assert.throws(() => resolveTeamNameForCurrentContext('---', cwd, {}), /invalid_team_name/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
