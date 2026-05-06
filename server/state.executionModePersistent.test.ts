// @responsibility ADR-0395 P2 ExecutionMode 우선순위 체인 (RUNTIME → persistent → env) 회귀 테스트
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function loadState() {
  return import('./state.js');
}

async function loadRepo() {
  return import('./persistence/executionModeOverrideRepo.js');
}

const ORIGINAL_EXECUTION_MODE = process.env.EXECUTION_MODE;
const ORIGINAL_AUTO_TRADE_MODE = process.env.AUTO_TRADE_MODE;
const ORIGINAL_PERSIST_DISABLED = process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED;
const ORIGINAL_PERSIST_DIR = process.env.PERSIST_DATA_DIR;

describe('ExecutionMode 우선순위 체인 (ADR-0395)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-state-exec-mode-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.EXECUTION_MODE;
    delete process.env.AUTO_TRADE_MODE;
    delete process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED;
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_EXECUTION_MODE === undefined) delete process.env.EXECUTION_MODE;
    else process.env.EXECUTION_MODE = ORIGINAL_EXECUTION_MODE;
    if (ORIGINAL_AUTO_TRADE_MODE === undefined) delete process.env.AUTO_TRADE_MODE;
    else process.env.AUTO_TRADE_MODE = ORIGINAL_AUTO_TRADE_MODE;
    if (ORIGINAL_PERSIST_DISABLED === undefined) delete process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED;
    else process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED = ORIGINAL_PERSIST_DISABLED;
    if (ORIGINAL_PERSIST_DIR === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = ORIGINAL_PERSIST_DIR;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('getExecutionMode 우선순위 (§2)', () => {
    it('1순위 RUNTIME — setExecutionMode("OFF") + env=LIVE → OFF', async () => {
      process.env.EXECUTION_MODE = 'LIVE';
      const state = await loadState();
      state.setExecutionMode('OFF');
      expect(state.getExecutionMode()).toBe('OFF');
    });

    it('1순위 RUNTIME — setExecutionMode 가 영속보다 우선', async () => {
      const state = await loadState();
      state.setPersistentExecutionMode('PAPER');
      state.setExecutionMode('OFF');
      expect(state.getExecutionMode()).toBe('OFF');
    });

    it('2순위 persistent — RUNTIME 미설정 + 디스크 OFF + env=LIVE → OFF', async () => {
      process.env.EXECUTION_MODE = 'LIVE';
      // 디스크에만 직접 기록 (RUNTIME 우회)
      const repo = await loadRepo();
      repo.savePersistentExecutionMode({ mode: 'OFF', reason: 'P2 검증' });
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('OFF');
    });

    it('2순위 persistent — RUNTIME 미설정 + 디스크 PAPER + AUTO_TRADE_MODE=LIVE → PAPER', async () => {
      process.env.AUTO_TRADE_MODE = 'LIVE';
      const repo = await loadRepo();
      repo.savePersistentExecutionMode({ mode: 'PAPER' });
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('PAPER');
    });

    it('3순위 env — RUNTIME + 영속 모두 미설정 + EXECUTION_MODE=LIVE → LIVE', async () => {
      process.env.EXECUTION_MODE = 'LIVE';
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('LIVE');
    });

    it('3순위 env — AUTO_TRADE_MODE=PAPER → PAPER', async () => {
      process.env.AUTO_TRADE_MODE = 'PAPER';
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('PAPER');
    });

    it('3순위 env default — 모두 미설정 → OFF', async () => {
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('OFF');
    });
  });

  describe('setPersistentExecutionMode (메모리 + 디스크 동시 갱신)', () => {
    it('영속 OFF — getExecutionMode 즉시 OFF + 디스크 record 영속', async () => {
      process.env.EXECUTION_MODE = 'LIVE';
      const state = await loadState();
      state.setPersistentExecutionMode('OFF', { reason: '운영자 강등', setBy: 'operator' });
      expect(state.getExecutionMode()).toBe('OFF');
      const record = state.getPersistentExecutionModeRecord();
      expect(record?.mode).toBe('OFF');
      expect(record?.reason).toBe('운영자 강등');
      expect(record?.setBy).toBe('operator');
    });

    it('영속 OFF → __resetExecutionModeForTests → env 복원 (LIVE)', async () => {
      process.env.EXECUTION_MODE = 'LIVE';
      const state = await loadState();
      state.setPersistentExecutionMode('OFF');
      expect(state.getExecutionMode()).toBe('OFF');
      state.__resetExecutionModeForTests();
      expect(state.getExecutionMode()).toBe('LIVE');
    });

    it('Railway 재배포 시뮬레이션 — RUNTIME 휘발 + 디스크 OFF 유지', async () => {
      process.env.EXECUTION_MODE = 'LIVE';
      const repo = await loadRepo();
      // 재배포 모방: 디스크에만 영속 record + RUNTIME 비어있음
      repo.savePersistentExecutionMode({ mode: 'OFF', setBy: 'operator' });
      const state = await loadState();
      // 새 프로세스 — RUNTIME 미설정. 영속 layer 만으로 OFF 회복
      expect(state.getExecutionMode()).toBe('OFF');
    });
  });

  describe('clearPersistentExecutionMode', () => {
    it('영속 강등 해제 — env default 즉시 회복', async () => {
      process.env.EXECUTION_MODE = 'LIVE';
      const state = await loadState();
      state.setPersistentExecutionMode('OFF');
      expect(state.getExecutionMode()).toBe('OFF');
      state.clearPersistentExecutionMode();
      expect(state.getExecutionMode()).toBe('LIVE');
      expect(state.getPersistentExecutionModeRecord()).toBeNull();
    });

    it('영속 부재 시 clear — idempotent', async () => {
      const state = await loadState();
      expect(() => state.clearPersistentExecutionMode()).not.toThrow();
      expect(state.getPersistentExecutionModeRecord()).toBeNull();
    });
  });

  describe('EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED ENV 우회', () => {
    it('ENV "true" + RUNTIME 부재 → env 사용 (영속 무시)', async () => {
      const repo = await loadRepo();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      process.env.EXECUTION_MODE = 'LIVE';
      process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED = 'true';
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('LIVE');
    });

    it('ENV "false" → default 정책 (영속 layer 적용)', async () => {
      const repo = await loadRepo();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      process.env.EXECUTION_MODE = 'LIVE';
      process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED = 'false';
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('OFF');
    });

    it('ENV "1" 거부 — 정확 비교 (ADR-0157)', async () => {
      const repo = await loadRepo();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      process.env.EXECUTION_MODE = 'LIVE';
      process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED = '1';
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('OFF'); // '1' 은 'true' 가 아니라 정책 적용
    });

    it('ENV "TRUE" 거부 — 정확 비교 (ADR-0157)', async () => {
      const repo = await loadRepo();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      process.env.EXECUTION_MODE = 'LIVE';
      process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED = 'TRUE';
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('OFF'); // 대소문자 정확
    });

    it('ENV DISABLED 시 getPersistentExecutionModeRecord → null', async () => {
      const repo = await loadRepo();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED = 'true';
      const state = await loadState();
      expect(state.getPersistentExecutionModeRecord()).toBeNull();
    });
  });

  describe('영속 layer 시뮬레이션 — RUNTIME 미설정 시 디스크 우선', () => {
    it('RUNTIME 미설정 + 디스크 손상 → env fallback (LIVE)', async () => {
      const paths = await import('./persistence/paths.js');
      fs.mkdirSync(path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE), { recursive: true });
      fs.writeFileSync(paths.EXECUTION_MODE_OVERRIDE_FILE, '{"corrupt":,}', 'utf-8');
      process.env.EXECUTION_MODE = 'LIVE';
      const state = await loadState();
      expect(state.getExecutionMode()).toBe('LIVE');
    });
  });

  describe('getPersistentExecutionModeRecord 진단', () => {
    it('영속 부재 → null', async () => {
      const state = await loadState();
      expect(state.getPersistentExecutionModeRecord()).toBeNull();
    });

    it('영속 OFF → record 반환 (mode + reason + setBy + setAt)', async () => {
      const state = await loadState();
      state.setPersistentExecutionMode('OFF', { reason: '진단', setBy: 'test' });
      const record = state.getPersistentExecutionModeRecord();
      expect(record).not.toBeNull();
      expect(record?.mode).toBe('OFF');
      expect(record?.reason).toBe('진단');
      expect(record?.setBy).toBe('test');
      expect(record?.setAt).toBeTruthy();
    });
  });
});
