// @responsibility Verify the daily Shadow checklist judges each part from known records only.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperMorningReview } from '../../src/types/paperMorning.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost } from '../trading/paper/paperStrategyFixtures.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { buildPaperAccountView, createPaperAccount } from '../trading/paper/paperAccount.js';
import { formatPaperCloseReport } from './paperCloseReport.js';
import { formatShadowChecklist } from './paperHealthChecklist.js';

const date = '2026-09-18';
const now = new Date(`${date}T16:10:00+09:00`);
function viewFixture(): PaperExperimentView {
  const snapshot = adaptiveTestSnapshot();
  const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
    selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf));
  return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 0, openCount: 0, completedCount: 0,
    groups: [], outcomes: [], experiments: [],
    lastRun: { snapshotId: 'close', asOf: `${date}T06:35:00Z`, candidateCount: 1000, observedCount: 950, missingPriceCount: 50,
      openedCount: 0, completedCount: 0, marketOpen: false, issues: [] },
    strategy: buildPaperStrategyView(ledger) };
}
const accountView = (lastSnapshotAt: string | null = `${date}T06:20:00Z`) => {
  const account = createPaperAccount({ initialCash: 10_000_000, maxPositionPct: 20, includeExploration: false }, `${date}T00:00:00Z`, 'virtual-test');
  account.lastSnapshotAt = lastSnapshotAt;
  account.weightChanges = [{ at: `${date}T00:10:00Z`, maxPositionPct: 10 }];
  return buildPaperAccountView(account, now.toISOString());
};
const morning = (sent: boolean): PaperMorningReview => ({ asOf: now.toISOString(), results: [],
  report: { picks: [{}, {}], delivery: sent ? { sentAt: '2026-09-17T23:30:00.000Z', messageId: 1 } : undefined } as never });

describe('Shadow operation checklist', () => {
  it('marks each part from today’s records and counts the marks', () => {
    const lines = formatShadowChecklist({ view: viewFixture(), account: accountView(), morning: morning(true), date, now });
    expect(lines[0]).toMatch(/^🩺 <b>Shadow 운용 점검<\/b> · 정상 \d+ · 대기 \d+ · 주의 \d+ · 이상 \d+$/);
    expect(lines).toContain('✅ 연구 평가 10:00');
    expect(lines).toContain('✅ 검증 연결 1개');
    expect(lines).toContain('✅ 가상 계좌 처리 15:20 · 종목당 10% · 보유 0/10');
    expect(lines).toContain('⏳ 매도 학습 비교 0건 · D5 결과 대기');
    expect(lines).toContain('✅ 아침 추천 발송 08:30 · 2종목');
    expect(lines).toContain('✅ 가격 미확인 5.0% (50/1000)');
    expect(lines.some(line => line.startsWith('⚠️ 가상 매수 검증 1건 · 탐색 0건 · 탐색 규칙'))).toBe(true);
  });
  it('waits during /paper on records whose time has not come yet instead of failing them', () => {
    const early = new Date(`${date}T00:30:00+09:00`);
    const lines = formatShadowChecklist({ view: viewFixture(), account: accountView(null),
      morning: { asOf: early.toISOString(), results: [], report: null }, date, now: early, live: true });
    expect(lines).toContain('⏳ 0시 연구 평가 진행 대기');
    expect(lines).toContain('⏳ 가상 계좌 장 시작 후 처리 · 종목당 10% · 보유 0/10');
    expect(lines).toContain('⏳ 아침 추천 08:30 발송 예정');
    expect(lines).toContain('⏳ 오늘 첫 가격 관측 대기');
    expect(lines.some(line => line.startsWith('❌'))).toBe(false);
    // The 16:10 report keeps failing the same missing records.
    const closing = formatShadowChecklist({ view: viewFixture(), account: accountView(null),
      morning: { asOf: early.toISOString(), results: [], report: null }, date, now: early });
    expect(closing).toContain('❌ 오늘 아침 추천 기록 없음');
  });
  it('marks trading-day records as a market holiday during /paper on a closed day', () => {
    const saturday = '2026-09-19', at = new Date(`${saturday}T12:00:00+09:00`);
    const lines = formatShadowChecklist({ view: viewFixture(), account: accountView(), morning: morning(true), date: saturday, now: at, live: true });
    expect(lines).toContain('⏳ 휴장일 · 연구 평가는 다음 관측 때 · 마지막 9월 18일');
    expect(lines).toContain('⏳ 휴장일 · 가상 매수 없음');
    expect(lines).toContain('⏳ 가상 계좌 휴장일 · 종목당 10% · 보유 0/10');
    expect(lines).toContain('⏳ 휴장일 · 가격 관측 없음');
    expect(lines.some(line => line.includes('가상 매수 검증'))).toBe(false);
  });
  it('reports missing or stale records instead of assuming they are fine', () => {
    const view = viewFixture();
    view.lastRun = { ...view.lastRun!, asOf: '2026-09-17T06:35:00Z' };
    view.strategy!.adaptive!.tradingDate = '2026-09-17';
    const lines = formatShadowChecklist({ view, account: accountView(null), morning: { asOf: now.toISOString(), results: [], report: null }, date, now });
    expect(lines).toContain('❌ 오늘 연구 평가 없음 · 마지막 9월 17일');
    expect(lines).toContain('❌ 가상 계좌 오늘 처리 없음 · 종목당 10% · 보유 0/10');
    expect(lines).toContain('❌ 오늘 아침 추천 기록 없음');
    expect(lines).toContain('❌ 오늘 가격 관측 없음');
    expect(formatShadowChecklist({ view, date, now })).toContain('❌ 가상 계좌 기록 확인 불가');
    expect(formatShadowChecklist({ view, account: buildPaperAccountView(null, now.toISOString()), date, now })).toContain('⚠️ 가상 계좌 미시작');
    expect(formatShadowChecklist({ view, account: accountView(), morning: morning(false), date, now })).toContain('⚠️ 아침 추천 발송 확인 대기');
  });
  it('shows the KRX listing age so a stopped refresh is seen without /health', () => {
    const view = viewFixture();
    const line = (krxListing: NonNullable<PaperExperimentView['strategy']>['krxListing']) => {
      view.strategy!.krxListing = krxListing;
      return formatShadowChecklist({ view, account: accountView(), morning: morning(true), date, now }).filter(item => item.includes('종목 목록'));
    };
    expect(line(undefined)).toEqual([]);
    expect(line({ refreshedAt: '2026-09-17T21:00:00Z', total: 2676, partial: false, stale: false, usable: true }))
      .toEqual(['✅ 종목 목록 갱신 9월 18일 06:00 · 2,676종목']);
    expect(line({ refreshedAt: '2026-09-16T07:30:00Z', total: 2681, partial: false, stale: true, usable: false }))
      .toEqual(['⚠️ 종목 목록 24시간 넘게 갱신 안 됨 · 마지막 9월 16일 16:30 · 상장폐지 판정 멈춤 · /krx_master_refresh']);
    expect(line({ refreshedAt: '2026-09-17T21:00:00Z', total: 396, partial: true, stale: false, usable: false }))
      .toEqual(['⚠️ 종목 목록 일부만 확보 396종목 · 상장폐지 판정 멈춤 · /krx_master_refresh']);
    expect(line(null)).toEqual(['⚠️ 종목 목록 확인 불가 · 상장폐지 판정 멈춤']);
  });
  it('names the oldest scheduled close still missing so its cause can be looked up', () => {
    const view = viewFixture(), snapshot = adaptiveTestSnapshot();
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf));
    const stuck = legacyStrategyLedger().trades[0];
    stuck.name = 'A&B';
    ledger.trades.push(stuck);
    ledger.lastRun = { ...ledger.lastRun!, asOf: '2026-09-25T01:00:00Z' };
    view.strategy = buildPaperStrategyView(ledger);
    expect(formatShadowChecklist({ view, account: accountView(), morning: morning(true), date, now }))
      .toContain(`⚠️ 예정일 지나 종가 미확인 1건 · 9월 23일 A&amp;B ${stuck.symbol}`);
    view.strategy = buildPaperStrategyView(ledger, undefined, symbol => symbol !== stuck.symbol);
    const lines = formatShadowChecklist({ view, account: accountView(), morning: morning(true), date, now });
    expect(lines).toContain(`✅ 상장폐지로 종가 없는 거래 1건 · 가격을 만들지 않고 보관 (A&amp;B ${stuck.symbol})`);
    expect(lines.some(line => line.includes('예정일 지나 종가 미확인'))).toBe(false);
  });
  it('places the checklist near the top of the close report', () => {
    const view = viewFixture(), checklist = formatShadowChecklist({ view, account: accountView(), morning: morning(true), date, now });
    const text = formatPaperCloseReport(view, date, now, undefined, checklist);
    expect(text.indexOf('🩺 <b>Shadow 운용 점검</b>')).toBeGreaterThan(0);
    expect(text.indexOf('🩺 <b>Shadow 운용 점검</b>')).toBeLessThan(text.indexOf('🔬'));
    expect(formatPaperCloseReport(view, date, now)).not.toContain('Shadow 운용 점검');
  });
});
