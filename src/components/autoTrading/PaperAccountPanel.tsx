// @responsibility Display virtual account operation evidence.
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paperExperimentApi, PAPER_EXPERIMENT_QUERY_KEY } from '../../api/paperExperimentClient';
import { paperAccountSlotCount, paperAccountWeightPct, type PaperAccountView } from '../../types/paperAccount';
import { paperAccountPerformance } from '../../utils/paperAccountPerformance';

const key = [...PAPER_EXPERIMENT_QUERY_KEY, 'virtual-account'];
const money = (value: number | null) => value === null ? '미확인' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '아직 처리 없음';
const statuses = { FILLED: '가상 체결', PENDING: '체결 대기', REJECTED: '매수 불가', EXPIRED: '신호 만료' };
const pct = (value: number | null) => value === null ? '집계 대기' : `${value.toFixed(2)}%`;
function AccountPolicy({ view }: { view: PaperAccountView }) {
  const [page, setPage] = useState(0), account = view.account!;
  const choices = [...(account.selections ?? [])].reverse(), latest = choices[0];
  const index = Math.min(page, Math.max(0, Math.ceil(choices.length / 10) - 1));
  const result = paperAccountPerformance(account);
  return <div className="space-y-2 text-sm">
    <h4 className="font-semibold">계좌 운용 기준</h4>
    <p>{latest ? `${latest.tradingDate} 선택: ${latest.candidates[0]?.label ?? '검증 수익성 충족 규칙 없음 · 신규 진입 대기'}` : '첫 장중 전체 관측에서 검증 성과를 확인해 기준을 선택합니다.'}</p>
    <p className="text-xs text-slate-400">검증 순수익률이 가장 높은 연결 규칙 하나를 매일 선택합니다. 같은 날 유지하며 해당 규칙으로 발생한 새 신호만 매수합니다. 매수마다 추정 자산의 {paperAccountWeightPct(account)}%를 배정하고 최대 {paperAccountSlotCount({ maxPositionPct: paperAccountWeightPct(account) })}종목까지 보유합니다. 빈 자리보다 신호가 많으면 날짜·종목으로 섞은 순서로 일부만 매수합니다.</p>
    <p>계좌 체결 성과: 청산 {result.closedCount}건 · 실현손익 {money(result.realizedPnl)} · 거래당 평균 순수익률 {pct(result.meanNetReturnPct)}</p>
    <p>평균 이익 {pct(result.meanWinPct)} · 평균 손실 {pct(result.meanLossPct)} · 총이익/총손실 {result.profitFactor === null ? '손실 표본 없음' : result.profitFactor.toFixed(2)} · 승률 {pct(result.winRatePct)}</p>
    <p>{account.risk ? `관측 최대 낙폭 ${pct(account.risk.maxDrawdownPct)} · ${stamp(account.risk.since)}부터 ${account.risk.observations}회 평가` : '관측 최대 낙폭 집계 대기'}</p>
    <p className="text-xs text-slate-400">최대 낙폭은 신선한 가격으로 평가한 청산 자산 기준이며 관측 사이의 가격과 기록 이전 구간은 포함하지 않습니다.</p>
    <details><summary className="cursor-pointer">선택 근거·적용 후 성과 ({choices.length}회)</summary>
      {choices.slice(index * 10, index * 10 + 10).map(choice => {
        const forward = paperAccountPerformance(account, choice.id);
        return <article key={choice.id} className="border-b border-slate-700 py-3 space-y-1 text-xs">
          <h5 className="font-semibold">{choice.tradingDate} · {choice.candidates[0]?.label ?? '검증 기준 없음'}</h5>
          <p>선택 {stamp(choice.selectedAt)} · 학습 자료 마감 {stamp(choice.cutoffAt)} · 표본 기준 학습/확인 각각 {choice.minimumSamples}건·{choice.minimumEntryDates}일</p>
          {choice.candidates.map((candidate, rank) => <p key={candidate.ruleKey}>{rank + 1}순위 {candidate.label}: 과거 검증 순수익 {pct(candidate.validation.meanNetReturnPct)} · {candidate.validation.sampleCount}건/{candidate.validation.dateCount}일</p>)}
          <p>선택 이후 계좌 체결: 청산 {forward.closedCount}건 / 보유 {forward.openCount}건 · 실현손익 {money(forward.realizedPnl)} · 평균 순수익률 {pct(forward.meanNetReturnPct)}</p>
          <p>과거 검증은 D1·D3·D5 고정 기간 성적입니다. 계좌의 관측 매도 성과와 별개이며 미래 수익을 보장하지 않습니다.</p>
        </article>;
      })}
      {choices.length > 10 && <div className="workspace-pagination"><button type="button" disabled={!index} onClick={() => setPage(index - 1)}>이전 선택</button><span>{index + 1} / {Math.ceil(choices.length / 10)}</span><button type="button" disabled={(index + 1) * 10 >= choices.length} onClick={() => setPage(index + 1)}>다음 선택</button></div>}
    </details>
  </div>;
}
export function PaperAccountRecords({ view }: { view: PaperAccountView }) {
  const [page, setPage] = useState(0);
  const account = view.account;
  if (!account) return null;
  const orders = [...account.orders].reverse(), index = Math.min(page, Math.max(0, Math.ceil(orders.length / 10) - 1));
  const skippedDate = Object.keys(account.skippedSignals?.counts ?? {}).sort().at(-1);
  const skipped = skippedDate ? Object.entries(account.skippedSignals!.counts[skippedDate]) : [];
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[
      ['주문 가능 현금', money(view.cash)], ['추정 청산 자산', money(view.equity)], ['실현손익', money(view.realizedPnl)],
      ['미실현손익', money(view.unrealizedPnl)], ['계좌 수익률', view.returnPct === null ? '미확인' : `${view.returnPct.toFixed(2)}%`],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
    <p className="text-xs text-slate-400">시작 {stamp(account.startedAt)} · 초기 예수금 {money(account.config.initialCash)} · 종목당 {paperAccountWeightPct(account)}% · 최대 {paperAccountSlotCount({ maxPositionPct: paperAccountWeightPct(account) })}종목 · 검증 신호만 · 마지막 처리 {stamp(account.lastSnapshotAt)}</p>
    {account.weightChanges?.length ? <p className="text-xs text-slate-400">비중 변경: 시작 {account.config.maxPositionPct}% → {account.weightChanges.map(change => `${stamp(change.at)} ${change.maxPositionPct}%`).join(' → ')} · 변경 이후 매수부터 적용</p> : null}
    {account.config.includeExploration && <p className="text-xs">이전 탐색 포함 설정은 이력으로 보존합니다. 새 매수는 검증 전용 기준을 적용합니다.</p>}
    <AccountPolicy view={view} />
    {view.positions.some(position => position.stale) && <p role="status" className="text-amber-200">이전 관측 가격이 포함된 잠정 평가입니다. 현재 청산 가능한 금액으로 보지 마세요.</p>}
    {view.positions.some(position => position.halted) && <p role="status" className="text-amber-200">거래정지 종목은 정지 직전 가격으로 평가하고, 정지 해제 후 첫 유효 가격으로 매도 판단·체결합니다.</p>}
    <h4 className="font-semibold">가상 계좌 보유 {view.positions.length}종목</h4>
    {!view.positions.length && <p>보유 종목이 없습니다.</p>}
    <div className="grid gap-3 lg:grid-cols-2">{view.positions.map(position => <article key={position.tradeId} className="rounded-lg border border-slate-700 p-3 text-sm">
      <h5>{position.name} ({position.symbol}) · {position.quantity}주</h5>
      <p>매수 지출 {money(position.entryCost)} · 추정 청산 금액 {money(position.liquidationValue)}</p>
      <p>미실현손익 {money(position.unrealizedPnl)} · 관측가 {money(position.mark?.price ?? null)}</p>
      <p className="text-xs text-slate-400">{stamp(position.mark?.observedAt ?? null)} {position.halted ? '· 거래정지 · 정지 직전 가격' : position.stale ? '· 이전 가격' : ''}</p>
    </article>)}</div>
    {skippedDate && <p className="text-xs text-slate-400">{skippedDate} 계좌 기준 밖 신호 {skipped.reduce((sum, [, count]) => sum + count, 0)}건은 주문 없이 1주 연구로만 집계합니다: {skipped.map(([reason, count]) => `${reason} ${count}건`).join(' · ')}</p>}
    <details><summary className="cursor-pointer">주문·체결 원장 ({orders.length}건)</summary>
      <div className="space-y-3 py-3">{orders.slice(index * 10, index * 10 + 10).map(order => <article key={order.id} className="rounded-lg border border-slate-700 p-3 text-xs space-y-1">
        <h5 className="text-sm font-semibold">{order.side === 'BUY' ? '매수' : '매도'} · {order.name} · {statuses[order.status]} · {order.quantity}주</h5>
        <p>{order.signalLabel} · {order.purpose === 'EXPLORATION' ? '탐색' : '검증'}</p>
        <p>신호 {stamp(order.signalAt)} · 주문 {stamp(order.submittedAt)}</p><p>신호 근거: {order.signalReason}</p><p>{order.statusReason}</p>
        {order.side === 'BUY' && <p>계좌 선택 기준: {order.selectionId ? account.selections?.find(choice => choice.id === order.selectionId)?.tradingDate ?? '기록 확인 필요' : '선택 근거 미기록'}</p>}
        {order.side === 'BUY' && <p>주문별 매수 한도 {money(order.budget)}{!order.fill && order.budget === 0 ? ' · 계좌 잔액과 별개이며, 조건 검사에서 거절되면 예산을 배정하지 않습니다.' : ''}</p>}
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
  const [cash, setCash] = useState('10000000'), [weight, setWeight] = useState('20');
  const start = useMutation({ mutationFn: paperExperimentApi.startAccount, retry: false,
    onSuccess: (view) => { client.setQueryData(key, view); } });
  const pause = useMutation({ mutationFn: paperExperimentApi.pauseAccountBuys, retry: false,
    onSuccess: (view) => { client.setQueryData(key, view); } });
  const [nextWeight, setNextWeight] = useState('');
  const reweight = useMutation({ mutationFn: paperExperimentApi.changeAccountWeight, retry: false,
    onSuccess: (view) => { client.setQueryData(key, view); setNextWeight(''); } });
  const account = query.data?.account;
  return <section aria-label="가상 계좌" className="space-y-4 rounded-xl border border-sky-500/30 p-4">
    <div className="flex justify-between"><h3 className="font-semibold">가상 계좌 운용 · 실주문 없음</h3><button type="button" onClick={() => { void query.refetch(); }}>계좌 새로고침</button></div>
    <p className="text-xs text-slate-400">신호 검증용 1주 거래와 별도로 현금·보유 비중을 반영합니다. 현재가 기반 전량 가상 체결이며 호가 잔량·부분 체결·D+2 결제는 재현하지 않습니다. 매도 대금은 즉시 재사용합니다.</p>
    {query.isPending && <p role="status">계좌 조회 중…</p>}
    {(query.error || start.error || pause.error || reweight.error || query.data?.error) && <p role="alert" className="workspace-alert">{query.error?.message ?? start.error?.message ?? pause.error?.message ?? reweight.error?.message ?? query.data?.error}</p>}
    {query.isSuccess && !account && !query.data?.error && <form className="space-y-3" onSubmit={event => {
      event.preventDefault(); start.mutate({ initialCash: Number(cash), maxPositionPct: Number(weight), includeExploration: false });
    }}>
      <div className="workspace-filters"><label>초기 예수금(원) <input type="number" min="1000" max="1000000000000" step="1" required value={cash} onChange={event => setCash(event.target.value)} /></label>
        <label>종목당 최대 비중(%) <input type="number" min="1" max="100" step="0.1" required value={weight} onChange={event => setWeight(event.target.value)} /></label>
        </div>
      <p className="text-xs">시작 이후 새 신호부터 운용합니다. 시작 금액은 원장에 고정하고, 종목당 비중은 이후 변경 시각부터 새 매수에 적용할 수 있으며, 기존 계좌를 초기화하지 않습니다. 종목당 비중에 따라 동시에 보유하는 종목 수가 정해집니다(20%면 5종목, 10%면 10종목).</p>
      <button className="workspace-button" type="submit" disabled={start.isPending || query.isFetching}>가상 계좌 시작</button>
    </form>}
    {account && query.data && <>
      <p>{account.buyPaused ? '신규 매수 일시정지 · 보유 평가와 매도 처리는 계속' : '신규 매수 허용 · 기존 Shadow 스캔·보유 감시에서 처리'}</p>
      <button type="button" className="workspace-button" disabled={pause.isPending || query.isError} onClick={() => pause.mutate({ id: account.id, paused: !account.buyPaused })}>
        {account.buyPaused ? '신규 매수 재개' : '신규 매수 일시정지'}</button>
      <form className="workspace-filters" onSubmit={event => { event.preventDefault(); reweight.mutate({ id: account.id, maxPositionPct: Number(nextWeight) }); }}>
        <label>종목당 비중 변경(%) <input type="number" min="1" max="100" step="0.1" required value={nextWeight}
          placeholder={String(paperAccountWeightPct(account))} onChange={event => setNextWeight(event.target.value)} /></label>
        <button type="submit" className="workspace-button" disabled={reweight.isPending || query.isError}>비중 변경</button>
      </form>
      <p className="text-xs text-slate-400">변경 이후 새 매수부터 적용하고 기존 주문·보유는 그대로 둡니다. 보유 종목이 새 한도보다 많으면 줄어들 때까지 신규 매수를 하지 않습니다.</p>
      <PaperAccountRecords view={query.data} />
      <p className="text-xs text-slate-400">계좌 수익률은 현금과 비용 차감 추정 청산 금액 기준입니다. 전체 관측이 정지되거나 가격 수집에 실패하면 계좌 처리도 새 관측을 기다립니다.</p>
    </>}
  </section>;
}
