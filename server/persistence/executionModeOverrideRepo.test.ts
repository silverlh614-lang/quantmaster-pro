// @responsibility ADR-0395 P2 ExecutionMode 영속 override 회귀 테스트
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function loadModule() {
  return import('./executionModeOverrideRepo.js');
}

describe('executionModeOverrideRepo (ADR-0395)', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-exec-mode-override-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.PERSIST_DATA_DIR;
    } else {
      process.env.PERSIST_DATA_DIR = originalDataDir;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('savePersistentExecutionMode + loadPersistentExecutionMode round-trip', () => {
    it('파일 부재 → null', async () => {
      const repo = await loadModule();
      expect(repo.loadPersistentExecutionMode()).toBeNull();
    });

    it('OFF 영속 → 동일 값 read', async () => {
      const repo = await loadModule();
      repo.savePersistentExecutionMode({ mode: 'OFF', reason: '테스트', setBy: 'test' });
      const loaded = repo.loadPersistentExecutionMode();
      expect(loaded).not.toBeNull();
      expect(loaded?.mode).toBe('OFF');
      expect(loaded?.reason).toBe('테스트');
      expect(loaded?.setBy).toBe('test');
      expect(loaded?.setAt).toBeTruthy();
    });

    it('PAPER 영속 → 동일 값 read', async () => {
      const repo = await loadModule();
      repo.savePersistentExecutionMode({ mode: 'PAPER' });
      expect(repo.loadPersistentExecutionMode()?.mode).toBe('PAPER');
    });

    it('LIVE 영속 → 동일 값 read', async () => {
      const repo = await loadModule();
      repo.savePersistentExecutionMode({ mode: 'LIVE', setBy: 'operator' });
      const loaded = repo.loadPersistentExecutionMode();
      expect(loaded?.mode).toBe('LIVE');
      expect(loaded?.setBy).toBe('operator');
    });

    it('reason / setBy 옵셔널 — 미전달 시 undefined', async () => {
      const repo = await loadModule();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      const loaded = repo.loadPersistentExecutionMode();
      expect(loaded?.reason).toBeUndefined();
      expect(loaded?.setBy).toBeUndefined();
    });

    it('setAt override — 명시 시 그 값 사용', async () => {
      const repo = await loadModule();
      const fixedAt = '2026-05-06T12:00:00.000Z';
      repo.savePersistentExecutionMode({ mode: 'OFF', setAt: fixedAt });
      const loaded = repo.loadPersistentExecutionMode();
      expect(loaded?.setAt).toBe(fixedAt);
    });

    it('setAt 미전달 — ISO 타임스탬프 자동 생성', async () => {
      const repo = await loadModule();
      const before = Date.now();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      const after = Date.now();
      const loaded = repo.loadPersistentExecutionMode();
      expect(loaded?.setAt).toBeTruthy();
      const ts = Date.parse(loaded?.setAt ?? '');
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe('clearPersistentExecutionMode', () => {
    it('영속 후 clear → 다음 load 는 null', async () => {
      const repo = await loadModule();
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      expect(repo.loadPersistentExecutionMode()).not.toBeNull();
      repo.clearPersistentExecutionMode();
      expect(repo.loadPersistentExecutionMode()).toBeNull();
    });

    it('파일 부재 시 clear → idempotent (throw 없음)', async () => {
      const repo = await loadModule();
      expect(() => repo.clearPersistentExecutionMode()).not.toThrow();
    });

    it('clear 후 다시 save → 새 record 영속', async () => {
      const repo = await loadModule();
      repo.savePersistentExecutionMode({ mode: 'LIVE' });
      repo.clearPersistentExecutionMode();
      repo.savePersistentExecutionMode({ mode: 'PAPER' });
      expect(repo.loadPersistentExecutionMode()?.mode).toBe('PAPER');
    });
  });

  describe('loadPersistentExecutionMode 안전 fallback', () => {
    it('손상 JSON → null fallback (env 로 복원)', async () => {
      const repo = await loadModule();
      const paths = await import('./paths.js');
      fs.mkdirSync(path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE), { recursive: true });
      fs.writeFileSync(paths.EXECUTION_MODE_OVERRIDE_FILE, '{"corrupt":,"json"}', 'utf-8');
      expect(repo.loadPersistentExecutionMode()).toBeNull();
    });

    it('잘못된 mode 값 ("XYZ") → null fallback', async () => {
      const repo = await loadModule();
      const paths = await import('./paths.js');
      fs.mkdirSync(path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE), { recursive: true });
      fs.writeFileSync(
        paths.EXECUTION_MODE_OVERRIDE_FILE,
        JSON.stringify({ mode: 'XYZ', setAt: new Date().toISOString() }),
        'utf-8',
      );
      expect(repo.loadPersistentExecutionMode()).toBeNull();
    });

    it('mode 누락 → null fallback', async () => {
      const repo = await loadModule();
      const paths = await import('./paths.js');
      fs.mkdirSync(path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE), { recursive: true });
      fs.writeFileSync(
        paths.EXECUTION_MODE_OVERRIDE_FILE,
        JSON.stringify({ reason: '누락', setAt: new Date().toISOString() }),
        'utf-8',
      );
      expect(repo.loadPersistentExecutionMode()).toBeNull();
    });

    it('null payload → null fallback', async () => {
      const repo = await loadModule();
      const paths = await import('./paths.js');
      fs.mkdirSync(path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE), { recursive: true });
      fs.writeFileSync(paths.EXECUTION_MODE_OVERRIDE_FILE, 'null', 'utf-8');
      expect(repo.loadPersistentExecutionMode()).toBeNull();
    });

    it('array payload → null fallback', async () => {
      const repo = await loadModule();
      const paths = await import('./paths.js');
      fs.mkdirSync(path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE), { recursive: true });
      fs.writeFileSync(paths.EXECUTION_MODE_OVERRIDE_FILE, '[]', 'utf-8');
      expect(repo.loadPersistentExecutionMode()).toBeNull();
    });

    it('잘못된 setAt (non-string) → 빈 문자열 fallback (record 자체는 유지)', async () => {
      const repo = await loadModule();
      const paths = await import('./paths.js');
      fs.mkdirSync(path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE), { recursive: true });
      fs.writeFileSync(
        paths.EXECUTION_MODE_OVERRIDE_FILE,
        JSON.stringify({ mode: 'OFF', setAt: 123 }),
        'utf-8',
      );
      const loaded = repo.loadPersistentExecutionMode();
      expect(loaded?.mode).toBe('OFF');
      expect(loaded?.setAt).toBe('');
    });
  });

  describe('atomic write 안전성', () => {
    it('save 호출 후 .tmp 파일 잔존 안 함', async () => {
      const repo = await loadModule();
      const paths = await import('./paths.js');
      repo.savePersistentExecutionMode({ mode: 'OFF' });
      const dir = path.dirname(paths.EXECUTION_MODE_OVERRIDE_FILE);
      const remains = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
      expect(remains).toEqual([]);
    });
  });
});
