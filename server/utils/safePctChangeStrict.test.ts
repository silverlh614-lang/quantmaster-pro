// @responsibility ADR-0117 safePctChangeStrict + DataQualityInfo SSOT 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  safePctChangeStrict,
  __resetSafePctChangeStrictWarnsForTests,
} from './safePctChange.js';
import {
  isDataQualityStrictDisabled,
  shouldBlockTradingByDataQuality,
  type DataQualityInfo,
} from '../types/dataQuality.js';

const ORIGINAL_ENV = process.env.DATA_QUALITY_STRICT_DISABLED;

beforeEach(() => {
  delete process.env.DATA_QUALITY_STRICT_DISABLED;
  __resetSafePctChangeStrictWarnsForTests();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DATA_QUALITY_STRICT_DISABLED;
  else process.env.DATA_QUALITY_STRICT_DISABLED = ORIGINAL_ENV;
});

describe('safePctChangeStrict — OK 분기', () => {
  it('정상 ±5% → ok=true / status=OK / blockTrading=false', () => {
    const r = safePctChangeStrict({
      current: 10500, base: 10000, source: 'KIS_REALTIME',
      context: 'test.normal',
    });
    expect(r.ok).toBe(true);
    expect(r.pct).toBeCloseTo(5, 5);
    expect(r.status).toBe('OK');
    expect(r.blockTrading).toBe(false);
    expect(r.blockDriftUpdate).toBe(false);
    expect(r.blockSizing).toBe(false);
    expect(r.reason).toMatch(/OK pct=5\.00%/);
  });

  it('정상 -10% → ok=true (음수 변화율도 정상)', () => {
    const r = safePctChangeStrict({
      current: 9000, base: 10000, source: 'KIS_REALTIME',
      context: 'test.negative_normal',
    });
    expect(r.ok).toBe(true);
    expect(r.pct).toBeCloseTo(-10, 5);
  });

  it('boundary +90% 정확 → 통과 (>; not >=)', () => {
    const r = safePctChangeStrict({
      current: 19000, base: 10000, source: 'KIS_REALTIME',
      context: 'test.boundary_pos',
    });
    expect(r.ok).toBe(true);
    expect(r.pct).toBeCloseTo(90, 5);
  });

  it('boundary -90% 정확 → 통과', () => {
    const r = safePctChangeStrict({
      current: 1000, base: 10000, source: 'KIS_REALTIME',
      context: 'test.boundary_neg',
    });
    expect(r.ok).toBe(true);
    expect(r.pct).toBeCloseTo(-90, 5);
  });
});

describe('safePctChangeStrict — STALE_BASE_OR_SPLIT_ADJUSTMENT', () => {
  it('+91% → ok=false / 3종 차단 모두 true', () => {
    const r = safePctChangeStrict({
      current: 19100, base: 10000, source: 'KIS_REALTIME',
      context: 'test.stale_pos',
    });
    expect(r.ok).toBe(false);
    expect(r.pct).toBeNull();
    expect(r.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(r.blockTrading).toBe(true);
    expect(r.blockDriftUpdate).toBe(true);
    expect(r.blockSizing).toBe(true);
    expect(r.reason).toMatch(/sanity violation/);
  });

  it('1차 로그 098460 +221% → STALE_BASE 차단', () => {
    const r = safePctChangeStrict({
      current: 40500, base: 12610, source: 'KIS_REALTIME',
      context: 'entryEngine.extensionPct',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(r.reason).toContain('absPct=221');
  });

  it('1차 로그 -91% (액면병합 의심) → STALE_BASE (90% 임계 초과)', () => {
    // current=900, base=10000 → -91% (90% 초과 차단)
    const r = safePctChangeStrict({
      current: 900, base: 10000, source: 'YAHOO_HISTORICAL',
      context: 'test.split_negative',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
  });

  it('maxAbsPct=50 override → 60% 차단', () => {
    const r = safePctChangeStrict({
      current: 16000, base: 10000, source: 'KIS_REALTIME',
      context: 'test.override_max',
      maxAbsPct: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
  });
});

describe('safePctChangeStrict — ZERO_OR_INVALID_PRICE', () => {
  it('current=0 → ZERO_OR_INVALID_PRICE 차단', () => {
    const r = safePctChangeStrict({
      current: 0, base: 10000, source: 'KIS_REALTIME',
      context: 'test.zero_current',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('ZERO_OR_INVALID_PRICE');
    expect(r.blockTrading).toBe(true);
  });

  it('base=0 → ZERO_OR_INVALID_PRICE 차단', () => {
    const r = safePctChangeStrict({
      current: 10000, base: 0, source: 'KIS_REALTIME',
      context: 'test.zero_base',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('ZERO_OR_INVALID_PRICE');
  });

  it('current 음수 → ZERO_OR_INVALID_PRICE', () => {
    const r = safePctChangeStrict({
      current: -100, base: 10000, source: 'KIS_REALTIME',
      context: 'test.neg_current',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('ZERO_OR_INVALID_PRICE');
  });

  it('NaN current → ZERO_OR_INVALID_PRICE', () => {
    const r = safePctChangeStrict({
      current: NaN, base: 10000, source: 'KIS_REALTIME',
      context: 'test.nan',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('ZERO_OR_INVALID_PRICE');
  });

  it('Infinity → ZERO_OR_INVALID_PRICE', () => {
    const r = safePctChangeStrict({
      current: Infinity, base: 10000, source: 'KIS_REALTIME',
      context: 'test.inf',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('ZERO_OR_INVALID_PRICE');
  });
});

describe('safePctChangeStrict — SOURCE_UNTRUSTED', () => {
  it('forbidYahooHistorical=true + source=YAHOO_HISTORICAL → 차단', () => {
    const r = safePctChangeStrict({
      current: 10500, base: 10000, source: 'YAHOO_HISTORICAL',
      context: 'test.untrusted',
      forbidYahooHistorical: true,
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('SOURCE_UNTRUSTED');
    expect(r.blockTrading).toBe(true);
    expect(r.reason).toMatch(/Yahoo historical/);
  });

  it('forbidYahooHistorical=false (default) + YAHOO_HISTORICAL → 통과', () => {
    const r = safePctChangeStrict({
      current: 10500, base: 10000, source: 'YAHOO_HISTORICAL',
      context: 'test.allow_yahoo_default',
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('OK');
  });

  it('forbidYahooHistorical=true + KIS_REALTIME → 통과', () => {
    const r = safePctChangeStrict({
      current: 10500, base: 10000, source: 'KIS_REALTIME',
      context: 'test.kis_with_forbid_yahoo',
      forbidYahooHistorical: true,
    });
    expect(r.ok).toBe(true);
  });
});

describe('safePctChangeStrict — ENV DATA_QUALITY_STRICT_DISABLED', () => {
  it('default (미설정) → strict 활성', () => {
    expect(isDataQualityStrictDisabled()).toBe(false);
    const r = safePctChangeStrict({
      current: 22000, base: 10000, source: 'KIS_REALTIME',
      context: 'test.env_default',
    });
    expect(r.ok).toBe(false);
  });

  it('"true" 명시 → ok=true 반환 (위반 시 warn 만)', () => {
    process.env.DATA_QUALITY_STRICT_DISABLED = 'true';
    expect(isDataQualityStrictDisabled()).toBe(true);
    const r = safePctChangeStrict({
      current: 22000, base: 10000, source: 'KIS_REALTIME',
      context: 'test.env_disabled',
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('OK');
    expect(r.reason).toMatch(/ENV uncritical/);
  });

  it('ENV=true + ZERO_OR_INVALID → ok=true 우회', () => {
    process.env.DATA_QUALITY_STRICT_DISABLED = 'true';
    const r = safePctChangeStrict({
      current: 0, base: 10000, source: 'KIS_REALTIME',
      context: 'test.env_zero',
    });
    expect(r.ok).toBe(true);
  });
});

describe('shouldBlockTradingByDataQuality SSOT', () => {
  it('undefined → false', () => {
    expect(shouldBlockTradingByDataQuality(undefined)).toBe(false);
  });

  it('OK → false', () => {
    const dq: DataQualityInfo = {
      status: 'OK', reason: 'ok', updatedAt: new Date().toISOString(),
    };
    expect(shouldBlockTradingByDataQuality(dq)).toBe(false);
  });

  it('STALE_BASE_OR_SPLIT_ADJUSTMENT → true', () => {
    const dq: DataQualityInfo = {
      status: 'STALE_BASE_OR_SPLIT_ADJUSTMENT', reason: 'stale',
      updatedAt: new Date().toISOString(),
    };
    expect(shouldBlockTradingByDataQuality(dq)).toBe(true);
  });

  it('ZERO_OR_INVALID_PRICE → true', () => {
    const dq: DataQualityInfo = {
      status: 'ZERO_OR_INVALID_PRICE', reason: 'invalid',
      updatedAt: new Date().toISOString(),
    };
    expect(shouldBlockTradingByDataQuality(dq)).toBe(true);
  });

  it('SOURCE_UNTRUSTED → true', () => {
    const dq: DataQualityInfo = {
      status: 'SOURCE_UNTRUSTED', reason: 'yahoo',
      updatedAt: new Date().toISOString(),
    };
    expect(shouldBlockTradingByDataQuality(dq)).toBe(true);
  });
});
