// @responsibility Display autonomous feature decisions.
import React from 'react';
import { PAPER_ADAPTIVE_REASON_LABELS, paperAdaptiveRuleLabel, paperPlaceboChance, type PaperAdaptiveEvidence, type PaperAdaptiveRule, type PaperAdaptiveState, type PaperAdaptiveStats, type PaperExplorationEvidence } from '../../types/paperAdaptive';
import { PAPER_FEATURES } from '../../types/paperObservationFeatures';
import { paperIndicatorFormulaOperands } from '../../types/paperIndicatorFormula';

const percent = (value: number | null, unit = '%') => value === null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
const timestamp = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
const samples = (value: PaperAdaptiveStats) => `${value.sampleCount}건 · ${value.dateCount}진입일 · ${value.symbolCount}종목`;

function InventionContext({ rule }: { rule: PaperAdaptiveRule }) {
  const invention = rule.invention;
  if (!invention) return null;
  return <div className="space-y-1 text-xs font-normal text-slate-400">
    <p>발명 지표 · 생성 <time dateTime={invention.createdAt}>{timestamp(invention.createdAt)} KST</time>
      {' · '}발명 자료 기준 <time dateTime={invention.discoveryCutoffAt}>{timestamp(invention.discoveryCutoffAt)} KST</time></p>
    <p>{paperIndicatorFormulaOperands(invention.formula).map(operand =>
      `N(${PAPER_FEATURES[operand.feature].label}) = (값 − ${operand.center}) / ${operand.scale}`).join(' · ')} · 각각 −3~3 범위로 제한</p>
  </div>;
}

export function PaperAdaptiveEvidenceDetails({ evidence }: { evidence: PaperAdaptiveEvidence | PaperExplorationEvidence }) {
  const candidate = evidence.candidate;
  const invented = Boolean(candidate.rule.invention);
  const exploration = 'trialId' in evidence;
  return <details className="rounded-lg border border-slate-700/60 bg-slate-950/30 text-xs text-slate-300">
    <summary className="cursor-pointer p-3 font-medium">진입 시 고정한 {exploration ? '탐색' : '지표'} 근거 · {paperAdaptiveRuleLabel(candidate.rule)}</summary>
    <div className="space-y-2 px-3 pb-3">
      {exploration && <><p>탐색 가상매수 · 검증 전 · {PAPER_ADAPTIVE_REASON_LABELS[candidate.reason]}</p>
        <p>탐색 등록 {timestamp(evidence.registeredAt)} KST · {evidence.trialId}</p></>}
      <InventionContext rule={candidate.rule} />
      {invented && <p>위 수식과 생성 시각은 이 거래의 진입 당시 원본입니다. 이후 새 지표가 생성되거나 기존 지표가 해제돼도 바뀌지 않습니다.</p>}
      <p>근거 기준 {timestamp(evidence.cutoffAt)} KST · 선택 평가 {timestamp(evidence.evaluatedAt)} KST</p>
      <p>{invented ? '생성 후 검증' : '후반 확인'} 시작 {evidence.validationStartDate ?? '누적 대기'} · 진입 이후 지표 연결이 해제돼도 당시 근거는 보존합니다. 매도는 거래에 기록한 규칙으로 판단합니다.</p>
      <p>{invented ? '발명 당시 학습' : '학습'} {samples(candidate.training)} · 평균 순수익률 {percent(candidate.training.meanNetReturnPct)} · 일당 대조군 차이 {percent(candidate.training.meanDailyExcessPct, '%p')}</p>
      <p>{invented ? '생성 후 검증' : '후반 확인'} {samples(candidate.validation)} · 평균 순수익률 {percent(candidate.validation.meanNetReturnPct)} · 일당 대조군 차이 {percent(candidate.validation.meanDailyExcessPct, '%p')}</p>
    </div>
  </details>;
}

export function PaperAdaptivePanel({ state }: { state: PaperAdaptiveState }) {
  const active = state.candidates.filter(candidate => candidate.active);
  const exploration = state.exploration?.rules;
  const invented = state.candidates.filter(candidate => candidate.rule.invention);
  const pendingInventions = invented.filter(candidate => candidate.reason === 'FORWARD_OBSERVATION').length;
  const activeInventions = invented.filter(candidate => candidate.active).length;
  const changes = [...state.changes].reverse().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  return <section className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4" aria-label="지표 자동 연결 상태">
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-200">검증 지표 자동 연결 · {active.length}개 사용 중</h4>
      <p className="text-xs text-slate-300">검증 연결 {active.length}/{state.policy.maxActiveRules}개 · 탐색 가상매수 {exploration ? `${exploration.length}/2개 · 검증 전` : '등록 확인 대기'}</p>
      <p className="text-xs text-slate-400">평가 거래일 {state.tradingDate} · 평가 {timestamp(state.evaluatedAt)} KST · 근거 기준 {timestamp(state.cutoffAt)} KST</p>
      {state.placebo && <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-950/30 p-3 text-xs" role="group" aria-label="무작위 대조">
        <p className="text-slate-200">무작위 대조 {state.placebo.permutations}회 · 검증 통과 실제 {state.placebo.passedCount}개 / 무작위 평균 {state.placebo.shuffledMeanPassedCount.toFixed(1)}개(상위 5% {state.placebo.shuffledHighPassedCount}개) · 우연히 이만큼 나올 확률 {state.placebo.chancePct.toFixed(0)}%</p>
        <p className="text-slate-400">종목끼리 수익 기록을 바꿔 지표와 수익의 관계만 끊고 같은 검증을 반복한 결과입니다. 확률이 낮을수록 우연이 아닐 가능성이 큽니다. 매수 판단에는 쓰지 않습니다.</p>
      </div>}
      <p className="text-xs text-slate-400">{state.policy.maturityModel === 'per-horizon-v1' ? '한 보유기간 이상 확정 표본' : '성숙 기본 관측'} {state.matureSampleCount}건 · {state.matureDateCount}개 진입일 · 관측 시작 {state.windowStartDate ?? '누적 대기'} · 후반 확인 시작 {state.validationStartDate ?? '누적 대기'}</p>
      {state.policy.maturityModel === 'per-horizon-v1' && <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-950/30 p-3 text-xs text-slate-300" role="group" aria-label="보유기간별 학습·검증 표본">
        {state.horizonSamples ? state.horizonSamples.map(item => <p key={item.horizon}>D{item.horizon} 확정 {item.matureSampleCount}건/{item.matureDateCount}일 · 학습 {item.trainingSampleCount}건/{item.trainingDateCount}일 · 검증 {item.validationSampleCount}건/{item.validationDateCount}일</p>)
          : <p>보유기간별 표본 집계 확인 대기</p>}
        <p className="text-slate-400">학습에는 검증 시작 전 확정된 수익만 사용합니다. 위 집계는 기간별 전체 관측이며, 각 지표·구간에 해당하는 표본은 아래에서 확인합니다.</p>
      </div>}
      <p className="text-xs text-slate-400">검증을 통과한 기본 지표와 발명 지표가 성과로 경쟁해 최대 {state.policy.maxActiveRules}개를 매수 판단에 연결합니다. 탐색 규칙은 별도 최대 2개이며, 조건이 일치하는 지표 하나로 판단합니다.</p>
      {state.discovery && <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/30 p-3" aria-label="발명 지표 현황">
        <h5 className="text-xs font-semibold text-slate-200">지표 발명 · 생성 후 관측 · 채택 · 해제·재채택</h5>
        <p className="text-xs text-slate-300">탐색 {state.discovery.round}차 · 이번 회차 기록 {state.discovery.attemptedIds.length}개 · 보관 중 {state.discovery.inventions.length}개 · 생성 후 관측 중 {pendingInventions}개 · 채택 {activeInventions}개</p>
        <p className="text-xs text-slate-400">이번 탐색 시작 {timestamp(state.discovery.roundStartedAt)} KST · 학습 진입일 기준 {state.discovery.roundTrainingEndDate ?? '누적 대기'}</p>
        <p className="text-xs text-slate-400">기존 지표 두 개의 척도를 맞춰 평균·차이·곱 수식을 만듭니다. 발명에 쓴 과거 성과와 생성 후 새로 쌓인 관측 성과를 나눠 검증합니다. 성과가 약해지면 연결을 해제하고, 보관 중인 지표는 관측을 이어가며 회복 시 다시 경쟁합니다.</p>
        <p className="text-xs text-slate-400">검토 가능한 수식을 모두 확인하고 새 학습 진입일이 20일 쌓이면 다음 탐색을 시작합니다. 보관 중인 수식은 고정하며, 다시 발명한 수식은 생성 이후 관측을 새로 쌓습니다.</p>
      </div>}
    </div>
    {active.length ? <ul className="space-y-2 text-sm text-emerald-200">{active.map(candidate => {
      const chance = paperPlaceboChance(state, candidate.rule);
      return <li key={candidate.rule.feature}>
        {paperAdaptiveRuleLabel(candidate.rule)} · {candidate.rule.invention ? '생성 후 검증' : '후반'} 일당 대조군 차이 {percent(candidate.validation.meanDailyExcessPct, '%p')}
        {chance !== null && ` · 무작위로 이 이상 ${chance.toFixed(0)}%`}
        <InventionContext rule={candidate.rule} />
      </li>;
    })}</ul>
      : <p className="text-sm text-amber-200">검증을 통과한 지표가 없습니다. 기본 관측과 성과 누적은 계속됩니다.</p>}
    {!!exploration?.length && <div className="space-y-2 text-xs text-amber-100" role="group" aria-label="탐색 가상매수 · 검증 전">
      <h5 className="font-medium">탐색 가상매수 · 검증 전</h5>
      {exploration.map(trial => <div key={trial.id} className="space-y-1 rounded-lg border border-amber-400/20 p-3">
        <p>{paperAdaptiveRuleLabel(trial.candidate.rule)} · {PAPER_ADAPTIVE_REASON_LABELS[trial.candidate.reason]}</p>
        <p>등록 {timestamp(trial.registeredAt)} KST · 등록 이후 새 관측이 일치하면 가상 진입합니다.</p>
        <p>학습 {samples(trial.candidate.training)} · 검증 {samples(trial.candidate.validation)}</p>
        <InventionContext rule={trial.candidate.rule} />
      </div>)}
    </div>}
    <details className="text-xs text-slate-300">
      <summary className="cursor-pointer py-2 font-medium">전체 지표의 연결·대기 사유 ({state.candidates.length}개)</summary>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <caption className="sr-only">자동 연결 후보별 학습 및 검증 성과</caption>
          <thead className="text-slate-400"><tr>{['지표 · 수식 · 보유기간', '상태 · 사유', '학습 표본', '학습 일당 차이', '검증 표본', '검증 일당 차이'].map(label => <th key={label} className="py-2 pr-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-800">{state.candidates.map(candidate => <tr key={candidate.rule.feature}>
            <th className="py-3 pr-3 font-medium">{paperAdaptiveRuleLabel(candidate.rule)}<InventionContext rule={candidate.rule} /></th>
            <td className={candidate.active ? 'pr-3 text-emerald-200' : 'pr-3'}>{PAPER_ADAPTIVE_REASON_LABELS[candidate.reason]}</td>
            <td className="pr-3">{samples(candidate.training)}</td><td className="pr-3 tabular-nums">{percent(candidate.training.meanDailyExcessPct, '%p')}</td>
            <td className="pr-3">{samples(candidate.validation)}</td><td className="pr-3 tabular-nums">{percent(candidate.validation.meanDailyExcessPct, '%p')}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="pt-2 text-slate-400">일당 차이는 같은 날짜·시장·뉴스·추세 대조군 대비 순수익률 차이를 보유일수로 나눈 값입니다. 진입일마다 같은 비중으로 집계하며 자료 부족과 성과 부족은 별도로 표시합니다.</p>
      {state.discovery && <p className="pt-2 text-slate-400">기본 지표의 검증은 학습 이후 구간, 발명 지표의 검증은 수식을 만든 뒤 관측한 구간입니다. 연구 종료된 수식은 보관 후보에서 빠집니다. 최근 변경 이력과 거래에 고정한 진입 당시 근거는 확인할 수 있습니다.</p>}
    </details>
    <div className="space-y-2 text-xs text-slate-300">
      <h5 className="font-medium">최근 자동 변경 {changes.length}건</h5>
      {changes.length ? <ol className="space-y-2">{changes.map((change, index) => {
        const created = change.reason === 'FORWARD_OBSERVATION' && change.from === null && change.to !== null;
        const retired = change.reason === 'DISCOVERY_RETIRED';
        const changedRule = change.to ?? change.from;
        return <li key={`${change.at}:${change.feature}:${index}`}>
        <span className="text-slate-400">{timestamp(change.at)} KST</span> · {created ? '새 지표 생성' : retired ? '연구 후보 종료' : change.from && change.to ? '교체' : change.to ? '연결' : '해제'} · {(created || retired) && changedRule
          ? paperAdaptiveRuleLabel(changedRule)
          : <>{change.from ? paperAdaptiveRuleLabel(change.from) : '미연결'} → {change.to ? paperAdaptiveRuleLabel(change.to) : '미연결'}</>} · {PAPER_ADAPTIVE_REASON_LABELS[change.reason]}
      </li>; })}</ol> : <p className="text-slate-400">아직 연결 상태 변경 기록이 없습니다.</p>}
    </div>
  </section>;
}
