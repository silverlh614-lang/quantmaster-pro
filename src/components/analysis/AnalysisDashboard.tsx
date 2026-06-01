// @responsibility analysis 영역 AnalysisDashboard 컴포넌트
import React, { useState, useEffect } from 'react';
import {
  History,
  TrendingUp,
  TrendingDown,
  Zap,
  Target,
  ShieldCheck,
  AlertTriangle,
  ArrowRightLeft,
  Clock,
  CheckCircle2,
  BarChart3,
  LineChart as LucideLineChart,
  Activity,
  Lightbulb,
  FileText,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Bookmark,
  Crown,
  X,
  Brain,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { cn } from '../../ui/cn';
import { StockRecommendation, MarketContext, runAdvancedAnalysis, AdvancedAnalysisResult } from '../../services/stockService';

type AnalysisTab = 'BACKTEST' | 'WALK_FORWARD' | 'PAPER_TRADING';
type RunAnalysisHandler = (type: AnalysisTab, period?: string) => Promise<void> | void;
type PaperTradeLog = NonNullable<AdvancedAnalysisResult['paperTradeLogs']>[number];
type PaperTradePick = PaperTradeLog['picks'][number];

const TAB_ITEMS: { id: AnalysisTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'BACKTEST', label: '백테스팅', icon: History },
  { id: 'WALK_FORWARD', label: 'Walk-Forward', icon: ArrowRightLeft },
  { id: 'PAPER_TRADING', label: '모의 투자', icon: Activity },
];

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '16px',
  fontSize: '12px',
  fontWeight: 'bold',
};

const BACKTEST_DESCRIPTION = [
  '과거 시장 데이터를 통해 27단계 체크리스트의 유효성을 검증합니다.',
  '하락장과 순환매 장세에서의 가중치 변화를 분석합니다.',
].join(' ');
const BACKTEST_PERIOD_RATE_HIKE = '2022년 금리 인상기 (하락장)';
const BACKTEST_PERIOD_RECOVERY = '2024년 상반기 (순환매 장세)';
const BACKTEST_RATE_HIKE_LABEL = '금리 인상기';
const BACKTEST_RECOVERY_LABEL = '상반기 장세';
const WALK_FORWARD_DESCRIPTION = [
  '2025년 최적화 로직을 2026년 최근 3개월 데이터에 대입하여 과최적화 여부를 검증합니다.',
  '최신 트렌드(AI 비주얼 스토리텔링, 밸류업 등)에 대한 적응력을 확인합니다.',
].join(' ');
const WALK_FORWARD_LOADING_LABEL = 'AI 전진 분석 수행 중...';
const PAPER_TRADING_DESCRIPTION = "매일 아침 시스템이 선정한 '마스터 픽'의 성과를 추적합니다.";
const NAVER_SEARCH_SUFFIX = '+주가';
const RATE_LIMIT_ALERT_MESSAGE = 'API 할당량이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
const ANALYSIS_ERROR_PREFIX = '분석 중 오류가 발생했습니다';

function isRateLimitError(message: string, status: unknown, code: unknown): boolean {
  return message.includes('429')
    || status === 429
    || code === 429
    || status === 'RESOURCE_EXHAUSTED'
    || message.includes('quota');
}

function TabNavigation({
  activeTab,
  onChange,
}: {
  activeTab: AnalysisTab;
  onChange: (tab: AnalysisTab) => void;
}) {
  return (
    <div className="flex items-center gap-2 p-1 bg-white/5 rounded-2xl border border-white/[0.07] w-fit">
      {TAB_ITEMS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold tracking-tight transition-all whitespace-nowrap",
            activeTab === tab.id
              ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
              : "text-white/40 hover:text-white/70 hover:bg-white/5"
          )}
        >
          <tab.icon className="w-4 h-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function BacktestControls({
  isAnalyzing,
  onRunAnalysis,
}: {
  isAnalyzing: boolean;
  onRunAnalysis: RunAnalysisHandler;
}) {
  return (
    <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/[0.07] space-y-6">
      <div>
        <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">과거 데이터 백테스팅</h3>
        <p className="text-sm text-white/40 leading-relaxed">
          {BACKTEST_DESCRIPTION}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => onRunAnalysis('BACKTEST', BACKTEST_PERIOD_RATE_HIKE)}
          disabled={isAnalyzing}
          className="group relative p-6 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-3xl transition-all text-left overflow-hidden"
        >
          <div className="relative z-10">
            <TrendingDown className="w-8 h-8 text-red-400 mb-4" />
            <span className="block text-xs font-black text-red-400/60 tracking-tight mb-1">2022 하락장</span>
            <span className="block text-lg font-black text-white">{BACKTEST_RATE_HIKE_LABEL}</span>
          </div>
          {isAnalyzing && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-20">
              <RefreshCw className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
        </button>

        <button
          onClick={() => onRunAnalysis('BACKTEST', BACKTEST_PERIOD_RECOVERY)}
          disabled={isAnalyzing}
          className="group relative p-6 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-3xl transition-all text-left overflow-hidden"
        >
          <div className="relative z-10">
            <ArrowRightLeft className="w-8 h-8 text-blue-400 mb-4" />
            <span className="block text-xs font-black text-blue-400/60 tracking-tight mb-1">2024 순환매</span>
            <span className="block text-lg font-black text-white">{BACKTEST_RECOVERY_LABEL}</span>
          </div>
        </button>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName: string;
}) {
  return (
    <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
      <span className="text-[10px] font-black text-white/20 tracking-tight block mb-1">{label}</span>
      <span className={cn("text-xl font-black", valueClassName)}>{value}</span>
    </div>
  );
}

function BacktestResultSummary({ result }: { result: AdvancedAnalysisResult }) {
  return (
    <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/[0.07] space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <span className="text-[10px] font-black text-orange-500 tracking-tight block mb-1">분석 결과</span>
          <h3 className="text-2xl font-black text-white tracking-tight">{result.period}</h3>
        </div>
        <div className={cn(
          "px-4 py-2 rounded-2xl font-black text-lg",
          (result.metrics.totalReturn || 0) >= 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
        )}>
          {result.metrics.totalReturn && result.metrics.totalReturn > 0 ? '+' : ''}{result.metrics.totalReturn}%
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <MetricTile label="승률" value={`${result.metrics.winRate}%`} valueClassName="text-white" />
        <MetricTile label="최대 낙폭" value={`${result.metrics.maxDrawdown}%`} valueClassName="text-red-400" />
        <MetricTile label="샤프 지수" value={result.metrics.sharpeRatio} valueClassName="text-blue-400" />
      </div>

      <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb className="w-4 h-4 text-orange-500" />
          <span className="text-[10px] font-black text-orange-500 tracking-tight">AI 인사이트</span>
        </div>
        <p className="text-xs text-white/70 leading-relaxed font-medium italic">
          {result.description}
        </p>
      </div>
    </div>
  );
}

function PerformanceChartCard({
  result,
  title,
  iconClassName,
  gradientId,
  color,
  seriesLabel,
  heightClassName,
  textLeft,
}: {
  result: AdvancedAnalysisResult;
  title: string;
  iconClassName: string;
  gradientId: string;
  color: string;
  seriesLabel: string;
  heightClassName: string;
  textLeft?: boolean;
}) {
  if (!result.performanceData) return null;

  return (
    <div className={cn("bg-white/5 rounded-[2.5rem] p-8 border border-white/[0.07]", textLeft && "text-left")}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <BarChart3 className={cn("w-6 h-6", iconClassName)} />
          <h4 className="text-lg font-black text-white uppercase tracking-tight">{title}</h4>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[10px] font-black text-white/40 tracking-tight">{seriesLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-white/20" />
            <span className="text-[10px] font-black text-white/40 tracking-tight">벤치마크</span>
          </div>
        </div>
      </div>
      <div className={cn("w-full", heightClassName)}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={result.performanceData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={color} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#ffffff20"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#ffffff40', fontWeight: 'bold' }}
            />
            <YAxis
              stroke="#ffffff20"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#ffffff40', fontWeight: 'bold' }}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{ color: '#fff' }} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={3}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
            />
            <Area
              type="monotone"
              dataKey="benchmark"
              stroke="#ffffff20"
              strokeWidth={2}
              fill="transparent"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ContributionAnalysis({ result }: { result: AdvancedAnalysisResult }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/[0.07]">
        <div className="flex items-center gap-3 mb-6">
          <Crown className="w-6 h-6 text-orange-400" />
          <h4 className="text-lg font-black text-white uppercase tracking-tight">주요 기여 종목</h4>
        </div>
        <div className="space-y-4">
          {result.topContributors?.map((item, i) => (
            <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 group/item">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400 font-black text-xs">
                  {i + 1}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-white tracking-tight">{item.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${item.weight}%` }}
                    className="h-full bg-green-500"
                  />
                </div>
                <span className="text-xs font-black text-green-400">{item.weight}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/[0.07]">
        <div className="flex items-center gap-3 mb-6">
          <AlertTriangle className="w-6 h-6 text-red-400" />
          <h4 className="text-lg font-black text-white uppercase tracking-tight">노이즈 항목</h4>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {result.noiseItems?.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-4 bg-red-500/5 rounded-2xl border border-red-500/10">
              <X className="w-4 h-4 text-red-400" />
              <span className="text-sm font-black text-white/60 tracking-tight">{item}</span>
              <span className="ml-auto text-[10px] font-black text-red-400/30 tracking-tight">낮은 영향</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BacktestTab({
  result,
  isAnalyzing,
  onRunAnalysis,
}: {
  result: AdvancedAnalysisResult | null;
  isAnalyzing: boolean;
  onRunAnalysis: RunAnalysisHandler;
}) {
  const isBacktest = result?.type === 'BACKTEST';
  const canShowPerformance = result && (result.type === 'BACKTEST' || result.type === 'WALK_FORWARD');

  return (
    <motion.div
      key="backtest"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <BacktestControls isAnalyzing={isAnalyzing} onRunAnalysis={onRunAnalysis} />
        {isBacktest && <BacktestResultSummary result={result} />}
      </div>

      {canShowPerformance && (
        <PerformanceChartCard
          result={result}
          title="성과 비교"
          iconClassName="text-orange-500"
          gradientId="colorValue"
          color="#f97316"
          seriesLabel="포트폴리오"
          heightClassName="h-[300px]"
        />
      )}

      {isBacktest && <ContributionAnalysis result={result} />}
    </motion.div>
  );
}

function WalkForwardPeriodCard({
  variant,
  title,
  period,
  accuracy,
}: {
  variant: 'training' | 'validation';
  title: string;
  period: string;
  accuracy: number;
}) {
  return (
    <div className={cn(
      "p-8 rounded-[2.5rem] relative overflow-hidden group",
      variant === 'training'
        ? "bg-white/5 border border-white/[0.07]"
        : "bg-orange-500/5 border border-orange-500/20"
    )}>
      <div className="absolute top-0 right-0 p-4">
        <div className={cn(
          "px-3 py-1 text-white text-[10px] font-black rounded-full tracking-tight",
          variant === 'training' ? "bg-blue-500" : "bg-orange-500"
        )}>
          {title}
        </div>
      </div>
      <span className="text-[10px] font-black text-white/20 tracking-tight block mb-2">{period}</span>
      <span className="text-2xl font-black text-white">{variant === 'training' ? '2025년 전체' : '2026년 1분기 (최근)'}</span>
      <div className="mt-6 space-y-3">
        <div className="flex justify-between text-[10px] font-semibold tracking-tight">
          <span className="text-white/30">정확도</span>
          <span className={variant === 'training' ? "text-blue-400" : "text-orange-500"}>{accuracy}%</span>
        </div>
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className={cn("h-full", variant === 'training' ? "bg-blue-500" : "bg-orange-500")}
            style={{ width: `${accuracy}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function WalkForwardLoading() {
  return (
    <div className="py-20 flex flex-col items-center gap-4">
      <RefreshCw className="w-12 h-12 text-blue-500 animate-spin" />
      <p className="text-sm font-black text-white/40 tracking-tight">{WALK_FORWARD_LOADING_LABEL}</p>
    </div>
  );
}

function WalkForwardResult({ result }: { result: AdvancedAnalysisResult }) {
  const baseAccuracy = result.metrics.accuracy || 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-8">
        <WalkForwardPeriodCard
          variant="training"
          title="학습"
          period="기준 기간"
          accuracy={result.metrics.accuracy as number}
        />
        <WalkForwardPeriodCard
          variant="validation"
          title="검증"
          period="테스트 기간"
          accuracy={baseAccuracy - 4.2}
        />
      </div>

      <div className="bg-white/5 p-6 rounded-3xl border border-white/5 text-left">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-green-400" />
          <span className="text-sm font-black text-white uppercase tracking-tight">견고성 점수: {result.metrics.robustnessScore}%</span>
        </div>
        <p className="text-xs text-white/50 leading-relaxed">
          {result.description}
        </p>
      </div>

      <PerformanceChartCard
        result={result}
        title="Walk-Forward 성과"
        iconClassName="text-blue-400"
        gradientId="colorValueBlue"
        color="#3b82f6"
        seriesLabel="검증"
        heightClassName="h-[250px]"
        textLeft
      />
    </>
  );
}

function WalkForwardTab({
  result,
  isAnalyzing,
}: {
  result: AdvancedAnalysisResult | null;
  isAnalyzing: boolean;
}) {
  return (
    <motion.div
      key="walk_forward"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="bg-white/5 rounded-[2.5rem] p-8 border border-white/[0.07]"
    >
      <div className="max-w-3xl mx-auto text-center space-y-8">
        <div className="space-y-4">
          <div className="w-20 h-20 bg-blue-500/10 rounded-[2rem] border border-blue-500/20 flex items-center justify-center mx-auto">
            <ArrowRightLeft className="w-10 h-10 text-blue-400" />
          </div>
          <h3 className="text-3xl font-black text-white uppercase tracking-tight">Walk-Forward 분석</h3>
          <p className="text-white/40 leading-relaxed font-medium">
            {WALK_FORWARD_DESCRIPTION}
          </p>
        </div>

        {isAnalyzing ? (
          <WalkForwardLoading />
        ) : result?.type === 'WALK_FORWARD' && (
          <WalkForwardResult result={result} />
        )}
      </div>
    </motion.div>
  );
}

function buildNaverFinanceUrl(pick: PaperTradePick): string {
  const cleanCode = String(pick.code).replace(/[^0-9]/g, '');
  return cleanCode.length === 6
    ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
    : `https://search.naver.com/search.naver?query=${encodeURIComponent(pick.name)}${NAVER_SEARCH_SUFFIX}`;
}

function PaperPickCard({
  pick,
  copiedCode,
  onCopy,
}: {
  pick: PaperTradePick;
  copiedCode: string | null;
  onCopy: (code: string) => void;
}) {
  return (
    <div className="bg-white/5 p-6 rounded-3xl border border-white/5 hover:bg-white/10 transition-all group">
      <div className="flex justify-between items-start mb-4">
        <div className="flex flex-col items-end">
          <h4 className="text-base sm:text-lg font-black text-white group-hover:text-orange-400 transition-colors truncate" title={pick.name}>{pick.name}</h4>
          <div className="flex items-center gap-2">
            <a
              href={buildNaverFinanceUrl(pick)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-black text-orange-500/40 hover:text-orange-500 transition-colors tracking-tight"
            >
              {pick.code}
            </a>
            <button
              onClick={() => onCopy(pick.code)}
              className="p-1 hover:bg-white/10 rounded transition-colors"
            >
              <Copy className={cn("w-3 h-3 transition-colors", copiedCode === pick.code ? "text-green-400" : "text-white/20")} />
            </button>
          </div>
        </div>
        <div className={cn(
          "px-2 py-1 rounded-lg text-[8px] font-semibold tracking-tight whitespace-nowrap shrink-0",
          pick.status === 'PROFIT' ? "bg-green-500 text-white" :
          pick.status === 'LOSS' ? "bg-red-500 text-white" :
          "bg-orange-500 text-white"
        )}>
          {pick.status} {pick.pnl ? `(${pick.pnl}%)` : ''}
        </div>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-black text-white/20 tracking-tight">진입</span>
          <span className="text-sm font-black text-white">₩{pick.entryPrice?.toLocaleString() || '0'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-black text-white/20 tracking-tight">목표</span>
          <span className="text-sm font-black text-green-400">₩{pick.targetPrice?.toLocaleString() || '0'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-black text-white/20 tracking-tight">손절</span>
          <span className="text-sm font-black text-red-400">₩{pick.stopLoss?.toLocaleString() || '0'}</span>
        </div>
      </div>

      <div className="pt-4 border-t border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-3 h-3 text-orange-500" />
          <span className="text-[9px] font-black text-white/30 tracking-tight">촉매 (27단계)</span>
        </div>
        <p className="text-[11px] text-white/50 leading-relaxed font-medium italic">
          {pick.catalyst}
        </p>
      </div>
    </div>
  );
}

function PaperTradeLogCard({
  log,
  copiedCode,
  onCopy,
}: {
  log: PaperTradeLog;
  copiedCode: string | null;
  onCopy: (code: string) => void;
}) {
  return (
    <div className="bg-white/5 rounded-[2.5rem] border border-white/[0.07] overflow-hidden">
      <div className="p-6 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-orange-500" />
          <span className="text-lg font-black text-white">{log.date} 마스터 픽</span>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {log.picks?.map((pick, j) => (
            <PaperPickCard key={j} pick={pick} copiedCode={copiedCode} onCopy={onCopy} />
          ))}
        </div>

        <div className="bg-orange-500/5 p-6 rounded-3xl border border-orange-500/10">
          <div className="flex items-center gap-3 mb-3">
            <Brain className="w-5 h-5 text-orange-500" />
            <span className="text-sm font-black text-white uppercase tracking-tight">AI 피드백 루프</span>
          </div>
          <p className="text-xs text-white/60 leading-relaxed font-medium">
            {log.aiFeedback}
          </p>
        </div>
      </div>
    </div>
  );
}

function PaperTradingTab({
  result,
  isAnalyzing,
  copiedCode,
  onRunAnalysis,
  onCopy,
}: {
  result: AdvancedAnalysisResult | null;
  isAnalyzing: boolean;
  copiedCode: string | null;
  onRunAnalysis: RunAnalysisHandler;
  onCopy: (code: string) => void;
}) {
  return (
    <motion.div
      key="paper_trading"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-2xl font-black text-white uppercase tracking-tight">모의 투자 기록</h3>
          <p className="text-sm text-white/40 font-medium">{PAPER_TRADING_DESCRIPTION}</p>
        </div>
        <button
          onClick={() => onRunAnalysis('PAPER_TRADING')}
          disabled={isAnalyzing}
          className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-orange-500/20 active:scale-95"
        >
          {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          픽 새로고침
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {result?.type === 'PAPER_TRADING' && result.paperTradeLogs?.map((log, i) => (
          <PaperTradeLogCard key={i} log={log} copiedCode={copiedCode} onCopy={onCopy} />
        ))}
      </div>
    </motion.div>
  );
}

export function AnalysisDashboard() {
  const [activeTab, setActiveTab] = useState<AnalysisTab>('BACKTEST');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AdvancedAnalysisResult | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleRunAnalysis = async (type: AnalysisTab, period?: string) => {
    setIsAnalyzing(true);
    try {
      const apiKey = localStorage.getItem('k-stock-api-key') || '';
      void apiKey;
      const result = await runAdvancedAnalysis(type, period);
      setAnalysisResult(result);
    } catch (error: any) {
      console.error("Analysis failed:", error);
      const errObj = error?.error || error;
      const message = errObj?.message || error?.message || "";
      const status = errObj?.status || error?.status;
      const code = errObj?.code || error?.code;
      const isRateLimit = isRateLimitError(message, status, code);

      if (isRateLimit) {
        alert(RATE_LIMIT_ALERT_MESSAGE);
      } else {
        alert(`${ANALYSIS_ERROR_PREFIX}: ${message}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    // Auto-run analysis when tab changes if no result
    if (!analysisResult || analysisResult.type !== activeTab) {
      if (activeTab === 'WALK_FORWARD') handleRunAnalysis('WALK_FORWARD');
      if (activeTab === 'PAPER_TRADING') handleRunAnalysis('PAPER_TRADING');
    }
  }, [activeTab]);

  return (
    <div className="space-y-8">
      <TabNavigation activeTab={activeTab} onChange={setActiveTab} />

      <AnimatePresence mode="wait">
        {activeTab === 'BACKTEST' && (
          <BacktestTab result={analysisResult} isAnalyzing={isAnalyzing} onRunAnalysis={handleRunAnalysis} />
        )}
        {activeTab === 'WALK_FORWARD' && (
          <WalkForwardTab result={analysisResult} isAnalyzing={isAnalyzing} />
        )}
        {activeTab === 'PAPER_TRADING' && (
          <PaperTradingTab
            result={analysisResult}
            isAnalyzing={isAnalyzing}
            copiedCode={copiedCode}
            onRunAnalysis={handleRunAnalysis}
            onCopy={handleCopy}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
