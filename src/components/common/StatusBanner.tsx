// @responsibility common 영역 StatusBanner 컴포넌트
/**
 * Neo-Brutalism Status Banner
 * One-line "현재 상태 요약" at the top of the main content area.
 * Shows: market phase, recommended position, watchlist count, gate average.
 */
import React from 'react';
import { Activity, Eye, Target, TrendingUp, Zap, Wifi, WifiOff, RefreshCw, Clock } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useRecommendationStore, useGlobalIntelStore, useMarketStore } from '../../stores';
import { useTradeStore } from '../../stores';

type ConnectionState = 'loading' | 'live' | 'stale' | 'idle';
type RegimePhase = 'BULL' | 'TRANSITION' | 'BEAR';

const CONNECTION_CONFIG: Record<ConnectionState, { label: string; color: string; icon: React.ReactNode; dot: string }> = {
  live: { label: 'LIVE', color: 'text-green-400', icon: <Wifi className="w-3 h-3" />, dot: 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.6)]' },
  loading: { label: 'SYNC', color: 'text-blue-400', icon: <RefreshCw className="w-3 h-3 animate-spin" />, dot: 'bg-blue-400 animate-pulse' },
  stale: { label: 'STALE', color: 'text-amber-400', icon: <Clock className="w-3 h-3" />, dot: 'bg-amber-400' },
  idle: { label: 'IDLE', color: 'text-theme-text-muted', icon: <WifiOff className="w-3 h-3" />, dot: 'bg-theme-text-muted' },
};

const PHASE_CONFIG: Record<RegimePhase, { label: string; color: string; dot: string }> = {
  BULL: { label: 'BULL PHASE', color: 'text-green-400', dot: 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.6)]' },
  TRANSITION: { label: 'TRANSITION', color: 'text-yellow-400', dot: 'bg-yellow-400 shadow-[0_0_6px_rgba(234,179,8,0.6)]' },
  BEAR: { label: 'BEAR PHASE', color: 'text-red-400', dot: 'bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.6)]' },
};

// 불변식 #6 — Provider 장애·데이터 부재를 market signal(BULL 등) 로 변환 금지.
// regime 이 known phase 가 아니면 회색 UNKNOWN 으로 정직 표시.
const UNKNOWN_PHASE_CONFIG = { label: 'REGIME UNKNOWN', color: 'text-theme-text-muted', dot: 'bg-theme-text-muted' };

function resolveConnectionState(input: {
  loadingReco: boolean;
  loadingMarket: boolean;
  isSyncing: boolean;
  recommendationCount: number;
  marketOverview?: { lastUpdated?: string } | null;
  recoUpdatedAt?: string | null;
}): ConnectionState {
  if (input.loadingReco || input.loadingMarket || input.isSyncing) return 'loading';
  const hasAny = input.recommendationCount > 0 || !!input.marketOverview;
  if (!hasAny) return 'idle';
  const ts = input.recoUpdatedAt
    ? new Date(input.recoUpdatedAt).getTime()
    : input.marketOverview?.lastUpdated ? new Date(input.marketOverview.lastUpdated).getTime() : NaN;
  if (!Number.isFinite(ts)) return 'live';
  return Date.now() - ts > 30 * 60 * 1000 ? 'stale' : 'live';
}

function getConnectionTitle(connState: ConnectionState): string | undefined {
  if (connState === 'stale') return '데이터가 30분 이상 갱신되지 않았습니다';
  if (connState === 'idle') return '아직 데이터를 불러오지 않았습니다';
  return undefined;
}

function getPhaseConfig(regime: string | null | undefined): { label: string; color: string; dot: string } {
  if (regime == null) return UNKNOWN_PHASE_CONFIG;
  return PHASE_CONFIG[regime as RegimePhase] ?? UNKNOWN_PHASE_CONFIG;
}

// 불변식 #6 — regime 미정 + cashWeightPct 부재면 null 반환(호출자가 '--' 로 렌더).
// 이전엔 regime 미정 시 무조건 10% 현금 = 90% 포지션 으로 단정 표시되어 데이터 부재를
// BULL 추천 신호로 변환하던 위반.
function getCashRatio(regime: string | null | undefined, cashWeightPct?: number): number | null {
  if (cashWeightPct != null) return cashWeightPct;
  if (regime === 'BEAR') return 50;
  if (regime === 'TRANSITION') return 30;
  if (regime === 'BULL') return 10;
  return null; // UNKNOWN / 미정 — 표시 보류
}

function getAverageScore(recommendations: Array<{ aiConvictionScore?: { totalScore?: number } }>): number {
  const scores = recommendations
    .map(r => r.aiConvictionScore?.totalScore)
    .filter((s): s is number => s != null);
  return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}

function getPositionColor(positionPct: number): string {
  if (positionPct >= 70) return 'text-green-400';
  if (positionPct >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

function getAverageScoreColor(avgScore: number): string {
  if (avgScore >= 80) return 'text-green-400';
  if (avgScore >= 60) return 'text-yellow-400';
  if (avgScore > 0) return 'text-red-400';
  return 'text-theme-text-muted';
}

export function StatusBanner() {
  const { recommendations, watchlist, loading: loadingReco, lastUpdated: recoUpdatedAt } = useRecommendationStore();
  const { tradeRecords } = useTradeStore();
  const { marketOverview, loadingMarket, syncStatus } = useMarketStore();
  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const marketNeutralResult = useGlobalIntelStore(s => s.marketNeutralResult);

  const recommendationRows = recommendations || [];
  const connState = resolveConnectionState({
    loadingReco,
    loadingMarket,
    isSyncing: syncStatus.isSyncing,
    recommendationCount: recommendationRows.length,
    marketOverview,
    recoUpdatedAt,
  });
  const connCfg = CONNECTION_CONFIG[connState];

  // 불변식 #6 — bearRegimeResult 부재(provider 장애·macro stale) 시 'BULL' 로 단정 금지.
  // null 그대로 흘려보내 UNKNOWN 표시 경로로 분기.
  const regime: string | null = bearRegimeResult?.regime ?? null;

  const phaseConfig = getPhaseConfig(regime);

  // Recommended position based on market neutral / regime
  const cashLeg = marketNeutralResult?.legs?.find(l => l.type === 'CASH');
  const cashRatio = getCashRatio(regime, cashLeg?.weightPct);
  const positionPct = cashRatio == null ? null : 100 - cashRatio;

  // Counts
  const watchlistCount = (watchlist || []).length;
  const openTrades = tradeRecords.filter(t => t.status === 'OPEN').length;

  const avgScore = getAverageScore(recommendationRows);

  return (
    <div className="neo-status-banner no-print" role="banner">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-11 flex items-center gap-2 sm:gap-4 overflow-x-auto no-scrollbar">
        {/* Connection / Data Freshness */}
        <div
          className="flex items-center gap-1.5 shrink-0"
          title={connState === 'stale' ? '데이터가 30분 이상 갱신되지 않았습니다.' : connState === 'idle' ? '아직 데이터를 불러오지 않았습니다.' : undefined}
          role="status"
          aria-label={`데이터 연결 ${connCfg.label}`}
        >
          <span className={cn('w-2 h-2 rounded-full', connCfg.dot)} />
          <span className={cn('flex items-center gap-1 text-[11px] font-black tracking-tight font-num', connCfg.color)}>
            {connCfg.icon}
            {connCfg.label}
          </span>
        </div>

        <Separator />

        {/* Market Phase */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('w-2 h-2 rounded-full', phaseConfig.dot)} />
          <span className={cn('text-[11px] font-black tracking-tight font-num', phaseConfig.color)}>
            {phaseConfig.label}
          </span>
        </div>

        <Separator />

        {/* Recommended Position — 불변식 #6: regime UNKNOWN 이면 '--' 로 보류, 색상 muted. */}
        <div
          className="flex items-center gap-1.5 shrink-0"
          title={positionPct == null ? 'Regime 미정 — 추천 포지션 계산 보류' : undefined}
        >
          <Target className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted tracking-tight hidden sm:inline">포지션</span>
          <span className={cn(
            'text-[11px] font-black font-num',
            positionPct == null ? 'text-theme-text-muted' : getPositionColor(positionPct)
          )}>
            {positionPct == null ? '--' : `${positionPct}%`}
          </span>
        </div>

        <Separator />

        {/* Gate Average */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Zap className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted tracking-tight hidden sm:inline">Gate</span>
          <span className={cn(
            'text-[11px] font-black font-num',
            getAverageScoreColor(avgScore)
          )}>
            {avgScore > 0 ? avgScore : '--'}
          </span>
        </div>

        <Separator />

        {/* Watchlist Count */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Eye className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted tracking-tight hidden sm:inline">감시</span>
          <span className="text-[11px] font-black text-blue-400 font-num">{watchlistCount}개</span>
        </div>

        <Separator />

        {/* Open Trades */}
        <div className="flex items-center gap-1.5 shrink-0">
          <TrendingUp className="w-3 h-3 text-theme-text-muted" />
          <span className="text-[10px] font-black text-theme-text-muted tracking-tight hidden sm:inline">보유</span>
          <span className="text-[11px] font-black text-orange-400 font-num">{openTrades}건</span>
        </div>

        {/* Candidate decision count - desktop */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-auto">
          <Activity className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] font-black text-violet-400 tracking-tight">
            시스템 후보 {(recommendations || []).length}건
          </span>
        </div>
      </div>
    </div>
  );
}

function Separator() {
  return <div className="w-px h-4 bg-white/10 shrink-0" />;
}
