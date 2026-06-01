// @responsibility buildMarketRallyLens 단위 테스트 — 조건1/4/6 활성·ENV OFF·providerIssue 비변환·입력부재 degrade·executionImpact 불변 검증.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildMarketRallyLens,
  isMarketRallyLensEnabled,
  type MarketRallyLensInput,
} from './marketRallyLens.js';
import type { MarketRallyLens } from './recommendationTypes.js';

const ENV_KEY = 'MARKET_RALLY_LENS_ENABLED';

function baseInput(overrides: Partial<MarketRallyLensInput> = {}): MarketRallyLensInput {
  return {
    kospiDayReturn: null,
    kospi20dReturn: null,
    foreignNetBuy5d: null,
    marketInstitutionNetBuyApprox: null,
    asOf: '2026-06-01T00:00:00.000Z',
    snapshotId: 'snap_test',
    ...overrides,
  };
}

describe('buildMarketRallyLens', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });

  describe('ENV gate', () => {
    it('미설정 → DISABLED (FEATURE_DISABLED, enabled=false)', () => {
      delete process.env[ENV_KEY];
      expect(isMarketRallyLensEnabled()).toBe(false);
      const lens = buildMarketRallyLens(baseInput({ kospiDayReturn: 3.0 }));
      expect(lens.enabled).toBe(false);
      expect(lens.reason).toBe('FEATURE_DISABLED');
      // 입력에 급등이 있어도 OFF 면 bullish 로 변환 안 함.
      expect(lens.kospiReturnPct).toBeNull();
      expect(lens.executionImpact).toBe('NONE');
      expect(lens.recommendationOnly).toBe(true);
    });

    it('명시적 false → DISABLED', () => {
      process.env[ENV_KEY] = 'false';
      const lens = buildMarketRallyLens(baseInput({ kospiDayReturn: 3.0 }));
      expect(lens.enabled).toBe(false);
      expect(lens.reason).toBe('FEATURE_DISABLED');
    });

    it('OFF 시에도 snapshotId 는 carry 된다 (정합 추적)', () => {
      delete process.env[ENV_KEY];
      const lens = buildMarketRallyLens(baseInput({ snapshotId: 'snap_carry' }));
      expect(lens.snapshotId).toBe('snap_carry');
    });
  });

  describe('ENV ON — 활성 조건 (조건1/4/6)', () => {
    beforeEach(() => {
      process.env[ENV_KEY] = 'true';
    });

    it('조건1: KOSPI 당일 +1.5%↑ → KOSPI_RALLY_1_5 활성', () => {
      const lens = buildMarketRallyLens(baseInput({ kospiDayReturn: 1.5 }));
      expect(lens.enabled).toBe(true);
      expect(lens.reason).toBe('KOSPI_RALLY_1_5');
      expect(lens.kospiReturnPct).toBe(1.5);
      expect(lens.executionImpact).toBe('NONE');
      expect(lens.recommendationOnly).toBe(true);
    });

    it('조건4: 외국인 5일 순매수 강세 → FOREIGN_5D_ACCUMULATION 활성', () => {
      const lens = buildMarketRallyLens(
        baseInput({ kospiDayReturn: 0.2, foreignNetBuy5d: 5000 }),
      );
      expect(lens.enabled).toBe(true);
      expect(lens.reason).toBe('FOREIGN_5D_ACCUMULATION');
      expect(lens.investorFlow.foreignNetBuy5d).toBe(5000);
      expect(lens.investorFlow.label).toBe('BULLISH');
      expect(lens.executionImpact).toBe('NONE');
    });

    it('조건6: KOSPI 20일 추세 상승 + 당일 반등 → KOSPI_20D_UPTREND_DAY_REBOUND 활성', () => {
      // 당일 < 1.5(조건1 미충족), 외국인 0(조건4 미충족), 20일>0 & 당일>0 (조건6 충족)
      const lens = buildMarketRallyLens(
        baseInput({ kospiDayReturn: 0.8, kospi20dReturn: 4.0, foreignNetBuy5d: 0 }),
      );
      expect(lens.enabled).toBe(true);
      expect(lens.reason).toBe('KOSPI_20D_UPTREND_DAY_REBOUND');
      expect(lens.executionImpact).toBe('NONE');
      expect(lens.recommendationOnly).toBe(true);
    });

    it('조건 미충족 (입력 존재) → NO_RALLY, enabled=false', () => {
      const lens = buildMarketRallyLens(
        baseInput({ kospiDayReturn: 0.3, kospi20dReturn: -1.0, foreignNetBuy5d: 0 }),
      );
      expect(lens.enabled).toBe(false);
      expect(lens.reason).toBe('NO_RALLY');
      expect(lens.executionImpact).toBe('NONE');
    });

    it('조건 OR 최초 매칭 — 조건1 우선 (당일 급등 + 외국인 강세 동시)', () => {
      const lens = buildMarketRallyLens(
        baseInput({ kospiDayReturn: 2.0, foreignNetBuy5d: 5000 }),
      );
      expect(lens.reason).toBe('KOSPI_RALLY_1_5');
    });
  });

  describe('조건 2/3/5/7 입력 부재 degrade', () => {
    beforeEach(() => {
      process.env[ENV_KEY] = 'true';
    });

    it('조건1·4·6 입력 전부 부재 → RALLY_INPUT_NOT_AVAILABLE (조건2/3/5/7 미평가 degrade)', () => {
      const lens = buildMarketRallyLens(baseInput());
      expect(lens.enabled).toBe(false);
      expect(lens.reason).toBe('RALLY_INPUT_NOT_AVAILABLE');
      expect(lens.kosdaqReturnPct).toBeNull(); // 조건5 입력 부재
      expect(lens.marketBreadth).toBeNull();   // 조건7 입력 부재
      expect(lens.executionImpact).toBe('NONE');
    });

    it('kosdaqDayReturn 미제공 시 kosdaqReturnPct=null (조건5 degrade — 활성 사유 안 됨)', () => {
      const lens = buildMarketRallyLens(baseInput({ kospiDayReturn: 1.6 }));
      expect(lens.kosdaqReturnPct).toBeNull();
      // 조건5(KOSPI_STRONG_KOSDAQ_WEAK) 는 절대 reason 으로 선택되지 않는다.
      expect(lens.reason).not.toBe('KOSPI_STRONG_KOSDAQ_WEAK');
      expect(lens.reason).not.toBe('MARKET_BREADTH_ADVANCE');
      expect(lens.reason).not.toBe('KOSPI_RALLY_2_0_INSTITUTION');
      expect(lens.reason).not.toBe('KOSPI_RALLY_2_5');
    });
  });

  describe('불변식 #6 — providerIssue 비변환', () => {
    beforeEach(() => {
      process.env[ENV_KEY] = 'true';
    });

    it('providerIssue=true → enabled=false, RALLY_UNKNOWN_PROVIDER_ISSUE, label=UNKNOWN (bullish/bearish 변환 금지)', () => {
      // 급등 입력이 있어도 providerIssue 면 UNKNOWN 으로만 처리.
      const lens = buildMarketRallyLens(
        baseInput({ kospiDayReturn: 3.0, foreignNetBuy5d: 9000, providerIssue: true }),
      );
      expect(lens.enabled).toBe(false);
      expect(lens.reason).toBe('RALLY_UNKNOWN_PROVIDER_ISSUE');
      expect(lens.investorFlow.label).toBe('UNKNOWN');
      expect(lens.kospiReturnPct).toBeNull();
      expect(lens.executionImpact).toBe('NONE');
      expect(lens.recommendationOnly).toBe(true);
    });

    it('입력 모두 null + ENV ON → BULLISH 로 승격하지 않음 (UNKNOWN 유지, degrade)', () => {
      const lens = buildMarketRallyLens(baseInput());
      expect(lens.investorFlow.label).toBe('UNKNOWN');
      expect(lens.enabled).toBe(false);
    });
  });

  describe('타입 리터럴 불변 — 모든 분기에서 executionImpact/recommendationOnly 고정', () => {
    it('OFF/ON/providerIssue/NO_RALLY 전 분기 executionImpact==="NONE" & recommendationOnly===true', () => {
      const cases: MarketRallyLens[] = [];
      delete process.env[ENV_KEY];
      cases.push(buildMarketRallyLens(baseInput({ kospiDayReturn: 2.0 })));
      process.env[ENV_KEY] = 'true';
      cases.push(buildMarketRallyLens(baseInput({ kospiDayReturn: 2.0 })));
      cases.push(buildMarketRallyLens(baseInput({ providerIssue: true })));
      cases.push(buildMarketRallyLens(baseInput({ kospiDayReturn: 0.1, foreignNetBuy5d: 0, kospi20dReturn: -1 })));
      for (const lens of cases) {
        expect(lens.executionImpact).toBe('NONE');
        expect(lens.recommendationOnly).toBe(true);
      }
    });
  });
});
