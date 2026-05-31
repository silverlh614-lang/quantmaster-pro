// @responsibility watchlist area stock recommendation card UI.
import React from 'react';
import {
  TrendingUp, TrendingDown, Bookmark, Star, Award, History, Plus, Zap,
  AlertTriangle, Copy, FileText, Search, ExternalLink, Flame, Target,
  ShieldCheck, Clock, Newspaper, BarChart3, Crown, Activity, Cloud,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { DataQualityBadge } from '../common/DataQualityBadge';
import { PriceAlertBadge } from '../common/PriceAlertBadge';
import { GateStatusCard, buildGateCardSummary } from './GateStatusCard';
import { GateMiniIndicator } from './GateMiniIndicator';
import { LastTriggerCard } from './LastTriggerCard';
import { EnemyChecklistCard } from './EnemyChecklistCard';
import { classifyDataQuality } from '../../utils/dataQualityClassifier';
import { computePriceAlertLevel } from '../../utils/priceAlertLevel';
import { evaluateLastTrigger } from '../../utils/lastTriggerStatus';
import { evaluateEnemyChecklist } from '../../utils/enemyChecklistFlag';
import { useGlobalIntelStore } from '../../stores';
import { SignalBadge } from '../../ui/badge';
import { PriceEditCell } from '../common/PriceEditCell';
import { usePriceCanon } from '../../hooks/usePriceCanon';
import { computeTranchePlan } from '../../utils/priceStrategy';
import { TrancheBreakdown } from '../common/TrancheBreakdown';
import { isMarketOpenFor, nextOpenAtFor, formatNextOpenKst } from '../../utils/marketTime';
import { useMarketMode } from '../../hooks/useMarketMode';
import { useUIVerbosity } from '../../hooks/useUIVerbosity';
import type { StockRecommendation } from '../../services/stockService';
import type { NewsFrequencyScore } from '../../types/quant';
import type { View } from '../../stores/useSettingsStore';
import { buildShadowTrade } from '../../services/autoTrading';
import { classifyScoreConcordance, getQuantGateScore } from '../../utils/recommendationScore';
import { buildStockAnalysisCanon } from '../../services/stock/stockAnalysisCanon';
import { buildCandidateDecisionCardModel } from '../../candidate-decision/candidateDecisionModel';
import { CandidateDecisionCard } from './CandidateDecisionCard';

export interface WatchlistCardProps {
  stock: StockRecommendation;
  idx: number;
  view: string;
  lastUsedMode: string;
  isWatched: (code: string) => boolean;
  copiedCode: string | null;
  onCopy: (name: string, code: string) => void;
  newsFrequencyScores: NewsFrequencyScore[];
  dartAlerts: { corp_name: string; stock_code: string; report_nm: string; rcept_dt: string; sentiment: string }[];
  syncingStock: string | null;
  kisBalance: number;
  onDeepAnalysis: (stock: StockRecommendation) => void;
  onDetailStock: (stock: StockRecommendation) => void;
  onToggleWatchlist: (stock: StockRecommendation) => void;
  onAddToBacktest: (stock: StockRecommendation) => void;
  onSetTradeRecord: (stock: StockRecommendation) => void;
  onAddShadowTrade: (trade: any) => void;
  onSetView: (view: View) => void;
  onSyncPrice: (stock: StockRecommendation) => Promise<StockRecommendation | null>;
  onManualPriceUpdate: (stock: StockRecommendation, newPrice: number) => void;
}

type MarketMode = ReturnType<typeof useMarketMode>;
type LastTriggerSummary = ReturnType<typeof evaluateLastTrigger>;
type EnemyChecklistSummary = ReturnType<typeof evaluateEnemyChecklist>;
type QuantGateScore = ReturnType<typeof getQuantGateScore>;
type ScoreConcordance = ReturnType<typeof classifyScoreConcordance>;

const cardToneClass = (stock: StockRecommendation, isAllGatesPassed: boolean): string => {
  if (isRiskAlert(stock)) return '!border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.15)]';
  if (isAllGatesPassed) return '!border-yellow-400/60 shadow-[0_0_40px_rgba(250,204,21,0.2)]';
  return 'shadow-[0_10px_30px_rgba(0,0,0,0.4)]';
};

const isAllGatesPassedFor = (stock: StockRecommendation): boolean =>
  stock.gateEvaluation?.isPassed === true ||
  (stock.gateEvaluation?.gate1Passed === true &&
    stock.gateEvaluation?.gate2Passed === true &&
    stock.gateEvaluation?.gate3Passed === true);

const drawdownPct = (stock: StockRecommendation): number =>
  stock.peakPrice > 0 ? Math.round((stock.currentPrice / stock.peakPrice - 1) * 100) : 0;

const isRiskAlert = (stock: StockRecommendation): boolean =>
  stock.peakPrice > 0 && drawdownPct(stock) <= -30;

const matchingDartAlerts = (
  stock: StockRecommendation,
  dartAlerts: WatchlistCardProps['dartAlerts'],
) => dartAlerts.filter((alert) => alert.stock_code.replace(/^A/, '') === stock.code);

const naverChartHref = (stock: StockRecommendation): string => {
  const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
  return cleanCode.length === 6
    ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
    : `https://search.naver.com/search.naver?query=${encodeURIComponent(`${stock.name} stock chart`)}`;
};

const formatKrw = (value: number | undefined, fallback = '-'): string =>
  value && value > 0 ? `₩${value.toLocaleString()}` : fallback;

const buildCardShadowTrade = (
  stock: StockRecommendation,
  kisBalance: number,
) => {
  const price = stock.currentPrice || stock.entryPrice || 0;
  const ge = stock.gateEvaluation;
  const positionSize = ge?.positionSize ?? (stock.type === 'STRONG_BUY' ? 20 : 10);
  const stopLossPct = price > 0 && stock.stopLoss > 0
    ? ((stock.stopLoss - price) / price) * 100
    : -8;
  const rrr = price > 0 && stock.stopLoss > 0 && stock.targetPrice > 0
    ? (stock.targetPrice - price) / (price - stock.stopLoss)
    : 2;
  const signal = {
    positionSize,
    rrr: Math.max(0.5, rrr),
    lastTrigger: stock.type === 'STRONG_BUY',
    recommendation: ge?.recommendation ?? (stock.type === 'STRONG_BUY' ? 'strong shadow' : 'shadow'),
    profile: { stopLoss: Math.min(-1, stopLossPct) },
  } as any;
  return buildShadowTrade(signal, stock.code, stock.name, price, kisBalance);
};

const modeBadgeMeta = (lastUsedMode: string) => {
  if (lastUsedMode === 'EARLY_DETECT') {
    return { label: 'Early', icon: Activity, className: 'bg-blue-500/20 border-blue-500/30 text-blue-400' };
  }
  if (lastUsedMode === 'MOMENTUM') {
    return { label: 'Momentum', icon: Zap, className: 'bg-orange-500/20 border-orange-500/30 text-orange-400' };
  }
  if (lastUsedMode === 'QUANT_SCREEN') {
    return { label: 'Quant', icon: Activity, className: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' };
  }
  return null;
};

const marketVariant = (stock: StockRecommendation, marketMode: MarketMode) => {
  const open = isMarketOpenFor(stock.code);
  let nextOpenLabel = '';
  try {
    nextOpenLabel = formatNextOpenKst(nextOpenAtFor(stock.code));
  } catch {
    nextOpenLabel = 'N/A';
  }
  if (open) return { label: 'LIVE', tone: 'orange', title: 'Regular-session live price' };
  if (marketMode === 'WEEKEND_CACHE') return { label: 'Weekend', tone: 'gray', title: `Next open ${nextOpenLabel}` };
  if (marketMode === 'HOLIDAY_CACHE') return { label: 'Holiday', tone: 'gray', title: `Next open ${nextOpenLabel}` };
  if (marketMode === 'DEGRADED') return { label: 'Degraded', tone: 'red', title: 'Price source degraded' };
  return { label: 'Closed', tone: 'blue', title: `Next open ${nextOpenLabel}` };
};

const toneClasses = (tone: string) => ({
  wrapper: tone === 'orange'
    ? 'bg-orange-500/10 border-orange-500/20 group-hover:bg-orange-500/20'
    : tone === 'blue'
      ? 'bg-blue-500/10 border-blue-500/20 group-hover:bg-blue-500/15'
      : tone === 'gray'
        ? 'bg-slate-500/10 border-slate-500/20 group-hover:bg-slate-500/15'
        : 'bg-red-500/10 border-red-500/30 group-hover:bg-red-500/15',
  dot: tone === 'orange'
    ? 'bg-orange-500 animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.8)]'
    : tone === 'blue'
      ? 'bg-blue-400/80'
      : tone === 'gray'
        ? 'bg-slate-400/80'
        : 'bg-red-400/80',
  text: tone === 'orange'
    ? 'text-orange-500'
    : tone === 'blue'
      ? 'text-blue-300'
      : tone === 'gray'
        ? 'text-slate-300'
        : 'text-red-300',
});

const TopBanners = ({
  stock,
  view,
  isAllGatesPassed,
}: {
  stock: StockRecommendation;
  view: string;
  isAllGatesPassed: boolean;
}) => (
  <>
    {isAllGatesPassed && (
      <div className="bg-gradient-to-r from-yellow-500/90 to-amber-400/90 backdrop-blur-md text-[10px] font-black text-black py-2 px-4 flex items-center justify-center gap-2 z-20 tracking-tight">
        <Crown className="w-3.5 h-3.5" />
        BEST · All Gates Passed
      </div>
    )}
    {view === 'WATCHLIST' && stock.watchedPrice && stock.watchedPrice > 0 && (
      <WatchedPriceBanner stock={stock} />
    )}
    {isRiskAlert(stock) && (
      <div className="bg-red-500/90 backdrop-blur-md text-[10px] font-black text-white py-2 px-4 flex items-center justify-center gap-2 z-20 animate-pulse tracking-tight">
        <AlertTriangle className="w-3.5 h-3.5" />
        Risk Alert: -30% Rule Exceeded
      </div>
    )}
  </>
);

const WatchedPriceBanner = ({ stock }: { stock: StockRecommendation }) => {
  const diff = stock.currentPrice - (stock.watchedPrice ?? 0);
  const pct = stock.watchedPrice ? (diff / stock.watchedPrice) * 100 : 0;
  const isUp = diff >= 0;
  return (
    <div className={cn(
      'flex items-center justify-between px-5 py-3 text-[11px] font-semibold tracking-tight',
      isUp ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400',
    )}>
      <div className="flex items-center gap-2">
        {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
        <span>Since Added</span>
        <span className="text-base font-black">{isUp ? '+' : ''}{pct.toFixed(2)}%</span>
      </div>
      <div className="flex flex-col items-end text-[9px] opacity-60">
        <span>Added ₩{stock.watchedPrice?.toLocaleString()}</span>
        <span>{stock.watchedAt}</span>
      </div>
    </div>
  );
};

const FloatingBadges = ({
  stock,
  lastUsedMode,
  newsFrequencyScores,
}: {
  stock: StockRecommendation;
  lastUsedMode: string;
  newsFrequencyScores: NewsFrequencyScore[];
}) => {
  const mode = modeBadgeMeta(lastUsedMode);
  const news = newsFrequencyScores.find((score) => score.code === stock.code);
  const phaseColors: Record<string, string> = {
    SILENT: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    EARLY: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
    GROWING: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
    CROWDED: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
    OVERHYPED: 'bg-red-500/20 border-red-500/30 text-red-400',
  };
  return (
    <>
      {mode && (
        <div className={cn('absolute top-3 left-3 z-10 flex items-center gap-1 border px-2 py-1 rounded-lg backdrop-blur-sm', mode.className)}>
          <mode.icon className="w-2.5 h-2.5" />
          <span className="text-[9px] font-semibold tracking-tight">{mode.label}</span>
        </div>
      )}
      {news && (
        <div className={cn('absolute top-3 right-3 z-10 flex items-center gap-1 border px-2 py-1 rounded-lg backdrop-blur-sm', phaseColors[news.phase] || '')}>
          <Newspaper className="w-2.5 h-2.5" />
          <span className="text-[9px] font-semibold tracking-tight">News {news.phase} ({news.score})</span>
        </div>
      )}
    </>
  );
};

const HeaderSection = ({
  stock,
  copiedCode,
  dartAlerts,
  isAllGatesPassed,
  quantGateScore,
  concordance,
  onCopy,
  onDeepAnalysis,
}: {
  stock: StockRecommendation;
  copiedCode: string | null;
  dartAlerts: WatchlistCardProps['dartAlerts'];
  isAllGatesPassed: boolean;
  quantGateScore: QuantGateScore;
  concordance: ScoreConcordance | null;
  onCopy: WatchlistCardProps['onCopy'];
  onDeepAnalysis: WatchlistCardProps['onDeepAnalysis'];
}) => (
  <div className="flex flex-col mb-4 sm:mb-6 gap-3 min-w-0">
    <StockIdentityPanel
      stock={stock}
      copiedCode={copiedCode}
      dartAlerts={dartAlerts}
      isAllGatesPassed={isAllGatesPassed}
      quantGateScore={quantGateScore}
      concordance={concordance}
      onCopy={onCopy}
    />
    <button
      onClick={(event) => {
        event.stopPropagation();
        onDeepAnalysis(stock);
      }}
      className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/50 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black text-orange-500 transition-all tracking-tight active:scale-[0.98] shadow-[0_0_20px_rgba(249,115,22,0.05)] hover:shadow-[0_0_25px_rgba(249,115,22,0.15)] group/deep"
    >
      <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover/deep:scale-110 transition-transform" />
      Deep Analysis
    </button>
  </div>
);

const StockIdentityPanel = ({
  stock,
  copiedCode,
  dartAlerts,
  isAllGatesPassed,
  quantGateScore,
  concordance,
  onCopy,
}: {
  stock: StockRecommendation;
  copiedCode: string | null;
  dartAlerts: WatchlistCardProps['dartAlerts'];
  isAllGatesPassed: boolean;
  quantGateScore: QuantGateScore;
  concordance: ScoreConcordance | null;
  onCopy: WatchlistCardProps['onCopy'];
}) => {
  const alerts = matchingDartAlerts(stock, dartAlerts);
  // Gate 점수(통과 비율)는 AI 충족으로 부풀 수 있어, 실데이터 검증 비율을 함께 표기(정본).
  const { verifiedPassCount, metCount } = buildStockAnalysisCanon(stock);
  return (
    <div className="relative p-4 sm:p-6 bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden group/name-area shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]">
      <div className="absolute -top-12 -left-12 w-40 h-40 bg-orange-500/5 blur-[80px] rounded-full group-hover/name-area:bg-orange-500/15 transition-all duration-700" />
      <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-blue-500/5 blur-[80px] rounded-full group-hover/name-area:bg-blue-500/15 transition-all duration-700" />
      <div className="relative flex flex-col min-w-0">
        <div className="flex items-start justify-between gap-2 sm:gap-3 min-w-0 mb-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <div className="relative group/copy min-w-0">
              <h4
                onClick={(event) => {
                  event.stopPropagation();
                  onCopy(stock.name, stock.code);
                }}
                className="text-lg sm:text-2xl lg:text-3xl font-black tracking-tighter text-white group-hover:text-orange-500 transition-all duration-300 leading-tight cursor-pointer flex items-center gap-2 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] break-keep"
                title="Copy stock name"
              >
                {stock.name}
                <Copy className="w-4 h-4 opacity-0 group-hover/copy:opacity-50 transition-opacity shrink-0" />
              </h4>
              <AnimatePresence>
                {copiedCode === stock.code && (
                  <motion.span
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute -top-10 left-0 text-[10px] font-black text-green-400 tracking-tight bg-green-500/20 backdrop-blur-md px-2 py-1 rounded-lg border border-green-500/30 z-30"
                  >
                    Copied!
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <span className="text-[10px] sm:text-[12px] font-black text-white/60 bg-white/10 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl border border-white/20 tracking-[0.15em] uppercase shrink-0 shadow-lg backdrop-blur-sm">
              {stock.code}
            </span>
            {alerts.length > 0 && (
              <div
                className="px-2 py-1 rounded-full text-[9px] font-semibold tracking-tight border bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-lg backdrop-blur-md flex items-center gap-1 shrink-0"
                title={alerts.map((alert) => alert.report_nm).join(', ')}
              >
                <FileText className="w-3 h-3" />
                DART
              </div>
            )}
            {stock.gate && (
              <div className={cn(
                'px-3 py-1 rounded-full text-[9px] font-semibold tracking-tight border shadow-lg backdrop-blur-md shrink-0',
                stock.gate === 1 ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                  stock.gate === 2 ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                    'bg-green-500/20 text-green-400 border-green-500/30',
              )}>
                Gate {stock.gate}
              </div>
            )}
            {isAllGatesPassed && (
              <div className="flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-semibold tracking-tight border shadow-lg backdrop-blur-md shrink-0 bg-yellow-400/20 text-yellow-400 border-yellow-400/40">
                <Crown className="w-3 h-3" />
                BEST
              </div>
            )}
            <div className="shrink-0">
              <GateMiniIndicator stock={stock} />
            </div>
          </div>
          <AiScoreBlock stock={stock} concordance={concordance} />
        </div>
        {stock.aiConvictionScore && (
          <div className="mt-2 text-[10px] text-orange-300/60">
            모델 점수는 진단용이며 자동매매 트리거가 아닙니다.
          </div>
        )}
        {quantGateScore && (
          <div className={cn(
            'mt-2 rounded-xl border px-3 py-2 text-[11px] font-bold',
            quantGateScore.pass
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/20 bg-red-500/10 text-red-200',
          )}>
            모델 점수 {stock.aiConvictionScore?.totalScore ?? '-'} | Gate {quantGateScore.value.toFixed(1)}/10{' '}
            <span className="text-white/55">· 검증 {verifiedPassCount}/{metCount}</span>{' '}
            {quantGateScore.pass ? '자동매매 가능' : '자동매매 차단'}{' '}
            ({quantGateScore.regime.replace(/_.+$/, '')} 기준 {quantGateScore.threshold}
            {quantGateScore.pass ? '' : ' 미달'})
          </div>
        )}
        {stock.chartPattern && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-2 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 backdrop-blur-md">
              <TrendingUp className={cn('w-3.5 h-3.5', (stock.chartPattern.type || '').includes('BULLISH') ? 'text-green-400' : 'text-red-400')} />
              <span className="text-[10px] sm:text-[11px] font-black text-blue-400 tracking-tight">
                Pattern: {stock.chartPattern.name}
              </span>
            </div>
          </div>
        )}
        {stock.visualReport?.summary && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-2 bg-orange-500/10 px-3 py-1 rounded-full border border-orange-500/20 backdrop-blur-md">
              <Zap className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
              <span className="text-[10px] sm:text-[11px] font-black text-orange-400 tracking-tight break-keep">{stock.visualReport.summary}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AiScoreBlock = ({
  stock,
  concordance,
}: {
  stock: StockRecommendation;
  concordance: ScoreConcordance | null;
}) => (
  <>
    {stock.aiConvictionScore && (
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[9px] font-black text-white/30 tracking-tight mb-0.5">Model Score</span>
        <span className={cn(
          'text-lg sm:text-xl font-black tracking-tighter font-num',
          stock.aiConvictionScore.totalScore >= 80 ? 'text-orange-500' :
            stock.aiConvictionScore.totalScore >= 60 ? 'text-blue-400' : 'text-white/60',
        )}>
          {stock.aiConvictionScore.totalScore}
        </span>
        {concordance && (
          <span className={cn(
            'mt-1 rounded-full border px-2 py-0.5 text-[8px] font-black tracking-widest',
            concordance.tier === 'EXCELLENT' || concordance.tier === 'GOOD'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : concordance.tier === 'NEUTRAL'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300',
          )}>
            {concordance.tier === 'WEAK' || concordance.tier === 'POOR' ? '!' : ''}{concordance.label}
          </span>
        )}
      </div>
    )}
  </>
);

const AiFactorBar = ({ stock }: { stock: StockRecommendation }) => {
  const factors = stock.aiConvictionScore?.factors || [];
  const total = stock.aiConvictionScore?.totalScore ?? 0;
  const g1Count = Math.max(1, Math.ceil(factors.length / 3));
  const g2Count = Math.max(1, Math.ceil(factors.length / 3));
  // factor.score 는 0~100 척도 → 게이트별 평균(0~100)으로 표시. 과거 ×10 가정이 "94/10"
  // 처럼 분모를 깨뜨렸던 버그 수정 (분자 0~100 vs 분모 10 불일치).
  const avgScore = (arr: typeof factors) =>
    arr.length ? Math.round(arr.reduce((sum, factor) => sum + factor.score, 0) / arr.length) : 0;
  const g1 = avgScore(factors.slice(0, g1Count));
  const g2 = avgScore(factors.slice(g1Count, g1Count + g2Count));
  const g3 = avgScore(factors.slice(g1Count + g2Count));
  const g1Max = 100;
  const g2Max = 100;
  const g3Max = 100;
  return (
    <>
      {stock.aiConvictionScore && (
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-black text-white/30 tracking-tight">판단 합치도</span>
            <span className="text-[11px] font-black text-white/70 font-num">{total}/100</span>
          </div>
          <div className="gate-bar">
            <div className="gate-bar-g1 rounded-l-full" style={{ width: `${Math.min((g1 / g1Max) * 33.3, 33.3)}%` }} title={`G1: ${g1}/${g1Max}`} />
            <div className="gate-bar-g2" style={{ width: `${Math.min((g2 / g2Max) * 33.3, 33.3)}%` }} title={`G2: ${g2}/${g2Max}`} />
            <div className="gate-bar-g3 rounded-r-full" style={{ width: `${Math.min((g3 / g3Max) * 33.4, 33.4)}%` }} title={`G3: ${g3}/${g3Max}`} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[8px] font-black font-num" style={{ color: 'var(--gate-1)' }}>G1 {g1}/{g1Max}</span>
            <span className="text-[8px] font-black font-num" style={{ color: 'var(--gate-2)' }}>G2 {g2}/{g2Max}</span>
            <span className="text-[8px] font-black font-num" style={{ color: 'var(--gate-3)' }}>G3 {g3}/{g3Max}</span>
          </div>
        </div>
      )}
    </>
  );
};

const SignalAndActions = ({
  stock,
  kisBalance,
  isWatched,
  onAddToBacktest,
  onToggleWatchlist,
  onSetTradeRecord,
  onAddShadowTrade,
  onSetView,
}: Pick<WatchlistCardProps, 'stock' | 'kisBalance' | 'isWatched' | 'onAddToBacktest' | 'onToggleWatchlist' | 'onSetTradeRecord' | 'onAddShadowTrade' | 'onSetView'>) => (
  <div className="flex justify-between items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
    <div className="flex flex-wrap gap-2 sm:gap-3 items-center min-w-0">
      <SignalBadge signal={stock.type || 'NEUTRAL'} />
      {stock.isLeadingSector && (
        <span className="bg-orange-500 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full tracking-tight shadow-[0_4px_15px_rgba(249,115,22,0.4)] flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap">
          <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
          Leading
        </span>
      )}
      {stock.isSectorTopPick && (
        <span className="bg-blue-500 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full tracking-tight shadow-[0_4px_15px_rgba(59,130,246,0.4)] flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap">
          <Award className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
          Top Pick
        </span>
      )}
      <span className="text-[9px] sm:text-[10px] font-black text-white/50 bg-white/10 px-2.5 py-1 rounded-full border border-white/10 tracking-tight backdrop-blur-md truncate max-w-[100px] sm:max-w-none">
        {stock.relatedSectors?.[0] || 'Market'}
      </span>
    </div>
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
      <button onClick={(event) => { event.stopPropagation(); onAddToBacktest(stock); }} className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 active:scale-90 shadow-sm" title="Add to Backtest">
        <History className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
      </button>
      <button onClick={(event) => { event.stopPropagation(); onToggleWatchlist(stock); }} className={cn('p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border active:scale-90 shadow-sm', isWatched(stock.code) ? 'bg-orange-500 text-white border-orange-400 shadow-[0_8px_20px_rgba(249,115,22,0.4)]' : 'bg-white/5 border-white/10 text-white/30 hover:text-white/70 hover:bg-white/10')}>
        <Bookmark className={cn('w-4 h-4 sm:w-4.5 sm:h-4.5', isWatched(stock.code) && 'fill-current')} />
      </button>
      <button onClick={(event) => { event.stopPropagation(); onSetTradeRecord(stock); }} className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/5 active:scale-90 shadow-sm" title="Trade record">
        <Plus className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
      </button>
      {(stock.type === 'STRONG_BUY' || stock.type === 'BUY') && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onAddShadowTrade(buildCardShadowTrade(stock, kisBalance));
            onSetView('AUTO_TRADE');
          }}
          className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 active:scale-90 shadow-sm"
          title="Register Shadow Trade"
        >
          <Zap className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
        </button>
      )}
    </div>
  </div>
);

const DiagnosticsSection = ({
  stock,
  lastTriggerSummary,
  enemyChecklistSummary,
  onDeepAnalysis,
}: {
  stock: StockRecommendation;
  lastTriggerSummary: LastTriggerSummary;
  enemyChecklistSummary: EnemyChecklistSummary;
  onDeepAnalysis: WatchlistCardProps['onDeepAnalysis'];
}) => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 sm:gap-3 mb-4 items-start">
      <div className="flex items-center gap-2 flex-wrap">
        <DataQualityBadge count={classifyDataQuality(stock)} compact />
        {stock.dataSourceType && <ConfidenceBadge type={stock.dataSourceType} />}
        <PriceAlertBadge
          level={computePriceAlertLevel({ currentPrice: stock.currentPrice, stopLoss: stock.stopLoss, targetPrice: stock.targetPrice })}
          currentPrice={stock.currentPrice}
          stopLoss={stock.stopLoss}
          targetPrice={stock.targetPrice}
        />
      </div>
      <GateStatusCard summary={buildGateCardSummary(stock)} onExpand={() => onDeepAnalysis(stock)} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-4">
      <LastTriggerCard summary={lastTriggerSummary} />
      <EnemyChecklistCard summary={enemyChecklistSummary} />
    </div>
  </>
);

const ExternalLinksAndPlan = ({ stock }: { stock: StockRecommendation }) => (
  <>
    <div className="flex items-center justify-between mb-6 sm:mb-8 py-3 sm:py-4 border-y border-white/5 bg-white/[0.02] rounded-xl sm:rounded-2xl px-3 sm:px-4">
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500 shrink-0" />
        <div className="flex gap-0.5 sm:gap-1 overflow-hidden">
          {[...Array(10)].map((_, index) => (
            <div key={index} className={cn('w-1 sm:w-1.5 h-3 sm:h-4 rounded-full transition-all duration-500 shrink-0', index < (stock.hotness ?? 0) ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.6)]' : 'bg-white/10')} />
          ))}
        </div>
        <span className="text-[9px] sm:text-[11px] font-black text-white/40 ml-1 sm:ml-2 tracking-widest uppercase truncate">Heat</span>
      </div>
      <a href={naverChartHref(stock)} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="flex items-center gap-1.5 sm:gap-2.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-white/5 hover:bg-orange-500 hover:text-white border border-white/10 rounded-lg sm:rounded-xl transition-all group/link shadow-sm active:scale-95">
        <span className="text-[8px] sm:text-[10px] font-semibold tracking-tight">Chart</span>
        <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
      </a>
    </div>
    {stock.tranchePlan && (
      <div className="mb-6 sm:mb-8 bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10 shadow-inner">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-orange-500" />
          <span className="text-[10px] font-black text-orange-500 tracking-tight">Automated Tranche Plan</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: '1', data: stock.tranchePlan.tranche1 },
            { id: '2', data: stock.tranchePlan.tranche2 },
            { id: '3', data: stock.tranchePlan.tranche3 },
          ].map((tranche) => (
            <div key={tranche.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-black text-white/20 tracking-tight">T{tranche.id}</span>
                <span className="text-[9px] font-black text-orange-500/70">{tranche.data?.size || 0}%</span>
              </div>
              <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                <div className="text-[9px] font-black text-white/60 truncate" title={tranche.data?.trigger || ''}>
                  {tranche.data?.trigger ? tranche.data.trigger.split(' (')[0] : '-'}
                </div>
                <div className="text-[7px] font-bold text-white/20 uppercase tracking-tighter truncate">
                  {tranche.data?.trigger?.includes('(') ? tranche.data.trigger.split('(')[1].replace(')', '') : 'Trigger'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </>
);

const TechnicalHealthGrid = ({ stock }: { stock: StockRecommendation }) => {
  const items = [
    {
      label: 'Conf.',
      icon: Zap,
      value: `${stock.confidenceScore}%`,
      active: !!stock.confidenceScore && stock.confidenceScore >= 90,
      activeClass: 'bg-green-500/10 border-green-500/20 text-green-400',
      iconActiveClass: 'text-green-400 fill-current',
    },
    {
      label: 'Mom.',
      icon: TrendingUp,
      value: `${stock.momentumRank}%`,
      active: !!stock.momentumRank && stock.momentumRank <= 5,
      activeClass: 'bg-red-500/10 border-red-500/20 text-red-400',
      iconActiveClass: 'text-red-400',
    },
    {
      label: 'Ichi.',
      icon: Cloud,
      value: stock.ichimokuStatus?.split('_')[0] || 'N/A',
      active: stock.ichimokuStatus === 'ABOVE_CLOUD',
      activeClass: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
      iconActiveClass: 'text-blue-400',
    },
    {
      label: 'Sector',
      icon: Crown,
      value: stock.isLeadingSector ? 'LEAD' : 'MAIN',
      active: !!stock.isLeadingSector,
      activeClass: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
      iconActiveClass: 'text-orange-400',
    },
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-6 sm:mb-8">
      {items.map((item) => (
        <div key={item.label} className={cn('rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16', item.active ? item.activeClass : 'bg-white/5 border-white/5')}>
          <span className="text-[6px] sm:text-[7px] font-black text-white/20 tracking-tight truncate w-full text-center">{item.label}</span>
          <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
            <item.icon className={cn('w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0', item.active ? item.iconActiveClass : 'text-white/20')} />
            <span className={cn('text-[9px] sm:text-[10px] font-black tracking-tighter truncate', item.active ? 'text-inherit' : 'text-white/70')}>{item.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

const PriceStrategySection = ({
  stock,
  marketMode,
  syncingStock,
  onManualPriceUpdate,
  onSyncPrice,
}: Pick<WatchlistCardProps, 'stock' | 'syncingStock' | 'onManualPriceUpdate' | 'onSyncPrice'> & { marketMode: MarketMode }) => {
  const variant = marketVariant(stock, marketMode);
  const tone = toneClasses(variant.tone);
  // 현재가 정본(SSOT) — Naver-first. stock.currentPrice(stale L4/이전 동기화) 직접 표시를
  // 끊어, 차트·상세 헤더와 같은 가격을 쓰게 한다 (하부 가격 전략 ≠ 현재가 불일치 수정).
  const { price: canonPrice } = usePriceCanon(stock.code, {
    fallbackPrice: stock.dataSourceType === 'REALTIME' ? stock.currentPrice : undefined,
    fallbackSource: 'REALTIME',
  });
  const displayPrice = canonPrice ?? stock.currentPrice;
  // 가격 전략 정본 — regime 가중 분할매수(눌림목). 1·2·3차 진입 + 시장 regime 가중 비중.
  // 검색 카드·deep-analysis·StockDetailModal 이 같은 헬퍼를 써 동일 값 표시.
  const tranchePlan = computeTranchePlan(
    displayPrice, stock.technicalSignals?.disparity20, stock.aiConvictionScore?.marketPhase,
    stock.entryPrice ?? 0, stock.targetPrice ?? 0, stock.stopLoss ?? 0,
  );
  const entryShown = tranchePlan?.avgEntry ?? stock.entryPrice ?? 0;
  const targetShown = tranchePlan?.target ?? stock.targetPrice ?? 0;
  const stopShown = tranchePlan?.stop ?? stock.stopLoss ?? 0;
  const isMultiTranche = tranchePlan?.multiTranche ?? false;
  return (
    <div className="bg-white/[0.03] border-y border-white/10 p-5 sm:p-8 py-5 sm:py-7 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-5 gap-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-orange-500 rounded-full" />
          <span className="text-[10px] sm:text-[11px] font-black text-white/30 tracking-tight sm:tracking-[0.25em]">가격 전략</span>
        </div>
        <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-1">
          <div className={cn('flex items-center gap-2 sm:gap-2.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl border shadow-[0_0_15px_rgba(249,115,22,0.1)] transition-all', tone.wrapper)} title={variant.title}>
            <div className="flex items-center gap-1.5 mr-1">
              <div className={cn('w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full', tone.dot)} />
              <span className={cn('text-[7px] sm:text-[8px] font-semibold tracking-tight', tone.text)}>{variant.label}</span>
            </div>
            <PriceEditCell stockCode={stock.code} currentPrice={displayPrice} syncingStock={syncingStock} onManualUpdate={(newPrice) => onManualPriceUpdate(stock, newPrice)} onSync={() => onSyncPrice(stock)} />
          </div>
          <div className="flex items-center gap-2 mt-1">
            {stock.priceUpdatedAt && (
              <span className="text-[7px] sm:text-[8px] font-black text-white/20 tracking-tight flex items-center gap-1">
                <Clock className="w-2 h-2" />
                {stock.priceUpdatedAt}
              </span>
            )}
            {stock.financialUpdatedAt && (
              <span className="text-[7px] sm:text-[8px] font-black text-blue-400/40 tracking-tight flex items-center gap-1">
                <ShieldCheck className="w-2 h-2" />
                DART: {stock.financialUpdatedAt}
              </span>
            )}
            <ConfidenceBadge type={stock.dataSourceType || 'AI'} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <PriceBox tone="blue" label={isMultiTranche ? '진입(평균)' : '진입'} primary={formatKrw(entryShown, displayPrice > 0 ? `₩${displayPrice.toLocaleString()}` : '-')} secondary={!isMultiTranche && stock.entryPrice2 && stock.entryPrice2 > 0 ? `2차 ₩${stock.entryPrice2.toLocaleString()}` : undefined} />
        <PriceBox tone="green" label="목표" primary={formatKrw(targetShown, displayPrice > 0 ? `₩${Math.round(displayPrice * 1.20).toLocaleString()}` : '-')} secondary={!isMultiTranche && stock.targetPrice2 && stock.targetPrice2 > 0 ? `2차 ₩${stock.targetPrice2.toLocaleString()}` : undefined} />
        <PriceBox tone="red" label="손절" primary={formatKrw(stopShown, displayPrice > 0 ? `₩${Math.round(displayPrice * 0.93).toLocaleString()}` : '-')} />
      </div>
      <TrancheBreakdown plan={tranchePlan} />
    </div>
  );
};

const PriceBox = ({
  tone,
  label,
  primary,
  secondary,
}: {
  tone: 'blue' | 'green' | 'red';
  label: string;
  primary: string;
  secondary?: string;
}) => {
  const classes = {
    blue: {
      box: 'bg-blue-500/5 border-blue-500/10 hover:bg-blue-500/10',
      label: 'text-blue-400/50',
      primary: 'text-white',
      secondary: 'text-blue-400/60',
    },
    green: {
      box: 'bg-green-500/5 border-green-500/10 hover:bg-green-500/10',
      label: 'text-green-400/50',
      primary: 'text-green-400',
      secondary: 'text-green-400/60',
    },
    red: {
      box: 'bg-red-500/5 border-red-500/10 hover:bg-red-500/10',
      label: 'text-red-400/50',
      primary: 'text-red-400',
      secondary: 'text-red-400/60',
    },
  }[tone];
  return (
    <div className={cn('rounded-2xl sm:rounded-3xl p-3 sm:p-5 border flex flex-col items-center justify-center gap-1.5 sm:gap-2 group/price transition-all shadow-sm min-w-0', classes.box)}>
      <span className={cn('text-[7px] sm:text-[9px] font-semibold tracking-tight truncate w-full text-center', classes.label)}>{label}</span>
      <span className={cn('text-xs sm:text-base font-black tracking-tighter truncate font-num', classes.primary)}>{primary}</span>
      {secondary && <span className={cn('text-[10px] sm:text-sm font-black tracking-tighter truncate', classes.secondary)}>{secondary}</span>}
    </div>
  );
};

const FooterInsights = ({ stock }: { stock: StockRecommendation }) => (
  <div className="p-5 sm:p-8 pt-5 sm:pt-7 flex-1 flex flex-col justify-between">
    <div className="space-y-6 sm:space-y-8">
      <InsightRow icon={ShieldCheck} tone="blue" title="Economic Moat" badge={stock.economicMoat?.type || 'NONE'} badgeActive={stock.economicMoat?.type !== 'NONE'} description={stock.economicMoat?.description} />
      <InsightRow icon={Zap} tone="yellow" title="Catalyst Analysis" badge={stock.checklist?.catalystAnalysis ? 'PASSED' : 'PENDING'} badgeActive={!!stock.checklist?.catalystAnalysis} description={stock.catalystDetail?.description || 'No catalyst memo yet.'} extra={stock.catalystSummary} />
      <ValuationRow stock={stock} />
      {stock.latestNews && stock.latestNews.length > 0 && <LatestNews stock={stock} />}
    </div>
  </div>
);

const InsightRow = ({
  icon: Icon,
  tone,
  title,
  badge,
  badgeActive,
  description,
  extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'blue' | 'yellow';
  title: string;
  badge: string;
  badgeActive: boolean;
  description?: string;
  extra?: string;
}) => (
  <div className="flex items-start gap-4 sm:gap-5">
    <div className={cn('w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl border flex items-center justify-center shrink-0 shadow-sm transition-all', tone === 'blue' ? 'bg-blue-500/10 border-blue-500/20' : 'bg-yellow-500/10 border-yellow-500/20')}>
      <Icon className={cn('w-5 h-5 sm:w-6 sm:h-6', tone === 'blue' ? 'text-blue-400' : 'text-yellow-400')} />
    </div>
    <div className="min-w-0 flex-1">
      <span className="text-[9px] sm:text-[10px] font-black text-white/20 tracking-tight sm:tracking-[0.2em] block mb-1.5 sm:mb-2">{title}</span>
      <div className="space-y-1.5 sm:space-y-2">
        <div className="flex items-center gap-2">
          <span className={cn('text-[9px] sm:text-[10px] font-black px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl shadow-sm inline-block', badgeActive ? (tone === 'blue' ? 'bg-blue-500 text-white' : 'bg-yellow-500 text-black') : 'bg-white/10 text-white/40')}>{badge}</span>
          {extra && <span className="text-[10px] sm:text-[11px] font-black text-yellow-400/80 truncate">{extra}</span>}
        </div>
        <p className="text-[11px] sm:text-[12px] text-white/50 font-bold italic leading-relaxed break-words">{description}</p>
      </div>
    </div>
  </div>
);

const ValuationRow = ({ stock }: { stock: StockRecommendation }) => {
  // P/E·P/B 정본 — stock.valuation(AI 채움·종목마다 누락) 우선, 없으면 Naver 스냅샷 fallback.
  // FundamentalsColumn(deep analysis)과 동일 소스 → 카드/상세 어느 경로든 같은 값 표시.
  const { per: naverPer, pbr: naverPbr } = usePriceCanon(stock.code);
  const per = stock.valuation?.per && stock.valuation.per > 0 ? stock.valuation.per : naverPer;
  const pbr = stock.valuation?.pbr && stock.valuation.pbr > 0 ? stock.valuation.pbr : naverPbr;
  return (
    <div className="flex items-start gap-4 sm:gap-5">
      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 shadow-sm">
        <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[9px] sm:text-[10px] font-black text-white/20 tracking-tight sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Valuation Matrix</span>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <ValuationCell label="P/E" value={per && per > 0 ? `${per.toFixed(1)}x` : 'N/A'} />
          <ValuationCell label="P/B" value={pbr && pbr > 0 ? `${pbr.toFixed(2)}x` : 'N/A'} />
          <ValuationCell label="EPS" value={`${(stock.valuation?.epsGrowth ?? 0) > 0 ? '+' : ''}${(stock.valuation?.epsGrowth ?? 0).toFixed(1)}%`} valueClass={(stock.valuation?.epsGrowth ?? 0) > 0 ? 'text-green-400' : (stock.valuation?.epsGrowth ?? 0) < 0 ? 'text-red-400' : 'text-white/50'} />
        </div>
      </div>
    </div>
  );
};

const ValuationCell = ({ label, value, valueClass = 'text-white/80' }: { label: string; value: string; valueClass?: string }) => (
  <div className="bg-white/5 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-white/5 shadow-inner min-w-0">
    <span className="text-[7px] sm:text-[9px] font-black text-white/10 uppercase block mb-0.5 sm:mb-1 tracking-tighter truncate">{label}</span>
    <span className={cn('text-xs sm:text-sm font-black truncate block font-num', valueClass)}>{value}</span>
  </div>
);

const LatestNews = ({ stock }: { stock: StockRecommendation }) => (
  <div className="flex items-start gap-4 sm:gap-5 group/news">
    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/news:bg-orange-500/20 transition-all">
      <Newspaper className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
    </div>
    <div className="min-w-0 flex-1">
      <span className="text-[9px] sm:text-[10px] font-black text-white/20 tracking-tight sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Latest News</span>
      <div className="space-y-2">
        {(stock.latestNews || []).slice(0, 5).map((news, index) => (
          <a key={index} href={`https://www.google.com/search?q=${encodeURIComponent(`${news.headline || ''} ${stock.name || ''}`)}`} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="flex flex-col gap-1 p-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-all group/news-item cursor-pointer">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] sm:text-[12px] font-bold text-white/80 group-hover/news-item:text-orange-400 transition-colors line-clamp-2 leading-tight">{news.headline}</span>
              <ExternalLink className="w-3 h-3 text-white/20 shrink-0" />
            </div>
            <span className="text-[9px] font-black text-white/20 tracking-tight">{news.date}</span>
          </a>
        ))}
      </div>
    </div>
  </div>
);

export function WatchlistCard({
  stock,
  idx,
  view,
  lastUsedMode,
  isWatched,
  copiedCode,
  onCopy,
  newsFrequencyScores,
  dartAlerts,
  syncingStock,
  kisBalance,
  onDeepAnalysis,
  onDetailStock,
  onToggleWatchlist,
  onAddToBacktest,
  onSetTradeRecord,
  onAddShadowTrade,
  onSetView,
  onSyncPrice,
  onManualPriceUpdate,
}: WatchlistCardProps) {
  const isAllGatesPassed = isAllGatesPassedFor(stock);
  const marketMode = useMarketMode();
  const verbosity = useUIVerbosity();
  const macroEnv = useGlobalIntelStore((state) => state.macroEnv);
  const recentPositiveDisclosure = dartAlerts.some(
    (alert) => alert.stock_code.replace(/^A/, '') === stock.code && alert.sentiment === 'POSITIVE',
  );
  const lastTriggerSummary = evaluateLastTrigger({ stock, vkospi: macroEnv?.vkospi, recentPositiveDisclosure });
  const enemyChecklistSummary = evaluateEnemyChecklist({ stock, marginBalance5dChange: undefined, weeklyRsi: undefined });
  const quantGateScore = getQuantGateScore(stock);
  // 점수/합치도는 분석 표시 정본(SSOT) 사용 — quantScore fallback 포함이라 gateEvaluation 부재
  // (검색 종목 등)에도 final score/합치도가 표시된다 (직전엔 null 이면 숨김).
  const concordance = buildStockAnalysisCanon(stock).concordance;
  const sourceSnapshotId = (stock as { sourceSnapshotId?: string; snapshotId?: string }).sourceSnapshotId
    ?? (stock as { sourceSnapshot?: { id?: string; sourceSnapshotId?: string } }).sourceSnapshot?.sourceSnapshotId
    ?? (stock as { sourceSnapshot?: { id?: string; sourceSnapshotId?: string } }).sourceSnapshot?.id
    ?? 'candidate-card-local';
  const candidateDecision = buildCandidateDecisionCardModel(stock, {
    sourceSnapshotId,
    asOf: stock.priceUpdatedAt ?? stock.financialUpdatedAt,
    engineMode: marketMode === 'DEGRADED' ? 'DEGRADED' : 'NORMAL',
    marketGateStatus: stock.aiConvictionScore?.marketPhase === 'BEAR' || stock.aiConvictionScore?.marketPhase === 'RISK_OFF' ? 'ORANGE' : 'YELLOW',
  });
  const candidateCardMode = verbosity.verbosity === 'minimal' ? 'simple' : 'pro';

  return (
    <motion.div
      key={stock.code}
      id={`stock-${stock.code}`}
      data-stock-code={stock.code}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: idx * 0.05 }}
      onClick={() => onDetailStock(stock)}
      className={cn(
        'glass-3d card-3d rounded-2xl sm:rounded-3xl p-0 transition-all duration-500 relative overflow-hidden flex flex-col h-full group border-theme-border hover:border-white/20 cursor-pointer',
        cardToneClass(stock, isAllGatesPassed),
      )}
    >
      <TopBanners stock={stock} view={view} isAllGatesPassed={isAllGatesPassed} />
      <FloatingBadges stock={stock} lastUsedMode={lastUsedMode} newsFrequencyScores={newsFrequencyScores} />
      <div className="p-5 sm:p-8 pb-4 sm:pb-6 bg-gradient-to-b from-white/[0.03] to-transparent">
        <HeaderSection
          stock={stock}
          copiedCode={copiedCode}
          dartAlerts={dartAlerts}
          isAllGatesPassed={isAllGatesPassed}
          quantGateScore={quantGateScore}
          concordance={concordance}
          onCopy={onCopy}
          onDeepAnalysis={onDeepAnalysis}
        />
        <CandidateDecisionCard
          model={candidateDecision}
          mode={candidateCardMode}
          className="mb-4 sm:mb-6"
        />
        <AiFactorBar stock={stock} />
        <SignalAndActions
          stock={stock}
          kisBalance={kisBalance}
          isWatched={isWatched}
          onAddToBacktest={onAddToBacktest}
          onToggleWatchlist={onToggleWatchlist}
          onSetTradeRecord={onSetTradeRecord}
          onAddShadowTrade={onAddShadowTrade}
          onSetView={onSetView}
        />
        <DiagnosticsSection
          stock={stock}
          lastTriggerSummary={lastTriggerSummary}
          enemyChecklistSummary={enemyChecklistSummary}
          onDeepAnalysis={onDeepAnalysis}
        />
        <ExternalLinksAndPlan stock={stock} />
        <TechnicalHealthGrid stock={stock} />
      </div>
      <PriceStrategySection
        stock={stock}
        marketMode={marketMode}
        syncingStock={syncingStock}
        onManualPriceUpdate={onManualPriceUpdate}
        onSyncPrice={onSyncPrice}
      />
      <FooterInsights stock={stock} />
    </motion.div>
  );
}
