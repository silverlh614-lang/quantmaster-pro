import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('bootManifest — 부팅/종료 매니페스트 (기억 보완 회로)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('최초 startBoot — previous 없음, status=unknown', async () => {
    const { startBoot, getLastBoot } = await import('./bootManifest.js');
    const r = startBoot();
    expect(r.previous).toBeNull();
    expect(r.previousCrashed).toBe(false);
    expect(r.current.status).toBe('unknown');
    expect(r.current.bootId).toBeTruthy();
    const last = getLastBoot();
    expect(last?.bootId).toBe(r.current.bootId);
  });

  it('markCleanShutdown 후 다음 startBoot — previous.status=clean, previousCrashed=false', async () => {
    const mod1 = await import('./bootManifest.js');
    const b1 = mod1.startBoot();
    mod1.markCleanShutdown(b1.current.bootId, 'SIGTERM');

    vi.resetModules();
    const mod2 = await import('./bootManifest.js');
    const b2 = mod2.startBoot();
    expect(b2.previous?.bootId).toBe(b1.current.bootId);
    expect(b2.previous?.status).toBe('clean');
    expect(b2.previous?.shutdownSignal).toBe('SIGTERM');
    expect(b2.previousCrashed).toBe(false);
  });

  it('마감 없이 다음 startBoot — previous 를 crashed 로 자동 마감', async () => {
    const mod1 = await import('./bootManifest.js');
    const b1 = mod1.startBoot();
    // 의도적으로 markCleanShutdown 호출하지 않음 (프로세스 강제 종료 시뮬레이션)

    vi.resetModules();
    const mod2 = await import('./bootManifest.js');
    const b2 = mod2.startBoot();
    expect(b2.previous?.bootId).toBe(b1.current.bootId);
    expect(b2.previous?.status).toBe('crashed');
    expect(b2.previousCrashed).toBe(true);
  });

  it('markBootReady — startupMs 기록', async () => {
    const { startBoot, markBootReady, listRecentBoots } = await import('./bootManifest.js');
    const r = startBoot();
    markBootReady(r.current.bootId, 1234);
    const recent = listRecentBoots(1);
    expect(recent[0].startupMs).toBe(1234);
  });

  it('최근 100건 초과 시 오래된 엔트리 트리밍', async () => {
    const mod = await import('./bootManifest.js');
    for (let i = 0; i < 120; i++) {
      const r = mod.startBoot();
      mod.markCleanShutdown(r.current.bootId);
    }
    const recent = mod.listRecentBoots(500);
    expect(recent.length).toBe(100);
  });
});
