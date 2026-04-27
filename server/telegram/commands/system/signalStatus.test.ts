/**
 * @responsibility signalStatus.cmd 회귀 테스트
 *
 * 검증:
 *   - formatSignalStatusMessage 분기 (빈 records / N건 표시 / 6 status emoji / KST 시각 / BLOCK 사유)
 *   - cmd execute 인자 검증 (기본 N=10 / 음수 → 10 fallback / 30 cap)
 *   - getRecentTradeSignalRecords throw 시 graceful 응답
 *   - 메타데이터: name + alias (/signals) + category=SYS + riskLevel=0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _getRecentTradeSignalRecords = vi.fn();

vi.mock('../../../persistence/tradeSignalStatusRepo.js', () => ({
  getRecentTradeSignalRecords: _getRecentTradeSignalRecords,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let signalStatus: typeof import('./signalStatus.cmd.js').default;
let formatSignalStatusMessage: typeof import('./signalStatus.cmd.js').formatSignalStatusMessage;

beforeEach(async () => {
  vi.resetModules();
  _getRecentTradeSignalRecords.mockReset();
  const mod = await import('./signalStatus.cmd.js');
  signalStatus = mod.default;
  formatSignalStatusMessage = mod.formatSignalStatusMessage;
});

describe('formatSignalStatusMessage', () => {
  it('빈 records → "최근 추천 없음" 안내', () => {
    const out = formatSignalStatusMessage([], 10);
    expect(out).toContain('📊 신호 상태 (최근 10건)');
    expect(out).toContain('최근 추천 없음.');
  });

  it('AUTO_TRADE_READY ✅ + KST 시각 + 마지막 전이 사유 표시', () => {
    const out = formatSignalStatusMessage(
      [
        {
          id: '2026-04-27T05:00:00Z:005930',
          stockCode: '005930',
          stockName: '삼성전자',
          status: 'AUTO_TRADE_READY',
          recommendationType: 'CONFIRMED_STRONG_BUY',
          createdAt: '2026-04-27T05:00:00Z',
          transitions: [
            { from: null, to: 'AI_CANDIDATE', reason: 'AI 추천', at: '2026-04-27T05:00:00Z' },
            { from: 'AI_CANDIDATE', to: 'DATA_VERIFIED', reason: 'Gate 통과', at: '2026-04-27T05:01:00Z' },
            { from: 'DATA_VERIFIED', to: 'RISK_APPROVED', reason: 'Kelly 0.75', at: '2026-04-27T06:42:00Z' },
            { from: 'RISK_APPROVED', to: 'AUTO_TRADE_READY', reason: '실주문 직전', at: '2026-04-27T06:43:00Z' },
          ],
          schemaVersion: 1,
        },
      ],
      10,
    );
    expect(out).toContain('✅ 005930 삼성전자');
    expect(out).toContain('AUTO_TRADE_READY');
    expect(out).toContain('15:43'); // KST = UTC+9, 06:43 → 15:43
    expect(out).toContain('실주문 직전');
  });

  it('BLOCKED 종목 ❌ + blockGate + blockReason 표시', () => {
    const out = formatSignalStatusMessage(
      [
        {
          id: '2026-04-27T05:00:00Z:247540',
          stockCode: '247540',
          stockName: '에코프로',
          status: 'BLOCKED',
          recommendationType: 'BUY',
          createdAt: '2026-04-27T05:00:00Z',
          blockGate: 'SECTOR',
          blockReason: '배터리 32% 초과',
          transitions: [
            { from: null, to: 'AI_CANDIDATE', reason: 'AI 추천', at: '2026-04-27T05:00:00Z' },
            { from: 'AI_CANDIDATE', to: 'BLOCKED', reason: '배터리 32% 초과', at: '2026-04-27T05:02:00Z' },
          ],
          finalizedAt: '2026-04-27T05:02:00Z',
          schemaVersion: 1,
        },
      ],
      5,
    );
    expect(out).toContain('❌ 247540 에코프로');
    expect(out).toContain('SECTOR');
    expect(out).toContain('배터리 32% 초과');
  });

  it('6 status emoji 모두 분기', () => {
    const sample = (status: string) => ({
      id: `2026-04-27T05:00:00Z:00000${status[0]}`,
      stockCode: `00000${status[0]}`,
      stockName: status,
      status: status as never,
      recommendationType: 'BUY' as const,
      createdAt: '2026-04-27T05:00:00Z',
      transitions: [
        { from: null, to: 'AI_CANDIDATE' as const, reason: 'r', at: '2026-04-27T05:00:00Z' },
      ],
      schemaVersion: 1 as const,
    });
    const out = formatSignalStatusMessage(
      [
        sample('AI_CANDIDATE'),
        sample('DATA_VERIFIED'),
        sample('RISK_APPROVED'),
        sample('USER_APPROVED'),
        sample('AUTO_TRADE_READY'),
        sample('BLOCKED'),
      ],
      10,
    );
    expect(out).toContain('🌱'); // AI_CANDIDATE
    expect(out).toContain('🟢'); // DATA_VERIFIED + USER_APPROVED
    expect(out).toContain('🟡'); // RISK_APPROVED
    expect(out).toContain('✅'); // AUTO_TRADE_READY
    expect(out).toContain('❌'); // BLOCKED
  });

  it('잘못된 timestamp → ? fallback (시각 자리)', () => {
    const out = formatSignalStatusMessage(
      [
        {
          id: 'bad',
          stockCode: '999999',
          stockName: '?',
          status: 'AI_CANDIDATE',
          recommendationType: 'BUY',
          createdAt: 'not-an-iso',
          transitions: [
            { from: null, to: 'AI_CANDIDATE', reason: 'r', at: 'not-an-iso' },
          ],
          schemaVersion: 1,
        },
      ],
      1,
    );
    expect(out).toContain('(?)');
  });
});

describe('signalStatus cmd execute', () => {
  it('args 없음 → 기본 N=10 호출', async () => {
    _getRecentTradeSignalRecords.mockReturnValue([]);
    const reply = vi.fn(async () => undefined);
    await signalStatus.execute({ args: [], reply });
    expect(_getRecentTradeSignalRecords).toHaveBeenCalledWith(10);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('최근 10건'));
  });

  it('N=5 명시 → 5 호출', async () => {
    _getRecentTradeSignalRecords.mockReturnValue([]);
    const reply = vi.fn(async () => undefined);
    await signalStatus.execute({ args: ['5'], reply });
    expect(_getRecentTradeSignalRecords).toHaveBeenCalledWith(5);
  });

  it('N=100 (cap 30) — 30 호출', async () => {
    _getRecentTradeSignalRecords.mockReturnValue([]);
    const reply = vi.fn(async () => undefined);
    await signalStatus.execute({ args: ['100'], reply });
    expect(_getRecentTradeSignalRecords).toHaveBeenCalledWith(30);
  });

  it('잘못된 N (음수 / NaN) → 10 fallback', async () => {
    _getRecentTradeSignalRecords.mockReturnValue([]);
    const reply = vi.fn(async () => undefined);
    await signalStatus.execute({ args: ['-5'], reply });
    expect(_getRecentTradeSignalRecords).toHaveBeenCalledWith(10);
    _getRecentTradeSignalRecords.mockClear();
    await signalStatus.execute({ args: ['abc'], reply });
    expect(_getRecentTradeSignalRecords).toHaveBeenCalledWith(10);
  });

  it('throw 시 ❌ 실패 메시지 응답 (graceful)', async () => {
    _getRecentTradeSignalRecords.mockImplementation(() => {
      throw new Error('disk error');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reply = vi.fn(async () => undefined);
    await signalStatus.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('❌'));
    errSpy.mockRestore();
  });
});

describe('signalStatus 메타데이터', () => {
  it('name + alias + category + riskLevel + visibility', () => {
    expect(signalStatus.name).toBe('/signal_status');
    expect(signalStatus.aliases).toEqual(['/signals']);
    expect(signalStatus.category).toBe('SYS');
    expect(signalStatus.riskLevel).toBe(0);
    expect(signalStatus.visibility).toBe('ADMIN');
    expect(signalStatus.usage).toContain('N=10');
  });
});
