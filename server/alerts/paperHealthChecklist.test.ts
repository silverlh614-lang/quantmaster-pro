// @responsibility Verify the daily Shadow checklist judges each part from known records only.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperProgramResearchView } from '../../src/types/paperIndicatorProgram.js';
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
  const attemptedAt = `${date}T06:00:00Z`, completedAt = `${date}T06:01:00Z`;
  const research = (overrides: Partial<PaperProgramResearchView> = {}): PaperProgramResearchView => ({
    state: 'IDLE', attemptedAt: null, completedAt: null, message: '장외 새 학습 자료 대기', proposals: [], ...overrides,
  });
  it.each([
    ['missing research', undefined, '⚠️ AI 계산법 연구 기록 확인 불가', [5, 1, 2, 0]],
    ['idle without attempts', research(), '⏳ AI 계산법 장외 새 학습 자료 대기', [5, 2, 1, 0]],
    ['running', research({ state: 'RUNNING', attemptedAt }), '⏳ AI 계산법 작성 중', [5, 2, 1, 0]],
    ['ready', research({ state: 'READY', attemptedAt, completedAt }), '✅ AI 계산법 완료 · 9월 18일', [6, 1, 1, 0]],
    ['older successful round', research({ state: 'READY', attemptedAt: '2026-09-17T06:00:00Z', completedAt: '2026-09-17T06:01:00Z' }), '✅ AI 계산법 완료 · 9월 17일', [6, 1, 1, 0]],
    ['failed with cause', research({ state: 'FAILED', attemptedAt, completedAt, failure: 'INTERRUPTED' }), '❌ AI 계산법 실패 · 서버 재시작으로 중단', [5, 1, 1, 1]],
    ['failed without cause', research({ state: 'FAILED', attemptedAt, completedAt }), '❌ AI 계산법 실패 · 기타 오류 · 서버 로그 [PaperProgramResearch] 확인', [5, 1, 1, 1]],
    ['unreadable storage without timestamps', research({ state: 'FAILED', failure: 'STORAGE' }), '❌ AI 계산법 실패 · 연구 후보 파일 읽기·저장 오류 · 파일 점검 필요', [5, 1, 1, 1]],
    ['interrupted without completion', research({ state: 'FAILED', attemptedAt, failure: 'INTERRUPTED' }), '❌ AI 계산법 실패 · 서버 재시작으로 중단', [5, 1, 1, 1]],
    ['future attempt', research({ state: 'READY', attemptedAt: `${date}T08:00:00Z`, completedAt: `${date}T08:01:00Z` }), '⚠️ AI 계산법 연구 기록 확인 불가', [5, 1, 2, 0]],
    ['future completion', research({ state: 'READY', attemptedAt, completedAt: `${date}T08:01:00Z` }), '⏳ AI 계산법 보고 시점의 작성 완료 미확인', [5, 2, 1, 0]],
    ['future failure', research({ state: 'FAILED', attemptedAt, completedAt: `${date}T08:01:00Z`, failure: 'TIMEOUT' }), '⏳ AI 계산법 보고 시점의 작성 완료 미확인', [5, 2, 1, 0]],
    ['missing completion', research({ state: 'READY', attemptedAt }), '⚠️ AI 계산법 완료 기록 확인 불가', [5, 1, 2, 0]],
    ['missing start', research({ state: 'RUNNING' }), '⚠️ AI 계산법 작성 시작 기록 확인 불가', [5, 1, 2, 0]],
  ] as const)('%s remains visible and contributes exactly once to close report totals', (_, record, expected, counts) => {
    const view = viewFixture();
    view.strategy!.adaptive!.programResearch = record;
    const before = JSON.stringify(view);
    const lines = formatShadowChecklist({ view, account: accountView(), morning: morning(true), date, now });
    expect(lines.filter(line => line.includes('AI 계산법'))).toEqual([expected]);
    expect(lines[0]).toBe(`🩺 <b>Shadow 운용 점검</b> · 정상 ${counts[0]} · 대기 ${counts[1]} · 주의 ${counts[2]} · 이상 ${counts[3]}`);
    const report = formatPaperCloseReport(view, date, now, undefined, lines);
    expect(report).toContain(lines[0]);
    expect(report).toContain(expected);
    expect(JSON.stringify(view)).toBe(before);
  });
  it('keeps the AI item when the parent research state is unavailable', () => {
    const view = viewFixture();
    view.strategy!.adaptive = undefined;
    expect(formatShadowChecklist({ view, date, now })).toContain('⚠️ AI 계산법 연구 기록 확인 불가');
  });
  it('escapes failure details in Telegram HTML', () => {
    const view = viewFixture();
    view.strategy!.adaptive!.programResearch = research({ state: 'FAILED', attemptedAt, completedAt,
      failure: 'INVALID_OUTPUT', failureDetail: '<검사> & 실패' });
    const lines = formatShadowChecklist({ view, date, now });
    expect(lines.find(line => line.includes('AI 계산법'))).toContain('&lt;검사&gt; &amp; 실패');
  });
  it('places the checklist near the top of the close report', () => {
    const view = viewFixture(), checklist = formatShadowChecklist({ view, account: accountView(), morning: morning(true), date, now });
    const text = formatPaperCloseReport(view, date, now, undefined, checklist);
    expect(text.indexOf('🩺 <b>Shadow 운용 점검</b>')).toBeGreaterThan(0);
    expect(text.indexOf('🩺 <b>Shadow 운용 점검</b>')).toBeLessThan(text.indexOf('🔬'));
    expect(formatPaperCloseReport(view, date, now)).not.toContain('Shadow 운용 점검');
  });
});
