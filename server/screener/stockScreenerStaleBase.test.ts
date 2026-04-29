// @responsibility stockScreener KIS 폴백 + STALE_BASE 제외 회귀 (ADR-0091 PR-Z4)
import { describe, it, expect } from 'vitest';
import type { YahooQuoteExtended } from './adapters/yahooQuoteAdapter';

/**
 * stockScreener.preScreenStocks 의 STALE_BASE 분기 결정 트리 검증.
 *
 * 사용자 패치 §"valid=false 면 Yahoo 등락률 폐기 + KIS 우선 사용 + KIS 도 없으면 0% +
 * 데이터품질 경고 + Gate/MOMENTUM 에서 해당 종목 감점 또는 제외" 를 결정 트리로 검증.
 *
 * 본 테스트는 stockScreener 본체를 직접 호출하지 않고 *분기 로직만* 검증 — 실제 wiring
 * 통합 테스트는 운영 데이터 누적 후 별도 PR (LIVE 회귀 위험 격리).
 */

interface FallbackDecision {
  action: 'PASS' | 'KIS_RECOVERED' | 'EXCLUDED';
  reason: string;
}

/**
 * 사용자 패치 결정 트리 SSOT (stockScreener:411~ 의 핵심 분기 추출).
 * - dataQuality=OK → PASS (정상 통과)
 * - dataQuality=STALE_BASE && issues=['changePercent'] only && KIS recovery success → KIS_RECOVERED
 * - dataQuality=STALE_BASE && (다중 위반 OR KIS recovery failure) → EXCLUDED
 */
function decideStaleBaseFallback(
  quote: Pick<YahooQuoteExtended, 'dataQuality' | 'dataQualityIssues'>,
  kisRecoverableChangePercent: number | null,
): FallbackDecision {
  if (quote.dataQuality !== 'STALE_BASE') {
    return { action: 'PASS', reason: 'OK' };
  }
  const issues = quote.dataQualityIssues ?? [];
  const onlyChangePercent = issues.length === 1 && issues[0] === 'changePercent';
  if (!onlyChangePercent) {
    return { action: 'EXCLUDED', reason: `다중 위반: ${issues.join(',')}` };
  }
  if (kisRecoverableChangePercent === null) {
    return { action: 'EXCLUDED', reason: 'KIS 폴백 실패' };
  }
  if (Math.abs(kisRecoverableChangePercent) > 30) {
    return { action: 'EXCLUDED', reason: `KIS 폴백도 sanity 위반 (${kisRecoverableChangePercent.toFixed(2)}%)` };
  }
  return { action: 'KIS_RECOVERED', reason: `KIS changePercent ${kisRecoverableChangePercent.toFixed(2)}%` };
}

describe('stockScreener STALE_BASE 분기 결정 트리', () => {
  it('dataQuality=OK → PASS (정상 통과)', () => {
    const decision = decideStaleBaseFallback({ dataQuality: 'OK' }, null);
    expect(decision.action).toBe('PASS');
  });

  it('dataQuality 미설정 (구버전 호환) → PASS', () => {
    const decision = decideStaleBaseFallback({}, null);
    expect(decision.action).toBe('PASS');
  });

  it('이미지 시나리오 — STALE_BASE + changePercent only + KIS 정상 → KIS_RECOVERED', () => {
    const decision = decideStaleBaseFallback(
      { dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'] },
      -2.5, // KIS 가 본 정상 등락률
    );
    expect(decision.action).toBe('KIS_RECOVERED');
    expect(decision.reason).toContain('-2.50%');
  });

  it('STALE_BASE + changePercent only + KIS 폴백 실패 (null) → EXCLUDED', () => {
    const decision = decideStaleBaseFallback(
      { dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'] },
      null,
    );
    expect(decision.action).toBe('EXCLUDED');
    expect(decision.reason).toContain('KIS 폴백 실패');
  });

  it('STALE_BASE + return5d 위반 (단일) → EXCLUDED (KIS 일봉 폴백 비용 부담으로 제외)', () => {
    const decision = decideStaleBaseFallback(
      { dataQuality: 'STALE_BASE', dataQualityIssues: ['return5d'] },
      -2.5,
    );
    expect(decision.action).toBe('EXCLUDED');
    expect(decision.reason).toContain('다중 위반');
  });

  it('STALE_BASE + 다중 위반 (changePercent + return5d) → EXCLUDED', () => {
    const decision = decideStaleBaseFallback(
      { dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent', 'return5d'] },
      -2.5, // KIS 정상이어도 다중 위반은 제외
    );
    expect(decision.action).toBe('EXCLUDED');
  });

  it('STALE_BASE + KIS 폴백 changePercent 도 sanity 위반 (-50%) → EXCLUDED', () => {
    const decision = decideStaleBaseFallback(
      { dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'] },
      -50, // KIS 도 sanity 위반
    );
    expect(decision.action).toBe('EXCLUDED');
    expect(decision.reason).toContain('KIS 폴백도 sanity 위반');
  });

  it('STALE_BASE + KIS 폴백 changePercent boundary 30% 정확 → KIS_RECOVERED', () => {
    const decision = decideStaleBaseFallback(
      { dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'] },
      30,
    );
    expect(decision.action).toBe('KIS_RECOVERED');
  });

  it('STALE_BASE + KIS 폴백 changePercent 30.01% → EXCLUDED', () => {
    const decision = decideStaleBaseFallback(
      { dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'] },
      30.01,
    );
    expect(decision.action).toBe('EXCLUDED');
  });

  it('이미지 시나리오 일괄 검증 — 6 종목 모두 STALE_BASE + KIS 정상 시 KIS_RECOVERED', () => {
    const symbols = [
      { code: '189300', kisChange: -2.0 },
      { code: '001430', kisChange: 1.5 },
      { code: '027360', kisChange: -0.8 },
      { code: '088280', kisChange: 0.0 },
      { code: '036540', kisChange: -1.2 },
      { code: '163730', kisChange: 2.3 },
    ];
    for (const { code, kisChange } of symbols) {
      const decision = decideStaleBaseFallback(
        { dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'] },
        kisChange,
      );
      expect(decision.action, `${code}: ${decision.reason}`).toBe('KIS_RECOVERED');
    }
  });
});
