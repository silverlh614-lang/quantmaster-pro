// @responsibility marketRegimeViewModel 주말/장외 stale 분류 회귀 (불변식 #6)
import { describe, it, expect } from 'vitest';
import { buildMarketRegimeView } from './marketRegimeViewModel';

const STALE = ['VIX', 'KOSPI', 'KOSDAQ', 'samsungIri'];

describe('buildMarketRegimeView — 주말/장외 stale 분류 (불변식 #6)', () => {
  it('장중 stale → PROVIDER_ISSUE + providerIssue=true + UNKNOWN', () => {
    const view = buildMarketRegimeView({ staleFields: STALE, offHoursExpected: false });
    expect(view.state).toBe('UNKNOWN');
    expect(view.providerIssue).toBe(true);
    expect(view.evidence.some(e => e.issueType === 'PROVIDER_ISSUE')).toBe(true);
    // 장중 UNKNOWN 은 기존 "레짐 미확인" 라벨 유지
    expect(view.title).toBe('레짐 미확인');
  });

  it('주말/장외 stale → provider 장애 아님 (providerIssue=false)', () => {
    const view = buildMarketRegimeView({ staleFields: STALE, offHoursExpected: true });
    // 불변식 #6 — 주말 stale 을 provider 장애로 변환하지 않는다
    expect(view.providerIssue).toBe(false);
    expect(view.evidence.some(e => e.issueType === 'PROVIDER_ISSUE')).toBe(false);
  });

  it('주말/장외 + telemetry 부재 → "직전 거래일 캐시" 라벨로 정직 표기', () => {
    const view = buildMarketRegimeView({ staleFields: STALE, offHoursExpected: true });
    expect(view.state).toBe('UNKNOWN'); // state machine 은 보존
    expect(view.title).toBe('직전 거래일 캐시 (주말/장외)');
    expect(view.summary).toContain('직전 거래일 종가');
    expect(view.summary).toContain('데이터 장애가 아니며');
  });

  it('주말이라도 BEAR telemetry 가 있으면 CRISIS 우선 (시장 신호 보존)', () => {
    const view = buildMarketRegimeView({
      offHoursExpected: true,
      staleFields: STALE,
      bearRegimeResult: {
        regime: 'BEAR', triggeredCount: 3, threshold: 2, lastUpdated: '2026-05-29T06:00:00.000Z',
      } as any,
    });
    expect(view.state).toBe('CRISIS');
  });
});
