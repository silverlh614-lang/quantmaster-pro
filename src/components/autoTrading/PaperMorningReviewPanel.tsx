// @responsibility Present dated recommendation follow-up evidence.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paperExperimentApi, PAPER_EXPERIMENT_QUERY_KEY } from '../../api/paperExperimentClient';
import { PAPER_MORNING_RESULT_LABELS, type PaperMorningReview } from '../../types/paperMorning';
import { paperAdaptiveRuleLabel } from '../../types/paperAdaptive';

const stamp = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '미확인';
const price = (value: number | null) => value === null ? '미확인' : `${value.toLocaleString('ko-KR')}원`;
const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

export function PaperMorningReviewResults({ review }: { review: PaperMorningReview }) {
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
        <h3 className="font-semibold">{item.rank}. {item.name} <span className="text-sm">({item.symbol})</span></h3>
        <p className="text-sm font-semibold">{PAPER_MORNING_RESULT_LABELS[item.status]}</p>
        <p className="text-xs">{pick.purpose === 'VALIDATED' ? '검증 규칙 추천' : '탐색 추천 · 검증 전'}</p>
        <p className="text-sm">참고 종가 {price(pick.referenceClose.close)} · {pick.referenceClose.tradingDate}</p>
        <p className="text-sm">추천 근거: {paperAdaptiveRuleLabel(pick.candidate.rule)}</p>
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
  </div>;
}

export function PaperMorningReviewPanel() {
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const query = useQuery({ queryKey: [...PAPER_EXPERIMENT_QUERY_KEY, 'morning-review', date],
    queryFn: () => paperExperimentApi.getMorningReview(date), enabled: Boolean(date), retry: 1,
    staleTime: 25_000, refetchInterval: 30_000, refetchIntervalInBackground: false });
  return <section className="qdash-archive my-5" aria-label="추천 종목 후속 결과">
    <header><div><h2>추천 종목 후속 결과</h2><p>추천일을 선택하면 각 종목의 현재까지의 가상 매매 결과를 확인합니다.</p></div>
      <div className="workspace-filters"><label>추천일 <input type="date" aria-label="추천일" value={date} max={today} onChange={event => setDate(event.target.value)} /></label>
        <button type="button" className="workspace-button" disabled={!date || query.isFetching} onClick={() => void query.refetch()}>결과 새로고침</button></div></header>
    <p className="qdash-note">오전 추천은 매수 후보입니다. 이후 Shadow가 장중 조건을 다시 판단해 매수·보유·매도를 기록합니다.</p>
    {query.isError && <p role="alert" className="workspace-alert">추천 결과 조회 실패 · {query.data ? '이전에 조회한 자료를 표시합니다.' : '다시 시도해 주세요.'}</p>}
    {date && query.isPending && <p role="status">추천 결과를 불러오는 중입니다…</p>}
    {query.data && <PaperMorningReviewResults review={query.data} />}
  </section>;
}
