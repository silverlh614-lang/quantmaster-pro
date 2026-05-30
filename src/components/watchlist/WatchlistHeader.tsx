/**
 * @responsibility DISCOVER watchlist header composition.
 */
import React from 'react';
import {
  Search, RefreshCw, Info, Clock, Globe, AlertTriangle,
  TrendingUp, Zap, Activity, ArrowUpRight, Crown,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { HeroChecklist } from '../trading/HeroChecklist';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { MASTER_CHECKLIST_STEPS } from '../../constants/checklist';
import type { StockRecommendation, MarketContext, StockFilters } from '../../services/stockService';
import { getQuantGateScore } from '../../utils/recommendationScore';

export interface WatchlistHeaderProps {
  filters: StockFilters;
  setFilters: (filters: StockFilters | ((prev: StockFilters) => StockFilters)) => void;
  setShowMasterChecklist: (v: boolean) => void;
  onFetchStocks: () => void;
  loading: boolean;
  lastUpdated: string | null;
  marketContext: MarketContext | null | undefined;
  recommendations: StockRecommendation[];
  onDeepAnalysis: (stock: StockRecommendation) => void;
}

const FILTER_CARDS: {
  mode: StockFilters['mode'];
  label: string;
  description: string;
  activeClassName: string;
  iconClassName: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    mode: 'MOMENTUM',
    label: 'Momentum Leaders',
    description: 'Strong momentum and supply-focused near-term candidates',
    activeClassName: 'bg-orange-500/15 border-orange-500/30 shadow-lg shadow-orange-500/10',
    iconClassName: 'text-orange-500',
    Icon: Zap,
  },
  {
    mode: 'EARLY_DETECT',
    label: 'Early Signals',
    description: 'Early energy setups before a larger move is confirmed',
    activeClassName: 'bg-blue-500/15 border-blue-500/30 shadow-lg shadow-blue-500/10',
    iconClassName: 'text-blue-500',
    Icon: Activity,
  },
  {
    mode: 'QUANT_SCREEN',
    label: 'Quant Screen',
    description: 'Factor-driven candidates from ROE, valuation, and leverage filters',
    activeClassName: 'bg-emerald-500/15 border-emerald-500/30 shadow-lg shadow-emerald-500/10',
    iconClassName: 'text-emerald-500',
    Icon: Activity,
  },
];

function buildTopRecommendations(recommendations: StockRecommendation[]): StockRecommendation[] {
  return [...(recommendations || [])]
    .filter(stock => (stock.aiConvictionScore?.totalScore || 0) > 0)
    .filter(stock => Number.isFinite(Number(stock.currentPrice)) && Number(stock.currentPrice) > 0)
    .sort((a, b) => (b.aiConvictionScore?.totalScore || 0) - (a.aiConvictionScore?.totalScore || 0))
    .slice(0, 3);
}

function isLastUpdatedStale(lastUpdated: string): boolean {
  const last = new Date(lastUpdated).getTime();
  const now = new Date().getTime();
  const diffMinutes = (now - last) / (1000 * 60);
  return diffMinutes > 30;
}

function FilterModeButton({
  card,
  active,
  onSelect,
}: {
  card: typeof FILTER_CARDS[number];
  active: boolean;
  onSelect: (mode: StockFilters['mode']) => void;
}) {
  return (
    <button
      onClick={() => onSelect(card.mode)}
      className={cn(
        'flex flex-col items-start gap-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl transition-all border',
        active ? card.activeClassName : 'bg-white/5 border-white/10 hover:bg-white/10'
      )}
    >
      <div className="flex items-center gap-2">
        <card.Icon className={cn('w-4 h-4', active ? `${card.iconClassName} fill-current` : 'text-white/40')} />
        <span className={cn('text-xs sm:text-sm font-black', active ? card.iconClassName : 'text-white/60')}>
          {card.label}
        </span>
      </div>
      <span className={cn('text-[10px] font-medium leading-tight', active ? `${card.iconClassName}/60` : 'text-white/25')}>
        {card.description}
      </span>
    </button>
  );
}

function FilterModeGrid({
  filters,
  setFilters,
}: {
  filters: StockFilters;
  setFilters: WatchlistHeaderProps['setFilters'];
}) {
  const onSelect = (mode: StockFilters['mode']) => {
    setFilters(prev => ({ ...prev, mode }));
  };
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
        {FILTER_CARDS.map(card => (
          <FilterModeButton
            key={card.mode}
            card={card}
            active={filters.mode === card.mode}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function AnalysisStartButton({
  loading,
  onFetchStocks,
}: {
  loading: boolean;
  onFetchStocks: () => void;
}) {
  return (
    <button
      onClick={onFetchStocks}
      disabled={loading}
      className={cn(
        'btn-3d px-8 sm:px-12 py-4 sm:py-5 rounded-2xl font-black text-base sm:text-xl flex items-center gap-3 sm:gap-4 transition-all duration-300 w-full sm:w-auto justify-center border-t',
        loading
          ? 'bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 border-cyan-300/40 shadow-[0_12px_40px_rgba(59,130,246,0.5)] text-white animate-pulse'
          : 'bg-gradient-to-br from-orange-400 via-orange-500 to-orange-700 hover:from-orange-300 hover:via-orange-400 hover:to-orange-600 border-white/40 shadow-[0_12px_40px_rgba(249,115,22,0.4)] text-white'
      )}
    >
      {loading ? (
        <RefreshCw className="w-6 h-6 sm:w-7 sm:h-7 animate-spin" />
      ) : (
        <Search className="w-6 h-6 sm:w-7 sm:h-7" />
      )}
      <span className="tracking-tighter">{loading ? 'Analysis running...' : 'Start leader scan'}</span>
    </button>
  );
}

function LastUpdatedInfo({
  lastUpdated,
  marketContext,
}: {
  lastUpdated: string | null;
  marketContext: MarketContext | null | undefined;
}) {
  if (!lastUpdated) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold text-white/20 uppercase tracking-[0.2em] flex items-center gap-2">
        <Clock className="w-3 h-3" />
        Last Updated: {new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (KST)
      </p>
      {marketContext?.dataSource && (
        <p className="text-[10px] font-bold text-green-500/40 uppercase tracking-[0.1em] flex items-center gap-2">
          <Globe className="w-2.5 h-2.5" />
          Source: {marketContext.dataSource}
        </p>
      )}
      {isLastUpdatedStale(lastUpdated) && (
        <p className="text-[10px] font-black text-orange-500/60 uppercase tracking-widest flex items-center gap-2 animate-pulse">
          <AlertTriangle className="w-2.5 h-2.5" />
          Data may be stale. Please refresh for real-time analysis.
        </p>
      )}
    </div>
  );
}

function HeroSection({
  filters,
  setFilters,
  setShowMasterChecklist,
  onFetchStocks,
  loading,
  lastUpdated,
  marketContext,
}: Pick<WatchlistHeaderProps, 'filters' | 'setFilters' | 'setShowMasterChecklist' | 'onFetchStocks' | 'loading' | 'lastUpdated' | 'marketContext'>) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="lg:col-span-3 glass-gradient rounded-2xl sm:rounded-3xl p-6 sm:p-10 lg:p-14 relative overflow-hidden group"
      >
        <div className="relative z-10">
          <h2 className="text-3xl sm:text-5xl lg:text-7xl font-bold mb-4 sm:mb-6 leading-[1.1] tracking-tight">
            <span className="text-gradient-blue">QuantMaster</span>{' '}
            <span className="text-gradient-accent">Pro</span>
          </h2>
          <p className="text-xs sm:text-sm lg:text-base font-bold text-theme-text-muted uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-6 sm:mb-10">
            Data-driven regime and signal analysis
          </p>
          <div className="relative group/info mb-10">
            <p className="text-theme-text-muted max-w-xl text-lg sm:text-xl font-medium leading-relaxed">
              AI powered <span className="text-theme-text border-b border-theme-border cursor-help font-bold" onClick={() => setShowMasterChecklist(true)}>27-step master checklist</span> for leader discovery.
            </p>
            <button
              onClick={() => setShowMasterChecklist(true)}
              className="absolute -right-8 top-0 p-2 text-theme-text-muted hover:text-blue-400 transition-colors"
            >
              <Info className="w-5 h-5" />
            </button>
          </div>

          <HeroChecklist steps={MASTER_CHECKLIST_STEPS} onShowChecklist={() => setShowMasterChecklist(true)} />

          <div className="flex flex-col gap-5 mb-12">
            <FilterModeGrid filters={filters} setFilters={setFilters} />
            <AnalysisStartButton loading={loading} onFetchStocks={onFetchStocks} />
            <LastUpdatedInfo lastUpdated={lastUpdated} marketContext={marketContext} />
          </div>
        </div>

        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/[0.08] blur-[120px] -mr-32 -mt-32" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/[0.06] blur-[100px] -ml-32 -mb-32" />
        <div className="absolute top-1/2 right-1/4 w-48 h-48 bg-cyan-500/[0.04] blur-[80px]" />
      </motion.div>
    </section>
  );
}

function TopRecommendationHeader() {
  return (
    <div className="flex items-center justify-between mb-8 px-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-orange-500/20 rounded-2xl flex items-center justify-center">
          <Crown className="w-6 h-6 text-orange-500" />
        </div>
        <div>
          <h3 className="text-2xl font-black text-theme-text tracking-tighter uppercase">Today's Top 3 Leaders</h3>
          <p className="text-sm text-theme-text-muted font-bold">Highest scoring candidates from the master checklist.</p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-theme-surface rounded-xl border border-theme-border">
        <Activity className="w-4 h-4 text-green-400" />
        <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">AI scan active</span>
      </div>
    </div>
  );
}

function RankBadge({ index }: { index: number }) {
  return (
    <div className="absolute top-0 right-0 p-6">
      <div className={cn(
        'w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl border shadow-2xl',
        index === 0 ? 'bg-orange-500 border-orange-400 text-white' :
        index === 1 ? 'bg-slate-400 border-slate-300 text-white' :
        'bg-amber-700 border-amber-600 text-white'
      )}>
        {index + 1}
      </div>
    </div>
  );
}

function ScoreTiles({ stock }: { stock: StockRecommendation }) {
  const quant = getQuantGateScore(stock);
  return (
    <div className="grid grid-cols-2 gap-4 mb-8">
      <div className="bg-theme-card rounded-2xl p-4 border border-theme-border">
        <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">AI Score</div>
        <div className="text-2xl font-black text-orange-500">{stock.aiConvictionScore?.totalScore || 0}</div>
        <div className="text-[10px] text-orange-300/60 mt-1">Gemini conviction</div>
      </div>
      <div className="bg-theme-card rounded-2xl p-4 border border-theme-border">
        {quant ? (
          <>
            <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">Gate</div>
            <div className={cn('text-2xl font-black', quant.pass ? 'text-emerald-400' : 'text-red-400')}>{quant.value.toFixed(1)}/10</div>
            <div className="text-[10px] text-theme-text-muted mt-1">
              {quant.pass ? 'Auto-trade eligible' : 'Auto-trade blocked'} · {quant.regime.replace(/_.+$/, '')} threshold {quant.threshold}
            </div>
          </>
        ) : (
          <>
            <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">Checklist</div>
            <div className="text-2xl font-black text-theme-text">{Object.values(stock.checklist || {}).filter(Boolean).length}/27</div>
          </>
        )}
      </div>
    </div>
  );
}

function formatUpside(stock: StockRecommendation): string {
  // currentPrice 가 신뢰 소스(NAVER/REALTIME) 가 아니면 upside 도 무의미 — '-' 노출
  // (Yahoo 환각 ₩1.86M 같은 값으로 +20%/-88% 가짜 산출 차단)
  const isTrusted = stock.dataSourceType === 'NAVER' || stock.dataSourceType === 'REALTIME';
  const targetPrice = Number(stock.targetPrice) || 0;
  const currentPrice = Number(stock.currentPrice) || 0;
  if (!isTrusted || targetPrice <= 0 || currentPrice <= 0) return '-';
  const upside = Math.round((targetPrice / currentPrice - 1) * 100);
  return upside > 0 ? `+${upside}%` : `${upside}%`;
}

function PriceAndUpside({ stock }: { stock: StockRecommendation }) {
  // Render-시점 신뢰 가드: dataSourceType 이 NAVER/REALTIME 만 가격 표시 허용.
  // 캐시된 stock.currentPrice(LLM 환각·Yahoo 잔재·snapshot stale)는 enrichment
  // 재실행 전이라도 표시 거부 — "가격 미확보" placeholder (불변식 #7 확장:
  // L4 AI_ESTIMATED·STALE 등은 live execution 뿐 아니라 표시 가격으로도 금지).
  const isTrustedSource = stock.dataSourceType === 'NAVER' || stock.dataSourceType === 'REALTIME';
  const hasPrice = isTrustedSource && typeof stock.currentPrice === 'number' && stock.currentPrice > 0;
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-400" />
          {hasPrice ? (
            <span className="text-lg font-black text-theme-text">₩{(stock.currentPrice as number).toLocaleString()}</span>
          ) : (
            <span className="text-lg font-black text-theme-text-muted">가격 미확보</span>
          )}
          <ConfidenceBadge type={stock.dataSourceType || 'AI'} />
        </div>
        {hasPrice && (stock.priceUpdatedAt || stock.dataSource) && (
          <div className="text-[8px] font-black text-theme-text-muted uppercase tracking-tighter mt-1">
            {stock.priceUpdatedAt} {stock.dataSource && `via ${stock.dataSource}`}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-green-400 font-black text-sm">
        <ArrowUpRight className="w-4 h-4" />
        {formatUpside(stock)}
      </div>
    </div>
  );
}

function TopRecommendationCard({
  stock,
  index,
  onDeepAnalysis,
}: {
  stock: StockRecommendation;
  index: number;
  onDeepAnalysis: (stock: StockRecommendation) => void;
}) {
  return (
    <motion.div
      key={stock.code}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      onClick={() => onDeepAnalysis(stock)}
      className="glass-3d rounded-2xl sm:rounded-3xl p-8 border border-white/10 relative overflow-hidden group cursor-pointer hover:border-orange-500/50 transition-all"
    >
      <RankBadge index={index} />

      <div className="mb-8">
        <div className={cn(
          'text-[10px] font-black uppercase tracking-[0.3em] mb-2',
          (stock.type || '').includes('BUY') ? 'text-red-500' : 'text-blue-500'
        )}>
          {(stock.type || '').replace('_', ' ')}
        </div>
        <h4 className="text-2xl sm:text-3xl font-black text-theme-text tracking-tighter mb-1 truncate" title={stock.name}>{stock.name}</h4>
        <div className="text-xs sm:text-sm font-black text-theme-text-muted uppercase tracking-widest truncate">{stock.code}</div>
      </div>

      <ScoreTiles stock={stock} />
      <PriceAndUpside stock={stock} />
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-orange-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </motion.div>
  );
}

function TopRecommendationsSection({
  recommendations,
  onDeepAnalysis,
}: {
  recommendations: StockRecommendation[];
  onDeepAnalysis: (stock: StockRecommendation) => void;
}) {
  const topRecommendations = buildTopRecommendations(recommendations);
  if (topRecommendations.length === 0) return null;
  return (
    <section className="mb-16">
      <TopRecommendationHeader />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {topRecommendations.map((stock, idx) => (
          <TopRecommendationCard
            key={stock.code}
            stock={stock}
            index={idx}
            onDeepAnalysis={onDeepAnalysis}
          />
        ))}
      </div>
    </section>
  );
}

export function WatchlistHeader({
  filters,
  setFilters,
  setShowMasterChecklist,
  onFetchStocks,
  loading,
  lastUpdated,
  marketContext,
  recommendations,
  onDeepAnalysis,
}: WatchlistHeaderProps) {
  return (
    <>
      <HeroSection
        filters={filters}
        setFilters={setFilters}
        setShowMasterChecklist={setShowMasterChecklist}
        onFetchStocks={onFetchStocks}
        loading={loading}
        lastUpdated={lastUpdated}
        marketContext={marketContext}
      />
      <TopRecommendationsSection recommendations={recommendations} onDeepAnalysis={onDeepAnalysis} />
    </>
  );
}
