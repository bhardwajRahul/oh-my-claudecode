import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { initTeamState, createTask, claimTask, readTask, writeAtomic } from '../state.js';
import { monitorTeamV2 } from '../runtime-v2.js';
import { planWorktreeTarget, ensureWorktree } from '../worktree.js';
import type { TeamConfig } from '../types.js';

const mocks = vi.hoisted(() => ({
  getWorkerLiveness: vi.fn(async () => 'alive'),
  tmuxExecAsync: vi.fn(async () => ({ stdout: '> \n', stderr: '' })),
}));

vi.mock('../tmux-session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux-session.js')>();
  return {
    ...actual,
    getWorkerLiveness: mocks.getWorkerLiveness,
  };
});

vi.mock('../../cli/tmux-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cli/tmux-utils.js')>();
  return {
    ...actual,
    tmuxExecAsync: mocks.tmuxExecAsync,
  };
});

async function initRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'omc-team-hardening-e2e-repo-'));
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd, stdio: 'ignore' });
  await writeFile(join(cwd, 'README.md'), 'hello\n', 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd, stdio: 'ignore' });
  return cwd;
}

function teamConfig(name: string, cwd: string, workerCount: number): TeamConfig {
  return {
    name,
    task: 'hardening smoke',
    agent_type: 'executor',
    worker_launch_mode: 'interactive',
    worker_count: workerCount,
    max_workers: 20,
    workers: Array.from({ length: workerCount }, (_, index) => ({
      name: `worker-${index + 1}`,
      index: index + 1,
      role: 'executor',
      assigned_tasks: [],
      pane_id: `%${index + 2}`,
      working_dir: cwd,
    })),
    created_at: new Date().toISOString(),
    tmux_session: `${name}:0`,
    next_task_id: 1,
    leader_cwd: cwd,
    team_state_root: join(cwd, '.omc', 'state', 'team', name),
    workspace_mode: 'single',
    worktree_mode: 'disabled',
    leader_pane_id: '%1',
    hud_pane_id: null,
    resize_hook_name: null,
    resize_hook_target: null,
  };
}

const ORIGINAL_OMC_TEAM_STATE_ROOT = process.env.OMC_TEAM_STATE_ROOT;

beforeEach(() => {
  delete process.env.OMC_TEAM_STATE_ROOT;
  mocks.getWorkerLiveness.mockResolvedValue('alive');
  mocks.tmuxExecAsync.mockResolvedValue({ stdout: '> \n', stderr: '' });
});

afterEach(() => {
  if (typeof ORIGINAL_OMC_TEAM_STATE_ROOT === 'string') process.env.OMC_TEAM_STATE_ROOT = ORIGINAL_OMC_TEAM_STATE_ROOT;
  else delete process.env.OMC_TEAM_STATE_ROOT;
});

describe('team hardening e2e', () => {
  it('reopens an expired in-progress task and allows the next worker to complete the flow', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'omc-team-hardening-e2e-'));
    try {
      await initTeamState(teamConfig('team-hardening-e2e', cwd, 2), cwd);
      const task = await createTask('team-hardening-e2e', { subject: 'recover me', description: 'd', status: 'pending' }, cwd);
      const firstClaim = await claimTask('team-hardening-e2e', task.id, 'worker-1', task.version ?? 1, cwd);
      expect(firstClaim.ok).toBe(true);
      if (!firstClaim.ok) return;

      const taskPath = join(cwd, '.omc', 'state', 'team', 'team-hardening-e2e', 'tasks', `task-${task.id}.json`);
      const current = JSON.parse(await readFile(taskPath, 'utf-8')) as { claim: { leased_until: string } };
      current.claim.leased_until = new Date(Date.now() - 1_000).toISOString();
      await writeAtomic(taskPath, JSON.stringify(current, null, 2));

      const snapshot = await monitorTeamV2('team-hardening-e2e', cwd);
      expect(snapshot?.recommendations.some((r) => r.includes(`task-${task.id}`) && r.includes('Reclaimed expired claim'))).toBe(true);

      const reopened = await readTask('team-hardening-e2e', task.id, cwd);
      expect(reopened?.status).toBe('pending');
      expect(reopened?.claim).toBeUndefined();

      const secondClaim = await claimTask('team-hardening-e2e', task.id, 'worker-2', reopened?.version ?? null, cwd);
      expect(secondClaim.ok).toBe(true);
      expect((secondClaim.ok && secondClaim.task.owner) || null).toBe('worker-2');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('refuses dirty worktree reuse in a realistic git-backed flow', async () => {
    const repo = await initRepo();
    try {
      const plan = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: true, name: null },
      });
      expect(plan.enabled).toBe(true);
      if (!plan.enabled) return;

      const first = ensureWorktree(plan);
      expect(first.enabled).toBe(true);
      if (!first.enabled) return;

      await writeFile(join(first.worktreePath, 'DIRTY.txt'), 'dirty\n', 'utf-8');
      expect(() => ensureWorktree(plan)).toThrow(/worktree_dirty/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('tolerates malformed worker status from the team state root', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'omc-team-hardening-worker-state-'));
    try {
      await initTeamState(teamConfig('team-hardening-worker-state', cwd, 1), cwd);

      const statusPath = join(cwd, '.omc', 'state', 'team', 'team-hardening-worker-state', 'workers', 'worker-1', 'status.json');
      await mkdir(join(cwd, '.omc', 'state', 'team', 'team-hardening-worker-state', 'workers', 'worker-1'), { recursive: true });
      await writeFile(statusPath, '{not valid json', 'utf-8');

      const snapshot = await monitorTeamV2('team-hardening-worker-state', cwd);
      expect(snapshot?.workers[0]?.name).toBe('worker-1');
      expect(snapshot?.workers[0]?.status.state).toBe('unknown');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
