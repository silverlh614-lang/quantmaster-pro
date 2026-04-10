import { describe, expect, it } from 'vitest';
import { evaluateStock, evaluateTMA } from './quantEngine';
import { AI_MODELS } from '../constants/aiConfig';
import type {
  ConditionId,
  MarketRegime,
  SectorRotation,
  MacroEnvironment,
  FinancialStressIndex,
} from '../types/quant';

// ─── 공통 픽스처 ───────────────────────────────────────────────────────────────

/** 27개 조건을 모두 높은 점수(8)로 채운 스톡 데이터 */
function createHighStockData(): Record<ConditionId, number> {
  const data: Record<ConditionId, number> = {} as any;
  for (let i = 1; i <= 27; i++) {
    data[i as ConditionId] = 8;
  }
  return data;
}

/** 모든 조건이 0점인 스톡 데이터 */
function createZeroStockData(): Record<ConditionId, number> {
  const data: Record<ConditionId, number> = {} as any;
  for (let i = 1; i <= 27; i++) {
    data[i as ConditionId] = 0;
  }
  return data;
}

/** MHS HIGH(≈100) 를 만드는 안정 거시 환경 */
function createHealthyMacroEnv(partial: Partial<MacroEnvironment> = {}): MacroEnvironment {
  return {
    bokRateDirection: 'CUTTING',
    us10yYield: 3.5,
    krUsSpread: 0.5,
    m2GrowthYoY: 7.0,
    bankLendingGrowth: 6.0,
    nominalGdpGrowth: 4.0,
    oeciCliKorea: 101.5,
    exportGrowth3mAvg: 8.0,
    vkospi: 16,
    samsungIri: 1.3,
    vix: 15,
    usdKrw: 1320,
    ...partial,
  };
}

/**
 * CRISIS 거시 환경: VKOSPI>35, VIX>30, MHS<30
 * → classifyExtendedRegime 이 FULL_STOP 을 반환하게 만든다.
 */
function createCrisisMacroEnv(): MacroEnvironment {
  return {
    bokRateDirection: 'HIKING',
    us10yYield: 5.5,
    krUsSpread: -2.0,
    m2GrowthYoY: 1.0,
    bankLendingGrowth: -1.0,
    nominalGdpGrowth: 5.0,
    oeciCliKorea: 97.0,
    exportGrowth3mAvg: -10.0,
    vkospi: 40,
    samsungIri: 0.5,
    vix: 35,
    usdKrw: 1380,
  };
}

/**
 * 구매 정지(buyingHalted) 거시 환경: MHS < 40 이나 CRISIS 임계값 미달.
 * VKOSPI/VIX 가 CRISIS 조건(>35/>30)을 충족하지 않아 FULL_STOP 은 발동되지 않는다.
 */
function createBuyingHaltedMacroEnv(): MacroEnvironment {
  return {
    bokRateDirection: 'HIKING',
    us10yYield: 5.5,
    krUsSpread: -2.0,
    m2GrowthYoY: 1.0,
    bankLendingGrowth: -1.0,
    nominalGdpGrowth: 5.0,
    oeciCliKorea: 97.0,
    exportGrowth3mAvg: -10.0,
    vkospi: 28,  // ≤35 → FULL_STOP 미발동
    samsungIri: 0.5,
    vix: 25,     // ≤30 → FULL_STOP 미발동
    usdKrw: 1380,
  };
}

function createBaseRegime(partial: Partial<MarketRegime> = {}): MarketRegime {
  return {
    type: '상승초기',
    weightMultipliers: {} as Record<ConditionId, number>,
    vKospi: 16,
    samsungIri: 1.3,
    ...partial,
  };
}

function createLeadingSector(): SectorRotation {
  return {
    name: '반도체',
    rank: 10,   // 상위 10% — rank < 2 는 LATE 사이클 판정이므로 제외
    strength: 80,
    isLeading: true,
    sectorLeaderNewHigh: false,
  };
}

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe('evaluateStock - Gate Cascade', () => {
  it('FULL_STOP: FSI CRISIS 레짐에서 모든 게이트 차단 + 강력 매도', () => {
    const fsiFsi: FinancialStressIndex = {
      tedSpread: { bps: 200, alert: 'CRISIS' },
      usHySpread: { bps: 900, trend: 'WIDENING' },
      moveIndex: { current: 180, alert: 'EXTREME' },
      compositeScore: 90,
      systemAction: 'CRISIS',
      lastUpdated: new Date().toISOString(),
    };

    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      false,
      3.0,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      createHealthyMacroEnv(),
      50,
      undefined,
      { financialStress: fsiFsi },
    );

    expect(result.gate1Passed).toBe(false);
    expect(result.gate2Passed).toBe(false);
    expect(result.gate3Passed).toBe(false);
    expect(result.positionSize).toBe(0);
    expect(result.recommendation).toBe('강력 매도');
    expect(result.emergencyStop).toBe(true);
  });

  it('FULL_STOP: VKOSPI>35 + VIX>30 + MHS<30 위기 레짐에서 모든 게이트 차단', () => {
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      false,
      3.0,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      createCrisisMacroEnv(),
    );

    expect(result.gate1Passed).toBe(false);
    expect(result.positionSize).toBe(0);
    expect(result.recommendation).toBe('강력 매도');
  });

  it('emergencyStop=true: 비상정지 시 모든 게이트 차단 + positionSize=0', () => {
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      true,   // emergencyStop
      3.0,
    );

    expect(result.gate1Passed).toBe(false);
    expect(result.positionSize).toBe(0);
    expect(result.emergencyStop).toBe(true);
  });

  it('buyingHalted: MHS<40 거시 환경에서 매수 중단 + positionSize=0', () => {
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      false,
      3.0,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      createBuyingHaltedMacroEnv(),
    );

    expect(result.gate1Passed).toBe(false);
    expect(result.positionSize).toBe(0);
    expect(result.gate0Result?.buyingHalted).toBe(true);
  });

  it('Gate 1 실패: GATE1_IDS 조건이 임계값 미달일 때 후속 게이트 미평가', () => {
    const result = evaluateStock(
      createZeroStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      false,
      3.0,
    );

    expect(result.gate1Passed).toBe(false);
    expect(result.gate2Passed).toBe(false);
    expect(result.gate3Passed).toBe(false);
    expect(result.gate2Score).toBe(0);
    expect(result.gate3Score).toBe(0);
    expect(result.positionSize).toBe(0);
  });

  it('전체 통과: 높은 스코어에서 Gate 1/2/3 모두 통과 + 양수 positionSize', () => {
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      false,
      3.0,
    );

    expect(result.gate1Passed).toBe(true);
    expect(result.gate2Passed).toBe(true);
    expect(result.gate3Passed).toBe(true);
    expect(result.positionSize).toBeGreaterThan(0);
  });

  it('RRR < 2.0: RRR 필터 미달 시 positionSize=0 + 관망 권고', () => {
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      false,
      1.5,   // rrr < 2.0
    );

    expect(result.positionSize).toBe(0);
    expect(result.recommendation).toBe('관망');
  });

  it('매도 신호 ≥5: 강력 매도 + positionSize=0', () => {
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0,
      false,
      3.0,
      [1, 2, 3, 4, 5],  // sellSignals 5개
    );

    expect(result.recommendation).toBe('강력 매도');
    expect(result.positionSize).toBe(0);
    expect(result.sellScore).toBe(5);
  });

  it('과열 신호 ≥3: 유포리아 감지 시 매도 권고로 전환', () => {
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      3,     // euphoriaSignals ≥ 3
      false,
      3.0,
    );

    expect(result.recommendation).toBe('매도');
    expect(result.euphoriaLevel).toBe(3);
  });

  it('AI_MODELS.PRIMARY 상수가 gemini-3-flash-preview 와 일치', () => {
    expect(AI_MODELS.PRIMARY).toBe('gemini-3-flash-preview');
  });
});

// ─── TMA (추세 모멘텀 가속도 측정기) ─────────────────────────────────────────────

describe('evaluateTMA', () => {
  it('감속 경보: TMA < 0 → DECELERATION', () => {
    // 수익률이 줄어드는 종가 시퀀스 (7일: 6개의 수익률)
    // returns: [+2%, +1.5%, +1%, +0.5%, +0.2%, +0.1%]
    // TMA = (0.1 - 2.0) / 5 = -0.38 → DECELERATION
    const closes = [1000, 1020, 1035.3, 1045.66, 1050.89, 1052.99, 1054.05];
    const result = evaluateTMA(closes);
    expect(result.tma).toBeLessThan(0);
    expect(result.alert).toBe('DECELERATION');
  });

  it('즉각 대응: TMA < -0.5 → IMMEDIATE', () => {
    // 급격한 감속: 초반 큰 상승 후 하락 전환
    // returns: [+3%, +2%, +1%, 0%, -1%, -2%]
    // TMA = (-2 - 3) / 5 = -1.0 → IMMEDIATE
    const closes = [1000, 1030, 1050.6, 1061.11, 1061.11, 1050.50, 1029.49];
    const result = evaluateTMA(closes);
    expect(result.tma).toBeLessThan(-0.5);
    expect(result.alert).toBe('IMMEDIATE');
  });

  it('정상: TMA >= 0 → NONE', () => {
    // 가속 중인 종가 시퀀스
    // returns: [+0.5%, +1%, +1.5%, +2%, +2.5%, +3%]
    // TMA = (3.0 - 0.5) / 5 = 0.5 → NONE
    const closes = [1000, 1005, 1015.05, 1030.28, 1050.89, 1077.16, 1109.47];
    const result = evaluateTMA(closes);
    expect(result.tma).toBeGreaterThanOrEqual(0);
    expect(result.alert).toBe('NONE');
  });

  it('데이터 부족 시 안전 기본값 반환', () => {
    const result = evaluateTMA([1000, 1010, 1020]);
    expect(result.tma).toBe(0);
    expect(result.alert).toBe('NONE');
  });

  it('evaluateStock에 dailyCloses 전달 시 tma 결과 포함', () => {
    const closes = [1000, 1030, 1050.6, 1061.11, 1061.11, 1050.50, 1029.49];
    const result = evaluateStock(
      createHighStockData(),
      createBaseRegime(),
      'A',
      createLeadingSector(),
      0, false, 3, [], undefined, undefined, undefined, undefined, undefined,
      createHealthyMacroEnv(), 50,
      { dailyCloses: closes },
    );
    expect(result.tma).toBeDefined();
    expect(result.tma!.alert).toBe('IMMEDIATE');
  });
});
