// @responsibility kellyDriftFailurePromotion 결함 수리 회귀 테스트
/**
 * Layer 2 wiring 1/5 — failurePatternDB conditionKeys 빈 벡터 결함.
 *
 * 결함: 기존 코드 `recent.entryKellySnapshot ? [] : []` 가 양쪽 분기 모두 빈 배열을
 * 반환해 buildEntryConditionScores 가 항상 27조건 NEUTRAL 벡터(=5)만 생성. 이로 인해
 * failurePatternDB cosine 매칭이 메타(섹터/regime)만으로 평가되어 손실 패턴 학습 무력화.
 *
 * 수리: ADR-0006 PR-19 가 영속하는 entryConditionScores 를 baseline 으로 직접 사용,
 * 부재 시 NEUTRAL 27 벡터 fallback. 본 회귀 테스트는 결함 재발 차단을 위한 최소 가드.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  // mock-drift fix: production 리팩토링으로 shadowTradeRepo→buyPipeline→liveBuyExecutor 가
  // 동일 모듈의 appendShadowLog 를 transitively 요구(순환 import). importOriginal spread 는
  // 무거운 순환 그래프를 실제 로드해 mock override 가 production 인스턴스에 전파되지 않으므로,
  // 테스트가 쓰는 loadShadowTrades + 체인이 요구하는 appendShadowLog 만 명시 stub 한다.
  loadShadowTrades: vi.fn().mockReturnValue([]),
  appendShadowLog: vi.fn(),
}));

vi.mock('../persistence/failurePatternRepo.js', () => ({
  appendFailurePattern: vi.fn(),
}));

import { loadShadowTrades, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { appendFailurePattern } from '../persistence/failurePatternRepo.js';
import {
  promoteKellyDriftPattern,
  KELLY_DRIFT_PROMOTION_THRESHOLD,
} from './kellyDriftFailurePromotion.js';
import { ENTRY_CONDITION_NEUTRAL_SCORE, ENTRY_CONDITION_HIGH_SCORE } from './entryConditionScores.js';

const mockLoad = loadShadowTrades as unknown as ReturnType<typeof vi.fn>;
const mockAppend = appendFailurePattern as unknown as ReturnType<typeof vi.fn>;

const ID = 'STOP_TOO_TIGHT';
const NOW = new Date('2026-04-30T00:00:00Z').getTime();
const TWO_DAYS_AGO = new Date(NOW - 2 * 86400 * 1000).toISOString();

function mkLossTrade(opts: {
  daysHeld: number;
  entryConditionScores?: Record<number, number>;
}): ServerShadowTrade {
  const exitTime = new Date(NOW - 86400 * 1000).toISOString();
  const signalTime = new Date(NOW - (opts.daysHeld + 1) * 86400 * 1000).toISOString();
  return {
    id: `t_${Math.random()}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime,
    shadowEntryPrice: 70_000,
    quantity: 10,
    stopLoss: 65_000,
    targetPrice: 80_000,
    status: 'HIT_STOP',
    exitTime,
    returnPct: -7.5,
    entryRegime: 'R2_BULL',
    exitInvalidationMatch: { id: ID, matchedAt: exitTime },
    entryKellySnapshot: {
      tier: 'STANDARD',
      signalGrade: 'BUY',
      rawKellyMultiplier: 1.0,
      effectiveKelly: 0.05,
      fractionalCap: 0.5,
      ipsAtEntry: 50,
      regimeAtEntry: 'R2_BULL',
      accountRiskBudgetPctAtEntry: 0,
      confidenceModifier: 1.0,
      snapshotAt: signalTime,
    },
    entryConditionScores: opts.entryConditionScores,
  } as ServerShadowTrade;
}

describe('promoteKellyDriftPattern — 결함 수리 회귀 가드', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockAppend.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('entryConditionScores 영속된 trade — appendFailurePattern 가 NEUTRAL 외 점수 보존', () => {
    // 27조건 중 일부를 HIGH(7) 으로 박제 — 결함 시에는 모두 NEUTRAL(5) 로 덮어씌워졌다.
    const persistedScores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) persistedScores[i] = ENTRY_CONDITION_NEUTRAL_SCORE;
    persistedScores[3] = ENTRY_CONDITION_HIGH_SCORE; // 예: ROE_TYPE_3
    persistedScores[14] = ENTRY_CONDITION_HIGH_SCORE; // 예: VCP_BREAKOUT
    persistedScores[20] = ENTRY_CONDITION_HIGH_SCORE; // 예: INSTITUTION_BUY

    const trades: ServerShadowTrade[] = Array.from({ length: KELLY_DRIFT_PROMOTION_THRESHOLD }, () =>
      mkLossTrade({ daysHeld: 30, entryConditionScores: persistedScores }),
    );
    mockLoad.mockReturnValue(trades);

    const result = promoteKellyDriftPattern(trades[trades.length - 1]);

    expect(result.promoted).toBe(true);
    expect(mockAppend).toHaveBeenCalledTimes(1);
    const appended = mockAppend.mock.calls[0][0] as { conditionScores: Record<number, number> };
    // 결함이 부활하면 모든 27 키가 NEUTRAL(5) 가 되어 이 단언이 실패한다.
    expect(appended.conditionScores[3]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(appended.conditionScores[14]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    expect(appended.conditionScores[20]).toBe(ENTRY_CONDITION_HIGH_SCORE);
    // 비-HIGH 조건은 NEUTRAL 유지
    expect(appended.conditionScores[1]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
  });

  it('entryConditionScores 부재 (레거시 trade) — NEUTRAL 27 벡터로 안전 fallback', () => {
    const trades: ServerShadowTrade[] = Array.from({ length: KELLY_DRIFT_PROMOTION_THRESHOLD }, () =>
      mkLossTrade({ daysHeld: 30 }),
    );
    mockLoad.mockReturnValue(trades);

    const result = promoteKellyDriftPattern(trades[trades.length - 1]);

    expect(result.promoted).toBe(true);
    const appended = mockAppend.mock.calls[0][0] as { conditionScores: Record<number, number> };
    for (let i = 1; i <= 27; i++) {
      expect(appended.conditionScores[i]).toBe(ENTRY_CONDITION_NEUTRAL_SCORE);
    }
    // 27 키 모두 존재 검증 — 빈 객체로 회귀하지 않음
    expect(Object.keys(appended.conditionScores)).toHaveLength(27);
  });

  it('이전 결함 패턴(빈 벡터) 재발 차단 — appended.conditionScores 가 비어있지 않음', () => {
    // 회귀 가드: 결함 코드(`recentKeys = ... ? [] : []`) 가 부활해도 27 키 보장.
    const trades: ServerShadowTrade[] = Array.from({ length: KELLY_DRIFT_PROMOTION_THRESHOLD }, () =>
      mkLossTrade({ daysHeld: 30 }),
    );
    mockLoad.mockReturnValue(trades);

    promoteKellyDriftPattern(trades[trades.length - 1]);

    const appended = mockAppend.mock.calls[0][0] as { conditionScores: Record<number, number> };
    expect(appended.conditionScores).not.toEqual({});
    expect(Object.keys(appended.conditionScores).length).toBeGreaterThan(0);
  });
});

// 사용 안 하는 import 제거를 위한 silencer (TWO_DAYS_AGO 는 향후 시간 기반 분기 회귀에 활용)
void TWO_DAYS_AGO;
