// @responsibility Summarize daily Shadow operation health as a plain checklist for the close report.
import type { PaperAccountView } from '../../src/types/paperAccount.js';
import { paperAccountSlotCount, paperAccountWeightPct } from '../../src/types/paperAccount.js';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperMorningReview } from '../../src/types/paperMorning.js';
import { PAPER_PROGRAM_FAILURE_LABELS } from '../../src/types/paperIndicatorProgram.js';
import { toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { paperValidationWait } from '../trading/paper/paperAdaptiveSelection.js';

type Mark = 'OK' | 'WAIT' | 'WARN' | 'FAIL';
const ICONS: Record<Mark, string> = { OK: '✅', WAIT: '⏳', WARN: '⚠️', FAIL: '❌' };
const MISSING_PRICE_WARN_PCT = 10;
const time = (value: string) => new Date(value).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const day = (value: string) => { const [, month, date] = value.split('-').map(Number); return `${month}월 ${date}일`; };
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Each line is judged only from records known by `now`; a missing record is reported, never assumed fine. */
export function formatShadowChecklist(input: { view: PaperExperimentView; account?: PaperAccountView; morning?: PaperMorningReview; date: string; now: Date }): string[] {
  const { view, account, morning, date } = input, cutoff = input.now.getTime();
  const known = (value: string | null | undefined) => Boolean(value) && Date.parse(value!) <= cutoff;
  const today = (value: string | null | undefined) => known(value) && toKstDateKey(value!) === date;
  const checks: Array<[Mark, string]> = [];
  const strategy = view.strategy && !view.strategy.error && !view.strategy.lastRun?.error ? view.strategy : undefined;
  const state = strategy?.adaptive && known(strategy.adaptive.evaluatedAt) ? strategy.adaptive : undefined;

  checks.push(state && state.tradingDate === date ? ['OK', `연구 평가 ${time(state.evaluatedAt)}`]
    : ['FAIL', `오늘 연구 평가 없음${state ? ` · 마지막 ${day(state.tradingDate)}` : ''}`]);
  if (state) {
    const active = state.candidates.filter(item => item.active).length, wait = paperValidationWait(state);
    checks.push(active ? ['OK', `검증 연결 ${active}개`]
      : ['WAIT', `검증 연결 0개${!wait ? '' : wait.kind === 'DATES' ? ` · 빠르면 ${day(wait.earliestDate)}`
        : wait.kind === 'CHANCE' ? ` · 무작위 대조 미통과 ${wait.count}개` : ' · 기준 통과 지표 없음'}`]);
  }
  if (strategy && strategy.trades.length === strategy.totalCount) {
    const entered = strategy.trades.filter(trade => trade.tradingDate === date && trade.strategyVersion === 'adaptive-features-v1' && known(trade.entryAt));
    const exploring = entered.filter(trade => trade.entryDecision.explorationEvidence).length;
    const rules = state?.exploration?.rules.filter(rule => today(rule.registeredAt)).length ?? 0;
    checks.push([rules ? 'OK' : 'WARN', `가상 매수 검증 ${entered.length - exploring}건 · 탐색 ${exploring}건 · 탐색 규칙 ${rules ? `${rules}개` : '미등록'}`]);
    const overdue = strategy.openBreakdown?.overdueScheduledCount ?? 0;
    if (overdue) checks.push(['WARN', `예정일 지나 종가 미확인 ${overdue}건 · 가장 오래된 예정일 ${strategy.openBreakdown!.oldestOverdueExitDate}`]);
  } else checks.push(['WARN', '가상 매수 기록 일부만 조회 · 대시보드 확인']);

  if (!account || account.error) checks.push(['FAIL', '가상 계좌 기록 확인 불가']);
  else if (!account.account) checks.push(['WARN', '가상 계좌 미시작']);
  else {
    const ledger = account.account, weight = paperAccountWeightPct(ledger);
    const selection = ledger.selections?.find(item => item.tradingDate === date);
    checks.push([today(ledger.lastSnapshotAt) ? 'OK' : 'FAIL', `가상 계좌 ${today(ledger.lastSnapshotAt) ? `처리 ${time(ledger.lastSnapshotAt!)}` : '오늘 처리 없음'} · 종목당 ${weight}% · 보유 ${account.positions.length}/${paperAccountSlotCount({ maxPositionPct: weight })}${selection && !selection.selectedRuleKey ? ' · 운용 기준 없음' : ''}`]);
  }

  const exit = strategy?.exitLearning;
  checks.push(exit && exit.completedTradeCount ? ['OK', `매도 학습 비교 ${exit.completedTradeCount}건/${exit.completedDateCount}일`] : ['WAIT', '매도 학습 비교 0건 · D5 결과 대기']);

  const report = morning?.report;
  checks.push(!morning || morning.trackingError && !report ? ['WARN', '아침 추천 기록 확인 불가']
    : !report ? ['FAIL', '오늘 아침 추천 기록 없음']
      : report.delivery && known(report.delivery.sentAt) ? ['OK', `아침 추천 발송 ${time(report.delivery.sentAt)} · ${report.picks.length}종목`]
        : ['WARN', '아침 추천 발송 확인 대기']);

  const research = state?.programResearch;
  if (!research || research.attemptedAt && !known(research.attemptedAt)) checks.push(['WARN', 'AI 계산법 연구 기록 확인 불가']);
  // A terminal result after the report cutoff cannot establish success or failure yet.
  else if (research.completedAt && !known(research.completedAt)) checks.push(['WAIT', 'AI 계산법 보고 시점의 작성 완료 미확인']);
  else if (research.state === 'FAILED') checks.push(['FAIL', `AI 계산법 실패 · ${PAPER_PROGRAM_FAILURE_LABELS[research.failure ?? 'UNKNOWN']}${research.failureDetail ? ` · ${escape(research.failureDetail)}` : ''}`]);
  else if (research.state === 'READY') checks.push(known(research.completedAt)
    ? ['OK', `AI 계산법 완료 · ${day(toKstDateKey(research.completedAt!))}`]
    : ['WARN', 'AI 계산법 완료 기록 확인 불가']);
  else if (research.state === 'RUNNING') checks.push(known(research.attemptedAt)
    ? ['WAIT', 'AI 계산법 작성 중'] : ['WARN', 'AI 계산법 작성 시작 기록 확인 불가']);
  else checks.push(['WAIT', 'AI 계산법 장외 새 학습 자료 대기']);

  const last = view.lastRun;
  if (!last || !today(last.asOf)) checks.push(['FAIL', '오늘 가격 관측 없음']);
  else {
    const missingPct = last.candidateCount ? last.missingPriceCount / last.candidateCount * 100 : 100;
    checks.push([missingPct <= MISSING_PRICE_WARN_PCT ? 'OK' : 'WARN', `가격 미확인 ${missingPct.toFixed(1)}% (${last.missingPriceCount}/${last.candidateCount})`]);
  }
  const count = (mark: Mark) => checks.filter(([value]) => value === mark).length;
  return [`🩺 <b>Shadow 운용 점검</b> · 정상 ${count('OK')} · 대기 ${count('WAIT')} · 주의 ${count('WARN')} · 이상 ${count('FAIL')}`,
    ...checks.map(([mark, text]) => `${ICONS[mark]} ${text}`)];
}
