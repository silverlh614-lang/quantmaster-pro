// @responsibility Explain evidence-based exploration allocation without implying proven investment performance.
import React from 'react';
import { paperAdaptiveRuleLabel, type PaperAdaptiveRule, type PaperAdaptiveState } from '../../types/paperAdaptive';
import { PAPER_AUTONOMY_POLICY, PAPER_AUTONOMY_REASON_LABELS, paperAutonomyRuleKey, type PaperAutonomyAllocation } from '../../types/paperAutonomy';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../types/paperObservationFeatures';

type Autonomy = NonNullable<NonNullable<PaperAdaptiveState['exploration']>['autonomy']>;
type Entry = Autonomy['entries'][number];
const explanations = {
  EXPLORE: '판단할 표본이 부족합니다. 실패로 단정하지 않고 시험합니다.',
  INCREASE: '완료된 가상 거래에서 양수 성과와 일자별 변동을 확인해 배분을 늘렸습니다. 이후 수익을 보장하지 않습니다.',
  REDUCE: '완료된 가상 거래의 성과가 약해 배분을 줄였습니다. 시험 기회를 0으로 만들지는 않습니다.',
  MAINTAIN: '성과의 방향이 충분히 분명하지 않아 기본 배분을 유지합니다.',
};
const stamp = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
const pct = (value: number | null) => value === null ? '미집계' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

function AllocationEntry({ entry, label, selected }: { entry: Entry; label: string; selected: boolean }) {
  return <article className="paper-autonomy-entry">
    <div className="paper-autonomy-entry-heading"><span>{selected ? '오늘 탐색에 연결' : '다음 선발 후보'}</span>
      <strong>{PAPER_AUTONOMY_REASON_LABELS[entry.reason]}</strong></div>
    <h5>{label}</h5>
    <p>{explanations[entry.reason]}</p>
    <dl className="paper-autonomy-metrics">
      <div><dt>신규 진입 배분</dt><dd>상대 가중치 {entry.weight}</dd></div>
      <div><dt>평가에 쓴 청산</dt><dd>{entry.stats.sampleCount}건 · {entry.stats.dateCount}개 진입일</dd></div>
      <div><dt>진입일별 평균 순수익률</dt><dd>{pct(entry.stats.meanDateNetReturnPct)}</dd></div>
    </dl>
    <details><summary>집계 범위와 이전 선택 보기</summary>
      <p>기준 시점까지 기록된 탐색 거래 {entry.stats.totalCount}건 · 청산 {entry.stats.closedCount}건 · 진행 중 {entry.stats.pendingCount}건</p>
      <p>같은 규칙·진입일에 진행 중인 거래가 남으면 그 진입일의 청산 결과도 평가에서 제외합니다. 빨리 끝난 수익 거래만 먼저 평가하지 않기 위한 기준입니다.</p>
      <p>확인된 전체 청산의 거래별 평균 순수익률 {pct(entry.stats.meanNetReturnPct)} · 평가에 쓴 진입일별 평균의 표준오차 {pct(entry.stats.standardErrorPct)}</p>
      <p>최근 탐색 선택 {entry.lastSelectedAt ? `${stamp(entry.lastSelectedAt)} KST` : '선택 이력 없음'}</p>
    </details>
  </article>;
}

export function PaperAutonomyPanel({ state }: { state?: PaperAdaptiveState }) {
  const autonomy = state?.exploration?.autonomy;
  const names = new Map([...state?.candidates ?? [], ...state?.exploration?.rules.map(trial => trial.candidate) ?? []]
    .map(candidate => [paperAutonomyRuleKey(candidate.rule), paperAdaptiveRuleLabel(candidate.rule)]));
  const selected = autonomy?.status === 'READY' ? autonomy.selectedRuleKeys.flatMap(key => autonomy.entries.filter(entry => entry.ruleKey === key)) : [];
  const others = autonomy?.status === 'READY' ? autonomy.entries.filter(entry => !autonomy.selectedRuleKeys.includes(entry.ruleKey)) : [];
  const entryCard = (entry: Entry, chosen: boolean) => <AllocationEntry key={entry.ruleKey} entry={entry}
    label={names.get(entry.ruleKey) ?? allocationLabel(entry.ruleKey)} selected={chosen} />;
  return <section className="paper-autonomy-panel" aria-label="자율 탐색 판단">
    <div className="paper-autonomy-heading"><h4>다음 시험 기회를 스스로 고릅니다</h4>
      <span>{autonomy?.status === 'READY' ? '자율 배분 적용' : autonomy?.status === 'FALLBACK' ? '기존 배분으로 복귀' : '자율 판단 기록 확인 대기'}</span></div>
    <p>기록된 탐색 가상 매매 결과로 최대 2개 시험 규칙을 고르고, 새 매수에 사용할 규칙의 배분을 조절합니다.</p>
    {!autonomy ? <p>저장된 자율 판단 기록이 없습니다. 이 화면만으로 기능의 운영 적용 여부를 확정할 수 없습니다.</p> : <>
      {autonomy.status === 'FALLBACK' && <div className="paper-autonomy-fallback" role="status">
        <p>자율 배분을 계산하지 못해 기존 방식으로 처리합니다. {autonomy.fallbackReason ?? '다음 일일 평가에서 상태를 다시 확인합니다.'}</p>
        <p>기존 방식으로 연결된 탐색 규칙 {state?.exploration?.rules.length ?? 0}개 · 기본 관측은 계속합니다.</p>
        {!!state?.exploration?.rules.length && <ul>{state.exploration.rules.map(trial => <li key={trial.id}>{paperAdaptiveRuleLabel(trial.candidate.rule)}</li>)}</ul>}
      </div>}
      <p className="paper-autonomy-time">평가 {stamp(autonomy.evaluatedAt)} KST · 자료 기준 {stamp(autonomy.cutoffAt)} KST</p>
      {autonomy.status === 'READY' && !selected.length && <p>이번에 연결된 탐색 규칙이 없습니다. 기본 관측은 계속합니다.</p>}
      <div className="paper-autonomy-cards">{selected.map(entry => entryCard(entry, true))}</div>
      {!!others.length && <details className="paper-autonomy-others"><summary>다른 후보 {others.length}개의 판단 보기</summary>
        <div className="paper-autonomy-cards">{others.map(entry => entryCard(entry, false))}</div></details>}
    </>}
    <details className="paper-autonomy-guide"><summary>무엇이 바뀌고, 숫자는 어떻게 읽나요?</summary>
      <p>최근 최대 {PAPER_AUTONOMY_POLICY.windowEntryDates}개 진입일 중 하루 시작 전까지 청산이 확인된 탐색 거래를 사용합니다. 최소 {PAPER_AUTONOMY_POLICY.minimumSamples}건·{PAPER_AUTONOMY_POLICY.minimumEntryDates}개 진입일은 배분의 성과를 판단하기 위한 기준이며, 탐색 매수를 막는 추가 조건이 아닙니다.</p>
      <p>첫 자리는 결과와 자료 부족을 보고 고르고, 둘째 자리는 최근 기회를 못 받은 후보를 순환합니다. 같은 종목을 고르는 중복 후보는 다른 후보가 있을 때 둘째 자리에서 피합니다.</p>
      <p>배분 1·2·3은 조건에 맞는 여러 규칙 중 선택될 상대적인 기회입니다. 투자 신뢰도나 매수 수량이 아닙니다. 검증 규칙은 기본 배분 2를 유지하고 모든 거래는 1주입니다.</p>
      <p>새 매수의 배정에만 적용합니다. 보유 거래의 매도 기준은 유지하며 D1·D3·D5를 기다리도록 바꾸지 않습니다. 기본 관측과 검증 최대 3개·탐색 최대 2개 구조도 유지합니다.</p>
      <p>AI를 추가 호출하지 않고 저장된 결과로 계산합니다. 같은 시점에 조건이 맞는 규칙들을 균등 배정했다면 고를 규칙도 함께 기록하지만, 실행하지 않은 매매의 수익을 만들어 비교하지 않습니다.</p>
    </details>
  </section>;
}

function allocationLabel(key: string, rule?: PaperAdaptiveRule): string {
  if (rule && paperAutonomyRuleKey(rule) === key) return paperAdaptiveRuleLabel(rule);
  const matched = key.match(/^(.*):(\d+):D([135])(?::born:.*)?$/);
  if (!matched) return '저장된 비교 규칙';
  const feature = matched[1] as PaperFeatureKey;
  const bucket = Number(matched[2]), horizon = Number(matched[3]) as 1 | 3 | 5;
  if (PAPER_FEATURES[feature]) return paperAdaptiveRuleLabel({ feature, bucket, horizon });
  return `발명 지표 · ${['−1 미만', '−1 이상 0 미만', '0 이상 1 미만', '1 이상'][bucket] ?? '저장 구간'} · D${horizon}`;
}

export function PaperAutonomyAllocationDetails({ allocation, rule }: { allocation?: PaperAutonomyAllocation; rule?: PaperAdaptiveRule }) {
  if (!allocation) return null;
  const sameRule = allocation.selectedRuleKey === allocation.baselineRuleKey;
  return <details className="paper-autonomy-allocation rounded-lg border border-slate-700/60 bg-slate-950/30 text-xs text-slate-300">
    <summary className="cursor-pointer p-3 font-medium">진입 당시 규칙 배분 · {allocation.method === 'OUTCOME_WEIGHTED' ? '자율 배분' : '기존 배분으로 복귀'}</summary>
    <div className="space-y-2 px-3 pb-3">
      <p><strong>실제 선택</strong> · {allocationLabel(allocation.selectedRuleKey, rule)}</p>
      <p><strong>같은 후보를 균등 배정하면</strong> · {sameRule ? '동일한 규칙' : allocationLabel(allocation.baselineRuleKey, rule)}</p>
      <p>{sameRule ? '이 거래는 균등 배정과 선택 결과가 같습니다.' : '이 거래는 배분에 따라 선택 규칙이 달라졌습니다.'} 현재 조건에 맞았던 같은 후보 목록을 비교한 것이며, 예전 연구 방식 전체를 재현한 결과는 아닙니다.</p>
      <p>평가 {stamp(allocation.evaluatedAt)} KST · 자료 기준 {stamp(allocation.cutoffAt)} KST</p>
      <ul className="space-y-2">{allocation.choices.map(choice => <li key={choice.ruleKey}>
        {allocationLabel(choice.ruleKey, rule)} · {choice.purpose === 'VALIDATED' ? '검증' : '탐색'} · 상대 가중치 {choice.weight}
        {' · '}{choice.reason === 'FIXED_VALIDATED' ? '검증 규칙의 기본 배분' : choice.reason === 'FALLBACK' ? '기존 배분 사용' : PAPER_AUTONOMY_REASON_LABELS[choice.reason]}
      </li>)}</ul>
      <p>배분은 매수 수량이 아닙니다. 거래는 1주이며 진입 당시 근거를 보존합니다. 실행하지 않은 비교 매매의 수익은 계산하지 않습니다.</p>
    </div>
  </details>;
}
