// @responsibility Present dated recommendation follow-up evidence.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paperExperimentApi, PAPER_EXPERIMENT_QUERY_KEY } from '../../api/paperExperimentClient';
import { PAPER_MORNING_RESULT_LABELS, type PaperMorningReview } from '../../types/paperMorning';
import { paperAdaptiveRuleLabel } from '../../types/paperAdaptive';
import { ChevronRight, Info } from 'lucide-react';
import { PaperDetailDialog } from './PaperDetailDialog';
import { PaperMorningDetail } from './PaperMorningDetail';

const stamp = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '미확인';
const price = (value: number | null) => value === null ? '미확인' : `${value.toLocaleString('ko-KR')}원`;
const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

export function PaperMorningReviewResults({ review }: { review: PaperMorningReview }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { report, results } = review;
  if (!report) return <p className="workspace-empty">선택한 날짜의 추천 기록이 없습니다.</p>;
  const delivered = report.delivery && Date.parse(report.delivery.sentAt) <= Date.parse(review.asOf);
  return <div className="space-y-3">
    <p className="qdash-note">{delivered ? `추천 발송 ${stamp(report.delivery!.sentAt)}` : '추천 발송 확인 대기'} · 조회 {stamp(review.asOf)} KST</p>
    {review.trackingError && <p role="alert" className="workspace-alert">{review.trackingError} · 결과를 미진입으로 판단하지 마세요.</p>}
    {!report.picks.length && <p className="workspace-empty">{report.reason}</p>}
    {results.length > 0 && <p className="qdash-note">추천 {results.length}종목 · 보유 {results.filter(row => row.status === 'OPEN').length} ·
      매도 완료 {results.filter(row => row.status === 'CLOSED').length} · 미진입 {results.filter(row => row.status === 'NOT_ENTERED').length}</p>}
    <div className="grid gap-3 lg:grid-cols-3">{results.map(item => {
      const pick = report.picks.find(value => value.symbol === item.symbol)!;
      const point = item.measurement?.latest;
      return <article key={item.symbol} className="rounded-xl border border-slate-700/60 p-4 space-y-2">
        <h3 className="font-semibold"><button type="button" className="paper-detail-trigger w-full" aria-haspopup="dialog"
          aria-label={`${item.name} 적용 내용 보기`} onClick={() => setSelected(item.symbol)}>
          <span>{item.rank}. {item.name} <span className="text-sm">({item.symbol})</span></span><ChevronRight size={18} aria-hidden="true" /></button></h3>
        <p className="text-sm font-semibold">{PAPER_MORNING_RESULT_LABELS[item.status]}</p>
        <p className="text-xs">{pick.purpose === 'VALIDATED' ? '검증 규칙 추천' : '탐색 추천 · 검증 전'}</p>
        <p className="text-sm">참고 종가 {price(pick.referenceClose.close)} · {pick.referenceClose.tradingDate}</p>
        <button type="button" className="paper-detail-trigger w-full text-sm" aria-haspopup="dialog" onClick={() => setSelected(item.symbol)}>
          <span>추천 근거: {paperAdaptiveRuleLabel(pick.candidate.rule)}</span><Info size={17} aria-hidden="true" /></button>
        {item.entryAt && <><p>가상 매수 {price(item.entryPrice)} · {stamp(item.entryAt)}</p><p className="text-sm">매수 사유: {item.entryReason ?? '미기록'}</p>
          <p className="text-xs">{item.matchesEntryRule ? '추천과 같은 규칙으로 진입' : '추천과 다른 규칙으로 진입'}</p></>}
        {item.status === 'CLOSED' && <><p>가상 매도 {price(item.exitPrice)} · {stamp(item.exitAt)}</p>
          <p>확정 순수익률 {item.netReturnPct === null ? '미확인' : pct(item.netReturnPct)}</p>
          <p className="text-sm">매도 사유: {item.exitReason ?? '미기록'}</p></>}
        {item.status === 'OPEN' && <p>{point ? `관측가 ${price(point.price)} · 평가 순수익률 ${pct(point.netReturnPct)} · ${stamp(point.observedAt)}` : '보유 중 가격 관측 미확인'}</p>}
        {(item.status === 'PENDING' || item.status === 'NOT_ENTERED') && <p className="text-sm">{item.lastDecision
          ? `마지막 장중 판단 ${stamp(item.lastDecision.decisionAt)}: ${item.lastDecision.reason}` : '장중 판단 근거 미기록 · 미진입 사유를 추정하지 않습니다.'}</p>}
      </article>;
    })}</div>
    <p className="qdash-note">수익률은 가상 매수가 기준·비용 반영입니다. 관측 시각 이후의 현재 수익률을 뜻하지 않습니다.
      마지막 장중 판단은 당일 전체 미진입 원인을 대표하지 않습니다.</p>
    <details><summary>당시 추천 원문</summary><pre className="whitespace-pre-wrap text-sm">{report.message.replace(/<\/?b>/g, '')}</pre></details>
    {selected && results.some(item => item.symbol === selected) && <PaperMorningDetail key={selected}
      pick={report.picks.find(item => item.symbol === selected)!} result={results.find(item => item.symbol === selected)!} onClose={() => setSelected(null)} />}
  </div>;
}

export function PaperMorningReviewPanel() {
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [help, setHelp] = useState(false);
  const query = useQuery({ queryKey: [...PAPER_EXPERIMENT_QUERY_KEY, 'morning-review', date],
    queryFn: () => paperExperimentApi.getMorningReview(date), enabled: Boolean(date), retry: 1,
    staleTime: 25_000, refetchInterval: 30_000, refetchIntervalInBackground: false });
  return <section className="qdash-archive my-5" aria-label="추천 종목 후속 결과">
    <header><div><h2>추천 종목 후속 결과</h2><p>추천일을 선택하면 각 종목의 현재까지의 가상 매매 결과를 확인합니다.</p></div>
      <div className="workspace-filters"><label>추천일 <input type="date" aria-label="추천일" value={date} max={today} onChange={event => setDate(event.target.value)} /></label>
        <button type="button" className="workspace-button" disabled={!date || query.isFetching} onClick={() => void query.refetch()}>결과 새로고침</button></div></header>
    <button type="button" className="paper-detail-trigger my-3" aria-haspopup="dialog" onClick={() => setHelp(true)}>
      <Info size={18} aria-hidden="true" /><span>추천 → 매수 → 매도, 어떻게 적용되나요?</span><ChevronRight size={18} aria-hidden="true" /></button>
    <p className="qdash-note">종목명이나 추천 근거를 누르면 실제 적용 규칙을 자세히 볼 수 있습니다.</p>
    {query.isError && <p role="alert" className="workspace-alert">추천 결과 조회 실패 · {query.data ? '이전에 조회한 자료를 표시합니다.' : '다시 시도해 주세요.'}</p>}
    {date && query.isPending && <p role="status">추천 결과를 불러오는 중입니다…</p>}
    {query.data && <PaperMorningReviewResults key={date} review={query.data} />}
    {help && <PaperDetailDialog title="추천부터 매도까지" subtitle="각 단계의 적용 범위" onClose={() => setHelp(false)}>
      <section className="paper-detail-section"><h3>① 오전 추천 · 후보 선정</h3><p>저장된 관측과 학습 결과로 후보를 정합니다. 추천 자체가 가상 매수를 실행하지는 않습니다.</p></section>
      <section className="paper-detail-section"><h3>② 장중 매수 · 새 관측으로 재판단</h3><p>장중 가격과 적용 규칙을 확인해 가상 진입합니다. 추천과 다른 규칙으로 진입하면 이를 따로 표시합니다.</p></section>
      <section className="paper-detail-section"><h3>③ 보유·매도 · 거래별 기준 적용</h3><p>새 거래는 가격과 진입 근거의 변화로 매도를 판단합니다. 기존 예약 청산 거래는 당시 정한 일정을 유지합니다.</p></section>
      <section className="paper-detail-section"><h3>수익률과 미진입 사유 읽기</h3><p>평가 수익은 마지막 관측 가격 기준이며, 확정 수익은 가상 매도 결과입니다. 모두 가상 매수가 기준으로 비용을 반영합니다.</p><p>미진입 사유는 마지막으로 기록한 장중 판단입니다. 기록이 없으면 미기록으로 표시합니다.</p></section>
    </PaperDetailDialog>}
  </section>;
}
