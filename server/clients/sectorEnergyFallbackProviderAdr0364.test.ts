// @responsibility ADR-0364 sectorEnergyFallbackProvider 회귀 테스트
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../trading/marketDataRefresh.js', () => ({
  fetchDailyBars: vi.fn(),
}));

import { fetchDailyBars } from '../trading/marketDataRefresh.js';
import {
  buildSectorEnergyFromYahooETF,
  ETF_FALLBACK_MIN_BARS,
  ETF_FALLBACK_PARTIAL_THRESHOLD,
  ETF_FALLBACK_RANGE,
  isSectorEnergyEtfFallbackDisabled,
  KOREAN_SECTOR_ETFS,
} from './sectorEnergyFallbackProvider.js';

const ORIGINAL_DISABLED = process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED;

beforeEach(() => {
  delete process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED;
  vi.mocked(fetchDailyBars).mockReset();
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED;
  else process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED = ORIGINAL_DISABLED;
});

describe('SSOT 상수 (ADR-0364)', () => {
  it('KOREAN_SECTOR_ETFS — 12 섹터 모두 등재', () => {
    expect(Object.keys(KOREAN_SECTOR_ETFS)).toHaveLength(12);
  });

  it('모든 ETF 심볼 .KS suffix (KRX 정합)', () => {
    for (const symbol of Object.values(KOREAN_SECTOR_ETFS)) {
      expect(symbol).toMatch(/^\d{6}\.KS$/);
    }
  });

  it('ETF_FALLBACK_RANGE = "1mo" (4주 산출 충분)', () => {
    expect(ETF_FALLBACK_RANGE).toBe('1mo');
  });

  it('ETF_FALLBACK_MIN_BARS = 20 (표본 임계)', () => {
    expect(ETF_FALLBACK_MIN_BARS).toBe(20);
  });

  it('ETF_FALLBACK_PARTIAL_THRESHOLD = 8 (PARTIAL 임계)', () => {
    expect(ETF_FALLBACK_PARTIAL_THRESHOLD).toBe(8);
  });

  it('사용자 명시 핵심 매핑 검증 — 반도체/이차전지/방산', () => {
    expect(KOREAN_SECTOR_ETFS['반도체']).toBe('091160.KS');
    expect(KOREAN_SECTOR_ETFS['이차전지']).toBe('305720.KS');
    expect(KOREAN_SECTOR_ETFS['방산']).toBe('449450.KS');
  });
});

describe('isSectorEnergyEtfFallbackDisabled — ENV 정확 비교 (ADR-0157)', () => {
  it('미설정 → false (default 활성)', () => {
    expect(isSectorEnergyEtfFallbackDisabled()).toBe(false);
  });
  it('"true" → true (fallback 비활성)', () => {
    process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED = 'true';
    expect(isSectorEnergyEtfFallbackDisabled()).toBe(true);
  });
  it('"1" / "TRUE" / "yes" → false (정확 비교)', () => {
    process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED = '1';
    expect(isSectorEnergyEtfFallbackDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED = 'TRUE';
    expect(isSectorEnergyEtfFallbackDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED = 'yes';
    expect(isSectorEnergyEtfFallbackDisabled()).toBe(false);
  });
});

function makeBars(closes: number[]) {
  return closes.map((close, i) => ({ ts: i, close }));
}

describe('buildSectorEnergyFromYahooETF — 동작 매트릭스', () => {
  it('ENV DISABLED → FAILED + 빈 inputs + fetchDailyBars 호출 0건', async () => {
    process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED = 'true';
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.dataQuality).toBe('FAILED');
    expect(r.inputs).toHaveLength(0);
    expect(r.validSectorCount).toBe(0);
    expect(r.totalSectorCount).toBe(12);
    expect(r.reasons[0]).toMatch(/SECTOR_ENERGY_ETF_FALLBACK_DISABLED/);
    expect(fetchDailyBars).not.toHaveBeenCalled();
  });

  it('12 섹터 모두 충분한 bars + 정상 수익률 → PARTIAL (validSectorCount=12)', async () => {
    // 각 ETF 가 100→105 (5% 4주 수익률) 21봉
    vi.mocked(fetchDailyBars).mockResolvedValue(makeBars(Array.from({ length: 21 }, (_, i) => 100 + i * 0.25)));
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.dataQuality).toBe('PARTIAL'); // 12 ≥ 8 threshold
    expect(r.inputs).toHaveLength(12);
    expect(r.validSectorCount).toBe(12);
    // 모든 섹터 return4w 양수 + volumeChangePct=0 + foreignConcentration=0
    for (const input of r.inputs) {
      expect(input.return4w).toBeGreaterThan(0);
      expect(input.volumeChangePct).toBe(0);
      expect(input.foreignConcentration).toBe(0);
    }
  });

  it('8 섹터만 응답 → PARTIAL (boundary)', async () => {
    let callCount = 0;
    vi.mocked(fetchDailyBars).mockImplementation(async () => {
      callCount++;
      // 첫 8 호출만 응답, 나머지 4건 null
      if (callCount <= 8) return makeBars(Array.from({ length: 21 }, (_, i) => 100 + i));
      return null;
    });
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.dataQuality).toBe('PARTIAL');
    expect(r.validSectorCount).toBe(8);
  });

  it('7 섹터만 응답 → STALE (PARTIAL 임계 미달)', async () => {
    let callCount = 0;
    vi.mocked(fetchDailyBars).mockImplementation(async () => {
      callCount++;
      if (callCount <= 7) return makeBars(Array.from({ length: 21 }, (_, i) => 100 + i));
      return null;
    });
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.dataQuality).toBe('STALE');
    expect(r.validSectorCount).toBe(7);
  });

  it('1 섹터만 응답 → STALE (validCount > 0)', async () => {
    let callCount = 0;
    vi.mocked(fetchDailyBars).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return makeBars(Array.from({ length: 21 }, (_, i) => 100 + i));
      return null;
    });
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.dataQuality).toBe('STALE');
    expect(r.validSectorCount).toBe(1);
  });

  it('모두 null → FAILED (validCount=0)', async () => {
    vi.mocked(fetchDailyBars).mockResolvedValue(null);
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.dataQuality).toBe('FAILED');
    expect(r.validSectorCount).toBe(0);
    expect(r.reasons.length).toBeGreaterThan(1); // 1 헤더 + 12 skip 사유
  });

  it('bars 19 (MIN_BARS 미달) → 해당 섹터 skip + reasons 등재', async () => {
    vi.mocked(fetchDailyBars).mockResolvedValue(makeBars(Array.from({ length: 19 }, (_, i) => 100 + i)));
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.validSectorCount).toBe(0);
    expect(r.dataQuality).toBe('FAILED');
    expect(r.reasons.some(s => /bars=19 < 20/.test(s))).toBe(true);
  });

  it('bars 20 (MIN_BARS 정확) → 산출', async () => {
    vi.mocked(fetchDailyBars).mockResolvedValue(makeBars(Array.from({ length: 20 }, (_, i) => 100 + i)));
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.validSectorCount).toBe(12);
  });

  it('수익률 +91% (sanity 위반 90% 초과) → 해당 섹터 skip', async () => {
    // 100 → 191 (91% 상승) — safePctChange sanity 90% 초과 → null
    vi.mocked(fetchDailyBars).mockResolvedValue(
      makeBars([100, ...Array.from({ length: 19 }, () => 100), 191]),
    );
    const r = await buildSectorEnergyFromYahooETF();
    // 모든 섹터가 동일한 sanity 위반 → 모두 skip → FAILED
    expect(r.validSectorCount).toBe(0);
    expect(r.dataQuality).toBe('FAILED');
    expect(r.reasons.some(s => /safePctChange null/.test(s))).toBe(true);
  });

  it('fetchDailyBars throw → 해당 섹터 skip + reasons 에 에러 메시지', async () => {
    vi.mocked(fetchDailyBars).mockRejectedValue(new Error('Yahoo 503'));
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.dataQuality).toBe('FAILED');
    expect(r.validSectorCount).toBe(0);
    expect(r.reasons.some(s => /Yahoo 503/.test(s))).toBe(true);
  });

  it('range 1mo + 모든 섹터에 동일 range 전달', async () => {
    vi.mocked(fetchDailyBars).mockResolvedValue(makeBars(Array.from({ length: 21 }, (_, i) => 100 + i)));
    await buildSectorEnergyFromYahooETF();
    // 12 호출 모두 range=1mo
    expect(fetchDailyBars).toHaveBeenCalledTimes(12);
    for (let i = 0; i < 12; i++) {
      const call = vi.mocked(fetchDailyBars).mock.calls[i];
      expect(call[1]).toBe('1mo');
    }
  });

  it('호출 심볼 매트릭스 정합 — KOREAN_SECTOR_ETFS 와 일치', async () => {
    vi.mocked(fetchDailyBars).mockResolvedValue(makeBars(Array.from({ length: 21 }, (_, i) => 100 + i)));
    await buildSectorEnergyFromYahooETF();
    const calledSymbols = vi.mocked(fetchDailyBars).mock.calls.map(c => c[0]);
    const expectedSymbols = Object.values(KOREAN_SECTOR_ETFS);
    expect(calledSymbols.sort()).toEqual(expectedSymbols.sort());
  });

  it('header reason — KRX OpenAPI 부재 마커', async () => {
    vi.mocked(fetchDailyBars).mockResolvedValue(makeBars(Array.from({ length: 21 }, (_, i) => 100 + i)));
    const r = await buildSectorEnergyFromYahooETF();
    expect(r.reasons[0]).toMatch(/KRX OpenAPI 부재/);
    expect(r.reasons[0]).toMatch(/ADR-0364/);
  });
});

// 정적 grep 가드
const SOURCE = readFileSync(
  resolve(__dirname, 'sectorEnergyFallbackProvider.ts'),
  'utf-8',
);

describe('sectorEnergyFallbackProvider.ts 정적 가드 (ADR-0364)', () => {
  it('호출자 0건 (Phase 1 dead code) — wrapper 만 export', () => {
    expect(SOURCE).toMatch(/export\s+async\s+function\s+buildSectorEnergyFromYahooETF/);
  });

  it('safePctChange 사용 — sanity 90% 임계 적용', () => {
    expect(SOURCE).toMatch(/safePctChange\s*\(/);
    expect(SOURCE).toMatch(/sanityBoundPct:\s*90/);
  });

  it('fetchDailyBars import (marketDataRefresh SSOT)', () => {
    expect(SOURCE).toMatch(/from\s+'\.\.\/trading\/marketDataRefresh/);
  });

  it('volumeChangePct + foreignConcentration = 0 명시 (ETF 한계)', () => {
    expect(SOURCE).toMatch(/volumeChangePct:\s*0/);
    expect(SOURCE).toMatch(/foreignConcentration:\s*0/);
  });

  it('ENV 정확 비교 의무', () => {
    expect(SOURCE).toMatch(/SECTOR_ENERGY_ETF_FALLBACK_DISABLED\s*===\s*'true'/);
  });
});
