// @responsibility Display autonomous feature decisions.
import React from 'react';
import { PAPER_ADAPTIVE_REASON_LABELS, paperAdaptiveRuleLabel, type PaperAdaptiveEvidence, type PaperAdaptiveState, type PaperAdaptiveStats } from '../../types/paperAdaptive';

const percent = (value: number | null, unit = '%') => value === null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
const timestamp = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
const samples = (value: PaperAdaptiveStats) => `${value.sampleCount}건 · ${value.dateCount}진입일 · ${value.symbolCount}종목`;

export function PaperAdaptiveEvidenceDetails({ evidence }: { evidence: PaperAdaptiveEvidence }) {
  const candidate = evidence.candidate;
  return <details className="rounded-lg border border-slate-700/60 bg-slate-950/30 text-xs text-slate-300">
    <summary className="cursor-pointer p-3 font-medium">진입 시 고정한 지표 근거 · {paperAdaptiveRuleLabel(candidate.rule)}</summary>
    <div className="space-y-2 px-3 pb-3">
      <p>근거 기준 {timestamp(evidence.cutoffAt)} KST · 선택 평가 {timestamp(evidence.evaluatedAt)} KST</p>
      <p>후반 확인 시작 {evidence.validationStartDate} · 진입 이후 지표 연결이 해제돼도 이 근거와 보유기간은 유지됩니다.</p>
      <p>학습 {samples(candidate.training)} · 평균 순수익률 {percent(candidate.training.meanNetReturnPct)} · 일당 대조군 차이 {percent(candidate.training.meanDailyExcessPct, '%p')}</p>
      <p>후반 확인 {samples(candidate.validation)} · 평균 순수익률 {percent(candidate.validation.meanNetReturnPct)} · 일당 대조군 차이 {percent(candidate.validation.meanDailyExcessPct, '%p')}</p>
    </div>
  </details>;
}

export function PaperAdaptivePanel({ state }: { state: PaperAdaptiveState }) {
  const active = state.candidates.filter(candidate => candidate.active);
  const changes = [...state.changes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  return <section className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4" aria-label="지표 자동 연결 상태">
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-200">지표 자동 연결 · {active.length}개 사용 중</h4>
      <p className="text-xs text-slate-400">평가 거래일 {state.tradingDate} · 평가 {timestamp(state.evaluatedAt)} KST · 근거 기준 {timestamp(state.cutoffAt)} KST</p>
      <p className="text-xs text-slate-400">성숙 기본 관측 {state.matureSampleCount}건 · {state.matureDateCount}개 진입일 · 관측 시작 {state.windowStartDate ?? '누적 대기'} · 후반 확인 시작 {state.validationStartDate ?? '누적 대기'}</p>
      <p className="text-xs text-slate-400">각 지표를 개별 평가해 연결하거나 해제합니다. 연결된 규칙 중 일치하는 하나를 선택하며, 모든 지표의 동시 충족을 요구하지 않습니다.</p>
    </div>
    {active.length ? <ul className="space-y-2 text-sm text-emerald-200">{active.map(candidate => <li key={candidate.rule.feature}>{paperAdaptiveRuleLabel(candidate.rule)} · 후반 일당 대조군 차이 {percent(candidate.validation.meanDailyExcessPct, '%p')}</li>)}</ul>
      : <p className="text-sm text-amber-200">연결된 지표가 없어 신규 매수를 기다립니다. 기본 관측과 성과 누적은 계속됩니다.</p>}
    <details className="text-xs text-slate-300">
      <summary className="cursor-pointer py-2 font-medium">전체 지표의 연결·대기 사유 ({state.candidates.length}개)</summary>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <caption className="sr-only">자동 연결 후보별 학습 및 후반 확인 성과</caption>
          <thead className="text-slate-400"><tr>{['지표 · 구간 · 보유기간', '상태 · 사유', '학습 표본', '학습 일당 차이', '후반 표본', '후반 일당 차이'].map(label => <th key={label} className="py-2 pr-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-800">{state.candidates.map(candidate => <tr key={candidate.rule.feature}>
            <th className="py-3 pr-3 font-medium">{paperAdaptiveRuleLabel(candidate.rule)}</th>
            <td className={candidate.active ? 'pr-3 text-emerald-200' : 'pr-3'}>{PAPER_ADAPTIVE_REASON_LABELS[candidate.reason]}</td>
            <td className="pr-3">{samples(candidate.training)}</td><td className="pr-3 tabular-nums">{percent(candidate.training.meanDailyExcessPct, '%p')}</td>
            <td className="pr-3">{samples(candidate.validation)}</td><td className="pr-3 tabular-nums">{percent(candidate.validation.meanDailyExcessPct, '%p')}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="pt-2 text-slate-400">일당 차이는 같은 날짜·시장·뉴스·추세 대조군 대비 순수익률 차이를 보유일수로 나눈 값입니다. 진입일마다 같은 비중으로 집계하며 자료 부족과 성과 부족은 별도로 표시합니다.</p>
    </details>
    <div className="space-y-2 text-xs text-slate-300">
      <h5 className="font-medium">최근 자동 변경 {changes.length}건</h5>
      {changes.length ? <ol className="space-y-2">{changes.map((change, index) => <li key={`${change.at}:${change.feature}:${index}`}>
        <span className="text-slate-400">{timestamp(change.at)} KST</span> · {change.from && change.to ? '교체' : change.to ? '연결' : '해제'} · {change.from ? paperAdaptiveRuleLabel(change.from) : '미연결'} → {change.to ? paperAdaptiveRuleLabel(change.to) : '미연결'} · {PAPER_ADAPTIVE_REASON_LABELS[change.reason]}
      </li>)}</ol> : <p className="text-slate-400">아직 연결 상태 변경 기록이 없습니다.</p>}
    </div>
  </section>;
}
