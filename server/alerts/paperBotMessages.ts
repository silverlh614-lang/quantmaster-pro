// @responsibility Format current Shadow bot reports.
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../src/types/paperStrategy.js';
import type { PaperStrategyCohort, PaperStrategyEdge, PaperStrategySelection } from '../../src/types/paperStrategy.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import { PAPER_NEWS_LABELS, summarizePaperNews } from '../../src/utils/paperNews.js';
import { PAPER_FLOW_ISSUE_LABELS } from '../../src/types/paperInvestorFlow.js';
import { PAPER_NEWS_EVENT_LABELS, PAPER_NEWS_FILING_LABELS, PAPER_NEWS_RELATION_LABELS } from '../../src/types/paperNewsFacts.js';
import { readPaperNewsFacts } from '../../src/utils/paperNewsFacts.js';
import { formatPaperCloseReport } from './paperCloseReport.js';
import { getPaperMorningReviewSafely } from '../trading/paper/paperMorningRuntime.js';
import { formatPaperMorningFollowup } from './paperMorningFollowup.js';
import { formatPaperAdaptiveSummary, paperTelegramRuleLabel } from './paperResearchMessages.js';

export const PAPER_BOT_SCHEDULES = [
  { kind: 'recommendation', minute: 8 * 60 + 30, graceMinutes: 30, label: '매일 08:30 · 학습 기반 추천 · 휴장일 연구 현황' },
  { kind: 'morning', minute: 8 * 60 + 45, graceMinutes: 45, label: '거래일 08:45 · 국내·해외 뉴스와 연관주' },
  { kind: 'intraday', minute: 10 * 60 + 30, graceMinutes: 45, label: '거래일 10:30 · 장중 판단·자율 연구' },
  { kind: 'intraday', minute: 13 * 60 + 30, graceMinutes: 45, label: '거래일 13:30 · 장중 판단·자율 연구' },
  { kind: 'close', minute: 16 * 60 + 10, graceMinutes: 240, label: '거래일 16:10 · 마감 요약' },
  { kind: 'weekly', minute: 19 * 60, graceMinutes: 180, label: '일요일 19:00 · 연구 요약' },
] as const;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (value: number) => value.toLocaleString('ko-KR');
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const excess = (value: number | null) => value === null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%p`;
const stamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '기록 대기';

/** Keep whole HTML lines so truncation cannot break tags or entities. */
function compactReport(lines: string[], footer: string[]): string {
  const tail = footer.join('\n'), omitted = '일부 상세는 대시보드에서 확인하세요.';
  let message = '';
  for (const line of lines) {
    const next = message ? `${message}\n${line}` : line;
    if (next.length + tail.length + omitted.length + 4 > 3500) {
      message += `\n${omitted}`; break;
    }
    message = next;
  }
  return `${message}\n\n${tail}`;
}

export function formatPaperReport(view: PaperExperimentView, kind: 'close' | 'status', date: string, news: string[] = [], now = new Date()): string {
  if (kind === 'close') return formatPaperCloseReport(view, date, now, formatPaperMorningFollowup(getPaperMorningReviewSafely(date, now), true));
  const last = view.lastRun;
  const strategy = view.strategy;
  const today = view.experiments.filter(item => item.tradingDate === date).length;
  const lines = [`📋 <b>Shadow 현재 현황 · ${date}</b>`, '가상 실험 · 실제 주문 없음', '',
    `마지막 관측 ${stamp(last?.asOf)}`, last ? `후보 ${num(last.candidateCount)} · 현재가 확인 ${num(last.observedCount)} · 미확인 ${num(last.missingPriceCount)}` : '아직 관측 기록이 없습니다.',
    `기본 관측: 오늘 진입 ${num(today)} · 누적 ${num(view.totalCount)} · D5 완료 ${num(view.completedCount)}`, ];
  if (!strategy || strategy.error || strategy.lastRun?.error) lines.push('전략 기록 확인 대기');
  else {
    const opened = strategy.trades.filter(item => item.tradingDate === date).length;
    const closed = strategy.trades.filter(item => item.exit?.effectiveAt.startsWith(date)).length;
    lines.push(`전략: 오늘 가상 진입 ${opened} · 오늘 평가일 청산 ${closed} · 보유 ${strategy.openCount}`,
      `전체 전략 이력(구전략 포함) 청산 ${strategy.performance.closedCount}건 · 평균 순수익률 ${pct(strategy.performance.meanNetReturnPct)}`);
    const waiting = strategy.latestDecisions.filter(item => item.action === 'WAIT');
    const needsSamples = waiting.filter(item => item.reasonCode === 'INSUFFICIENT_MATURE_SAMPLES' || item.reasonCode === 'INSUFFICIENT_ENTRY_DATES').length;
    lines.push(`최근 판단 대기 ${waiting.length}종목${needsSamples ? ` · 표본/진입일 누적 중 ${needsSamples}종목` : ''}`);
  }
  lines.push('', ...formatPaperAdaptiveSummary(view, now));
  lines.push('', '<b>기본 관측 누적 성과</b>', ...view.outcomes.map(item => `D${item.horizon}: ${pct(item.meanNetReturnPct)} · ${item.count}건`));
  if (view.research) lines.push('', `과거 재현 ${num(view.research.sampleCount)}건 · 과거 연구 가능 ${num(view.research.learningSampleCount)}건${view.research.error ? ' · 연구 갱신 확인 필요' : ''}`);
  if (news.length) lines.push('', '<b>최근 24시간 수집 뉴스·공시</b>', ...news.slice(0, 3).map(headline => `• ${escape(headline.slice(0, 100))}`));
  else lines.push('', '최근 24시간에 확인된 새 뉴스·공시 기록 없음');
  return compactReport(lines, ['비용 반영 독립 실험 평균이며 계좌 수익률이 아닙니다.', '/paper · /paper_research · /paper_bot']);
}

const RESEARCH_WAIT_LABELS: Record<string, string> = {
  MISSING_INPUT: '입력값 없음', NO_TRAIN_VARIATION: '학습 구간 비교군 부족', NO_TEST_MATCH: '후반 구간 해당 없음',
};

export function formatPaperResearch(view: PaperExperimentView, now = new Date()): string {
  const research = view.research;
  const lines = ['🔬 <b>Shadow 연구 점검 · 누적 자료 기준</b>', '', ...formatPaperAdaptiveSummary(view, now)];
  if (!research) lines.push('저장 자료 연구 결과를 아직 불러오지 못했습니다. 다음 스캔 이후 확인하세요.');
  else {
    lines.push('', '📂 <b>저장 자료 연구 · 자율 연구와 별도</b>', `연구 갱신 ${stamp(research.asOf)}`, research.error ? '연구 갱신 오류 · 이전 저장 결과입니다.' : '',
    `${research.symbols}종목 · 과거 재현 ${num(research.sampleCount)}건 · 과거 연구 가능 ${num(research.learningSampleCount)}건`,
    `과거 진입일 ${research.firstDate ?? '미확인'} ~ ${research.lastDate ?? '미확인'}`, '', '<b>조건별 후반 검증 · 대조군 대비</b>');
    for (const item of research.featureStudies ?? []) {
      const difference = item.status === 'EVALUATED' && item.matchedDifferencePct !== null ? `${item.matchedDifferencePct > 0 ? '+' : ''}${item.matchedDifferencePct.toFixed(2)}%p`
        : `비교 대기(${RESEARCH_WAIT_LABELS[item.status] ?? item.status} · 값 있음 ${num(item.availableCount)}건·학습 ${num(item.trainingCount)}건)`;
      lines.push(`• ${escape(item.label)}: ${difference} · ${item.testCount}건/${item.testSymbolCount}종목/${item.testDateCount}진입일`);
    }
    lines.push(`상대강도 기준 지수 시계열 ${num(research.benchmarkSeriesCount ?? 0)}개`);
    const index = research.inventory?.find(item => item.file.startsWith('KIS 지수 일봉'));
    lines.push(index ? `상대강도 기준 KIS 지수 일봉 ${num(index.records)}건 · ${index.status === 'FOUND' ? '수집 완료' : escape(index.issue ?? '수집 대기')}`
      : '상대강도 기준 KIS 지수 일봉 수집 대기 · 다음 스캔 이후 확인');
    lines.push(...relativeStrengthLines(view.relativeStrengthStudy));
    lines.push(...longHorizonLines(research.longHorizon));
  }
  const strategy = view.strategy;
  const strategyAvailable = strategy && !strategy.error && !strategy.lastRun?.error;
  if (strategyAvailable) lines.push('', '<b>전체 전략 이력 · 구전략 포함</b>',
    `전체 전략 이력 가상 청산 ${num(strategy.performance.closedCount)}건 · 평균 순수익률 ${pct(strategy.performance.meanNetReturnPct)}`,
    ...selectionLines(strategy.selection));
  return compactReport(lines, ['시그널은 진입 당시 선택 규칙과 학습 근거를 고정하고, 청산 결과를 별도 기록합니다.',
    '과거 7개 조건은 같은 날짜·뉴스·추세·보유기간을 맞춘 탐색 연구이며 매매에 자동 적용하지 않습니다.', '/paper · /paper_bot']);
}

function longHorizonLines(study: NonNullable<PaperExperimentView['research']>['longHorizon']): string[] {
  if (!study) return [];
  const lines = ['', '<b>20거래일 보유 연구 · 과거 종가 재현</b>'];
  if (!study.sampleCount) return [...lines, '20거래일 뒤 종가까지 확인된 표본이 아직 없습니다.'];
  lines.push(`${num(study.sampleCount)}건/${num(study.symbolCount)}종목/${num(study.entryDateCount)}진입일 (${study.firstDate}~${study.lastDate})`,
    `비용 차감 평균 ${pct(study.meanNetReturnPct)} · 승률 ${study.winRatePct === null ? '미확인' : `${study.winRatePct.toFixed(1)}%`} · 같은 기간 지수 대비 ${pct(study.meanExcessReturnPct)} (${num(study.excessCount)}건)`);
  for (const item of study.features) {
    lines.push(item.status === 'EVALUATED' && item.matchedDifferencePct !== null
      ? `• ${escape(item.label)}: ${escape(item.selectedGroup ?? '')} 선택 → ${item.matchedDifferencePct > 0 ? '+' : ''}${item.matchedDifferencePct.toFixed(2)}%p · ${num(item.testCount)}건/${num(item.testDateCount)}진입일`
      : `• ${escape(item.label)}: 비교 대기(${RESEARCH_WAIT_LABELS[item.status] ?? item.status} · 학습 ${num(item.trainingCount)}건)`);
  }
  lines.push(`20일 구간이 서로 겹쳐 독립 구간은 약 ${num(Math.ceil(study.entryDateCount / 20))}개뿐입니다. 탐색 연구이며 매수 조건에 쓰지 않습니다.`);
  return lines;
}

function relativeStrengthLines(study: PaperExperimentView['relativeStrengthStudy']): string[] {
  if (!study) return [];
  const lines = ['', '<b>실제 관측 상대강도 검증 · 같은 날·같은 그룹 상위 대 하위</b>'];
  if (!study.indexReady) return [...lines, 'KOSPI·KOSDAQ 지수 일봉 수집 대기 · 다음 스캔 이후 확인'];
  lines.push(`지수 대비 20일 상대강도 계산 ${num(study.measuredCount)}/${num(study.experimentCount)}건 · 진입 전 완료 종가 기준`);
  for (const item of study.horizons) {
    lines.push(item.cellCount
      ? `D${item.horizon}: 상위 ${pct(item.upperMeanPct)} vs 하위 ${pct(item.lowerMeanPct)} → ${item.differencePct! > 0 ? '+' : ''}${item.differencePct!.toFixed(2)}%p · ${num(item.cellCount)}개 날짜·그룹 중 상위 우세 ${num(item.upperWinCount)} · ${num(item.entryDateCount)}진입일/${num(item.sampleCount)}건`
      : `D${item.horizon}: 확정 성과가 있는 같은 날·같은 그룹 비교 대기`);
  }
  lines.push('장중 진입 표본 검증이며 과거 재현과 별개입니다. 매수 조건에 쓰지 않습니다.');
  return lines;
}

const edgeText = (edge: PaperStrategyEdge) => edge.edgePct === null ? '비교 대기'
  : `${excess(edge.edgePct)} (${num(edge.dateCount)}일·${num(edge.tradeCount)}건)`;
function selectionLines(selection: PaperStrategySelection | undefined): string[] {
  if (!selection || !selection.candidateCount) return [];
  const c = selection.comparison, adaptive = selection.adaptive;
  const rate = selection.selectionRatePct === null ? '미확인' : `${selection.selectionRatePct.toFixed(1)}%`;
  return ['', '<b>전략 선별력 · 같은 날 후보 대비</b>',
    `전략 진입일 ${num(selection.dateCount)}일 · 후보 ${num(selection.candidateCount)} 중 신규 진입 ${num(selection.boughtCount)} (${rate}) · 기존 보유 ${num(selection.heldCount)} · 미진입 ${num(selection.notBoughtCount)}`,
    ...selection.cohorts.filter(item => item.candidateCount).map(item =>
      `• ${COHORT_LABELS[item.cohort]}: ${num(item.boughtCount)}/${num(item.candidateCount)} 진입`),
    c.groupCount
      ? `청산 전략 ${pct(c.strategyMeanPct)} vs 같은 날·같은 기간 미진입 ${pct(c.unselectedMeanPct)} → 차이 ${c.differencePct === null ? '미확인' : `${c.differencePct > 0 ? '+' : ''}${c.differencePct.toFixed(2)}%p`} · ${num(c.groupCount)}개 날짜·기간 (전체 후보 ${pct(c.baselineMeanPct)})`
      : '같은 날 미진입 후보의 확정 성과가 아직 없어 선별력 비교 대기',
    ...(adaptive ? ['', '<b>관측 매도 거래 · D5 종가 기준</b>',
      `종목 선택: 산 종목 − 같은 날 안 산 종목 ${edgeText(adaptive.entry)}`,
      `• 검증 통과 ${edgeText(adaptive.validatedEntry)} · 탐색 ${edgeText(adaptive.explorationEntry)}`,
      `매도: 실제 청산 − 같은 거래 D5 보유 ${edgeText(adaptive.exit)}`,
      ...adaptive.months.slice(-3).map(item => `• ${item.month}: 선택 ${edgeText(item.entry)} · 매도 ${edgeText(item.exit)}`)] : []),
    '진입률은 전체 전략 기준입니다. 예약 청산 거래는 같은 보유기간, 관측 매도 거래는 D5 종가로 비교합니다. 연구 표시이며 매수 조건에 쓰지 않습니다.'];
}

export interface PaperBotTradeEvent { id: string; at: string; trade: PaperStrategyTrade; side: 'BUY' | 'EXIT' }
export function paperTradeEvents(trades: PaperStrategyTrade[]): PaperBotTradeEvent[] {
  return trades.flatMap(trade => [{ id: `${trade.id}:BUY`, at: trade.entryAt, trade, side: 'BUY' as const },
    ...(trade.exit ? [{ id: `${trade.id}:EXIT`, at: trade.exit.decisionAt, trade, side: 'EXIT' as const }] : [])]);
}
export function formatPaperTrades(events: PaperBotTradeEvent[]): string {
  const buys = events.filter(item => item.side === 'BUY').length;
  const lines = ['📣 <b>Shadow 매수·매도</b>', '가상 매매 · 실제 주문 없음', '',
    `<b>매수 ${buys}건 · 매도 ${events.length - buys}건</b>`];
  for (const event of events.slice(0, 10)) {
    const trade = event.trade;
    const purpose = trade.entryDecision.explorationEvidence ? '탐색 가상매수 · 검증 전' : trade.entryDecision.adaptiveEvidence ? '검증 통과 가상매수' : '구전략 가상매수';
    const block = [`${event.side === 'BUY' ? '🟢' : '🔴'} <b>${event.side === 'BUY' ? '매수' : '매도'} · ${escape(trade.name.slice(0, 30))} (${escape(trade.symbol)})</b>`];
    if (event.side === 'BUY') block.push(`<b>1주 · ${num(trade.entryPrice)}원</b>`,
      `매수 판단 ${stamp(event.at)}`,
      trade.policy.exitModel === 'ADAPTIVE_OBSERVED' ? '매도 기준: 가격·진입 근거 변화' : `예약 매도 ${trade.scheduledExitDate}`);
    else block.push(`순수익률 <b>${pct(trade.exit?.netReturnPct)}</b>`,
      `매수 ${num(trade.entryPrice)}원 → 매도 ${trade.exit && Number.isFinite(trade.exit.price) ? num(trade.exit.price) : '미확인'}원`,
      trade.exit?.model === 'ADAPTIVE_OBSERVED' ? `관측 매도 ${stamp(trade.exit.effectiveAt)}` : `예약 매도 · 평가일 ${trade.scheduledExitDate}`,
      ...(trade.exit?.model === 'ADAPTIVE_OBSERVED' ? [`사유: ${escape(trade.exit.decision.reason.slice(0, 100))}`] : []),
      `매수일 ${trade.tradingDate} · 매도 판단 ${stamp(event.at)}`);
    block.push(trade.entryDecision.explorationEvidence ? `🧪 ${purpose}` : purpose);
    lines.push(`\n${block.join('\n')}`);
  }
  if (events.length > 10) lines.push(`외 ${events.length - 10}건 · 전체 내역은 대시보드에서 확인`);
  lines.push('', '근거·복기: 분석 채널 · 전체 내역 /paper');
  return lines.join('\n');
}
const COHORT_LABELS: Record<PaperStrategyCohort, string> = {
  NEWS_RECENT_ABOVE_MA20: '최근 뉴스 있음 · 20일선 위', NEWS_RECENT_BELOW_MA20: '최근 뉴스 있음 · 20일선 아래',
  NEWS_ABSENT_ABOVE_MA20: '최근 뉴스 미관측 · 20일선 위', NEWS_ABSENT_BELOW_MA20: '최근 뉴스 미관측 · 20일선 아래',
};

function measuredExitLines(trade: PaperStrategyTrade, reportedAt: string): string[] {
  const measurement = trade.measurement, exit = trade.exit;
  if (!measurement || !exit) return ['보유 중 가격 측정 미기록 · 관측 최고 대비 청산 차이 미집계'];
  const cutoff = Date.parse(reportedAt), end = Date.parse(exit.effectiveAt), start = Date.parse(trade.entryAt);
  const points = [measurement.latest, measurement.highest, measurement.lowest];
  if (!points.every(point => Date.parse(point.effectiveAt) >= start && Date.parse(point.effectiveAt) <= end
    && (point.kind === 'ENTRY'
      ? Date.parse(point.observedAt) <= Date.parse(point.effectiveAt) && Date.parse(point.effectiveAt) === Date.parse(point.recordedAt)
      : Date.parse(point.effectiveAt) <= Date.parse(point.observedAt) && Date.parse(point.observedAt) <= Date.parse(point.recordedAt))
    && Date.parse(point.recordedAt) <= cutoff)) return ['청산 시점에 확인 가능한 가격 측정 기록 없음 · 경로 비교 미집계'];
  return [`보유 중 관측 ${num(measurement.pointCount)}개 · 추적 시작 ${stamp(measurement.startedAt)} KST`,
    ...(measurement.fromEntry ? [] : ['진입 후 중간 추적 · 이전 구간 미기록']),
    ...([['최근', measurement.latest], ['관측 최고', measurement.highest], ['관측 최저', measurement.lowest]] as const).map(([label, point]) =>
      `${label} ${pct(point.netReturnPct)} · ${num(point.price)}원 · 가격 ${stamp(point.effectiveAt)} / 관측 ${stamp(point.observedAt)} / 기록 ${stamp(point.recordedAt)} KST`),
    `관측 최고 순수익 − 청산 순수익 ${(measurement.highest.netReturnPct - exit.netReturnPct).toFixed(2)}%p${measurement.fromEntry ? '' : ' · 중간 추적 구간 기준'}`,
    '수집된 가격 기준이며 실제 장중 최고·최저나 최적 매도점은 아닙니다.'];
}

/** Only entry-frozen evidence and the matching exit; never re-evaluate a signal. */
export function formatPaperTradeAnalysis(events: PaperBotTradeEvent[]): string {
  const lines = ['📝 <b>Shadow 매매 분석</b>', '가상 매매 · 실제 주문 없음'];
  for (const event of events.slice(0, 5)) {
    const trade = event.trade;
    const evidence = trade.entryDecision.evidence;
    const exploration = trade.entryDecision.explorationEvidence;
    const adaptive = exploration ?? trade.entryDecision.adaptiveEvidence;
    const selected = evidence?.horizons.find(item => item.horizon === trade.horizon);
    lines.push('', `<b>${event.side === 'BUY' ? '진입 근거' : '청산 복기'} · ${escape(trade.name.slice(0, 30))}(${trade.symbol})</b>`,
      `매수 ${num(trade.entryPrice)}원 · ${trade.tradingDate}`,
      ...(event.side === 'EXIT' ? [`청산 순수익률 <b>${pct(trade.exit?.netReturnPct)}</b>`] : []),
      trade.policy.exitModel === 'ADAPTIVE_OBSERVED' ? '매도: 가격·진입 근거로 판단' : `예약 매도 ${trade.scheduledExitDate}`);
    if (trade.morningRecommendation) lines.push(`아침 추천 연결: ${stamp(trade.morningRecommendation.sentAt)} · ${trade.morningRecommendation.rank}순위 · ${trade.morningRecommendation.matchesEntryRule ? '같은 규칙 진입' : '다른 규칙 진입'}`);
    if (trade.exitPolicy) {
      const policy = trade.exitPolicy, profile = policy.profile;
      lines.push('', '🎯 <b>매도 기준</b>', `매도 기준: ${policy.origin === 'FORWARD_LEARNED' ? '후속 관측 검증으로 선택' : '초기 탐색 기준 · 학습 검증 전'}`,
        `• 손실 제한 ${profile.stopLossPct}%`,
        `• 수익 ${profile.trailingArmPct}% 도달 후 고점 대비 ${profile.trailingDrawdownPct}%p 반납`,
        `• 진입 근거 ${profile.signalFailureCount}회/${profile.signalFailureMinutes}분 이상 약화`);
    }
    if (adaptive) {
      const { training, validation, rule } = adaptive.candidate;
      const invented = rule.invention;
      lines.push('', exploration ? '🧪 <b>탐색 가상매수 · 검증 전</b>' : '✅ <b>검증 통과 가상매수</b>',
        `${exploration ? '탐색' : '자동 연결'} 지표: ${escape(paperTelegramRuleLabel(rule))}`);
      if (exploration) lines.push(`탐색 등록 ${stamp(exploration.registeredAt)}`);
      if (invented) lines.push(`원본 수식 생성 ${escape(invented.createdAt)} · 발명 자료 기준 ${escape(invented.discoveryCutoffAt)}`);
      lines.push('', `<b>${invented ? '발명 당시 학습' : '학습'} ${num(training.sampleCount)}건/${training.dateCount}진입일</b>`,
        `평균 순수익률 ${pct(training.meanNetReturnPct)} · 일당 대조군 차이 ${excess(training.meanDailyExcessPct)}`,
        '', `<b>${invented ? '생성 후 검증' : '후반 확인'} ${num(validation.sampleCount)}건/${validation.dateCount}진입일</b>`,
        `평균 순수익률 ${pct(validation.meanNetReturnPct)} · 일당 대조군 차이 ${excess(validation.meanDailyExcessPct)}`,
        `근거 기준 ${stamp(adaptive.cutoffAt)} · 선택 평가 ${stamp(adaptive.evaluatedAt)} · ${invented ? '생성 후 검증' : '후반'} 시작 ${adaptive.validationStartDate ?? '누적 대기'}`,
        '진입 당시 근거 고정 · 이후 매도는 거래별 매도 규칙 적용');
    } else if (evidence) {
      lines.push('구전략 가상매수', COHORT_LABELS[evidence.cohort],
        `동일 유형 ${num(evidence.sampleCount)}건 · ${num(evidence.entryDateCount)}개 진입일`,
        `기본 관측 ${evidence.baselineSampleCount ?? '미기록'}건 · 과거 재현 ${evidence.historicalSampleCount ?? '미기록'}건`,
        `진입 당시 D${trade.horizon} 평균 순수익률 ${pct(selected?.meanNetReturnPct)} · 승률 ${pct(selected?.winRatePct)}`,
        `D1·D3·D5 중 거래일당 평균 성과로 보유기간 선택 · 근거 기준 ${stamp(evidence.cutoffAt)}`);
    } else lines.push('진입 당시 학습 근거 미기록');
    const entryMs = Date.parse(trade.entryAt);
    const headline = trade.entryObservation.news.filter(item => Date.parse(item.observedAt) <= entryMs
      && Date.parse(item.observedAt) >= entryMs - trade.policy.newsLookbackHours * 3_600_000)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    const summary = summarizePaperNews(trade.entryObservation.news, trade.entryAt, trade.policy.newsLookbackHours);
    const flow = trade.entryObservation.investorFlow;
    lines.push('', '📰 <b>진입 당시 뉴스·수급</b>');
    if (flow) {
      const shares = (value: number | null) => value === null ? '미확인' : `${num(value)}주`;
      lines.push(`진입 당시 직전 거래일 수급(${escape(flow.requestedTradingDate)}): 외국인 ${shares(flow.foreignNetShares)} · 기관 ${shares(flow.institutionalNetShares)}`);
      if (flow.issue) lines.push(`수급 비교 제외: ${PAPER_FLOW_ISSUE_LABELS[flow.issue] ?? '자료 확인 필요'}`);
    } else lines.push('진입 당시 기관·외국인 수급 미기록');
    lines.push(`진입 당시 뉴스 평가: ${PAPER_NEWS_LABELS[summary.direction]}`);
    if (summary.totalCount) lines.push(`호재 ${summary.counts.POSITIVE} · 악재 ${summary.counts.NEGATIVE} · 혼재 ${summary.counts.MIXED} · 중립 ${summary.counts.NEUTRAL} · 판단 불가 ${summary.counts.UNKNOWN}`);
    if (headline && !summary.evidence.length) lines.push(`당시 뉴스: ${escape(headline.headline.slice(0, 70))}`);
    for (const item of summary.evidence.slice(0, 2)) {
      lines.push(`${PAPER_NEWS_LABELS[item.direction]} · ${escape(item.source)}: ${escape(item.headline.slice(0, 60))}`,
        `분류 근거: ${escape(item.reason.slice(0, 90))}`);
      const facts = readPaperNewsFacts(item, trade.entryAt);
      if (facts) lines.push(`${PAPER_NEWS_RELATION_LABELS[facts.relationship]} · ${PAPER_NEWS_FILING_LABELS[facts.filingStatus]}`,
        ...(facts.relationship === 'DIRECT' ? [`사건 ${PAPER_NEWS_EVENT_LABELS[facts.event]} · 접수일 ${escape(facts.filedDate ?? '미확인')}`,
          `최초 확인 ${stamp(facts.firstSeenAt)} · 원문 ${facts.sourceUrl}`] : []));
    }
    if (event.side === 'EXIT') lines.push('', '📈 <b>보유 중 관측</b>', ...measuredExitLines(trade, event.at));
  }
  lines.push('', '관측 표본의 과거 평균이며 개별 종목의 수익 예측이 아닙니다.',
    '뉴스 분류는 연구용이며 진입 조건에 미반영입니다.', '/paper · /paper_research');
  return lines.join('\n');
}

export function formatPaperBotStatus(state: PaperBotState): string {
  const sent = state.messages.filter(item => item.state === 'SENT').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0];
  const health = { OK: '정상', PAUSED: '일시정지', STALE: '관측 지연', UNAVAILABLE: '원장 조회 오류', PRICE_MISSING: '장중 가격 미확인', STRATEGY_ERROR: '전략 갱신 오류' }[state.health] ?? '점검 대기';
  const channels = { TRADE: 'CH1 매매', ANALYSIS: 'CH2 판단', INFO: 'CH3 정보', SYSTEM: 'CH4 연구', DM: '개인 DM' };
  const delivery = Object.entries(channels).map(([channel, label]) => {
    const messages = state.messages.filter(item => (item.channel ?? 'DM') === channel);
    return `${label}: 성공 ${messages.filter(item => item.state === 'SENT').length} · 대기 ${messages.filter(item => item.state === 'PENDING').length} · 실패 ${messages.filter(item => item.state === 'FAILED').length}`;
  });
  return ['🤖 <b>Shadow 알림 봇</b>', '', '🗓 <b>발송 일정</b>', ...PAPER_BOT_SCHEDULES.map(item => item.label), '매분 · 새 전략 진입/청산, 연구 변경, 관측 중단/복구 확인', '', '📮 <b>채널 역할</b>',
    'CH1 매매: 진입·청산 / CH2 판단: 08:30 추천·진입 근거·청산 복기·10:30/13:30 판단',
    'CH3 정보: 08:45 준비 / CH4 연구: 지표 변경·16:10 성과·일요일 연구 / 개인 DM: 운영 상태', '',
    '관측 지연: 장중 10분·휴장/장외 60분, 진행률 확인 후 5분 지속 시 알림 · 같은 경고 최소 1시간 간격',
    '', `⚙️ <b>관측 상태 ${health}</b>`,
    `마지막 점검 ${stamp(state.lastCheckedAt)}`, `마지막 확인된 발송 ${stamp(sent?.sentAt)}`,
    `최근 14일: 발송 대기 ${state.messages.filter(item => item.state === 'PENDING').length} · 실패 ${state.messages.filter(item => item.state === 'FAILED').length} · 만료 ${state.messages.filter(item => item.state === 'EXPIRED').length}`,
    '08:30 추천 명단·근거·발송 원문은 날짜별로 별도 영구 보관합니다.',
    ...(state.messages.some(item => item.kind === 'recommendation' && item.state === 'SENT' && item.error)
      ? ['추천 발송 성공 · 영구 보관의 발송 확인 갱신 필요'] : []),
    '', '📬 <b>채널별 발송 결과</b>', ...delivery, '', 'Telegram 메시지 ID를 받은 경우에만 발송 성공으로 기록합니다.', '/paper · /paper_research'].join('\n');
}
