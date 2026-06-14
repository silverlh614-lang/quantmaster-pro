// @responsibility 주간 캘리브레이션 평균수익/손실·RRR 회귀 — fills SSOT 에서 파생(returnPct strip 무관).
import { describe, it, expect, vi } from 'vitest';

// reportGenerator 는 import 시 다수 영속/네트워크 모듈을 끌어오므로 순수 헬퍼 테스트용으로 mock.
vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: vi.fn() }));
vi.mock('../clients/geminiClient.js', () => ({ callGemini: vi.fn() }));

import { buildWeeklyReportMetrics } from './reportGenerator.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

const NOW = Date.UTC(2026, 5, 14, 23, 0, 0); // 2026-06-14 23:00 UTC

// 영속된 청산 trade 를 모사: updateShadow 가 returnPct 를 strip 하므로 returnPct 는 없고
// 실현 수익률은 SELL fill 의 pnlPct(수량 가중)에만 존재한다.
function closedTrade(
  status: 'HIT_TARGET' | 'HIT_STOP',
  pnlPct: number,
  daysAgo = 2,
): ServerShadowTrade {
  const signalTime = new Date(NOW - daysAgo * 86_400_000).toISOString();
  return {
    stockCode: '000001',
    stockName: `종목${pnlPct}`,
    signalTime,
    status,
    // returnPct 의도적 부재 — 영속 round-trip 후 상태.
    fills: [
      { id: 'b1', type: 'BUY', qty: 10, price: 1000, reason: 'entry', timestamp: signalTime },
      { id: 's1', type: 'SELL', qty: 10, price: 1000 * (1 + pnlPct / 100), pnl: 0, pnlPct, reason: 'exit', timestamp: signalTime },
    ],
  } as unknown as ServerShadowTrade;
}

describe('buildWeeklyReportMetrics — fills SSOT 기반 평균수익/손실·RRR (returnPct strip 회귀)', () => {
  it('SELL fill pnlPct 로부터 avgWin/avgLoss/RRR 을 0 이 아닌 실제값으로 산출', () => {
    const shadows = [
      closedTrade('HIT_TARGET', 6.0),
      closedTrade('HIT_TARGET', 4.0),
      closedTrade('HIT_STOP', -2.0),
      closedTrade('HIT_STOP', -3.0),
    ];

    const m = buildWeeklyReportMetrics(shadows, NOW);

    expect(m.closed.length).toBe(4);
    expect(m.wins.length).toBe(2);
    expect(m.losses.length).toBe(2);
    expect(m.winRate).toBe(50);
    // 핵심 회귀: returnPct 부재에도 fills 에서 파생되어 0 이 아니다.
    expect(m.avgWin).toBeCloseTo(5.0, 5);
    expect(m.avgLoss).toBeCloseTo(2.5, 5);
    expect(m.rrr).toBeCloseTo(2.0, 5);
  });

  it('returnPct 를 직접 읽던 과거 버그였다면 0 이 나왔을 입력에서 비-0 보장', () => {
    const m = buildWeeklyReportMetrics([closedTrade('HIT_STOP', -7.45)], NOW);
    expect(m.avgLoss).toBeGreaterThan(0);
    expect(m.avgLoss).toBeCloseTo(7.45, 5);
  });
});
