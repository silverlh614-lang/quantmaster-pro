/**
 * @responsibility scanIndices.cmd 회귀 테스트
 *
 * 검증:
 *   - 정상 실행: runGlobalScanAgent 호출 + 시작/완료 메시지 2건
 *   - 60s rate-limit 차단 + 카운트다운 안내
 *   - rate-limit 갱신은 가드 통과 직후 → throw 후에도 폭주 차단
 *   - runGlobalScanAgent throw → ❌ 실패 메시지 응답
 *   - 메타데이터: name + aliases (/global_scan, /index_scan) + category=MKT + riskLevel=0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _runGlobalScanAgent = vi.fn(async (): Promise<void> => undefined);

vi.mock('../../../alerts/globalScanAgent.js', () => ({
  runGlobalScanAgent: _runGlobalScanAgent,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let scanIndices: typeof import('./scanIndices.cmd.js').default;
let __resetScanIndicesRateLimitForTests: typeof import('./scanIndices.cmd.js').__resetScanIndicesRateLimitForTests;

beforeEach(async () => {
  const mod = await import('./scanIndices.cmd.js');
  scanIndices = mod.default;
  __resetScanIndicesRateLimitForTests = mod.__resetScanIndicesRateLimitForTests;
  __resetScanIndicesRateLimitForTests();

  _runGlobalScanAgent.mockClear();
  _runGlobalScanAgent.mockResolvedValue(undefined);
});

afterEach(() => {
  __resetScanIndicesRateLimitForTests();
});

describe('/scan_indices — 정상 실행', () => {
  it('runGlobalScanAgent 호출 + 시작/완료 메시지 2건', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply });

    expect(_runGlobalScanAgent).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledTimes(2);

    const startMsg = reply.mock.calls[0]![0];
    expect(startMsg).toContain('글로벌 지수 스캔 시작');
    expect(startMsg).toContain('S&P500');
    expect(startMsg).toContain('VIX');

    const finishMsg = reply.mock.calls[1]![0];
    expect(finishMsg).toContain('완료');
    expect(finishMsg).toMatch(/\d+\.\ds/);
  });

  it('args 무시 — 인자 있어도 동일하게 실행', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: ['ignored'], reply });

    expect(_runGlobalScanAgent).toHaveBeenCalledOnce();
  });
});

describe('/scan_indices — 안전 가드', () => {
  it('60s 이내 재호출 → 차단 + 카운트다운 안내', async () => {
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply: reply1 });
    expect(_runGlobalScanAgent).toHaveBeenCalledOnce();

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply: reply2 });

    expect(reply2).toHaveBeenCalledOnce();
    expect(reply2.mock.calls[0]![0]).toContain('60초 이내');
    expect(reply2.mock.calls[0]![0]).toMatch(/\d+초 후/);

    expect(_runGlobalScanAgent).toHaveBeenCalledOnce();
  });

  it('rate-limit 리셋 후 재실행 가능', async () => {
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply: reply1 });
    expect(_runGlobalScanAgent).toHaveBeenCalledOnce();

    __resetScanIndicesRateLimitForTests();

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply: reply2 });
    expect(_runGlobalScanAgent).toHaveBeenCalledTimes(2);
  });
});

describe('/scan_indices — 에러 처리', () => {
  it('runGlobalScanAgent throw → ❌ 실패 메시지', async () => {
    _runGlobalScanAgent.mockRejectedValueOnce(new Error('Yahoo 503'));
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply });

    expect(reply).toHaveBeenCalledTimes(2);
    const errMsg = reply.mock.calls[1]![0];
    expect(errMsg).toContain('실패');
    expect(errMsg).toContain('Yahoo 503');
  });

  it('throw 후에도 rate-limit 갱신 유지 (재시도 폭주 차단)', async () => {
    _runGlobalScanAgent.mockRejectedValueOnce(new Error('실패'));
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply: reply1 });

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await scanIndices.execute({ args: [], reply: reply2 });

    expect(reply2.mock.calls[0]![0]).toContain('60초 이내');
    expect(_runGlobalScanAgent).toHaveBeenCalledOnce();
  });
});

describe('TelegramCommand 메타데이터 정합', () => {
  it('name + aliases 양쪽 등록 (/global_scan, /index_scan)', () => {
    expect(scanIndices.name).toBe('/scan_indices');
    expect(scanIndices.aliases).toContain('/global_scan');
    expect(scanIndices.aliases).toContain('/index_scan');
  });

  it('category=MKT, riskLevel=0, visibility=ADMIN', () => {
    expect(scanIndices.category).toBe('MKT');
    expect(scanIndices.riskLevel).toBe(0);
    expect(scanIndices.visibility).toBe('ADMIN');
  });

  it('description + usage 노출', () => {
    expect(scanIndices.description).toBeTruthy();
    expect(scanIndices.description).toContain('글로벌 지수');
    expect(scanIndices.usage).toBe('/scan_indices');
  });
});
