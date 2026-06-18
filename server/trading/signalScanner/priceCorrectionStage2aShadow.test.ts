/**
 * @responsibility ADR-0623 Stage 2a 회귀 테스트 — ENV SSOT + Seam A 집계 채움 + LIVE 무접촉 정적 가드
 *
 * design.md §10.6 의 Stage 2a 케이스만 (#1,2,3,4,7,8,9,10,11). #5,6 [2b] 제외.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isPriceCorrectionShadowEnabled,
  isPriceCorrectionDisabled,
  evaluatePriceCorrection,
} from './priceCorrectionEngine.js';
import { evaluatePriceIntegrity } from './priceIntegrityChecker.js';
import { accumulatePriceIntegrityCorrection } from './scanDiagnostics/scanCounterAccumulators.js';
import { createScanCounters } from './scanDiagnostics/scanCounterFactory.js';

const REPO_ROOT = resolve(__dirname, '../../..');
function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

const ENV_KEYS = ['PRICE_CORRECTION_SHADOW_ENABLED', 'PRICE_CORRECTION_DISABLED'] as const;
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('ADR-0623 Stage 2a — ENV SSOT (isPriceCorrectionShadowEnabled)', () => {
  it('#1 ENV OFF byte-equiv: unset/false → shadow 채택 false (Stage 1 baseline)', () => {
    expect(isPriceCorrectionShadowEnabled()).toBe(false); // unset
    process.env.PRICE_CORRECTION_SHADOW_ENABLED = 'false';
    expect(isPriceCorrectionShadowEnabled()).toBe(false);
  });

  it('#2 ENV 헬퍼 정확 비교 (ADR-0157): true 만 true, 그 외 false', () => {
    process.env.PRICE_CORRECTION_SHADOW_ENABLED = 'true';
    expect(isPriceCorrectionShadowEnabled()).toBe(true);
    for (const v of ['TRUE', '1', '', 'yes', 'True', ' true ']) {
      process.env.PRICE_CORRECTION_SHADOW_ENABLED = v;
      expect(isPriceCorrectionShadowEnabled()).toBe(false);
    }
  });

  it('#10/#2 disabled 우선: PRICE_CORRECTION_DISABLED=true + shadow ON → false', () => {
    process.env.PRICE_CORRECTION_DISABLED = 'true';
    process.env.PRICE_CORRECTION_SHADOW_ENABLED = 'true';
    expect(isPriceCorrectionDisabled()).toBe(true);
    expect(isPriceCorrectionShadowEnabled()).toBe(false); // disabled 가 shadow 차단
  });

  it('진리표: 4 조합 SSOT 검증 (§2)', () => {
    const cases: Array<[string | undefined, string | undefined, boolean]> = [
      [undefined, undefined, false],
      [undefined, 'true', true],
      ['true', undefined, false],
      ['true', 'true', false],
    ];
    for (const [disabled, shadow, expected] of cases) {
      if (disabled === undefined) delete process.env.PRICE_CORRECTION_DISABLED;
      else process.env.PRICE_CORRECTION_DISABLED = disabled;
      if (shadow === undefined) delete process.env.PRICE_CORRECTION_SHADOW_ENABLED;
      else process.env.PRICE_CORRECTION_SHADOW_ENABLED = shadow;
      expect(isPriceCorrectionShadowEnabled()).toBe(expected);
    }
  });
});

describe('ADR-0623 Stage 2a — Seam A accumulator (집계 채움)', () => {
  it('#3 integrity/correction sample 누적 → counters samples push only', () => {
    const counters = createScanCounters();
    expect(counters.priceIntegritySamples).toBeUndefined();
    expect(counters.priceCorrectionSamples).toBeUndefined();

    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 51000,
      previousClose: 50000,
    });
    const correction = evaluatePriceCorrection({
      integrity,
      kis: { current: 51000, previousClose: 50000 },
    });
    accumulatePriceIntegrityCorrection(counters, integrity, correction);

    expect(counters.priceIntegritySamples).toHaveLength(1);
    expect(counters.priceIntegritySamples?.[0]).toEqual({ symbol: '005930', status: integrity.status });
    expect(counters.priceCorrectionSamples).toHaveLength(1);
    expect(counters.priceCorrectionSamples?.[0]).toEqual({
      correctionType: correction.correctionType,
      confidence: correction.confidence,
      usableForShadow: correction.usableForShadow,
    });
  });

  it('#3 STALE 다종목 누적 — statusCounts 분포 형성 재료', () => {
    const counters = createScanCounters();
    const symbols = ['005930', '000660', '035720'];
    for (const symbol of symbols) {
      const integrity = evaluatePriceIntegrity({
        symbol,
        currentPrice: 50000,
        currentPriceDate: '2026-05-04',
        previousClose: 50000,
        previousCloseDate: '2026-05-03',
        lastKrxTradingDate: '2026-05-06',
      });
      const correction = evaluatePriceCorrection({
        integrity,
        kis: { current: 51000, previousClose: 50000 },
      });
      accumulatePriceIntegrityCorrection(counters, integrity, correction);
    }
    expect(counters.priceIntegritySamples).toHaveLength(3);
    expect(counters.priceIntegritySamples?.every((s) => s.status === 'STALE')).toBe(true);
  });

  it('#9 원본 mutate 0 — accumulator 가 integrity/correction 객체 불변', () => {
    const counters = createScanCounters();
    const integrity = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 51000,
      previousClose: 50000,
    });
    const correction = evaluatePriceCorrection({
      integrity,
      kis: { current: 51000, previousClose: 50000 },
    });
    const integritySnapshot = JSON.stringify(integrity);
    const correctionSnapshot = JSON.stringify(correction);
    accumulatePriceIntegrityCorrection(counters, integrity, correction);
    expect(JSON.stringify(integrity)).toBe(integritySnapshot);
    expect(JSON.stringify(correction)).toBe(correctionSnapshot);
  });

  it('#4 Seam A LIVE 무변화 — accumulator 가 LIVE 카운터(entries/quoteFails 등) 무접촉', () => {
    const counters = createScanCounters();
    const before = JSON.stringify({
      entries: counters.entries,
      quoteFails: counters.quoteFails,
      gateMisses: counters.gateMisses,
      liveEligibleCount: counters.liveEligibleCount,
      shadowObservableCount: counters.shadowObservableCount,
    });
    const integrity = evaluatePriceIntegrity({ symbol: '005930', currentPrice: 51000, previousClose: 50000 });
    const correction = evaluatePriceCorrection({ integrity, kis: { current: 51000, previousClose: 50000 } });
    accumulatePriceIntegrityCorrection(counters, integrity, correction);
    const after = JSON.stringify({
      entries: counters.entries,
      quoteFails: counters.quoteFails,
      gateMisses: counters.gateMisses,
      liveEligibleCount: counters.liveEligibleCount,
      shadowObservableCount: counters.shadowObservableCount,
    });
    expect(after).toBe(before);
  });
});

describe('ADR-0623 Stage 2a — LIVE 무접촉 / 외부 API 0 정적 가드', () => {
  const BUY_LIST_LOOP = 'server/trading/signalScanner/perSymbol/buyListLoop.ts';
  const ACCUMULATORS = 'server/trading/signalScanner/scanDiagnostics/scanCounterAccumulators.ts';
  const PERSIST = 'server/trading/signalScanner/scanDiagnostics/persistScanResults.ts';

  it('#7 LIVE 본체 모듈 — corrected 값 LIVE decision 미사용 (entryEngine/exitEngine 무접촉)', () => {
    const liveBodies = [
      'server/trading/entryEngine.ts',
      'server/trading/exitEngine/index.ts',
      'server/trading/autoTradeEngine.ts',
      'server/trading/orchestrator/tradingOrchestrator.ts',
      'server/orchestrator/tradingOrchestrator.ts',
    ];
    for (const t of liveBodies) {
      let src: string;
      try {
        src = readSrc(t);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw e;
      }
      expect(src).not.toMatch(/priceCorrectionEngine/);
      expect(src).not.toMatch(/priceIntegrityChecker/);
      expect(src).not.toMatch(/\bcorrectedPrice\b/);
      expect(src).not.toMatch(/\bcorrectedGapPct\b/);
    }
  });

  it('#8 외부 API 0 — Seam A accumulator 가 fetch/axios/kisClient 호출 0건', () => {
    const src = readSrc(ACCUMULATORS);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/from\s+['"]axios['"]/);
    expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(src).not.toMatch(/\bkisGet\b/);
    expect(src).not.toMatch(/\bkisPost\b/);
    expect(src).not.toMatch(/from\s+['"][^'"]*kisClient[^'"]*['"]/);
  });

  it('#8 buyListLoop Seam A 블록 — corrected 입력은 reCheckQuote/currentPrice 만 (신규 fetch 0)', () => {
    const src = readSrc(BUY_LIST_LOOP);
    // Seam A 블록은 evaluatePriceIntegrity/evaluatePriceCorrection 를 호출하되 입력으로 신규
    // KIS quote fetch 를 추가하지 않는다 (kisIntradayCorrectionStep 결과 reCheckQuote 재사용).
    expect(src).toMatch(/Adr0623PriceCorrection/);
    expect(src).toMatch(/evaluatePriceIntegrity/);
    expect(src).toMatch(/evaluatePriceCorrection/);
    expect(src).toMatch(/accumulatePriceIntegrityCorrection/);
    // Seam A 가 isPriceCorrectionDisabled 게이팅 + try/catch 격리
    expect(src).toMatch(/isPriceCorrectionDisabled\(\)/);
  });

  it('persistScanResults reduce 블록 — ADR-0623 집계 채움 존재 + try/catch 격리', () => {
    const src = readSrc(PERSIST);
    expect(src).toMatch(/buildPriceIntegrityCorrectionAdr0623|ADR-0623/);
    expect(src).toMatch(/summaryDraft\.priceIntegrity\s*=/);
    expect(src).toMatch(/summaryDraft\.priceCorrection\s*=/);
  });
});
