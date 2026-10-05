// @responsibility Format dated Shadow research reports for Telegram.
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperStrategyDecision, PaperStrategyPerformance } from '../../src/types/paperStrategy.js';
import { PAPER_ADAPTIVE_REASON_LABELS, paperAdaptiveRuleLabel, type PaperAdaptiveRule, type PaperAdaptiveState } from '../../src/types/paperAdaptive.js';
import { PAPER_FEATURES } from '../../src/types/paperObservationFeatures.js';
import { paperIndicatorFormulaOperands } from '../../src/types/paperIndicatorFormula.js';
import { explainPaperIndicator, inventedRuleRange } from '../../src/utils/paperIndicatorExplanation.js';
import { toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { PAPER_AUTONOMY_REASON_LABELS, paperAutonomyRuleKey } from '../../src/types/paperAutonomy.js';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (value: string, limit = 120) => escape(Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, limit).join(''));
const num = (value: number) => Number.isFinite(value) ? value.toLocaleString('ko-KR') : '미집계';
const pct = (value: number | null | undefined, unit = '%') => value == null || !Number.isFinite(value) ? '미집계'
  : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
const known = (value: string | undefined, cutoff: number) => Boolean(value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= cutoff);
const stamp = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '시각 미확인';

/** Plain text only; callers escape it before inserting Telegram HTML. */
export function paperTelegramRuleLabel(rule: PaperAdaptiveRule): string {
  return rule.invention
    ? `${explainPaperIndicator(rule.invention.formula).title} · 조합값 ${inventedRuleRange(rule.bucket)} · D${rule.horizon}`
    : paperAdaptiveRuleLabel(rule).replace(PAPER_FEATURES.pbr.label, 'PBR (주가순자산비율)');
}

function ruleLines(rule: PaperAdaptiveRule): string[] {
  const label = paperTelegramRuleLabel(rule);
  const split = label.lastIndexOf(' · ', label.lastIndexOf(' · ') - 1);
  if (split < 0) return [`<b>• ${text(label, 180)}</b>`];
  return [`<b>• ${text(label.slice(0, split), 100)}</b>`, `조건 ${text(label.slice(split + 3), 80)} 성과 비교`];
}

function bounded(lines: string[], limit: number): string[] {
  const result: string[] = [], tail = '… 상세 /paper_research';
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 + tail.length > limit) { result.push(tail); break; }
    result.push(line); size += line.length + 1;
  }
  return result;
}

function adaptivePerformance(view: PaperExperimentView, cutoff: number, purpose?: 'VALIDATED' | 'EXPLORATION'): (PaperStrategyPerformance & { openCount?: number }) | undefined {
  const strategy = view.strategy;
  if (!strategy) return undefined;
  if (strategy.trades.length === strategy.totalCount) {
    const trades = strategy.trades.filter(trade => trade.strategyVersion === 'adaptive-features-v1' && known(trade.entryAt, cutoff)
      && (!purpose || (trade.entryDecision.explorationEvidence ? 'EXPLORATION' : 'VALIDATED') === purpose));
    const closed = trades.filter(trade => trade.status === 'CLOSED' && trade.exit
      && known(trade.exit.effectiveAt, cutoff) && known(trade.exit.observedAt, cutoff) && known(trade.exit.decisionAt, cutoff)
      && Number.isFinite(trade.exit.netReturnPct)).map(trade => trade.exit!);
    return { closedCount: closed.length, meanNetReturnPct: closed.length ? closed.reduce((sum, item) => sum + item.netReturnPct, 0) / closed.length : null,
      winRatePct: null, totalNetPnl: null, openCount: trades.length - closed.length };
  }
  return known(strategy.lastRun?.asOf, cutoff) ? purpose ? strategy.performanceByPurpose?.[purpose] : strategy.performanceByVersion?.['adaptive-features-v1'] : undefined;
}

export function formatPaperAdaptiveSummary(view: PaperExperimentView, now: Date, detail: 'full' | 'brief' = 'full'): string[] {
  const lines = ['🔬 <b>자율 연구 · 지표 발명</b>'], strategy = view.strategy, cutoff = now.getTime();
  if (!strategy || strategy.error || strategy.lastRun?.error) return [...lines, strategy ? '전략 갱신 오류 · 연구 상태 확인 불가' : '자율 연구 기록 미조회'];
  const state = strategy.adaptive;
  const exitLearning = strategy.exitLearning;
  if (!state) lines.push('자율 지표 평가 미기록');
  else if (!known(state.evaluatedAt, cutoff) || !known(state.cutoffAt, cutoff)) lines.push('미래 또는 잘못된 평가 시각 · 연구 상태 확인 필요');
  else {
    const active = state.candidates.filter(item => item.active), discovery = state.discovery;
    lines.push(`최근 평가 ${stamp(state.evaluatedAt)} KST`, '',
      `✅ <b>검증 지표 자동 연결 ${active.length}개/최대 3개</b>`,
      ...(discovery ? [`이 중 발명 지표 ${active.filter(item => item.rule.invention).length}개`] : []));
    for (const item of active.slice(0, detail === 'full' ? 3 : 0)) lines.push('', ...ruleLines(item.rule),
      `${item.rule.invention ? '생성 후 검증' : '후반 검증'} ${num(item.validation.sampleCount)}건/${num(item.validation.dateCount)}일 · 일당 차이 ${pct(item.validation.meanDailyExcessPct, '%p')}`);
    const exploration = state.exploration?.rules;
    lines.push('', '🧪 <b>탐색 가상매수 · 검증 전</b>', !exploration ? '등록 확인 대기'
      : exploration.some(trial => !known(trial.registeredAt, cutoff)) ? '탐색 등록 시각 확인 필요'
        : `연결 ${exploration.length}개/최대 2개 · 수익성 검증 전`);
    for (const trial of (detail === 'full' ? exploration ?? [] : []).filter(item => known(item.registeredAt, cutoff)).slice(0, 2)) {
      lines.push('', ...ruleLines(trial.candidate.rule), text(PAPER_ADAPTIVE_REASON_LABELS[trial.candidate.reason], 35));
      const autonomy = state.exploration?.autonomy;
      const entry = autonomy?.entries.find(item => item.ruleKey === paperAutonomyRuleKey(trial.candidate.rule));
      if (autonomy && known(autonomy.evaluatedAt, cutoff) && entry) lines.push(
        `${PAPER_AUTONOMY_REASON_LABELS[entry.reason]} · 상대 배분 ${entry.weight}`,
        `실제 탐색 평가 ${entry.stats.sampleCount}건/${entry.stats.dateCount}진입일 · 진행 ${entry.stats.pendingCount}건`);
    }
    if (state.exploration?.autonomy?.status === 'FALLBACK' && known(state.exploration.autonomy.evaluatedAt, cutoff)) lines.push('자율 배분 확인 필요 · 기존 순환·균등 배정 사용');
    if (discovery) lines.push('', '🧬 <b>새 지표 연구</b>', `발명 ${discovery.round}차 · 이번 회차 검토 ${discovery.attemptedIds.length}개 · 보관 ${discovery.inventions.length}개`,
      `생성 후 검증 대기 ${state.candidates.filter(item => item.rule.invention && item.reason === 'FORWARD_OBSERVATION').length}개`);
    else lines.push('지표 발명 연구 기록 미조회');
    if (state.programResearch && (!state.programResearch.attemptedAt || known(state.programResearch.attemptedAt, cutoff))) {
      const research = state.programResearch;
      const label = { IDLE: '새 자료 대기', RUNNING: '계산법 작성 중', READY: '작성 회차 완료 · 성과 검증 별도', FAILED: '작성 회차 확인 필요 · 기존 전략 계속' };
      const terminal = research.state === 'READY' || research.state === 'FAILED';
      lines.push(`AI 계산법: ${terminal && !known(research.completedAt ?? undefined, cutoff) ? '보고 시점의 작성 완료 미확인' : label[research.state]}`);
    }
    if (detail === 'full' && state.policy.maturityModel === 'per-horizon-v1') {
      lines.push('', '📚 <b>학습·검증 표본</b>');
      if (state.horizonSamples) for (const item of state.horizonSamples) lines.push(`<b>D${item.horizon}</b> · 학습 ${num(item.trainingSampleCount)}건/${num(item.trainingDateCount)}일 · 검증 ${num(item.validationSampleCount)}건/${num(item.validationDateCount)}일`);
      else lines.push('보유기간별 표본 집계 확인 대기');
    }
    lines.push(`${state.policy.maturityModel === 'per-horizon-v1' ? '한 보유기간 이상 확정 표본' : '성숙 관측'} ${num(state.matureSampleCount)}건/${num(state.matureDateCount)}진입일`);
    if (detail === 'full') lines.push('D1·D3·D5는 성과 비교 시점이며 매도 예약일이 아닙니다.',
      '발명 지표의 조합값은 재료를 기준값으로 환산한 값입니다. 수식·해설은 대시보드에서 확인하세요.');
    const reasons = new Map<string, number>();
    for (const item of state.candidates.filter(item => !item.active)) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
    if (detail === 'full' && reasons.size) lines.push(`미채택: ${[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([reason, count]) =>
      `${text(PAPER_ADAPTIVE_REASON_LABELS[reason as keyof typeof PAPER_ADAPTIVE_REASON_LABELS] ?? reason, 35)} ${count}개`).join(' · ')}`);
  }
  const performance = adaptivePerformance(view, cutoff);
  const performanceLine = performance ? `현행 자율 전략 전체(검증+탐색) 가상 청산 ${num(performance.closedCount)}건 · 평균 순수익률 ${pct(performance.meanNetReturnPct)} (구전략 제외)`
    : '현행 자율 전략 성과 미집계 · 구전략 합산 성과로 대체하지 않음';
  const performanceLines = ['', '📊 <b>가상 매매 결과 · 구전략 제외</b>', detail === 'full' ? performanceLine : performance
    ? `현행 전략 매도 ${num(performance.closedCount)}건 · 평균 순수익률 ${pct(performance.meanNetReturnPct)} (검증+탐색, 구전략 제외)`
    : '현행 자율 전략 성과 미집계', ...(['VALIDATED', 'EXPLORATION'] as const).map(purpose => {
    const value = adaptivePerformance(view, cutoff, purpose), label = purpose === 'VALIDATED' ? '검증 통과 진입' : '탐색 진입(검증 전)';
    return value ? `${label}: 보유 ${value.openCount === undefined ? '미집계' : `${num(value.openCount)}건`} · 청산 ${num(value.closedCount)}건 · 평균 ${pct(value.meanNetReturnPct)}`
      : `${label}: 목적별 성과 미집계`;
  })];
  if (exitLearning && known(exitLearning.evaluatedAt, cutoff)) performanceLines.push('', '🎯 <b>매도 학습</b>',
    `매도 학습: ${exitLearning.selectedProfileId ? '검증 기준 채택' : '초기 기준 탐색 · 검증 전'}`,
    `비교 완료 ${num(exitLearning.completedTradeCount)}건/${num(exitLearning.completedDateCount)}진입일`);
  return [...bounded(lines, (detail === 'full' ? 1900 : 1100) - performanceLines.join('\n').length - 1), ...performanceLines];
}

function frozenFormula(rule: PaperAdaptiveRule | null): string[] {
  const invention = rule?.invention;
  if (!invention) return [];
  if (invention.formula.version === 'feature-program-v1') return ['', '📐 <b>AI 계산 기준 · 변경 당시 고정</b>',
    `연구 등록 ${stamp(invention.createdAt)} KST · 계산 ID ${invention.formula.digest.slice(0, 12)}`,
    `AI 해석: ${text(invention.formula.interpretation, 160)}`, `한계: ${text(invention.formula.limitation, 120)}`,
    '가설·계산 절차·재료별 기준은 대시보드 발명 지표에서 확인'];
  return ['', '📐 <b>수식 기준</b>', `고정 수식 생성 ${stamp(invention.createdAt)} KST`,
    ...paperIndicatorFormulaOperands(invention.formula).map(operand =>
      text(`N(${PAPER_FEATURES[operand.feature].label})=(값−${operand.center})/${operand.scale}`, 120)), '각각 −3~3 제한'];
}
function changeType(change: PaperAdaptiveState['changes'][number]): string {
  if (change.reason === 'FORWARD_OBSERVATION' && !change.from && change.to) return '새 지표 생성';
  if (change.reason === 'DISCOVERY_RETIRED') return '연구 종료';
  return change.from && change.to ? '규칙 교체' : change.to ? '매수에 채택' : '연결 해제';
}

export function formatPaperResearchChanges(state: PaperAdaptiveState, changes: PaperAdaptiveState['changes'], now: Date): string {
  const cutoff = now.getTime();
  const valid = changes.filter(change => known(change.at, cutoff)
    && [change.from, change.to].every(rule => !rule?.invention || known(rule.invention.createdAt, Date.parse(change.at))));
  const lines = ['🧬 <b>Shadow 자율 연구 변경</b>', '가상 판단 · 실제 주문 없음'];
  if (known(state.evaluatedAt, cutoff)) lines.push(`최근 저장 평가 ${stamp(state.evaluatedAt)} KST`);
  else lines.push('최근 평가 시각 확인 필요');
  for (const change of valid.slice(0, 3)) lines.push('', `<b>${changeType(change)} · ${stamp(change.at)} KST</b>`,
    `이전: ${change.from ? text(paperTelegramRuleLabel(change.from), 220) : '없음'}`,
    `이후: ${change.to ? text(paperTelegramRuleLabel(change.to), 220) : '없음'}`,
    `사유: ${text(PAPER_ADAPTIVE_REASON_LABELS[change.reason] ?? change.reason, 80)}`,
    ...frozenFormula(change.to ?? change.from));
  if (!valid.length) lines.push('보고 가능한 변경 기록 없음');
  if (valid.length > 3) lines.push(`추가 변경 ${valid.length - 3}건 · 상세 기록 확인`);
  if (valid.length < changes.length) lines.push(`미래·시각 불명 변경 ${changes.length - valid.length}건 제외`);
  lines.push('', '변경 당시 고정한 규칙입니다. 현재 평가 성과와 구분해 기록합니다.', '/paper_research');
  return bounded(lines, 3500).join('\n');
}

function decisionEvidence(item: PaperStrategyDecision): string[] {
  const evidence = item.explorationEvidence ?? item.adaptiveEvidence;
  if (!evidence) return [];
  const cutoff = Date.parse(item.decisionAt);
  if (!known(evidence.evaluatedAt, cutoff) || !known(evidence.cutoffAt, cutoff)
    || (item.explorationEvidence && !known(item.explorationEvidence.registeredAt, cutoff))
    || (evidence.candidate.rule.invention && !known(evidence.candidate.rule.invention.createdAt, cutoff))) return ['진입 근거 시각 확인 필요'];
  const { rule, validation } = evidence.candidate;
  return [...(item.explorationEvidence ? ['🧪 탐색 가상매수 · 검증 전'] : []), `진입 당시 고정 지표: ${text(paperTelegramRuleLabel(rule), 140)}`,
    `${rule.invention ? '생성 후 검증' : '후반 검증'} ${num(validation.sampleCount)}건/${num(validation.dateCount)}일 · 일당 대조군 차이 ${pct(validation.meanDailyExcessPct, '%p')}`];
}

export function formatPaperIntraday(view: PaperExperimentView, date: string, now: Date): string {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!validDate || !Number.isFinite(now.getTime()) || date > toKstDateKey(now)) return '<b>Shadow 장중 점검</b>\n집계 날짜 확인 필요';
  const cutoff = Math.min(now.getTime(), Date.parse(`${date}T23:59:59.999+09:00`));
  const lines = [`🕒 <b>Shadow 장중 점검 · ${date}</b>`, `보고 기준 ${stamp(new Date(cutoff).toISOString())} KST · 가상 판단 · 실제 주문 없음`, ''];
  const last = view.lastRun;
  if (last && known(last.asOf, cutoff)) lines.push(`마지막 관측 ${stamp(last.asOf)} KST${toKstDateKey(last.asOf) === date ? '' : ' · 이전 날짜 기록'}`,
    `가격 확인 ${num(last.observedCount)}/${num(last.candidateCount)}종목 · 미확인 ${num(last.missingPriceCount)}`);
  else lines.push(last ? '관측 시각 확인 필요 · 미래·시각 불명 기록 제외' : '관측 기록 미조회');
  const collection = view.collection;
  if (collection && known(collection.lastProgressAt, cutoff) && known(collection.startedAt, Date.parse(collection.lastProgressAt))) {
    lines.push(`수집 진행 기록 ${num(collection.completed)}/${num(collection.total)}종목 · ${stamp(collection.lastProgressAt)} KST`);
  }
  const strategy = view.strategy, run = strategy?.lastRun;
  if (!strategy || strategy.error || run?.error) lines.push('', '전략 갱신 상태 확인 필요 · 판단 건수 미집계');
  else if (!run || !known(run.asOf, cutoff) || toKstDateKey(run.asOf) !== date) lines.push('', '오늘 확인된 최신 전략 판단 미기록 · 이전·미래 판단으로 대체하지 않음');
  else {
    const decisions = [...new Map(strategy.latestDecisions.filter(item => item.snapshotId === run.snapshotId && item.decisionAt === run.asOf
      && known(item.decisionAt, cutoff)).map(item => [item.symbol, item])).values()];
    const expected = run.openedCount + run.closedCount + run.waitingCount + run.holdingCount;
    lines.push('', `<b>최근 판단 · ${stamp(run.asOf)} KST</b>`);
    if (!decisions.length && expected > 0) lines.push('최신 판단 상세 미조회 · 건수 미집계');
    else {
      if (decisions.length !== expected) lines.push(`최신 판단 일부 확인 ${decisions.length}/${num(expected)}종목 · 아래는 확인된 상세 기준`);
      const count = (action: PaperStrategyDecision['action']) => decisions.filter(item => item.action === action).length;
      lines.push(`<b>매수 ${count('BUY')} · 매도 ${count('EXIT')} · 보유 ${count('HOLD')} · 대기 ${count('WAIT')}</b>`, '');
      const reasons = new Map<string, { reason: string; count: number }>();
      for (const item of decisions.filter(item => item.action === 'WAIT')) {
        const current = reasons.get(item.reasonCode) ?? { reason: item.reason, count: 0 };
        current.count++; reasons.set(item.reasonCode, current);
      }
      for (const item of [...reasons.values()].sort((a, b) => b.count - a.count).slice(0, 3)) lines.push(`• 대기 ${num(item.count)}종목: ${text(item.reason, 90)}`);
      const priority = { BUY: 0, EXIT: 1, HOLD: 2, WAIT: 3 };
      const selected = decisions.filter(item => item.action !== 'WAIT')
        .sort((a, b) => priority[a.action] - priority[b.action]).slice(0, 3);
      for (const item of selected) lines.push('', `<b>${item.action === 'BUY' ? '매수' : item.action === 'EXIT' ? '매도' : '보유'} · ${text(item.name, 30)} (${text(item.symbol, 12)})</b>`,
        text(item.reason, 110), ...decisionEvidence(item));
      if (!selected.length) lines.push('표시할 매수·매도·보유 종목 없음');
    }
  }
  lines.push('', ...formatPaperAdaptiveSummary(view, new Date(cutoff), 'brief'), '', '/paper · /paper_research');
  return bounded(lines, 3500).join('\n');
}
