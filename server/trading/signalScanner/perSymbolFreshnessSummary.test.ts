// @responsibility ADR-0557 묶음0 dead-carry 해소 회귀 — perSymbol freshness 소비처가 진단/관찰 카운트만 노출하고 판단(gate/score/permission/주문) 영향 0 + flag OFF byte-equivalent 임을 단언.

import { describe, it, expect } from 'vitest';
import {
  summarizePerSymbolFreshness,
  formatPerSymbolFreshnessSummary,
} from './perSymbolFreshnessSummary.js';
import type { SymbolSnapshotData, SymbolFieldFreshness } from '../sourceSnapshot/symbolSnapshotData.js';
import type { DataHealth } from '../../../src/types/shadowCase.js';

// ─── 헬퍼: 최소 SymbolSnapshotData (freshness 외 필드는 소비처 미참조 → 부분 구성 허용) ──
function freshnessOf(
  overrides: Partial<SymbolFieldFreshness> & {
    quote?: DataHealth;
    technicalIndicators?: DataHealth;
    supply?: DataHealth;
    dartFinancials?: DataHealth;
  } = {},
): SymbolFieldFreshness {
  const quote = overrides.quote ?? 'VERIFIED';
  const technicalIndicators = overrides.technicalIndicators ?? 'VERIFIED';
  const supply = overrides.supply ?? 'VERIFIED';
  const dartFinancials = overrides.dartFinancials ?? 'MISSING';
  const providerIssue =
    overrides.providerIssue ??
    [quote, technicalIndicators, supply].some(
      (h) => h === 'STALE' || h === 'MISSING' || h === 'DEGRADED',
    );
  return {
    quote,
    technicalIndicators,
    supply,
    dartFinancials,
    providerIssue,
    marketSignal: false,
  };
}

function symbolWith(code: string, freshness?: SymbolFieldFreshness): SymbolSnapshotData {
  // 소비처는 sym.freshness 만 읽으므로 나머지 필드는 타입 만족용 최소값.
  return {
    code,
    name: code,
    market: 'KOSPI',
    quote: null,
    investorFlow: null,
    dailyBars: [],
    programTrade: null,
    technicalIndicators: null,
    supplySignal: null,
    dartFinancials: null,
    freshness,
    dataQuality: 'MISSING',
    fetchedAt: '2026-06-03T00:00:00.000Z',
    fetchDurationMs: 0,
  };
}

describe('perSymbolFreshnessSummary — ADR-0557 Consumer Contract (관찰 전용)', () => {
  // ── flag ON: freshness 산출 → 소비처가 읽어 카운트로 노출 ──
  it('flag ON: freshness 가 산출되면 소비처가 종목/필드 health 를 카운트한다', () => {
    const perSymbol: Record<string, SymbolSnapshotData> = {
      '005930': symbolWith('005930', freshnessOf({ quote: 'VERIFIED', technicalIndicators: 'VERIFIED', supply: 'VERIFIED', dartFinancials: 'MISSING' })),
      '000660': symbolWith('000660', freshnessOf({ quote: 'STALE', technicalIndicators: 'VERIFIED', supply: 'DEGRADED', dartFinancials: 'MISSING' })),
    };

    const summary = summarizePerSymbolFreshness(perSymbol);

    expect(summary.symbolsWithFreshness).toBe(2);
    expect(summary.symbolsWithoutFreshness).toBe(0);
    // 000660 은 STALE/DEGRADED → providerIssue=true 1종목.
    expect(summary.providerIssueSymbols).toBe(1);
    // 필드 health 합산: VERIFIED = quote/tech/supply/(none dart) ... 직접 카운트 검증.
    // 005930: VERIFIED,VERIFIED,VERIFIED,MISSING → V3 M1
    // 000660: STALE,VERIFIED,DEGRADED,MISSING    → V1 S1 D1 M1
    expect(summary.fieldHealthCounts.VERIFIED).toBe(4);
    expect(summary.fieldHealthCounts.STALE).toBe(1);
    expect(summary.fieldHealthCounts.DEGRADED).toBe(1);
    expect(summary.fieldHealthCounts.MISSING).toBe(2);
  });

  it('flag ON: format 라인이 marketSignal=false / executionImpact=NONE 를 명시한다 (불변식 #6)', () => {
    const perSymbol = { '005930': symbolWith('005930', freshnessOf({ quote: 'STALE' })) };
    const line = formatPerSymbolFreshnessSummary(summarizePerSymbolFreshness(perSymbol));
    expect(line).toContain('[UNIFIED_SNAPSHOT_FRESHNESS]');
    expect(line).toContain('marketSignal=false');
    expect(line).toContain('executionImpact=NONE');
    expect(line).toContain('symbolsWithFreshness=1');
    // providerIssue surface 는 카운트로 노출되나 약세 신호로 변환되지 않음.
    expect(line).toContain('providerIssueSymbols=1');
  });

  // ── flag OFF: perSymbol 부재 → 소비 미실행과 동치 (byte-equivalent) ──
  it('flag OFF: perSymbol undefined → 모든 카운트 0 (소비 분기 미실행 동치)', () => {
    const summary = summarizePerSymbolFreshness(undefined);
    expect(summary.symbolsWithFreshness).toBe(0);
    expect(summary.symbolsWithoutFreshness).toBe(0);
    expect(summary.providerIssueSymbols).toBe(0);
    expect(Object.values(summary.fieldHealthCounts).every((n) => n === 0)).toBe(true);
  });

  it('flag OFF 동치: 빈 perSymbol map 도 동일하게 0 카운트', () => {
    const a = summarizePerSymbolFreshness(undefined);
    const b = summarizePerSymbolFreshness({});
    expect(b).toEqual(a);
  });

  // ── graceful 결측: freshness 미산출 종목은 throw 없이 격리 (불변식 #1) ──
  it('freshness 부분 결측: freshness undefined 종목은 symbolsWithoutFreshness 로 격리 (throw 금지)', () => {
    const perSymbol: Record<string, SymbolSnapshotData> = {
      '005930': symbolWith('005930', freshnessOf()),
      '000660': symbolWith('000660', undefined), // 부분 결측
    };
    expect(() => summarizePerSymbolFreshness(perSymbol)).not.toThrow();
    const summary = summarizePerSymbolFreshness(perSymbol);
    expect(summary.symbolsWithFreshness).toBe(1);
    expect(summary.symbolsWithoutFreshness).toBe(1);
  });

  it('예기치 못한 health 값은 UNKNOWN 으로 격리한다 (throw 금지 — 불변식 #1)', () => {
    const rogue = freshnessOf();
    // 타입 우회로 비정상 값 주입 — 소비처가 graceful 격리하는지 확인.
    (rogue as unknown as { quote: string }).quote = 'BOGUS';
    const perSymbol = { '005930': symbolWith('005930', rogue) };
    expect(() => summarizePerSymbolFreshness(perSymbol)).not.toThrow();
    const summary = summarizePerSymbolFreshness(perSymbol);
    expect(summary.fieldHealthCounts.UNKNOWN).toBeGreaterThanOrEqual(1);
  });

  // ── 순수성: 입력 구조를 변형하지 않는다 (판단값 carry 보존, 불변식 #5) ──
  it('summarize 는 입력 perSymbol/freshness 를 변형하지 않는다 (read-only 소비)', () => {
    const fr = freshnessOf({ quote: 'STALE' });
    const before = JSON.stringify(fr);
    const perSymbol = { '005930': symbolWith('005930', fr) };
    summarizePerSymbolFreshness(perSymbol);
    expect(JSON.stringify(fr)).toBe(before);
    // marketSignal 은 절대 true 로 변환되지 않음 (불변식 #6).
    expect(fr.marketSignal as boolean).toBe(false);
  });
});
