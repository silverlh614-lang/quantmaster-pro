// @responsibility 회귀 테스트 — /learning_loop_health cmd 메타데이터 + execute 호출 + alias
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('/learning_loop_health cmd (ADR-0130 PR-Diag)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-llh-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 메타데이터: name + alias /llh + LRN + riskLevel=0 + ADMIN', async () => {
    const mod = await import('./learningLoopHealth.cmd.js');
    const cmd = mod.default;
    expect(cmd.name).toBe('/learning_loop_health');
    expect(cmd.aliases).toContain('/llh');
    expect(cmd.category).toBe('LRN');
    expect(cmd.riskLevel).toBe(0);
    expect(cmd.visibility).toBe('ADMIN');
  });

  it('2. description 에 ADR-0130 명시', async () => {
    const mod = await import('./learningLoopHealth.cmd.js');
    expect(mod.default.description).toContain('ADR-0130');
  });

  it('3. execute 정상 — reply 1회 호출 + 메시지 포함', async () => {
    const mod = await import('./learningLoopHealth.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await mod.default.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    const sentMsg = reply.mock.calls[0][0] as string;
    expect(sentMsg).toContain('Self-learning loop health');
  });

  it('4. execute throw 시 graceful — ❌ 메시지 + reply 호출', async () => {
    // collectLearningLoopHealth 가 예외 던지도록 mock
    vi.doMock('../../../learning/learningLoopHealth.js', () => ({
      collectLearningLoopHealth: () => {
        throw new Error('forced for test');
      },
      formatLearningLoopHealthMessage: () => '',
    }));
    vi.resetModules();
    const mod = await import('./learningLoopHealth.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    // console.error 무시 (의도된 throw 로그)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mod.default.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    const sentMsg = reply.mock.calls[0][0] as string;
    expect(sentMsg).toContain('❌');
    errSpy.mockRestore();
    vi.doUnmock('../../../learning/learningLoopHealth.js');
  });

  it('5. commandRegistry 에 /learning_loop_health + alias /llh 등록', async () => {
    await import('./learningLoopHealth.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    const main = commandRegistry.resolve('/learning_loop_health');
    const alias = commandRegistry.resolve('/llh');
    expect(main).toBeTruthy();
    expect(alias).toBeTruthy();
    expect(main).toBe(alias);
  });
});
