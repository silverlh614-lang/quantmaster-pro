// @responsibility Display investor-flow observations with descriptive outcome associations.
import React, { useState } from 'react';
import type { PaperFlowCorrelation, PaperInvestorFlow, PaperInvestorFlowSnapshot, PaperInvestorFlowStudy } from '../../types/paperInvestorFlow';
import { PAPER_FLOW_ISSUE_LABELS } from '../../types/paperInvestorFlow';
import { PAPER_NEWS_LABELS } from '../../utils/paperNews';
import { Section } from '../../ui/section';

const actors = { FOREIGN: '외국인', INSTITUTION: '기관', COMBINED: '외국인+기관 합산' };
const groups = { BOTH_BUY: '동반 순매수', BOTH_SELL: '동반 순매도', DIVERGENT: '매수·매도 엇갈림', OTHER: '한쪽 이상 순매수 0' };
const percent = (value: number | null) => value !== null && Number.isFinite(value) ? `${value.toFixed(2)}%` : '집계 대기';
const shares = (value: number | null) => value !== null && Number.isFinite(value) ? `${value.toLocaleString('ko-KR')}주` : '미확인';
const coefficient = (value: number | null, status: PaperFlowCorrelation['status']) => value !== null && Number.isFinite(value)
  ? value.toFixed(3) : status === 'NO_VARIATION' ? '변동 없어 계산 불가' : '짝지어진 표본 3건부터 계산';

export function PaperInvestorFlowDetails({ flow }: { flow?: PaperInvestorFlow }) {
  if (!flow) return <p className="text-xs text-slate-400">진입 당시 기관·외국인 수급 미기록</p>;
  return <details className="rounded-lg border border-slate-700/60 p-3 text-xs text-slate-300">
    <summary className="cursor-pointer font-medium">기관·외국인 수급 · {flow.tradingDate ?? flow.requestedTradingDate}{flow.issue ? ' · 자료 확인 필요' : ''}</summary>
    <div className="mt-3 space-y-2">
      <p>직전 거래일 기준 {flow.requestedTradingDate} · KIS 일별 수급</p>
      <p>외국인 {shares(flow.foreignNetShares)} · 기관 {shares(flow.institutionalNetShares)}</p>
      <p>양수는 순매수, 음수는 순매도 · 같은 날 거래량 {shares(flow.volume)}</p>
      {!flow.issue && flow.volume !== null && flow.volume > 0 && <p>거래량 대비 외국인 {percent(flow.foreignNetShares === null ? null : flow.foreignNetShares / flow.volume * 100)} · 기관 {percent(flow.institutionalNetShares === null ? null : flow.institutionalNetShares / flow.volume * 100)}</p>}
      {flow.issue && <p className="text-amber-200">{PAPER_FLOW_ISSUE_LABELS[flow.issue] ?? '수급 자료 확인 필요'} · 상관계산에서 제외</p>}
      <p className="text-slate-400">확인 시각 {flow.observedAt ? new Date(flow.observedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '미확인'} KST</p>
    </div>
  </details>;
}

export function PaperInvestorFlowPanel({ study, snapshot }: { study?: PaperInvestorFlowStudy; snapshot?: PaperInvestorFlowSnapshot }) {
  const [news, setNews] = useState('ALL');
  const segment = study?.segments.find(item => item.news === news);
  return <Section title="기관·외국인 수급과 후속 성과" subtitle="직전 거래일 순매수량 / 같은 날 거래량 · 진입 당시 저장 자료로 D1·D3·D5 순수익률과의 관계를 측정합니다." variant="neo">
    {snapshot && <div className="space-y-2 rounded-lg border border-slate-700/60 p-3 text-sm text-slate-200">
      <p>최근 수급 현황 · {snapshot.tradingDate} 거래일 · {snapshot.availableCount}/{snapshot.candidateCount}종목 확인</p>
      <p>{snapshot.groups.map(item => `${groups[item.group]} ${item.count}종목`).join(' · ')}</p>
      <p>최근 종목 간 외국인↔기관 수급 상관: 피어슨 {coefficient(snapshot.flowCorrelation.pearson, snapshot.flowCorrelation.status)} / 스피어만 {coefficient(snapshot.flowCorrelation.spearman, snapshot.flowCorrelation.status)}</p>
      <p className="text-xs text-slate-400">한 거래일의 종목 간 비교입니다. 아래 진입 후 수익률 연구와 별도로 봅니다.</p>
    </div>}
    <p className="text-xs text-slate-400">수량을 거래량 대비 비율로 비교합니다. 피어슨은 수급 크기와 성과의 직선 관계, 스피어만은 순위 관계를 나타내며 -1~+1 범위입니다. 양수는 순매수 비율이 클수록 수익률도 높은 경향, 음수는 반대 경향입니다.</p>
    <p className="text-xs text-slate-400">같은 날짜의 종목과 겹치는 보유 기간은 독립 표본이 아닙니다. 상관관계는 인과관계나 예측 성능의 입증이 아니며, 수급을 새 매수 조건에 추가하지 않습니다.</p>
    {!study || !segment ? <p className="workspace-empty">수급 관측 결과를 불러오는 중입니다.</p> : <>
      <p className="text-sm text-slate-200">기본 관측 {study.totalCount}건 중 수급 비교 가능 {study.availableCount}건 · 수급 미기록·미확인 {study.totalCount - study.availableCount}건</p>
      <div className="workspace-filters"><select aria-label="수급 연구 뉴스 방향" value={news} onChange={event => setNews(event.target.value)}>
        {study.segments.map(item => <option key={item.news} value={item.news}>{item.news === 'ALL' ? '전체 뉴스 유형' : PAPER_NEWS_LABELS[item.news]}</option>)}
      </select></div>
      <p className="text-sm text-slate-200">선택 유형 {segment.observationCount}건 · 외국인↔기관 수급 상관: 피어슨 {coefficient(segment.flowCorrelation.pearson, segment.flowCorrelation.status)} / 스피어만 {coefficient(segment.flowCorrelation.spearman, segment.flowCorrelation.status)}</p>
      <p className="text-xs text-slate-400">외국인↔기관 비교 {segment.flowCorrelation.count}건 · {segment.flowCorrelation.symbolCount}종목 · {segment.flowCorrelation.entryDateCount}개 진입일</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
        <caption className="sr-only">수급 비율과 이후 순수익률의 상관계수</caption>
        <thead className="text-xs text-slate-400"><tr>{['수급 주체', '성과 기간', '피어슨', '스피어만', '표본 / 종목 / 진입일'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800 text-slate-200">{segment.correlations.map(item => <tr key={`${item.actor}:${item.horizon}`}>
          <th className="p-3 font-medium">{actors[item.actor]}</th><td className="p-3">D{item.horizon}</td>
          <td className="p-3 tabular-nums">{coefficient(item.pearson, item.status)}</td><td className="p-3 tabular-nums">{coefficient(item.spearman, item.status)}</td>
          <td className="p-3 tabular-nums">{item.count}건 / {item.symbolCount}종목 / {item.entryDateCount}일</td>
        </tr>)}</tbody>
      </table></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
        <caption className="py-2 text-left text-sm text-slate-200">뉴스 방향 내 동반 수급별 평균 성과</caption>
        <thead className="text-xs text-slate-400"><tr>{['수급 유형', '관측', '외국인 / 기관 비율 평균', 'D1', 'D3', 'D5'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800 text-slate-200">{segment.groups.map(item => <tr key={item.group}>
          <th className="p-3 font-medium">{groups[item.group]}</th><td className="p-3">{item.observationCount}건</td>
          <td className="p-3">{percent(item.meanForeignPctVolume)} / {percent(item.meanInstitutionPctVolume)}</td>
          {item.outcomes.map(outcome => <td key={outcome.horizon} className="p-3">{percent(outcome.meanNetReturnPct)}<div className="text-xs text-slate-400">{outcome.count}건</div></td>)}
        </tr>)}</tbody>
      </table></div>
      <details className="text-xs text-slate-400"><summary className="cursor-pointer py-2">계산 제외 사유</summary>
        {Object.entries(study.missing).map(([issue, count]) => <p key={issue}>{PAPER_FLOW_ISSUE_LABELS[issue as keyof typeof PAPER_FLOW_ISSUE_LABELS] ?? issue}: {count}건</p>)}
        <p>기존 관측은 소급 보충하지 않습니다. 수급이 없어도 기본 관측과 가격 성과 집계는 계속됩니다.</p>
      </details>
    </>}
  </Section>;
}
