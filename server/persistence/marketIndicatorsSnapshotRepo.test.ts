/**
 * @responsibility marketIndicatorsSnapshotRepo 회귀 (ADR-0062 PR-γ)
 *
 * load/save round-trip + mergeFreshIntoSnapshot 정책 (성공 필드만 갱신, NaN/Infinity 무시,
 * 음수 가격 거부) + fillMissingFromSnapshot fallback (실패 필드 채움 + staleFields 정확).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';

import {
  fillMissingFromSnapshot,
  loadMarketIndicatorsSnapshot,
  MARKET_INDICATOR_FIELDS,
  mergeFreshIntoSnapshot,
  saveMarketIndicatorsSnapshot,
  __testOnly,
  type MarketIndicatorsFresh,
  type MarketIndicatorsSnapshot,
} from './marketIndicatorsSnapshotRepo.js';
import { MARKET_INDICATORS_SNAPSHOT_FILE } from './paths.js';

const NOW = '2026-04-27T00:00:00.000Z';

function makeFresh(overrides: Partial<MarketIndicatorsFresh> = {}): MarketIndicatorsFresh {
  return {
    vix: 18.5,
    us10yYield: 4.25,
    usShortRate: 5.30,
    samsungIri: 1.05,
    vkospi: 17.8,
    vkospiDayChange: 0.5,
    vkospi5dTrend: -2.1,
    kospi: { price: 2700, change: 15, changePct: 0.56 },
    kosdaq: { price: 870, change: -3, changePct: -0.34 },
    ewyReturn: 1.2,
    mtumReturn: 2.5,
    ...overrides,
  };
}

describe('MARKET_INDICATOR_FIELDS — 11 필드 SSOT', () => {
  it('정확히 11 필드 (vix/us10yYield/usShortRate/samsungIri/vkospi*3/kospi/kosdaq/ewy/mtum)', () => {
    expect(MARKET_INDICATOR_FIELDS).toHaveLength(11);
    expect([...MARKET_INDICATOR_FIELDS]).toEqual([
      'vix', 'us10yYield', 'usShortRate', 'samsungIri',
      'vkospi', 'vkospiDayChange', 'vkospi5dTrend',
      'kospi', 'kosdaq', 'ewyReturn', 'mtumReturn',
    ]);
  });
});

describe('marketIndicatorsSnapshotRepo — load/save round-trip', () => {
  beforeEach(() => {
    __testOnly.removeSnapshotFile();
  });
  afterEach(() => {
    __testOnly.removeSnapshotFile();
  });

  it('파일 부재 시 빈 객체 반환', () => {
    const snap = loadMarketIndicatorsSnapshot();
    expect(snap).toEqual({});
  });

  it('save → load round-trip — 성공 필드 모두 보존', () => {
    const fresh = makeFresh();
    const merged = mergeFreshIntoSnapshot({}, fresh, NOW);
    expect(saveMarketIndicatorsSnapshot(merged)).toBe(true);

    const loaded = loadMarketIndicatorsSnapshot();
    expect(loaded.vix?.value).toBe(18.5);
    expect(loaded.kospi?.value).toEqual({ price: 2700, change: 15, changePct: 0.56 });
    expect(loaded.updatedAt).toBe(NOW);
  });

  it('손상 JSON 은 빈 객체 fallback', () => {
    fs.writeFileSync(MARKET_INDICATORS_SNAPSHOT_FILE, '{not valid json');
    const snap = loadMarketIndicatorsSnapshot();
    expect(snap).toEqual({});
  });

  it('null/array 직접 저장 시 빈 객체 fallback (스키마 가드)', () => {
    fs.writeFileSync(MARKET_INDICATORS_SNAPSHOT_FILE, 'null');
    expect(loadMarketIndicatorsSnapshot()).toEqual({});

    fs.writeFileSync(MARKET_INDICATORS_SNAPSHOT_FILE, '[1,2,3]');
    expect(loadMarketIndicatorsSnapshot()).toEqual({});
  });
});

describe('mergeFreshIntoSnapshot — 성공 필드만 갱신', () => {
  it('빈 snapshot + 정상 fresh — 모든 11 필드 갱신 + capturedAt 동기화', () => {
    const fresh = makeFresh();
    const out = mergeFreshIntoSnapshot({}, fresh, NOW);
    expect(out.vix?.value).toBe(18.5);
    expect(out.vix?.capturedAt).toBe(NOW);
    expect(out.kospi?.value).toEqual({ price: 2700, change: 15, changePct: 0.56 });
    expect(out.updatedAt).toBe(NOW);
  });

  it('null 필드는 snapshot 의 last-known-good 보존 (덮어쓰지 않음)', () => {
    const previous: MarketIndicatorsSnapshot = {
      vix: { value: 20.0, capturedAt: '2026-04-26T00:00:00.000Z' },
      kospi: { value: { price: 2680, change: 0, changePct: 0 }, capturedAt: '2026-04-26T00:00:00.000Z' },
    };
    const fresh = makeFresh({ vix: null, kospi: null });
    const out = mergeFreshIntoSnapshot(previous, fresh, NOW);
    // null 필드는 보존
    expect(out.vix?.value).toBe(20.0);
    expect(out.vix?.capturedAt).toBe('2026-04-26T00:00:00.000Z');
    expect(out.kospi?.value).toEqual({ price: 2680, change: 0, changePct: 0 });
    // 다른 성공 필드는 갱신
    expect(out.us10yYield?.value).toBe(4.25);
    expect(out.us10yYield?.capturedAt).toBe(NOW);
  });

  it('NaN / Infinity 값은 무시 (snapshot 보존)', () => {
    const previous: MarketIndicatorsSnapshot = {
      vix: { value: 20.0, capturedAt: '2026-04-26T00:00:00.000Z' },
    };
    const fresh = makeFresh({ vix: NaN as unknown as number, us10yYield: Infinity });
    const out = mergeFreshIntoSnapshot(previous, fresh, NOW);
    expect(out.vix?.value).toBe(20.0); // NaN 무시 — 이전 값 보존
    expect(out.us10yYield).toBeUndefined(); // Infinity 무시 — snapshot 에 새로 추가 안 됨
  });

  it('kospi quote: price <= 0 또는 NaN 은 무시', () => {
    const previous: MarketIndicatorsSnapshot = {};
    const fresh = makeFresh({ kospi: { price: 0, change: 0, changePct: 0 } });
    const out = mergeFreshIntoSnapshot(previous, fresh, NOW);
    expect(out.kospi).toBeUndefined();

    const fresh2 = makeFresh({ kospi: { price: NaN, change: 0, changePct: 0 } });
    const out2 = mergeFreshIntoSnapshot(previous, fresh2, NOW);
    expect(out2.kospi).toBeUndefined();
  });

  it('updatedAt 은 매 호출마다 capturedAt 으로 갱신', () => {
    const fresh = makeFresh();
    const out1 = mergeFreshIntoSnapshot({}, fresh, '2026-04-26T00:00:00.000Z');
    expect(out1.updatedAt).toBe('2026-04-26T00:00:00.000Z');

    const out2 = mergeFreshIntoSnapshot(out1, fresh, '2026-04-27T01:00:00.000Z');
    expect(out2.updatedAt).toBe('2026-04-27T01:00:00.000Z');
  });
});

describe('fillMissingFromSnapshot — null 필드 fallback', () => {
  it('snapshot 부재 + 일부 null 필드 — null 그대로 유지, staleFields 빈 배열', () => {
    const fresh = makeFresh({ vix: null, kospi: null });
    const out = fillMissingFromSnapshot(fresh, {});
    expect(out.body.vix).toBeNull();
    expect(out.body.kospi).toBeNull();
    expect(out.staleFields).toEqual([]);
  });

  it('snapshot 보유 + null 필드 — snapshot 값으로 채우고 staleFields 에 기록', () => {
    const snapshot: MarketIndicatorsSnapshot = {
      vix: { value: 20.0, capturedAt: '2026-04-26T00:00:00.000Z' },
      kospi: { value: { price: 2680, change: 0, changePct: 0 }, capturedAt: '2026-04-26T00:00:00.000Z' },
    };
    const fresh = makeFresh({ vix: null, kospi: null });
    const out = fillMissingFromSnapshot(fresh, snapshot);
    expect(out.body.vix).toBe(20.0);
    expect(out.body.kospi).toEqual({ price: 2680, change: 0, changePct: 0 });
    expect(out.staleFields.sort()).toEqual(['kospi', 'vix']);
  });

  it('성공 필드는 fresh 그대로 사용 (staleFields 에 포함 안 됨)', () => {
    const snapshot: MarketIndicatorsSnapshot = {
      vix: { value: 20.0, capturedAt: '2026-04-26T00:00:00.000Z' },
    };
    const fresh = makeFresh(); // vix=18.5 (성공)
    const out = fillMissingFromSnapshot(fresh, snapshot);
    expect(out.body.vix).toBe(18.5); // fresh 그대로
    expect(out.staleFields).toEqual([]);
  });

  it('snapshot 의 모든 필드 + 모든 fresh null — 11 필드 모두 stale', () => {
    const snapshot: MarketIndicatorsSnapshot = {};
    for (const field of MARKET_INDICATOR_FIELDS) {
      const value = field === 'kospi' || field === 'kosdaq'
        ? { price: 100, change: 0, changePct: 0 }
        : 100;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (snapshot as any)[field] = { value, capturedAt: '2026-04-26T00:00:00.000Z' };
    }

    const allNullFresh: MarketIndicatorsFresh = {
      vix: null, us10yYield: null, usShortRate: null, samsungIri: null,
      vkospi: null, vkospiDayChange: null, vkospi5dTrend: null,
      kospi: null, kosdaq: null, ewyReturn: null, mtumReturn: null,
    };
    const out = fillMissingFromSnapshot(allNullFresh, snapshot);
    expect(out.staleFields).toHaveLength(11);
    expect([...out.staleFields].sort()).toEqual([...MARKET_INDICATOR_FIELDS].sort());
  });
});
