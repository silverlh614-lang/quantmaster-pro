// @responsibility trading 영역 AuditTrailModal 컴포넌트
import React from 'react';
import { cn } from '../../../ui/cn';
import type { ServerShadowTrade, PositionEvent } from '../../../api';
import { EXIT_RULE_SHORT, REGIME_LABELS } from './constants';

interface Props {
  trade: ServerShadowTrade | null;
  events: PositionEvent[];
  loading: boolean;
  onClose: () => void;
}

/** 감사 추적 뷰어 — 완결된 포지션 카드 클릭 시 진입/청산 이벤트 타임라인 모달. */
export function AuditTrailModal({ trade, events, loading, onClose }: Props) {
  if (!trade) return null;

  const fills = (trade.fills ?? []);
  const entryRegime = (trade as Record<string, unknown>).entryRegime as string | undefined;

  // ── 상단 요약 KPI 계산 ─────────────────────────────────────────────
  const sells = fills.filter((f) => f.type === 'SELL');
  const totalPnl = sells.reduce((s, f) => s + (f.pnl ?? 0), 0);
  const totalQty = sells.reduce((s, f) => s + f.qty, 0);
  const weightedPnl = totalQty > 0
    ? sells.reduce((s, f) => s + (f.pnlPct ?? 0) * f.qty, 0) / totalQty
    : (trade.returnPct ?? 0);
  const mfe = sells.reduce((mx, f) => Math.max(mx, f.pnlPct ?? 0), 0);
  const mae = sells.reduce((mn, f) => Math.min(mn, f.pnlPct ?? 0), 0);
  const slDist = trade.shadowEntryPrice && trade.stopLoss
    ? ((trade.stopLoss - trade.shadowEntryPrice) / trade.shadowEntryPrice * 100).toFixed(1)
    : null;
  const isWin = totalPnl >= 0;

  const kpis = [
    { label: '실현 P&L', value: `${totalPnl >= 0 ? '+' : ''}${Math.round(totalPnl).toLocaleString()}원`, color: isWin ? 'text-green-400' : 'text-red-400' },
    { label: '가중평균 수익률', value: `${weightedPnl >= 0 ? '+' : ''}${weightedPnl.toFixed(2)}%`, color: isWin ? 'text-green-400' : 'text-red-400' },
    { label: 'MFE (최대 유리)', value: `+${mfe.toFixed(2)}%`, color: 'text-blue-400' },
    { label: 'MAE / SL거리', value: `${mae.toFixed(2)}% / ${slDist ?? 'N/A'}%`, color: 'text-amber-400' },
  ];

  const exportCSV = () => {
    const rows: (string | number | undefined)[][] = [
      ['ts', 'type', 'subType', 'quantity', 'price', 'realizedPnL', 'cumRealizedPnL', 'remainingQty'],
      ...events.map((e) => {
        const rec = e as Record<string, unknown>;
        return [
          String(rec.ts ?? ''), String(rec.type ?? ''), String(rec.subType ?? ''),
          String(rec.quantity ?? ''), String(rec.price ?? ''),
          String(rec.realizedPnL ?? ''), String(rec.cumRealizedPnL ?? ''),
          String(rec.remainingQty ?? ''),
        ];
      }),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-${trade.stockCode}-${trade.id?.slice(-8) ?? 'pos'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-theme-border/30 bg-[#0f1117] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-theme-border/20 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-black text-theme-text text-base">{trade.stockName}</span>
              <span className="text-theme-text-muted text-xs">{trade.stockCode}</span>
              {entryRegime && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold">
                  {REGIME_LABELS[entryRegime] ?? entryRegime}
                </span>
              )}
            </div>
            <p className="text-[11px] text-theme-text-muted mt-0.5">
              진입 {trade.shadowEntryPrice?.toLocaleString()}원
              {trade.originalQuantity && ` × ${trade.originalQuantity}주`}
              {trade.signalTime && ` · ${new Date(new Date(trade.signalTime).getTime() + 9*3_600_000).toISOString().slice(0,10)}`}
              {trade.exitTime && ` → ${new Date(new Date(trade.exitTime).getTime() + 9*3_600_000).toISOString().slice(0,10)}`}
              {trade.signalTime && trade.exitTime && (() => {
                const days = Math.round((new Date(trade.exitTime!).getTime() - new Date(trade.signalTime).getTime()) / 86_400_000);
                return days > 0 ? ` (${days}일 보유)` : '';
              })()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-theme-text-muted hover:text-theme-text transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* 요약 KPI 바 */}
        <div className="grid grid-cols-4 gap-px bg-theme-border/20 shrink-0">
          {kpis.map(({ label, value, color }) => (
            <div key={label} className="bg-[#0f1117] px-3 py-3 text-center">
              <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold mb-1">{label}</p>
              <p className={cn('font-black font-num text-sm', color)}>{value}</p>
            </div>
          ))}
        </div>

        {/* TradeEvent 타임라인 + fills */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          <div>
            <p className="text-[10px] font-black text-theme-text-muted uppercase tracking-wider mb-2 flex items-center gap-2">
              TradeEvent 감사 로그
              {loading && <span className="text-[9px] text-violet-400 normal-case">로딩중…</span>}
              {!loading && events.length === 0 && <span className="text-[9px] text-theme-text-muted normal-case">(이벤트 없음 — fills 기반 요약만 표시)</span>}
            </p>
            {events.length > 0 && (
              <div className="space-y-1.5">
                {events.map((evt, ei) => {
                  const rec = evt as Record<string, unknown>;
                  const type = String(rec.type ?? '');
                  const subType = rec.subType as string | undefined;
                  const isEntry = type === 'ENTRY';
                  const isSell = type === 'PARTIAL_SELL' || type === 'FULL_SELL';
                  const realizedPnL = typeof rec.realizedPnL === 'number' ? rec.realizedPnL : 0;
                  const cumRealizedPnL = rec.cumRealizedPnL as number | undefined;
                  const win = isSell && realizedPnL >= 0;
                  const ts = String(rec.ts ?? '');
                  const quantity = String(rec.quantity ?? '');
                  const price = typeof rec.price === 'number' ? rec.price : Number(rec.price);
                  const remainingQty = String(rec.remainingQty ?? '');
                  return (
                    <div key={String(rec.id ?? ei)} className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px]',
                      isEntry ? 'border-violet-500/20 bg-violet-500/5' :
                      win ? 'border-green-500/20 bg-green-500/5' :
                             'border-red-500/20 bg-red-500/5'
                    )}>
                      <span className="text-theme-text-muted w-10 shrink-0 font-num">
                        {ts ? new Date(new Date(ts).getTime() + 9*3_600_000).toISOString().slice(11,16) : ''}
                      </span>
                      <span className={cn(
                        'text-[9px] font-black px-1.5 py-0.5 rounded shrink-0',
                        isEntry ? 'bg-violet-500/30 text-violet-300' :
                        win ? 'bg-green-500/30 text-green-300' : 'bg-red-500/30 text-red-300'
                      )}>
                        {subType ?? type}
                      </span>
                      <span className="text-theme-text font-num">{quantity}주 @{price?.toLocaleString()}</span>
                      {isSell && (
                        <span className={cn('font-black font-num ml-auto shrink-0', win ? 'text-green-400' : 'text-red-400')}>
                          {realizedPnL >= 0 ? '+' : ''}{Math.round(realizedPnL).toLocaleString()}원
                        </span>
                      )}
                      <span className="text-theme-text-muted text-[10px] shrink-0 font-num">
                        잔량 {remainingQty}주
                      </span>
                      {isSell && cumRealizedPnL !== undefined && (
                        <span className={cn('text-[10px] font-num shrink-0', cumRealizedPnL >= 0 ? 'text-green-400/60' : 'text-red-400/60')}>
                          누적 {cumRealizedPnL >= 0 ? '+' : ''}{Math.round(cumRealizedPnL).toLocaleString()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {fills.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-theme-text-muted uppercase tracking-wider mb-2">
                Fill 상세 ({fills.length}건)
              </p>
              <div className="space-y-1">
                {fills.map((f, fi) => {
                  const isBuy = f.type === 'BUY';
                  const isLoss = !isBuy && (f.pnlPct ?? 0) < 0;
                  return (
                    <div key={f.id ?? fi} className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded border text-[11px]',
                      isBuy ? 'border-violet-500/15 bg-violet-500/[0.04]' :
                      isLoss ? 'border-red-500/15 bg-red-500/[0.03]' :
                               'border-green-500/15 bg-green-500/[0.03]'
                    )}>
                      <span className="text-theme-text-muted w-10 shrink-0 font-num">
                        {new Date(new Date(f.timestamp).getTime() + 9*3_600_000).toISOString().slice(11,16)}
                      </span>
                      <span className={cn(
                        'text-[9px] font-bold px-1 py-0.5 rounded shrink-0',
                        isBuy ? 'bg-violet-500/25 text-violet-300' :
                        isLoss ? 'bg-red-500/25 text-red-300' : 'bg-green-500/25 text-green-300'
                      )}>
                        {f.subType ?? f.type}
                      </span>
                      <span className="text-theme-text font-num">{f.qty}주 @{f.price?.toLocaleString()}</span>
                      {f.exitRuleTag && (
                        <span className="text-[9px] text-theme-text-muted border border-theme-border/20 rounded px-1">
                          {EXIT_RULE_SHORT[f.exitRuleTag] ?? f.exitRuleTag}
                        </span>
                      )}
                      {!isBuy && f.pnlPct != null && (
                        <span className={cn('font-black font-num ml-auto shrink-0', isLoss ? 'text-red-400' : 'text-green-400')}>
                          {f.pnlPct >= 0 ? '+' : ''}{f.pnlPct.toFixed(2)}%
                        </span>
                      )}
                      {!isBuy && f.pnl != null && (
                        <span className={cn('font-num text-[10px] shrink-0', isLoss ? 'text-red-400/70' : 'text-green-400/70')}>
                          {f.pnl >= 0 ? '+' : ''}{Math.round(f.pnl).toLocaleString()}원
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 하단 버튼 바 */}
        <div className="px-5 py-3 border-t border-theme-border/20 flex justify-between items-center shrink-0">
          <button
            onClick={exportCSV}
            disabled={events.length === 0}
            className="text-[11px] px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-theme-text-muted hover:text-theme-text border border-theme-border/20 transition-colors disabled:opacity-40"
          >
            CSV 내보내기
          </button>
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/30 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
