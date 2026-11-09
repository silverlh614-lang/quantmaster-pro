/**
 * @responsibility local_deploy 자동 배포 절차 회귀 테스트 — 단계 판정, 성공, 실패 복귀, 실행기 자체 갱신.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyChanges,
  deployCommit,
  isAutoDeployEnabled,
  resumeAfterRuntimeUpdate,
  shouldDeploy,
} from './local_deploy.mjs';

const PREV = 'aaaaaaa0000000000000000000000000000000000';
const NEXT = 'bbbbbbb1111111111111111111111111111111111';

function harness({ files = ['server/index.ts'], healthy = true, failInstall = false, state = {} } = {}) {
  const calls = [];
  const notes = [];
  let head = PREV;
  let stored = { rejected: [], ...state };
  let clock = Date.parse('2026-11-10T00:00:00Z');
  const deps = {
    now: () => new Date((clock += 1_000)),
    head: () => head,
    changedFiles: () => files,
    subject: (sha) => `커밋 ${sha.slice(0, 7)}`,
    checkout: async (sha) => { calls.push(`checkout:${sha.slice(0, 7)}`); head = sha; },
    install: async () => {
      calls.push('install');
      if (failInstall && head === NEXT) throw new Error('npm ci 실패');
    },
    build: async () => { calls.push('build'); },
    stopServer: async () => { calls.push('stop'); },
    startServer: () => { calls.push(`start:${head.slice(0, 7)}`); },
    waitHealthy: async (sha) => {
      calls.push(`health:${sha.slice(0, 7)}`);
      return healthy ? { ok: true } : { ok: false, reason: '4분 안에 /api/health 응답 없음' };
    },
    loadState: () => stored,
    saveState: (next) => { stored = next; },
    notify: async (text, { important }) => { calls.push(important ? 'notify:important' : 'notify:info'); notes.push(text); },
    log: () => {},
  };
  return { deps, calls, notes, state: () => stored, setHead: (sha) => { head = sha; } };
}

describe('classifyChanges', () => {
  it('서버만 바뀐 커밋은 설치·빌드를 건너뛴다', () => {
    expect(classifyChanges(['server/index.ts', 'docs/ai/10-patch-history-index.md', 'README.md']))
      .toMatchObject({ needInstall: false, needBuild: false, runtimeChanged: false, bootstrapChanged: false });
  });
  it('화면 코드가 바뀌면 빌드한다', () => {
    expect(classifyChanges(['src/App.tsx'])).toMatchObject({ needInstall: false, needBuild: true });
  });
  it('package-lock 이 바뀌면 설치와 빌드를 모두 한다', () => {
    expect(classifyChanges(['package-lock.json'])).toMatchObject({ needInstall: true, needBuild: true });
  });
  it('실행기·부트스트랩 변경을 구분한다', () => {
    expect(classifyChanges(['scripts/local_runtime.mjs'])).toMatchObject({ runtimeChanged: true, bootstrapChanged: false });
    expect(classifyChanges(['scripts/start_local.mjs'])).toMatchObject({ runtimeChanged: false, bootstrapChanged: true });
  });
});

describe('isAutoDeployEnabled / shouldDeploy', () => {
  it('운영 폴더(플래그 + 분리된 HEAD)에서만 켠다', () => {
    expect(isAutoDeployEnabled({ flag: undefined, detachedHead: true }).enabled).toBe(false);
    expect(isAutoDeployEnabled({ flag: 'true', detachedHead: false }).enabled).toBe(false);
    expect(isAutoDeployEnabled({ flag: 'TRUE', detachedHead: true }).enabled).toBe(true);
  });
  it('같은 커밋과 거부된 커밋은 배포하지 않는다', () => {
    expect(shouldDeploy({ head: PREV, target: PREV, rejected: [] })).toBe(false);
    expect(shouldDeploy({ head: PREV, target: NEXT, rejected: [NEXT] })).toBe(false);
    expect(shouldDeploy({ head: PREV, target: NEXT, rejected: [] })).toBe(true);
  });
});

describe('deployCommit', () => {
  it('성공: 종료 → 교체 → 기동 → 커밋 확인 후 완료 기록', async () => {
    const h = harness();
    await expect(deployCommit(NEXT, h.deps)).resolves.toEqual({ status: 'deployed' });
    expect(h.calls).toEqual(['stop', 'checkout:bbbbbbb', 'start:bbbbbbb', 'health:bbbbbbb', 'notify:info']);
    expect(h.state()).toMatchObject({ current: NEXT, phase: null, verifying: null, last: { result: 'deployed', target: NEXT } });
  });

  it('기동 확인 실패: 이전 커밋으로 복귀하고 그 커밋을 거부 목록에 올린다', async () => {
    const h = harness({ healthy: false });
    await expect(deployCommit(NEXT, h.deps)).resolves.toEqual({ status: 'rolled-back' });
    expect(h.calls).toEqual([
      'stop', 'checkout:bbbbbbb', 'start:bbbbbbb', 'health:bbbbbbb',
      'stop', 'checkout:aaaaaaa', 'notify:important', 'start:aaaaaaa',
    ]);
    expect(h.state()).toMatchObject({ current: PREV, rejected: [NEXT], last: { result: 'rolled-back', target: NEXT } });
    expect(h.notes.at(-1)).toContain('기동 확인 실패');
  });

  it('설치 실패: 새 버전을 띄우지 않고 이전 커밋을 다시 설치해 띄운다', async () => {
    const h = harness({ files: ['package-lock.json'], failInstall: true });
    await expect(deployCommit(NEXT, h.deps)).resolves.toEqual({ status: 'rolled-back' });
    expect(h.calls).not.toContain('start:bbbbbbb');
    expect(h.calls.slice(-5)).toEqual(['checkout:aaaaaaa', 'install', 'build', 'notify:important', 'start:aaaaaaa']);
    expect(h.state().last).toMatchObject({ result: 'rolled-back', reason: expect.stringContaining('npm ci 실패') });
  });

  it('실행기 코드가 바뀌면 서버를 띄우지 않고 재시작을 요청한 뒤, 새 실행기가 확인을 이어 간다', async () => {
    const h = harness({ files: ['scripts/local_runtime.mjs'] });
    await expect(deployCommit(NEXT, h.deps)).resolves.toEqual({ status: 'self-update', target: NEXT });
    expect(h.calls).toEqual(['stop', 'checkout:bbbbbbb']);
    expect(h.state().verifying).toMatchObject({ target: NEXT, prev: PREV });

    await expect(resumeAfterRuntimeUpdate(h.deps)).resolves.toEqual({ status: 'deployed' });
    expect(h.calls.slice(-3)).toEqual(['start:bbbbbbb', 'health:bbbbbbb', 'notify:info']);
    expect(h.state()).toMatchObject({ verifying: null, current: NEXT });
  });

  it('실행기 변경 커밋이 실패하면 복귀 후 다시 실행기 재시작을 요청한다', async () => {
    const h = harness({ files: ['scripts/local_runtime.mjs'], healthy: false });
    await deployCommit(NEXT, h.deps);
    await expect(resumeAfterRuntimeUpdate(h.deps)).resolves.toEqual({ status: 'self-update', target: PREV });
    expect(h.calls.at(-1)).toBe('notify:important');
    expect(h.state()).toMatchObject({ verifying: null, current: PREV, rejected: [NEXT] });
  });
});

describe('resumeAfterRuntimeUpdate', () => {
  it('확인할 배포가 없으면 null', async () => {
    await expect(resumeAfterRuntimeUpdate(harness().deps)).resolves.toBeNull();
  });
  it('HEAD 가 확인 대상과 다르면(복귀 후 재시작) 확인 상태만 지운다', async () => {
    const h = harness({ state: { verifying: { target: NEXT, prev: PREV, changes: classifyChanges([]), subject: 'x' } } });
    await expect(resumeAfterRuntimeUpdate(h.deps)).resolves.toBeNull();
    expect(h.state().verifying).toBeNull();
    expect(h.calls).toEqual([]);
  });
});
