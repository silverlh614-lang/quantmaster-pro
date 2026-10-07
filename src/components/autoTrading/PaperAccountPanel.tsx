// @responsibility Display virtual account operation evidence.
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paperExperimentApi, PAPER_EXPERIMENT_QUERY_KEY } from '../../api/paperExperimentClient';
import type { PaperAccountView } from '../../types/paperAccount';

const key = [...PAPER_EXPERIMENT_QUERY_KEY, 'virtual-account'];
const money = (value: number | null) => value === null ? '미확인' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '아직 처리 없음';
const statuses = { FILLED: '가상 체결', PENDING: '체결 대기', REJECTED: '매수 불가', EXPIRED: '신호 만료' };
export function PaperAccountRecords({ view }: { view: PaperAccountView }) {
  const [page, setPage] = useState(0);
  const account = view.account;
  if (!account) return null;
  const orders = [...account.orders].reverse(), index = Math.min(page, Math.max(0, Math.ceil(orders.length / 10) - 1));
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[
      ['주문 가능 현금', money(view.cash)], ['추정 청산 자산', money(view.equity)], ['실현손익', money(view.realizedPnl)],
      ['미실현손익', money(view.unrealizedPnl)], ['계좌 수익률', view.returnPct === null ? '미확인' : `${view.returnPct.toFixed(2)}%`],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
    <p className="text-xs text-slate-400">시작 {stamp(account.startedAt)} · 초기 예수금 {money(account.config.initialCash)} · 종목당 최대 {account.config.maxPositionPct}% · {account.config.includeExploration ? '검증·탐색 포함' : '검증 신호만'} · 마지막 처리 {stamp(account.lastSnapshotAt)}</p>
    {view.positions.some(position => position.stale) && <p role="status" className="text-amber-200">이전 관측 가격이 포함된 잠정 평가입니다. 현재 청산 가능한 금액으로 보지 마세요.</p>}
    <h4 className="font-semibold">가상 계좌 보유 {view.positions.length}종목</h4>
    {!view.positions.length && <p>보유 종목이 없습니다.</p>}
    <div className="grid gap-3 lg:grid-cols-2">{view.positions.map(position => <article key={position.tradeId} className="rounded-lg border border-slate-700 p-3 text-sm">
      <h5>{position.name} ({position.symbol}) · {position.quantity}주</h5>
      <p>매수 지출 {money(position.entryCost)} · 추정 청산 금액 {money(position.liquidationValue)}</p>
      <p>미실현손익 {money(position.unrealizedPnl)} · 관측가 {money(position.mark?.price ?? null)}</p>
      <p className="text-xs text-slate-400">{stamp(position.mark?.observedAt ?? null)} {position.stale ? '· 이전 가격' : ''}</p>
    </article>)}</div>
    <details><summary className="cursor-pointer">주문·체결 원장 ({orders.length}건)</summary>
      <div className="space-y-3 py-3">{orders.slice(index * 10, index * 10 + 10).map(order => <article key={order.id} className="rounded-lg border border-slate-700 p-3 text-xs space-y-1">
        <h5 className="text-sm font-semibold">{order.side === 'BUY' ? '매수' : '매도'} · {order.name} · {statuses[order.status]} · {order.quantity}주</h5>
        <p>{order.signalLabel} · {order.purpose === 'EXPLORATION' ? '탐색' : '검증'}</p>
        <p>신호 {stamp(order.signalAt)} · 주문 {stamp(order.submittedAt)}</p><p>신호 근거: {order.signalReason}</p><p>{order.statusReason}</p>
        {order.side === 'BUY' && <p>당시 매수 한도 {money(order.budget)}</p>}
        {order.fill && <><p>체결 {stamp(order.fill.at)} · 기준 관측가 {money(order.fill.quote.price)} · 가상 체결가 {money(order.fill.price)}</p>
          <p>수수료 {money(order.fill.fee)} · 세금 {money(order.fill.tax)} · 현금 증감 {money(order.fill.cashDelta)}</p>
          <p>가격 출처 {order.fill.quote.source} · 관측 {stamp(order.fill.quote.observedAt)}</p></>}
        <p className="text-slate-400">원본 신호 거래 {order.tradeId} · 비용 {order.costModel.version}</p>
      </article>)}</div>
      {orders.length > 10 && <div className="workspace-pagination"><span>{index + 1} / {Math.ceil(orders.length / 10)}</span>
        <button type="button" disabled={!index} onClick={() => setPage(index - 1)}>이전 주문</button>
        <button type="button" disabled={(index + 1) * 10 >= orders.length} onClick={() => setPage(index + 1)}>다음 주문</button></div>}
    </details>
  </div>;
}
export function PaperAccountPanel() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: paperExperimentApi.getAccount, refetchInterval: 15_000, retry: false });
  const [cash, setCash] = useState('10000000'), [weight, setWeight] = useState('20'), [exploration, setExploration] = useState(false);
  const start = useMutation({ mutationFn: paperExperimentApi.startAccount, retry: false,
    onSuccess: (view) => { client.setQueryData(key, view); } });
  const pause = useMutation({ mutationFn: paperExperimentApi.pauseAccountBuys, retry: false,
    onSuccess: (view) => { client.setQueryData(key, view); } });
  const account = query.data?.account;
  return <section aria-label="가상 계좌" className="space-y-4 rounded-xl border border-sky-500/30 p-4">
    <div className="flex justify-between"><h3 className="font-semibold">가상 계좌 운용 · 실주문 없음</h3><button type="button" onClick={() => { void query.refetch(); }}>계좌 새로고침</button></div>
    <p className="text-xs text-slate-400">신호 검증용 1주 거래와 별도로 현금·보유 비중을 반영합니다. 현재가 기반 전량 가상 체결이며 호가 잔량·부분 체결·D+2 결제는 재현하지 않습니다. 매도 대금은 즉시 재사용합니다.</p>
    {query.isPending && <p role="status">계좌 조회 중…</p>}
    {(query.error || start.error || pause.error || query.data?.error) && <p role="alert" className="workspace-alert">{query.error?.message ?? start.error?.message ?? pause.error?.message ?? query.data?.error}</p>}
    {query.isSuccess && !account && !query.data?.error && <form className="space-y-3" onSubmit={event => {
      event.preventDefault(); start.mutate({ initialCash: Number(cash), maxPositionPct: Number(weight), includeExploration: exploration });
    }}>
      <div className="workspace-filters"><label>초기 예수금(원) <input type="number" min="1000" max="1000000000000" step="1" required value={cash} onChange={event => setCash(event.target.value)} /></label>
        <label>종목당 최대 비중(%) <input type="number" min="1" max="100" step="0.1" required value={weight} onChange={event => setWeight(event.target.value)} /></label>
        <label><input type="checkbox" checked={exploration} onChange={event => setExploration(event.target.checked)} /> 검증 전 탐색 신호도 포함</label></div>
      <p className="text-xs">시작 이후 새 신호부터 운용합니다. 시작 금액과 비중 설정은 원장에 고정하며, 기존 계좌를 초기화하지 않습니다.</p>
      <button className="workspace-button" type="submit" disabled={start.isPending || query.isFetching}>가상 계좌 시작</button>
    </form>}
    {account && query.data && <>
      <p>{account.buyPaused ? '신규 매수 일시정지 · 보유 평가와 매도 처리는 계속' : '신규 매수 허용 · 기존 Shadow 스캔·보유 감시에서 처리'}</p>
      <button type="button" className="workspace-button" disabled={pause.isPending || query.isError} onClick={() => pause.mutate({ id: account.id, paused: !account.buyPaused })}>
        {account.buyPaused ? '신규 매수 재개' : '신규 매수 일시정지'}</button>
      <PaperAccountRecords view={query.data} />
      <p className="text-xs text-slate-400">계좌 수익률은 현금과 비용 차감 추정 청산 금액 기준입니다. 전체 관측이 정지되거나 가격 수집에 실패하면 계좌 처리도 새 관측을 기다립니다.</p>
    </>}
  </section>;
}
