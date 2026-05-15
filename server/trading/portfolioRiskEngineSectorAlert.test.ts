// @responsibility PATCH-008 섹터 집중도 자동대응 오발동 방지 단위 테스트
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  buildSectorObserveOnlyAlert,
  buildSectorOverflowAlert,
  calculateExposureMetrics,
  classifySectorType,
  evaluateSectorRiskAutoAction,
  flushSectorRiskSummaryIfDue,
  formatSectorRiskSummary,
  recordSectorRiskSummary,
  resetSectorRiskSummaryForTest,
  shouldEmitSectorRiskDetail,
  SECTOR_TIGHT_STOP_RATIO,
  type SectorTighteningMeta,
} from './portfolioRiskEngine.js';


afterEach(() => {
  vi.unstubAllEnvs();
  resetSectorRiskSummaryForTest();
});

const baseConfig = {
  maxSectorConcentrationByOpenPositionsPct: 30,
  maxSectorExposureByCapitalPct: 30,
  maxSectorExposureByNavPct: 30,
  minPositionsForSectorAutoAction: 2,
  minSectorExposureAmount: 3_000_000,
  minSectorExposureByCapitalPct: 3,
  allowShadowSectorAutoAction: false,
  allowLiveSectorAutoAction: true,
};

describe('PATCH-008 sector exposure metrics', () => {
  it('상수 SSOT — SECTOR_TIGHT_STOP_RATIO = 0.99 (트레일링 후보 -1%)', () => {
    expect(SECTOR_TIGHT_STOP_RATIO).toBe(0.99);
  });

  it('Test 1: Shadow 1종목 원금 대비 0.1494% — 100% 보유 비중 착시만 OBSERVE', () => {
    const metrics = calculateExposureMetrics({
      sectorName: '우량기업부',
      sectorExposureAmount: 149_400,
      totalOpenPositionExposure: 149_400,
      positionCount: 1,
      baseCapital: 100_000_000,
      accountNAV: 100_000_000,
      config: baseConfig,
    });
    const decision = evaluateSectorRiskAutoAction({ metrics, mode: 'SHADOW', config: baseConfig });
    const msg = buildSectorObserveOnlyAlert({
      metrics,
      posNames: '한선엔지니어링',
      reasons: decision.reasons,
    });

    expect(metrics.concentrationByOpenPositionsPct).toBe(100);
    expect(metrics.exposureByBaseCapitalPct).toBeCloseTo(0.1494, 4);
    expect(metrics.sectorType).toBe('MARKET_SEGMENT');
    expect(decision.canTriggerAutoAction).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      'SINGLE_POSITION_ARTIFACT',
      'SMALL_EXPOSURE_ARTIFACT',
      'MARKET_SEGMENT_NOT_INDUSTRY_SECTOR',
      'SHADOW_POSITION_OBSERVE_ONLY',
      'AUTO_ACTION_DISABLED_FOR_SHADOW',
    ]));
    expect(msg).toContain('[섹터 집중도 참고 – 자동대응 없음]');
    expect(msg).toContain('분류유형: MARKET_SEGMENT');
    expect(msg).toContain('원금 대비 노출: 0.15%');
    expect(msg).not.toContain('[섹터 집중도 초과 – 자동 대응]');
    expect(msg).not.toContain('손절선 긴축');
    expect(msg).not.toContain('가격 도달 시 청산');
    expect(msg).not.toContain('LIVE 전환 전 섹터 분산 필수');
  });

  it('Test 2: LIVE 4종목 원금 대비 35% 산업 섹터 — VALID_LIVE_SECTOR_RISK', () => {
    const metrics = calculateExposureMetrics({
      sectorName: '반도체',
      sectorExposureAmount: 35_000_000,
      totalOpenPositionExposure: 35_000_000,
      positionCount: 4,
      baseCapital: 100_000_000,
      accountNAV: 100_000_000,
      config: baseConfig,
    });
    const decision = evaluateSectorRiskAutoAction({ metrics, mode: 'LIVE', config: baseConfig });
    const msg = buildSectorOverflowAlert({
      sector: '반도체',
      weightPct: metrics.concentrationByOpenPositionsPct,
      limitPct: 30,
      posNames: 'A, B, C, D',
      exitTarget: null,
      metrics,
    });

    expect(metrics.sectorType).toBe('INDUSTRY');
    expect(metrics.positionCount).toBe(4);
    expect(metrics.sectorExposureAmount).toBe(35_000_000);
    expect(metrics.exposureByBaseCapitalPct).toBe(35);
    expect(decision.canTriggerAutoAction).toBe(true);
    expect(decision.reasons).toContain('VALID_LIVE_SECTOR_RISK');
    expect(msg).toContain('[LIVE 섹터 노출 초과]');
    expect(msg).toContain('원금 대비 노출: 35.0%');
    expect(msg).toContain('자동 액션 후보');
    expect(msg).not.toContain('가격이');
  });

  it('Test 3: LIVE 1종목 원금 대비 35% — 섹터 룰은 포지션 수 부족, 단일종목 리스크로 라우팅', () => {
    const metrics = calculateExposureMetrics({
      sectorName: '반도체',
      sectorExposureAmount: 35_000_000,
      totalOpenPositionExposure: 35_000_000,
      positionCount: 1,
      baseCapital: 100_000_000,
      accountNAV: 100_000_000,
      config: baseConfig,
    });
    const decision = evaluateSectorRiskAutoAction({ metrics, mode: 'LIVE', config: baseConfig });

    expect(decision.canTriggerAutoAction).toBe(false);
    expect(decision.singlePositionRisk).toBe(true);
    expect(decision.reasons).toContain('INSUFFICIENT_POSITION_COUNT');
    expect(decision.reasons).toContain('SINGLE_POSITION_ARTIFACT');
  });

  it('Test 4: Shadow 3종목 원금 대비 40% — SHADOW 직접 자동대응 금지', () => {
    const metrics = calculateExposureMetrics({
      sectorName: '반도체',
      sectorExposureAmount: 40_000_000,
      totalOpenPositionExposure: 40_000_000,
      positionCount: 3,
      baseCapital: 100_000_000,
      accountNAV: 100_000_000,
      config: baseConfig,
    });
    const decision = evaluateSectorRiskAutoAction({ metrics, mode: 'SHADOW', config: baseConfig });

    expect(decision.canTriggerAutoAction).toBe(false);
    expect(decision.reasons).toContain('SHADOW_POSITION_OBSERVE_ONLY');
    expect(decision.reasons).toContain('AUTO_ACTION_DISABLED_FOR_SHADOW');
    expect(decision.reasons).not.toContain('VALID_LIVE_SECTOR_RISK');
  });

  it('Test 5: marketSegment 라벨은 MARKET_SEGMENT로 분류되어 산업 섹터 자동대응 제외', () => {
    for (const label of ['우량기업부', '벤처기업부', '중견기업부', 'KOSDAQ']) {
      const metrics = calculateExposureMetrics({
        sectorName: label,
        sectorExposureAmount: 50_000_000,
        totalOpenPositionExposure: 50_000_000,
        positionCount: 3,
        baseCapital: 100_000_000,
        accountNAV: 100_000_000,
        config: baseConfig,
      });
      const decision = evaluateSectorRiskAutoAction({ metrics, mode: 'LIVE', config: baseConfig });

      expect(classifySectorType(label)).toBe('MARKET_SEGMENT');
      expect(decision.canTriggerAutoAction).toBe(false);
      expect(decision.reasons).toContain('MARKET_SEGMENT_NOT_INDUSTRY_SECTOR');
    }
  });

  it('SHADOW 수익 보호 후보 메타는 섹터 자동대응 메시지와 분리 가능', () => {
    const target: SectorTighteningMeta = {
      stockName: '한선엔지니어링',
      stockCode: '452280',
      currentPrice: 24_900,
      tightStop: 24_651,
      pnlPct: 6.55,
    };
    expect(target.tightStop).toBe(Math.round(target.currentPrice * SECTOR_TIGHT_STOP_RATIO));
  });
});


describe('HOTFIX-013 sector risk log normalization', () => {
  it('production suppresses observe-only concentration details unless verbose flags are enabled', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(shouldEmitSectorRiskDetail({
      mode: 'SHADOW',
      canTriggerAutoAction: false,
      executionImpact: 'NONE',
    })).toBe(false);

    vi.stubEnv('ENABLE_VERBOSE_RISK_LOGS', 'true');
    expect(shouldEmitSectorRiskDetail({
      mode: 'SHADOW',
      canTriggerAutoAction: false,
      executionImpact: 'NONE',
    })).toBe(true);
  });

  it('LIVE risk-control candidate keeps detailed logging enabled for warn classification', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(shouldEmitSectorRiskDetail({
      mode: 'LIVE',
      canTriggerAutoAction: true,
      executionImpact: 'RISK_CONTROL_ONLY',
      autoActionTriggered: true,
    })).toBe(true);
  });

  it('aggregates observe-only sectors into SECTOR_RISK_SUMMARY info payload', () => {
    vi.stubEnv('SECTOR_RISK_SUMMARY_INTERVAL_SECONDS', '60');
    const metrics = calculateExposureMetrics({
      sectorName: '자동차부품',
      sectorExposureAmount: 1_451_000,
      totalOpenPositionExposure: 3_264_000,
      positionCount: 1,
      baseCapital: 100_000_000,
      accountNAV: 100_000_000,
      config: baseConfig,
    });
    const loggerOverride = { info: vi.fn() };

    expect(metrics.sectorType).toBe('INDUSTRY');
    recordSectorRiskSummary({
      metrics,
      mode: 'SHADOW',
      reasons: [
        'OPEN_POSITION_CONCENTRATION_ONLY',
        'INSUFFICIENT_POSITION_COUNT',
        'SINGLE_POSITION_ARTIFACT',
        'SMALL_EXPOSURE_ARTIFACT',
        'INSUFFICIENT_CAPITAL_EXPOSURE',
        'SHADOW_POSITION_OBSERVE_ONLY',
        'AUTO_ACTION_DISABLED_FOR_SHADOW',
      ],
      autoActionTriggered: false,
      autoActionBlocked: true,
    }, 1_000);

    expect(flushSectorRiskSummaryIfDue(30_000, { loggerOverride })).toBe(false);
    expect(loggerOverride.info).not.toHaveBeenCalled();
    expect(flushSectorRiskSummaryIfDue(61_000, { loggerOverride })).toBe(true);
    expect(loggerOverride.info).toHaveBeenCalledWith(expect.stringContaining('[SECTOR_RISK_SUMMARY]'));
    expect(loggerOverride.info).toHaveBeenCalledWith(expect.stringContaining('checkedSectors=1'));
    expect(loggerOverride.info).toHaveBeenCalledWith(expect.stringContaining('autoActionBlocked=1'));
    expect(loggerOverride.info).toHaveBeenCalledWith(expect.stringContaining('shadowObserveOnly=1'));
    expect(loggerOverride.info).toHaveBeenCalledWith(expect.stringContaining('executionImpact=NONE'));
    expect(loggerOverride.info).toHaveBeenCalledWith(expect.stringContaining('severity=info'));
    expect(loggerOverride.info).toHaveBeenCalledWith(expect.stringContaining('logClass=RISK_OBSERVE'));
  });

  it('formats summary with top reasons and max exposure metrics', () => {
    const summary = formatSectorRiskSummary({
      windowStartedAt: 0,
      checkedSectors: 3,
      autoActionBlocked: 3,
      autoActionTriggered: 0,
      shadowObserveOnly: 3,
      maxExposureByCapitalPct: 1.53,
      maxConcentrationByOpenPositionsPct: 46.76,
      reasons: {
        SINGLE_SMALL_SHADOW_POSITION_ARTIFACT: 3,
        AUTO_ACTION_DISABLED_FOR_SHADOW: 3,
        SMALL_EXPOSURE_ARTIFACT: 3,
      },
      sampleSectors: [],
    });

    expect(summary).toContain('[SECTOR_RISK_SUMMARY]');
    expect(summary).toContain('window=60s');
    expect(summary).toContain('maxExposureByCapitalPct=1.53');
    expect(summary).toContain('maxConcentrationByOpenPositionsPct=46.76');
    expect(summary).toContain('topReasons=SINGLE_SMALL_SHADOW_POSITION_ARTIFACT:3');
  });
});
