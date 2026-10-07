// @responsibility Queue virtual account execution notifications with durable deduplication.
import { createHash } from 'node:crypto';
import type { PaperAccountLedger, PaperAccountOrder, PaperAccountView } from '../../src/types/paperAccount.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import { ChannelSemantic } from './alertRouter.js';
import { toKstDateKey } from '../calendar/krxTradingCalendar.js';

const safe = (value: string, limit = 150) => value.slice(0, limit).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const amount = (value: number | null) => value === null ? '미확인' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
const stamp = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
export function retireSignalTradeAlerts(state: PaperBotState): void {
  for (const message of state.messages) if (message.kind === 'trades' && message.state === 'PENDING' && !message.id.startsWith('paper:account:')) {
    message.state = 'SUPERSEDED'; message.error = '신호 검증 개별 알림 종료 · 연구 요약으로 통합';
  }
}
export function enqueueAccountHealth(state: PaperBotState, view: PaperAccountView | undefined, now: Date): void {
  const health = !view || view.error ? 'ERROR' : 'OK', previous = state.accountHealth;
  if (health === previous) return;
  state.accountHealth = health;
  if (!previous && health === 'OK') return;
  for (const message of state.messages) if (message.id.startsWith('paper:account-health:') && message.state === 'PENDING') message.state = 'SUPERSEDED';
  state.messages.push({ id: `paper:account-health:${health}:${now.toISOString()}`, kind: 'health', state: 'PENDING', attempts: 0,
    message: health === 'ERROR' ? '⚠️ <b>가상 계좌 확인 필요</b>\n계좌 조회 또는 처리에 실패했습니다. 대시보드에서 확인하세요. 신호 검증 연구는 별도로 계속됩니다.'
      : '✅ <b>가상 계좌 조회·처리 오류 해소</b>\n계좌 상태를 다시 확인할 수 있습니다.',
    createdAt: now.toISOString(), nextAttemptAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3600000).toISOString() });
}
export function formatAccountExecutions(account: PaperAccountLedger, orders: PaperAccountOrder[], analysis = false): string {
  const lines = [analysis ? '<b>② 판단 · 가상 계좌 체결 근거</b>' : '<b>① 매매 · 가상 계좌 체결</b>', '실주문 없음 · 계좌에서 체결된 수량 기준'];
  for (const order of orders) {
    const fill = order.fill!;
    lines.push('', `<b>${order.side === 'BUY' ? '🟢 매수' : '🔴 매도'} · ${safe(order.name, 30)} (${safe(order.symbol, 12)})</b>`,
      `${order.quantity}주 · 체결가 ${amount(fill.price)}`, `가상 체결 ${stamp(fill.at)}`);
    const selection = order.selectionId ? account.selections?.find(item => item.id === order.selectionId) : undefined;
    if (analysis) lines.push(`신호: ${safe(order.signalLabel, 100)}`, `판단: ${safe(order.signalReason)}`,
      ...(selection?.candidates[0] ? [`계좌 기준: ${selection.tradingDate} 검증 순수익 1순위 · 과거 ${selection.candidates[0].validation.meanNetReturnPct!.toFixed(2)}% (${selection.candidates[0].validation.sampleCount}건/${selection.candidates[0].validation.dateCount}일)`] : []),
      order.side === 'BUY' ? `당시 매수 한도 ${amount(order.budget)}` : '계좌 보유 전량 청산',
      `가격 관측 ${stamp(fill.quote.observedAt)} · ${safe(fill.quote.source, 40)}`);
    else {
      lines.push(`현금 증감 ${amount(fill.cashDelta)} · 수수료 ${amount(fill.fee)} · 세금 ${amount(fill.tax)}`);
      if (order.side === 'SELL') {
        const buy = account.orders.find(item => item.tradeId === order.tradeId && item.side === 'BUY' && item.fill);
        lines.push(buy?.fill ? `실현손익 ${amount(Math.round((fill.cashDelta + buy.fill.cashDelta) * 100) / 100)}` : '실현손익 대사 미확인');
      }
    }
  }
  lines.push('', '전체 계좌·주문 내역: 대시보드 가상 계좌');
  return lines.join('\n');
}
export function formatAccountSummary(view: PaperAccountView | undefined, now: Date): string {
  const lines = ['<b>가상 계좌 운용 요약</b>'];
  if (!view || view.error) return [...lines, '계좌 기록 확인 불가 · 손익을 추정하지 않습니다.'].join('\n');
  if (!view.account) return [...lines, '계좌 미시작 · 신호 검증은 내부 연구로 계속됩니다.'].join('\n');
  lines.push(`현금 ${amount(view.cash)} · 추정 청산 자산 ${amount(view.equity)}`, `실현손익 ${amount(view.realizedPnl)} · 미실현손익 ${amount(view.unrealizedPnl)}`,
    `계좌 수익률 ${view.returnPct === null ? '미확인' : `${view.returnPct.toFixed(2)}%`} · 보유 ${view.positions.length}종목`,
    view.account.buyPaused ? '신규 매수 정지 · 보유 평가·매도 계속' : '신규 매수 허용',
    `평가 기준 ${view.account.lastSnapshotAt ? stamp(view.account.lastSnapshotAt) : '아직 처리 없음'}`);
  if (view.positions.some(position => position.stale)) lines.push('이전 관측 가격 포함 · 잠정 평가');
  const selection = view.account.selections?.at(-1);
  if (selection) lines.push(`운용 기준 ${selection.tradingDate}: ${selection.candidates[0] ? safe(selection.candidates[0].label, 100) : '검증 충족 규칙 없음 · 신규 매수 대기'}`);
  const today = toKstDateKey(now), reasons = new Map<string, number>();
  for (const order of view.account.orders) if (['REJECTED', 'EXPIRED'].includes(order.status)
    && Date.parse(order.submittedAt) <= now.getTime() && toKstDateKey(order.submittedAt) === today)
    reasons.set(order.statusReason, (reasons.get(order.statusReason) ?? 0) + 1);
  const pending = view.account.orders.filter(order => order.status === 'PENDING').length;
  if (pending) lines.push(`체결 대기 ${pending}건 · 유효한 새 가격 확인 후 처리`);
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5)) lines.push(`미매수 ${count}건: ${safe(reason, 80)}`);
  lines.push('1주 신호 검증 성과와 별도 · 상세는 대시보드');
  return lines.join('\n');
}
export function enqueueAccountExecutions(state: PaperBotState, view: PaperAccountView | undefined, now: Date): void {
  if (!view || view.error) return;
  const account = view.account;
  const events = (account?.orders ?? []).filter(order => order.status === 'FILLED' && order.fill
    && Date.parse(order.fill.at) <= now.getTime() && Date.parse(order.fill.at) >= now.getTime() - 7 * 86400000)
    .map(order => ({ order, id: `account:${account!.id}:${order.id}`, at: order.fill!.at }));
  const initialized = state.accountInitializedAt;
  if (!initialized) state.accountInitializedAt = now.toISOString();
  const added = initialized ? events.filter(event => !state.seenEvents[event.id] && Date.parse(event.at) >= Date.parse(initialized)) : [];
  for (let offset = 0; offset < added.length;) {
    const batch = added.slice(offset, offset + 5);
    while (batch.length > 1 && Math.max(...[false, true].map(analysis => formatAccountExecutions(account!, batch.map(event => event.order), analysis).length)) > 3500) batch.pop();
    offset += batch.length;
    for (const [channel, analysis] of [[ChannelSemantic.EXECUTION, false], [ChannelSemantic.SIGNAL, true]] as const) {
      const id = `paper:account:${hash(batch.map(event => event.id).sort().join('|'))}:${channel}`;
      if (!state.messages.some(message => message.id === id)) state.messages.push({ id, kind: 'trades', channel,
        message: formatAccountExecutions(account!, batch.map(event => event.order), analysis), state: 'PENDING', attempts: 0,
        createdAt: now.toISOString(), nextAttemptAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3600000).toISOString() });
    }
  }
  for (const event of events) state.seenEvents[event.id] = event.at;
}
