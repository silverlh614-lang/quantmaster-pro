// @responsibility trading 영역 ShadowTradesSection 컴포넌트
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import { Section } from '../../../ui/section';
import type { ServerShadowTrade } from '../../../api';
import {
  getWeightedPnlPct, getTotalRealizedPnl, getSellFills,
  getRemainingQty, isPartialPosition, fmtFillTime, fillLabel,
} from './shadowTradeFills';
import { EXIT_RULE_SHORT, SUBTYPE_SHORT } from './constants';

type Fill = NonNullable<ServerShadowTrade['fills']>[number];

interface Props {
  trades: ServerShadowTrade[];
  /** 완결된 포지션 카드 클릭 시 감사 모달 오픈 */
  onOpenAudit: (trade: ServerShadowTrade) => void;
}

type ViewMode = 'holding' | 'closed' | 'fills';

export function ShadowTradesSection({ trades, onOpenAudit }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('holding');
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => setExpandedTrades(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // ── fill 기반 분류 ──────────────────────────────────────────────────
  const holdingTrades = trades.filter((t) => t.status !== 'REJECTED' && getRemainingQty(t) > 0);
  // 🔑 완결 = 잔량 0 (fills 단일 진실 원천). status 는 동기화 지연 가능성이
  // 있어 기준으로 쓰지 않는다. 그렇지 않으면 status='HIT_STOP' 인데 fills에 잔량이
  // 남은 포지션이 보유중·완결 양쪽에 중복 표시된다.
  const closedTrades = trades.filter((t) => t.status !== 'REJECTED' && getRemainingQty(t) === 0);
  const allFills: { fill: Fill; trade: ServerShadowTrade }[] = [];
  for (const t of trades) {
    for (const f of (t.fills ?? [])) allFills.push({ fill: f, trade: t });
  }
  allFills.sort((a, b) => new Date(b.fill.timestamp).getTime() - new Date(a.fill.timestamp).getTime());

  const tabs: { key: ViewMode; label: string; count: number; color: string }[] = [
    { key: 'holding', label: '📦 보유중',   count: holdingTrades.length, color: 'bg-violet-500' },
    { key: 'closed',  label: '📜 완결',     count: closedTrades.length,  color: 'bg-slate-600' },
    { key: 'fills',   label: '🔍 체결 기록', count: allFills.length,      color: 'bg-cyan-600'  },
  ];

  if (trades.length === 0) return null;

  return (
    <Section title="서버 Shadow Trades" subtitle={`${trades.length}건`}>
      {/* 탭 헤더 */}
      <div className="flex items-center gap-1.5 mb-4 border-b border-slate-700/40 pb-3">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setViewMode(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              viewMode === tab.key
                ? `${tab.color} text-white`
                : 'bg-white/5 text-theme-text-muted hover:text-theme-text'
            )}
          >
            {tab.label}
            <span className={cn(
              'text-[9px] font-black px-1 py-0.5 rounded',
              viewMode === tab.key ? 'bg-white/20 text-white' : 'bg-slate-700 text-theme-text-muted'
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {viewMode === 'holding' && <HoldingTab trades={holdingTrades} expanded={expandedTrades} onToggle={toggleExpand} />}
      {viewMode === 'closed' && <ClosedTab trades={closedTrades} expanded={expandedTrades} onToggle={toggleExpand} onOpenAudit={onOpenAudit} />}
      {viewMode === 'fills' && <FillsTab fills={allFills} />}
    </Section>
  );
}

// ─── 📦 보유중 탭 ────────────────────────────────────────────────────────────

function HoldingTab({
  trades, expanded, onToggle,
}: {
  trades: ServerShadowTrade[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (trades.length === 0) {
    return (
      <p className="text-xs text-center py-6 text-theme-text-muted border border-dashed border-slate-700/40 rounded-xl">
        현재 보유 중인 포지션이 없습니다
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {trades.map((t, i) => {
        const key = t.id ?? String(i);
        const origQty = t.originalQuantity ?? t.quantity ?? 0;
        const remainingQty = getRemainingQty(t);
        const partial = isPartialPosition(t);
        const soldSoFar = origQty - remainingQty;
        const sellFills = getSellFills(t);
        const realizedPnl = getTotalRealizedPnl(t);
        const weightedPnl = getWeightedPnlPct(t);
        const isExpanded = expanded.has(key);
        const profileType = (t as Record<string, unknown>).profileType as string | undefined;

        return (
          <Card key={key} padding="sm" className={cn('text-sm', partial ? '!border-amber-500/20 !bg-amber-500/5' : '')}>
            {/* 헤더 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="font-black text-theme-text truncate">{t.stockName}</span>
                <span className="text-theme-text-muted text-[11px] shrink-0">{t.stockCode}</span>
                {profileType && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/40 font-bold shrink-0">
                    {profileType}
                  </span>
                )}
                {partial && (
                  <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">
                    부분청산 {soldSoFar}주 완료
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  HOLDING
                </span>
                {sellFills.length > 0 && (
                  <button
                    onClick={() => onToggle(key)}
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* 가격/수량 행 */}
            <div className="flex gap-3 mt-2 text-xs text-theme-text-muted flex-wrap">
              <span>진입 <span className="text-theme-text font-bold font-num">{t.shadowEntryPrice?.toLocaleString()}</span></span>
              <span>손절 <span className="font-num">{t.stopLoss?.toLocaleString()}</span></span>
              <span>목표 <span className="font-num">{t.targetPrice?.toLocaleString()}</span></span>
              <span>수량 <span className="text-theme-text font-num">
                {remainingQty}{remainingQty < origQty && <span className="text-amber-400">/{origQty}</span>}주
              </span></span>
            </div>

            {/* 부분 익절이 있으면 이미 실현된 손익 표시 */}
            {(realizedPnl !== 0 || (partial && weightedPnl !== 0)) && (
              <div className="flex items-center gap-3 mt-2 text-xs">
                {weightedPnl !== 0 && (
                  <span className={cn('font-black font-num', weightedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {weightedPnl >= 0 ? '+' : ''}{weightedPnl.toFixed(2)}%
                    <span className="font-normal text-theme-text-muted ml-1">(청산분 가중평균)</span>
                  </span>
                )}
                {realizedPnl !== 0 && (
                  <span className={cn('font-num text-[10px]', realizedPnl >= 0 ? 'text-green-400/70' : 'text-red-400/70')}>
                    실현 {realizedPnl >= 0 ? '+' : ''}{Math.round(realizedPnl).toLocaleString()}원
                  </span>
                )}
              </div>
            )}

            {/* 부분 청산 타임라인 */}
            {isExpanded && sellFills.length > 0 && (
              <div className="mt-3 pt-3 border-t border-theme-border/20 space-y-1.5">
                <p className="text-[10px] text-theme-text-muted font-bold uppercase tracking-wider">부분 청산 이력</p>
                {sellFills.map((f, fi) => (
                  <div key={f.id ?? fi} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="text-theme-text-muted">{fmtFillTime(f.timestamp)}</span>
                      <span className={cn('px-1 py-0.5 rounded text-[9px] font-bold',
                        f.subType === 'STOP_LOSS' || f.subType === 'EMERGENCY'
                          ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                      )}>{fillLabel(f)}</span>
                      <span className="text-theme-text-muted">{f.qty}주 @{f.price?.toLocaleString()}</span>
                    </div>
                    <span className={cn('font-bold font-num', (f.pnlPct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {(f.pnlPct ?? 0) >= 0 ? '+' : ''}{(f.pnlPct ?? 0).toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── 📜 완결 탭 ──────────────────────────────────────────────────────────────

function ClosedTab({
  trades, expanded, onToggle, onOpenAudit,
}: {
  trades: ServerShadowTrade[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onOpenAudit: (trade: ServerShadowTrade) => void;
}) {
  if (trades.length === 0) {
    return (
      <p className="text-xs text-center py-6 text-theme-text-muted border border-dashed border-slate-700/40 rounded-xl">
        오늘 완결된 거래가 없습니다
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {trades.map((t, i) => {
        const key = t.id ?? String(i);
        const origQty = t.originalQuantity ?? t.quantity ?? 0;
        const sellFills = getSellFills(t);
        const realizedPnl = getTotalRealizedPnl(t);
        const totalSoldQty = sellFills.reduce((s, f) => s + (f.qty ?? 0), 0);
        const weightedPnl = totalSoldQty > 0
          ? sellFills.reduce((s, f) => s + (f.pnlPct ?? 0) * (f.qty ?? 0), 0) / totalSoldQty
          : (t.returnPct ?? 0);
        // 색상 규칙: 실현 PnL 합계 기준 (강제손절 태그가 아니라 총합이 판정)
        const isWin = sellFills.length > 0 ? realizedPnl > 0 : weightedPnl > 0;
        const isExpanded = expanded.has(key);

        // 청산 구성 — 익절(TP)/손절(SL) 수량 분리
        const exitComp = (() => {
          let tpQty = 0, slQty = 0;
          for (const f of sellFills) {
            if (f.subType === 'STOP_LOSS' || f.subType === 'EMERGENCY') slQty += f.qty ?? 0;
            else tpQty += f.qty ?? 0;
          }
          return { tp: tpQty, sl: slQty };
        })();

        // 계층화된 태그 요약 — Primary + Subs
        const tagSummary = (() => {
          const primary = getRemainingQty(t) === 0 ? '전량 청산' : '부분 청산';
          const subSet = new Set<string>();
          for (const f of sellFills) {
            if (f.exitRuleTag) subSet.add(EXIT_RULE_SHORT[f.exitRuleTag] ?? f.exitRuleTag);
            else if (f.subType) subSet.add(SUBTYPE_SHORT[f.subType] ?? f.subType);
          }
          const subs = [...subSet];
          return { primary, label: subs.length > 0 ? `${primary} (${subs.join(' · ')})` : primary };
        })();

        return (
          <Card
            key={key}
            padding="sm"
            className={cn(
              'text-sm opacity-90 cursor-pointer hover:opacity-100 transition-opacity',
              isWin ? '!border-green-500/15 !bg-green-500/[0.03]' : '!border-red-500/15 !bg-red-500/[0.03]'
            )}
            onClick={() => onOpenAudit(t)}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-black text-theme-text truncate">{t.stockName}</span>
                <span className="text-theme-text-muted text-[11px] shrink-0">{t.stockCode}</span>
                {sellFills.length > 0 && (
                  <span className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 border',
                    isWin
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                  )}>
                    {tagSummary.label}
                  </span>
                )}
                {exitComp.tp > 0 && exitComp.sl > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 border bg-slate-700/40 text-slate-300 border-slate-600/30">
                    익절 {exitComp.tp}주 + 손절 {exitComp.sl}주
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className={cn('font-black font-num text-sm', isWin ? 'text-green-400' : 'text-red-400')}>
                    {weightedPnl >= 0 ? '+' : ''}{weightedPnl.toFixed(2)}%
                  </p>
                  {realizedPnl !== 0 && (
                    <p className={cn('font-num text-[10px]', realizedPnl >= 0 ? 'text-green-400/70' : 'text-red-400/70')}>
                      {realizedPnl >= 0 ? '+' : ''}{Math.round(realizedPnl).toLocaleString()}원
                    </p>
                  )}
                </div>
                {sellFills.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggle(key); }}
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* 진입 요약 */}
            <p className="text-xs text-theme-text-muted mt-1.5">
              진입 <span className="font-num text-theme-text">{t.shadowEntryPrice?.toLocaleString()}</span>
              {origQty > 0 && <span> × {origQty}주</span>}
            </p>

            {/* 청산 이벤트 타임라인 */}
            {isExpanded && sellFills.length > 0 && (
              <div className="mt-2 pt-2 space-y-1.5 border-t border-theme-border/20">
                {sellFills.map((f, fi) => {
                  const isLoss = (f.pnlPct ?? 0) < 0;
                  const cumPnl = sellFills.slice(0, fi + 1).reduce((s, f2) => s + (f2.pnl ?? 0), 0);
                  return (
                    <div key={f.id ?? fi} className="flex items-center gap-2 text-[11px]">
                      <span className="text-theme-text-muted w-10 shrink-0">{fmtFillTime(f.timestamp)}</span>
                      <span className={cn('shrink-0', isLoss ? 'text-red-400' : 'text-green-400')}>
                        {f.subType === 'STOP_LOSS' || f.subType === 'EMERGENCY' ? '🔴' : '🟢'}
                      </span>
                      <span className={cn('text-[9px] font-bold px-1 py-0.5 rounded shrink-0',
                        isLoss ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                      )}>{fillLabel(f)}</span>
                      <span className="text-theme-text-muted">{f.qty}주 @{f.price?.toLocaleString()}</span>
                      <span className={cn('font-bold font-num ml-auto shrink-0', isLoss ? 'text-red-400' : 'text-green-400')}>
                        {(f.pnlPct ?? 0) >= 0 ? '+' : ''}{(f.pnlPct ?? 0).toFixed(2)}%
                      </span>
                      {cumPnl !== 0 && (
                        <span className={cn('font-num text-[10px] shrink-0', cumPnl >= 0 ? 'text-green-400/60' : 'text-red-400/60')}>
                          누적 {cumPnl >= 0 ? '+' : ''}{Math.round(cumPnl).toLocaleString()}원
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 합계 구분선 */}
            {sellFills.length >= 2 && (() => {
              const winQty = sellFills.filter((f) => (f.pnlPct ?? 0) >= 0).reduce((s, f) => s + (f.qty ?? 0), 0);
              const lossQty = sellFills.filter((f) => (f.pnlPct ?? 0) < 0).reduce((s, f) => s + (f.qty ?? 0), 0);
              const summaryLabel = winQty > 0 && lossQty > 0
                ? `익절 ${winQty}주 + 손절 ${lossQty}주`
                : winQty > 0 ? `익절 ${winQty}주` : `손절 ${lossQty}주`;
              return (
                <div className="mt-2 pt-2 border-t border-slate-700/30 flex justify-between text-[11px]">
                  <span className="text-theme-text-muted">합계 · {summaryLabel}</span>
                  <div className="flex items-center gap-3">
                    <span className={cn('font-black font-num', isWin ? 'text-green-400' : 'text-red-400')}>
                      {weightedPnl >= 0 ? '+' : ''}{weightedPnl.toFixed(2)}%
                      <span className="font-normal text-theme-text-muted ml-1">(가중평균)</span>
                    </span>
                    {realizedPnl !== 0 && (
                      <span className={cn('font-num', realizedPnl >= 0 ? 'text-green-400/80' : 'text-red-400/80')}>
                        {realizedPnl >= 0 ? '+' : ''}{Math.round(realizedPnl).toLocaleString()}원
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
          </Card>
        );
      })}
    </div>
  );
}

// ─── 🔍 체결 기록 탭 ─────────────────────────────────────────────────────────

function FillsTab({ fills }: { fills: { fill: Fill; trade: ServerShadowTrade }[] }) {
  if (fills.length === 0) {
    return (
      <p className="text-xs text-center py-6 text-theme-text-muted border border-dashed border-slate-700/40 rounded-xl">
        체결 이벤트가 아직 없습니다 (신규 포지션부터 기록됩니다)
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {fills.slice(0, 50).map(({ fill: f, trade: t }, i) => {
        const isSell = f.type === 'SELL';
        const isLoss = isSell && (f.pnlPct ?? 0) < 0;
        return (
          <div key={f.id ?? i} className={cn(
            'flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs',
            !isSell ? 'border-violet-500/20 bg-violet-500/5' :
            isLoss ? 'border-red-500/20 bg-red-500/5' :
                     'border-green-500/20 bg-green-500/5'
          )}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-theme-text-muted text-[10px] w-9 shrink-0">{fmtFillTime(f.timestamp)}</span>
              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0',
                !isSell ? 'bg-violet-500/30 text-violet-300' :
                isLoss ? 'bg-red-500/30 text-red-300' : 'bg-green-500/30 text-green-300'
              )}>{fillLabel(f)}</span>
              <span className="font-bold text-theme-text truncate">{t.stockName}</span>
              <span className="text-theme-text-muted shrink-0">{f.qty}주 @{f.price?.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isSell && (
                <span className={cn('font-black font-num', isLoss ? 'text-red-400' : 'text-green-400')}>
                  {(f.pnlPct ?? 0) >= 0 ? '+' : ''}{(f.pnlPct ?? 0).toFixed(2)}%
                </span>
              )}
              {isSell && f.pnl != null && (
                <span className={cn('text-[10px] font-num', isLoss ? 'text-red-400/70' : 'text-green-400/70')}>
                  {f.pnl >= 0 ? '+' : ''}{Math.round(f.pnl).toLocaleString()}원
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
