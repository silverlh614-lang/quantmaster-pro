/**
 * ShadowPortfolioPanel — 섀도우 계좌 포트폴리오 대시보드
 * KPI 헤더 · 보유 포지션 · 거래내역(체결 트리 포함) · 통계
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, TrendingUp, TrendingDown, Wallet, BarChart2,
  ChevronDown, ChevronUp, Clock, Target, ShieldAlert,
  Minus, AlertCircle,
} from 'lucide-react';
import { cn } from '../../ui/cn';
import { KpiStrip, type KpiItem } from '../../ui/kpi-strip';
import { Badge } from '../../ui/badge';
import { Spinner } from '../../ui/spinner';
import { isMarketOpen } from '../../utils/marketTime';
import { shadowApi, ApiError } from '../../api';
import { usePolledFetch } from '../../hooks/usePolledFetch';

// ─── 타입 (서버 shadowAccountRepo.ts 미러) ───────────────────────────────────

interface PositionFill {
  id: string;
  type: 'BUY' | 'SELL';
  subType?: string;
  qty: number;
  price: number;
  pnl?: number;
  pnlPct?: number;
  reason: string;
  exitRuleTag?: string;
  timestamp: string;
}

interface ActivePosition {
  tradeId: string;
  stockCode: string;
  stockName: string;
  entryPrice: number;
  remainingQty: number;
  originalQty: number;
  investedCash: number;
  stopLoss: number;
  targetPrice: number;
  signalTime: string;
  watchlistSource?: string;
  profileType?: string;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPct?: number;
}

interface ClosedTrade {
  tradeId: string;
  stockCode: string;
  stockName: string;
  entryPrice: number;
  exitPrice?: number;
  originalQty: number;
  totalSoldQty: number;
  realizedPnl: number;
  weightedPnlPct: number;
  closeTime?: string;
  exitRuleTag?: string;
  fills: PositionFill[];
  status: string;
}

interface AccountStats {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancy: number;
}

interface ShadowAccountState {
  startingCapital: number;
  cashBalance: number;
  totalInvested: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalAssets: number;
  returnPct: number;
  openPositions: ActivePosition[];
  closedTrades: ClosedTrade[];
  todayRealizedPnl?: number;
  todaySellFillCount?: number;
  stats: AccountStats;
  computedAt: string;
}

// ─── 포맷 유틸 ─────────────────────────────────────────────────────────────────

function fmtKrw(v: number): string {
  if (Math.abs(v) >= 100_000_000)
    return `${(v / 100_000_000).toFixed(2)}억`;
  if (Math.abs(v) >= 10_000)
    return `${Math.round(v / 10_000).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString()}원`;
}

function fmtPct(v: number, digits = 2): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** 상대시간 — 1분 이내 "방금 전", 1시간 이내 "N분 전", 그 외 HH:MM. */
function fmtRelative(d: Date, now: Date = new Date()): string {
  const sec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (sec < 10) return '방금 전';
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}


// ─── EXIT RULE TAG 레이블 ───────────────────────────────────────────────────────
const EXIT_LABELS: Record<string, string> = {
  R6_EMERGENCY_EXIT: 'R6 긴급',
  HARD_STOP: '강제손절',
  MA60_DEATH_FORCE_EXIT: 'MA60 강제',
  CASCADE_FINAL: '연쇄 최종',
  LIMIT_TRANCHE_TAKE_PROFIT: '분할익절',
  TRAILING_PROTECTIVE_STOP: '트레일링',
  TARGET_EXIT: '목표가',
  CASCADE_HALF_SELL: '연쇄 반매',
  RRR_COLLAPSE_PARTIAL: 'RRR붕괴',
  DIVERGENCE_PARTIAL: '다이버전스',
  EUPHORIA_PARTIAL: '과열',
  STOP_LOSS: '손절',
};

// ─── 체결 서브타입 배지 ─────────────────────────────────────────────────────────
function FillBadge({ fill }: { fill: PositionFill }) {
  const isBuy = fill.type === 'BUY';
  const label = isBuy ? '매수' : (fill.exitRuleTag ? EXIT_LABELS[fill.exitRuleTag] ?? '매도' : '매도');
  return (
    <span className={cn(
      'text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide',
      isBuy ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
             : fill.pnlPct !== undefined && fill.pnlPct >= 0
               ? 'bg-green-500/20 text-green-300 border border-green-500/30'
               : 'bg-red-500/20 text-red-300 border border-red-500/30'
    )}>
      {label}
    </span>
  );
}

// ─── 보유 포지션 카드 ────────────────────────────────────────────────────────────
function OpenPositionCard({ pos }: { pos: ActivePosition }) {
  const hasPrice = pos.currentPrice !== undefined;
  const pnl = pos.unrealizedPnl ?? 0;
  const pct = pos.unrealizedPct ?? 0;
  const isPos = pct >= 0;
  const isPartial = pos.remainingQty < pos.originalQty;

  return (
    <div className="border border-slate-700/60 rounded-xl p-3 sm:p-4 bg-white/[0.02] space-y-2">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-sm text-theme-text truncate">{pos.stockName}</span>
            <span className="text-[10px] text-theme-text-muted">{pos.stockCode}</span>
            {isPartial && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                부분청산
              </span>
            )}
            {pos.profileType && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-600/40 text-slate-400 border border-slate-600/40">
                {pos.profileType}
              </span>
            )}
          </div>
          <p className="text-[10px] text-theme-text-muted mt-0.5">
            진입 {fmtDate(pos.signalTime)} · {pos.remainingQty}주{isPartial ? ` / 원래 ${pos.originalQty}주` : ''}
          </p>
        </div>
        {/* 미실현 손익 */}
        <div className="text-right shrink-0">
          {hasPrice ? (
            <>
              <p className={cn('font-black text-sm font-num', isPos ? 'text-green-400' : 'text-red-400')}>
                {fmtPct(pct)}
              </p>
              <p className={cn('text-[10px] font-num', isPos ? 'text-green-400/70' : 'text-red-400/70')}>
                {pnl >= 0 ? '+' : ''}{fmtKrw(pnl)}
              </p>
            </>
          ) : (
            <span className="text-[10px] text-theme-text-muted">가격 없음</span>
          )}
        </div>
      </div>

      {/* 가격 정보 */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="text-center">
          <p className="text-theme-text-muted">진입가</p>
          <p className="font-num font-bold text-theme-text">{pos.entryPrice.toLocaleString()}</p>
        </div>
        <div className="text-center">
          <p className="text-theme-text-muted">현재가</p>
          <p className={cn('font-num font-bold', hasPrice ? (isPos ? 'text-green-400' : 'text-red-400') : 'text-theme-text-muted')}>
            {hasPrice ? pos.currentPrice!.toLocaleString() : '—'}
          </p>
        </div>
        <div className="text-center">
          <p className="text-theme-text-muted">손절가</p>
          <p className="font-num font-bold text-red-400/80">{pos.stopLoss.toLocaleString()}</p>
        </div>
      </div>

      {/* 진행 바: 진입가 → 목표가 내 현재가 위치 */}
      {hasPrice && (
        <div className="space-y-1">
          <div className="relative h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
            <div
              className={cn('absolute inset-y-0 left-0 rounded-full transition-all', isPos ? 'bg-green-500' : 'bg-red-500')}
              style={{
                width: `${Math.max(0, Math.min(100,
                  ((pos.currentPrice! - pos.stopLoss) / (pos.targetPrice - pos.stopLoss)) * 100
                ))}%`
              }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-theme-text-muted font-num">
            <span>손절 {pos.stopLoss.toLocaleString()}</span>
            <span>목표 {pos.targetPrice.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 청산 거래 행 ─────────────────────────────────────────────────────────────
function ClosedTradeRow({
  trade,
  expanded,
  onToggle,
}: {
  trade: ClosedTrade;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isWin = trade.weightedPnlPct > 0;
  const sells = trade.fills.filter(f => f.type === 'SELL');

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      {/* 요약 행 */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        {/* 손익 아이콘 */}
        <div className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
          isWin ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
        )}>
          {isWin ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
        </div>

        {/* 종목 정보 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-xs sm:text-sm text-theme-text">{trade.stockName}</span>
            <span className="text-[10px] text-theme-text-muted">{trade.stockCode}</span>
            {trade.exitRuleTag && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/40">
                {EXIT_LABELS[trade.exitRuleTag] ?? trade.exitRuleTag}
              </span>
            )}
          </div>
          <p className="text-[10px] text-theme-text-muted">
            {trade.closeTime ? fmtDate(trade.closeTime) : '—'} · {trade.totalSoldQty}주
          </p>
        </div>

        {/* 손익 */}
        <div className="text-right shrink-0">
          <p className={cn('font-black text-sm font-num', isWin ? 'text-green-400' : 'text-red-400')}>
            {fmtPct(trade.weightedPnlPct)}
          </p>
          <p className={cn('text-[10px] font-num', isWin ? 'text-green-400/70' : 'text-red-400/70')}>
            {trade.realizedPnl >= 0 ? '+' : ''}{fmtKrw(trade.realizedPnl)}
          </p>
        </div>

        {/* 펼치기 */}
        {sells.length > 0 && (
          <div className="text-theme-text-muted shrink-0 ml-1">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        )}
      </button>

      {/* 체결 내역 트리 */}
      {expanded && (
        <div className="border-t border-slate-700/40 bg-slate-900/30 px-3 sm:px-4 py-2 space-y-1.5">
          {trade.fills.map(fill => (
            <div key={fill.id} className="flex items-center gap-2 text-[10px] sm:text-xs">
              <FillBadge fill={fill} />
              <span className="font-num text-theme-text">{fill.price.toLocaleString()}원</span>
              <span className="text-theme-text-muted">×{fill.qty}주</span>
              {fill.pnlPct !== undefined && (
                <span className={cn('font-num font-bold', fill.pnlPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {fmtPct(fill.pnlPct, 1)}
                </span>
              )}
              {fill.pnl !== undefined && (
                <span className={cn('font-num', fill.pnl >= 0 ? 'text-green-400/70' : 'text-red-400/70')}>
                  ({fill.pnl >= 0 ? '+' : ''}{fmtKrw(fill.pnl)})
                </span>
              )}
              <span className="text-theme-text-muted ml-auto shrink-0">{fmtTime(fill.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function ShadowPortfolioPanel() {
  const [account, setAccount] = useState<ShadowAccountState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set());
  // 상대시간("N분 전")을 주기적으로 재렌더하기 위한 tick — 30초마다 갱신.
  const [, setRelativeTick] = useState(0);

  // ── 데이터 페치 ─────────────────────────────────────────────────────────────
  // silent=true 는 폴링(재진입) 호출에서 스피너를 띄우지 않기 위함.
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await shadowApi.getAccount<ShadowAccountState>();
      setAccount(data);
      setLastRefresh(new Date());
    } catch (e) {
      const msg = e instanceof ApiError
        ? `서버 오류 ${e.status}`
        : e instanceof Error ? e.message : '알 수 없는 오류';
      setError(msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // 초기 로드(스피너 표시) + 장중·가시 상태에서 60s 폴링(silent).
  usePolledFetch(() => refresh(true), { skipInitial: true });
  useEffect(() => { refresh(false); }, [refresh]);

  // 상대시간 라벨("N분 전")만 30초마다 재렌더 (fetch 없음).
  useEffect(() => {
    const id = setInterval(() => setRelativeTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── 체결 트리 토글 ───────────────────────────────────────────────────────────
  const toggleTrade = useCallback((id: string) => {
    setExpandedTrades(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── KPI 아이템 생성 ──────────────────────────────────────────────────────────
  const kpiItems: KpiItem[] = account ? [
    {
      label: '총 자산',
      value: fmtKrw(account.totalAssets),
      status: account.returnPct >= 0 ? 'pass' : 'fail',
    },
    {
      label: '수익률',
      value: fmtPct(account.returnPct),
      trend: account.returnPct >= 0 ? 'up' : 'down',
      status: account.returnPct > 3 ? 'pass' : account.returnPct >= 0 ? 'warn' : 'fail',
    },
    {
      label: '현금',
      value: fmtKrw(account.cashBalance),
      status: 'neutral',
    },
    {
      label: '평가액',
      value: fmtKrw(account.totalInvested),
      status: account.openPositions.length > 0 ? 'warn' : 'neutral',
    },
    {
      label: '실현손익',
      value: `${account.realizedPnl >= 0 ? '+' : ''}${fmtKrw(account.realizedPnl)}`,
      trend: account.realizedPnl > 0 ? 'up' : account.realizedPnl < 0 ? 'down' : 'neutral',
      status: account.realizedPnl > 0 ? 'pass' : account.realizedPnl < 0 ? 'fail' : 'neutral',
    },
    {
      label: '미실현손익',
      value: `${account.unrealizedPnl >= 0 ? '+' : ''}${fmtKrw(account.unrealizedPnl)}`,
      trend: account.unrealizedPnl > 0 ? 'up' : account.unrealizedPnl < 0 ? 'down' : 'neutral',
      status: account.unrealizedPnl > 0 ? 'pass' : account.unrealizedPnl < 0 ? 'fail' : 'neutral',
    },
  ] : [];

  // ── 렌더 ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-black text-theme-text tracking-tight">섀도우 계좌</h2>
          <p className="text-[10px] sm:text-xs text-theme-text-muted mt-0.5">
            {account ? `시작원금 ${fmtKrw(account.startingCapital)}` : '포트폴리오 추적'}
            {lastRefresh && (
              <span className="ml-2">· {fmtRelative(lastRefresh)} 갱신</span>
            )}
            {isMarketOpen()
              ? <span className="ml-1 text-green-400/70">· 장중 1분 자동갱신</span>
              : <span className="ml-1 text-theme-text-muted/60">· 장외</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-600/50 text-[11px] font-bold text-theme-text-muted hover:text-theme-text hover:border-slate-500 transition-all disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          <span className="hidden sm:inline">{loading ? '갱신 중...' : '새로고침'}</span>
        </button>
      </div>

      {/* 에러 */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-red-500/30 bg-red-500/[0.06] text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 로딩 */}
      {loading && !account && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {account && (
        <>
          {/* KPI Strip */}
          <KpiStrip items={kpiItems} className="grid-cols-3 sm:grid-cols-6" />

          {/* 오늘(KST) 실현 성과 — 금일 SELL fill이 있을 때만 표시 */}
          {(account.todaySellFillCount ?? 0) > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-white/[0.015] px-3 py-2 text-xs">
              <span className="text-theme-text-muted">
                오늘 {account.todaySellFillCount}건 체결
              </span>
              <span className={cn(
                'font-num font-black',
                (account.todayRealizedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400',
              )}>
                {(account.todayRealizedPnl ?? 0) >= 0 ? '+' : ''}
                {fmtKrw(account.todayRealizedPnl ?? 0)}
              </span>
            </div>
          )}

          {/* ── 보유 포지션 ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5 text-theme-text-muted" />
              <h3 className="text-xs sm:text-sm font-black uppercase tracking-wide text-theme-text-muted">
                보유 포지션
                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-700/60 text-theme-text text-[10px] normal-case font-bold">
                  {account.openPositions.length}
                </span>
              </h3>
            </div>
            {account.openPositions.length === 0 ? (
              <p className="text-xs text-theme-text-muted py-4 text-center border border-dashed border-slate-700/40 rounded-xl">
                보유 중인 포지션 없음
              </p>
            ) : (
              <div className="space-y-2">
                {account.openPositions.map(pos => (
                  <OpenPositionCard key={pos.tradeId} pos={pos} />
                ))}
              </div>
            )}
          </section>

          {/* ── 거래 내역 ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5 text-theme-text-muted" />
              <h3 className="text-xs sm:text-sm font-black uppercase tracking-wide text-theme-text-muted">
                거래 내역
                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-700/60 text-theme-text text-[10px] normal-case font-bold">
                  {account.closedTrades.length}
                </span>
              </h3>
            </div>
            {account.closedTrades.length === 0 ? (
              <p className="text-xs text-theme-text-muted py-4 text-center border border-dashed border-slate-700/40 rounded-xl">
                청산된 거래 없음
              </p>
            ) : (
              <div className="space-y-1.5">
                {account.closedTrades.map(trade => (
                  <ClosedTradeRow
                    key={trade.tradeId}
                    trade={trade}
                    expanded={expandedTrades.has(trade.tradeId)}
                    onToggle={() => toggleTrade(trade.tradeId)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── 통계 ── */}
          {account.stats.totalTrades > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Target className="w-3.5 h-3.5 text-theme-text-muted" />
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wide text-theme-text-muted">
                  누적 통계
                </h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    label: '승률',
                    value: `${account.stats.winRate.toFixed(1)}%`,
                    sub: `${account.stats.winCount}승 ${account.stats.lossCount}패`,
                    status: account.stats.winRate >= 55 ? 'pass' : account.stats.winRate >= 45 ? 'warn' : 'fail',
                  },
                  {
                    label: '평균 수익',
                    value: `+${account.stats.avgWinPct.toFixed(2)}%`,
                    sub: '수익 거래 평균',
                    status: 'pass',
                  },
                  {
                    label: '평균 손실',
                    value: `${account.stats.avgLossPct.toFixed(2)}%`,
                    sub: '손실 거래 평균',
                    status: 'fail',
                  },
                  {
                    label: '기대값',
                    value: fmtPct(account.stats.expectancy, 2),
                    sub: '거래당 기대 수익률',
                    status: account.stats.expectancy > 0 ? 'pass' : 'fail',
                  },
                ].map((item, i) => (
                  <div
                    key={i}
                    className={cn(
                      'border rounded-xl p-3 text-center',
                      item.status === 'pass' ? 'border-green-500/30 bg-green-500/[0.04]'
                        : item.status === 'fail' ? 'border-red-500/25 bg-red-500/[0.03]'
                        : 'border-yellow-500/30 bg-yellow-500/[0.04]'
                    )}
                  >
                    <p className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted">{item.label}</p>
                    <p className={cn(
                      'text-base sm:text-lg font-black font-num mt-1',
                      item.status === 'pass' ? 'text-green-400'
                        : item.status === 'fail' ? 'text-red-400'
                        : 'text-yellow-400'
                    )}>{item.value}</p>
                    <p className="text-[10px] text-theme-text-muted mt-0.5">{item.sub}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
