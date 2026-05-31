/**
 * @responsibility DISCOVER watchlist header composition.
 */
import React from 'react';
import {
  Search, RefreshCw, Info, Clock, Globe, AlertTriangle,
  Zap, Activity, ArrowUpRight, Crown,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../ui/cn';
import { HeroChecklist } from '../trading/HeroChecklist';
import { PriceDisplay } from '../common/PriceDisplay';
import { usePriceCanon } from '../../hooks/usePriceCanon';
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
    label: '모멘텀 주도주',
    description: '강한 모멘텀·수급 중심의 단기 후보',
    activeClassName: 'bg-orange-500/15 border-orange-500/30 shadow-lg shadow-orange-500/10',
    iconClassName: 'text-orange-500',
    Icon: Zap,
  },
  {
    mode: 'EARLY_DETECT',
    label: '얼리 시그널',
    description: '큰 변동 확인 전 초기 에너지 셋업',
    activeClassName: 'bg-blue-500/15 border-blue-500/30 shadow-lg shadow-blue-500/10',
    iconClassName: 'text-blue-500',
    Icon: Activity,
  },
  {
    mode: 'QUANT_SCREEN',
    label: '퀀트 스크린',
    description: 'ROE·밸류에이션·레버리지 팩터 기반 후보',
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

// 프리미엄 진입 모션 — 컨테이너 stagger + 아이템 fade-up (easeOutExpo).
const HERO_STAGGER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.12 } },
};
const HERO_ITEM = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

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
    <motion.button
      onClick={() => onSelect(card.mode)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      className={cn(
        'group/mode relative flex flex-col items-start gap-1.5 overflow-hidden rounded-2xl border px-4 py-3.5 backdrop-blur-md transition-colors sm:px-5 sm:py-4',
        active
          ? `${card.activeClassName} shadow-[0_10px_34px_-10px_rgba(0,0,0,0.5)]`
          : 'border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.055]'
      )}
    >
      {/* active 상단 하이라이트 라인 */}
      {active && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-current to-transparent opacity-50" />
      )}
      <div className="flex items-center gap-2">
        <card.Icon className={cn('h-4 w-4 transition-transform duration-300 group-hover/mode:scale-110', active ? `${card.iconClassName} fill-current` : 'text-white/40')} />
        <span className={cn('text-xs font-black tracking-tight sm:text-sm', active ? card.iconClassName : 'text-white/65')}>
          {card.label}
        </span>
      </div>
      <span className={cn('text-[10px] font-medium leading-tight', active ? `${card.iconClassName}/60` : 'text-white/30')}>
        {card.description}
      </span>
    </motion.button>
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
    <motion.button
      onClick={onFetchStocks}
      disabled={loading}
      whileHover={loading ? undefined : { y: -2 }}
      whileTap={loading ? undefined : { scale: 0.99 }}
      transition={{ type: 'spring', stiffness: 400, damping: 24 }}
      className={cn(
        'group/scan relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl border-t px-8 py-4 text-base font-black tracking-tight transition-colors duration-300 sm:w-auto sm:gap-4 sm:px-12 sm:py-5 sm:text-xl',
        loading
          ? 'animate-pulse border-cyan-300/40 bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 text-white shadow-[0_16px_46px_-12px_rgba(59,130,246,0.7)]'
          : 'border-white/40 bg-gradient-to-br from-orange-400 via-orange-500 to-orange-700 text-white shadow-[0_16px_46px_-12px_rgba(249,115,22,0.65)] hover:shadow-[0_20px_56px_-12px_rgba(249,115,22,0.8)]'
      )}
    >
      {/* 호버 시 스며드는 sheen (프리미엄 shimmer) */}
      {!loading && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover/scan:translate-x-full" />
      )}
      {loading ? (
        <RefreshCw className="h-6 w-6 animate-spin sm:h-7 sm:w-7" />
      ) : (
        <Search className="h-6 w-6 transition-transform duration-300 group-hover/scan:scale-110 sm:h-7 sm:w-7" />
      )}
      <span className="relative">{loading ? '분석 진행 중...' : '주도주 스캔 시작'}</span>
    </motion.button>
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
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-white/25">
        <Clock className="h-3 w-3" />
        마지막 갱신: {new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (KST)
      </p>
      {marketContext?.dataSource && (
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-500/45">
          <Globe className="h-2.5 w-2.5" />
          출처: {marketContext.dataSource}
        </p>
      )}
      {isLastUpdatedStale(lastUpdated) && (
        <p className="flex animate-pulse items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-500/60">
          <AlertTriangle className="h-2.5 w-2.5" />
          데이터가 오래됐을 수 있습니다 — 새로고침 권장
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
  const reduceMotion = useReducedMotion();
  return (
    <section className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3 lg:gap-8">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="group relative overflow-hidden rounded-2xl border border-white/[0.07] glass-gradient p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.7)] sm:rounded-3xl sm:p-10 lg:col-span-3 lg:p-14"
      >
        {/* 상단 하이라이트 하어라인 — 유리 패널 입체감 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        <motion.div className="relative z-10" variants={HERO_STAGGER} initial="hidden" animate="show">
          <motion.h2 variants={HERO_ITEM} className="mb-4 text-3xl font-bold leading-[1.1] tracking-tight [text-shadow:0_2px_30px_rgba(59,130,246,0.25)] sm:mb-6 sm:text-5xl lg:text-7xl">
            <span className="text-gradient-blue">QuantMaster</span>{' '}
            <span className="text-gradient-accent">Pro</span>
          </motion.h2>
          <motion.p variants={HERO_ITEM} className="mb-6 text-xs font-bold uppercase tracking-[0.15em] text-theme-text-muted sm:mb-10 sm:text-sm sm:tracking-[0.2em] lg:text-base">
            데이터 기반 국면·신호 분석
          </motion.p>
          <motion.div variants={HERO_ITEM} className="group/info relative mb-10">
            <p className="max-w-xl text-lg font-medium leading-relaxed text-theme-text-muted sm:text-xl">
              AI 기반 <span className="cursor-help border-b border-theme-border font-bold text-theme-text" onClick={() => setShowMasterChecklist(true)}>27단계 마스터 체크리스트</span>로 주도주 발굴.
            </p>
            <button
              onClick={() => setShowMasterChecklist(true)}
              className="absolute -right-8 top-0 p-2 text-theme-text-muted transition-colors hover:text-blue-400"
            >
              <Info className="h-5 w-5" />
            </button>
          </motion.div>

          <motion.div variants={HERO_ITEM}>
            <HeroChecklist steps={MASTER_CHECKLIST_STEPS} onShowChecklist={() => setShowMasterChecklist(true)} />
          </motion.div>

          <motion.div variants={HERO_ITEM} className="mb-12 flex flex-col gap-5">
            <FilterModeGrid filters={filters} setFilters={setFilters} />
            <AnalysisStartButton loading={loading} onFetchStocks={onFetchStocks} />
            <LastUpdatedInfo lastUpdated={lastUpdated} marketContext={marketContext} />
          </motion.div>
        </motion.div>

        {/* 앰비언트 글로우 — 깊이감 (브랜드 오렌지 + 쿨톤, 은은한 호흡) */}
        <motion.div
          className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-blue-500/[0.10] blur-[130px]"
          animate={reduceMotion ? undefined : { opacity: [0.55, 0.9, 0.55] }}
          transition={reduceMotion ? undefined : { duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="pointer-events-none absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-indigo-500/[0.07] blur-[110px]" />
        <div className="pointer-events-none absolute right-1/3 top-1/3 h-56 w-56 rounded-full bg-orange-500/[0.05] blur-[100px]" />
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
          <h3 className="text-2xl font-black text-theme-text tracking-tighter uppercase">오늘의 TOP 3 주도주</h3>
          <p className="text-sm text-theme-text-muted font-bold">마스터 체크리스트 최고 점수 후보.</p>
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

function PriceAndUpside({ stock }: { stock: StockRecommendation }) {
  // PriceDisplay 가 usePriceCanon hook 으로 Naver 정본 단일 조회.
  // 산재된 가드 로직 제거 — 가격 정본 SSOT 일원화 (불변식 #7 정합).
  // upside% 도 정본 가격 기반으로 — Yahoo 환각값(₩1.86M) 기반 가짜 +20%/-88% 차단.
  const fallbackKisPrice = stock.dataSourceType === 'REALTIME'
    && typeof stock.currentPrice === 'number' && stock.currentPrice > 0
    ? stock.currentPrice
    : null;
  const { price: canonPrice } = usePriceCanon(stock.code, {
    fallbackPrice: fallbackKisPrice ?? undefined,
    fallbackSource: 'REALTIME',
  });
  const targetPrice = Number(stock.targetPrice) || 0;
  const upsideText = canonPrice && canonPrice > 0 && targetPrice > 0
    ? (() => {
        const upside = Math.round((targetPrice / canonPrice - 1) * 100);
        return upside > 0 ? `+${upside}%` : `${upside}%`;
      })()
    : '-';
  return (
    <div className="flex items-center justify-between">
      <PriceDisplay
        code={stock.code}
        variant="card"
        fallbackKisPrice={fallbackKisPrice}
      />
      <div className="flex items-center gap-2 text-green-400 font-black text-sm">
        <ArrowUpRight className="w-4 h-4" />
        {upsideText}
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
