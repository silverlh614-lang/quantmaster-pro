// @responsibility ADR-0597 횡단면 percentile shadow 보조점수 순수 산출 회귀 (midrank·동률·결손·관측 전용 마커).
import { describe, expect, it } from 'vitest';
import {
  buildGate1CrossSectionalShadowReportAdr0597,
  GATE1_MARKET_SIGNAL_COMPONENT_CODES,
} from './gate1CrossSectionalShadowScoreAdr0597.js';

function row(symbol: string, actualScore: number, marketScores?: number[]) {
  return {
    symbol,
    actualScore,
    ...(marketScores
      ? {
          positiveComponents: marketScores.map((weightedScore, i) => ({
            code: GATE1_MARKET_SIGNAL_COMPONENT_CODES[i % GATE1_MARKET_SIGNAL_COMPONENT_CODES.length],
            weightedScore,
          })),
        }
      : {}),
  };
}

describe('buildGate1CrossSectionalShadowReportAdr0597', () => {
  it('midrank percentile — 단조·경계 (최저 0, 최고 100)', () => {
    const report = buildGate1CrossSectionalShadowReportAdr0597([
      row('A', 72), row('B', 66), row('C', 62), row('D', 57), row('E', 50),
    ]);
    expect(report.candidates).toBe(5);
    expect(report.scores.map((s) => s.symbol)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(report.scores.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(report.scores[0].totalPercentile).toBe(100);
    expect(report.scores[4].totalPercentile).toBe(0);
    expect(report.totalScoreMedian).toBe(62);
    expect(report.totalScoreMax).toBe(72);
    expect(report.topSymbols).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('동률은 0.5 가중 midrank, n=1 은 중앙(50)', () => {
    const tied = buildGate1CrossSectionalShadowReportAdr0597([
      row('A', 60), row('B', 60), row('C', 50),
    ]);
    const a = tied.scores.find((s) => s.symbol === 'A');
    const b = tied.scores.find((s) => s.symbol === 'B');
    expect(a?.totalPercentile).toBe(75);
    expect(a?.totalPercentile).toBe(b?.totalPercentile);
    expect(buildGate1CrossSectionalShadowReportAdr0597([row('X', 53.6)]).scores[0].totalPercentile).toBe(50);
  });

  it('시장 블록 — 6종 합산(음수 clamp), 컴포넌트 부재 시 null (결손≠0, 불변식 #6)', () => {
    const report = buildGate1CrossSectionalShadowReportAdr0597([
      row('A', 70, [10, 8, -2]),
      row('B', 60),
      { symbol: 'C', actualScore: 55, positiveComponents: [{ code: 'WATCHLIST_PRIORITY', weightedScore: 8 }] },
    ]);
    expect(report.scores.find((s) => s.symbol === 'A')?.marketBlockScore).toBe(18);
    expect(report.scores.find((s) => s.symbol === 'B')?.marketBlockScore).toBeNull();
    // 상수 블록(WATCHLIST_PRIORITY)만 있는 후보는 시장 블록 산출 대상이 아니다.
    expect(report.scores.find((s) => s.symbol === 'C')?.marketBlockScore).toBeNull();
    expect(report.scores.find((s) => s.symbol === 'B')?.marketBlockPercentile).toBeNull();
  });

  it('관측 전용 마커 고정 + 빈 입력/비유한 점수 무시', () => {
    const empty = buildGate1CrossSectionalShadowReportAdr0597([
      { symbol: '', actualScore: 50 },
      { symbol: 'N', actualScore: Number.NaN },
    ]);
    expect(empty.candidates).toBe(0);
    expect(empty.totalScoreMedian).toBeNull();
    expect(empty.executionImpact).toBe('NONE');
    expect(empty.thresholdAutoChanged).toBe(false);
    expect(empty.operatorApprovalRequired).toBe(true);
  });
});
