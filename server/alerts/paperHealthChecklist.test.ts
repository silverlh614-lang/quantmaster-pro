// @responsibility Verify the daily Shadow checklist judges each part from known records only.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperMorningReview } from '../../src/types/paperMorning.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger, strategyTestCost } from '../trading/paper/paperStrategyFixtures.js';
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
  it('places the checklist near the top of the close report', () => {
    const view = viewFixture(), checklist = formatShadowChecklist({ view, account: accountView(), morning: morning(true), date, now });
    const text = formatPaperCloseReport(view, date, now, undefined, checklist);
    expect(text.indexOf('🩺 <b>Shadow 운용 점검</b>')).toBeGreaterThan(0);
    expect(text.indexOf('🩺 <b>Shadow 운용 점검</b>')).toBeLessThan(text.indexOf('🔬'));
    expect(formatPaperCloseReport(view, date, now)).not.toContain('Shadow 운용 점검');
  });
});
