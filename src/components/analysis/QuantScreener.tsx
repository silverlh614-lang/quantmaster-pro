// @responsibility analysis QuantScreener component
import React, { useEffect, useRef, useState } from 'react';
import {
  Filter,
  Zap,
  Brain,
  BarChart3,
  Target,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { motion } from 'motion/react';
import { StockFilters, StockRecommendation } from '../../services/stockService';
import type { BearRegimeResult } from '../../types/quant';
import { cn } from '../../ui/cn';
import { formatMarketCapTKrw } from '../../utils/marketCapFormat';

interface QuantScreenerProps {
  onScreen: (filters: StockFilters) => Promise<void>;
  loading: boolean;
  recommendations: StockRecommendation[];
  onStockClick?: (stock: StockRecommendation) => void;
  bearRegimeResult?: BearRegimeResult | null;
}

type PipelineStage = {
  label: string;
  desc: string;
  color: string;
  border: string;
};

const INITIAL_FILTERS: StockFilters = {
  minRoe: 15,
  maxPer: 20,
  maxDebtRatio: 100,
  minMarketCap: 1000,
  mode: 'MOMENTUM',
};

const PIPELINE_DELAYS_MS = [0, 12000, 22000, 32000, 42000];
const PIPELINE_STAGES: PipelineStage[] = [
  { label: '퀀트 스크리닝', desc: 'ROE, 밸류에이션, 유동성, 52주 근접도 필터', color: 'text-blue-400', border: 'border-blue-500/40' },
  { label: 'DART 검토', desc: '최근 공시 및 지분 신호', color: 'text-amber-400', border: 'border-amber-500/40' },
  { label: '종합 점수', desc: '퀀트, 공시, 뉴스 팩터 결합', color: 'text-green-400', border: 'border-green-500/40' },
  { label: '조용한 매집', desc: 'VWAP, 기관 분할 매수, 매물대 축소', color: 'text-purple-400', border: 'border-purple-500/40' },
  { label: '타이밍 검토', desc: '내러티브 품질 및 27조건 게이트 판독', color: 'text-pink-400', border: 'border-pink-500/40' },
];

const MODE_OPTIONS = [
  { value: 'MOMENTUM', label: '모멘텀 주도주' },
  { value: 'EARLY_DETECT', label: '초기 신호 감지' },
  { value: 'QUANT_SCREEN', label: '하이브리드 퀀트 발굴' },
  { value: 'BEAR_SCREEN', label: '약세장 스크리너' },
] as const;

const TREND_ITEMS = [
  { label: '저PBR 바스켓', value: '+12.4%' },
  { label: 'AI 반도체 테마', value: '+8.7%' },
  { label: 'K-방산 수출 모멘텀', value: '+15.2%' },
];

function usePipelineStage(loading: boolean, mode: StockFilters['mode']): number {
  const [pipelineStage, setPipelineStage] = useState<number>(-1);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (loading && mode === 'QUANT_SCREEN') {
      setPipelineStage(0);
      timersRef.current = PIPELINE_DELAYS_MS.map((delay, idx) => (
        setTimeout(() => setPipelineStage(idx), delay)
      ));
    } else {
      setPipelineStage(-1);
    }

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [loading, mode]);

  return pipelineStage;
}

function updateFilterValue(filters: StockFilters, name: string, value: string): StockFilters {
  return {
    ...filters,
    [name]: name === 'mode' ? value : Number(value),
  };
}

function recommendationTone(type: StockRecommendation['type']): string {
  return type.includes('BUY') ? 'text-green-400' : 'text-red-400';
}

function formatPrice(value?: number): string {
  return value === undefined ? 'N/A' : `${value.toLocaleString()} KRW`;
}

// 시총 단위는 경로별 혼재(원/억) — marketCapFormat 가 크기로 정규화 후 조(T) 표시.
// (이전 고정 /10000 은 원 단위 snapshot 값을 1e8 배 과대표시).
const formatMarketCap = formatMarketCapTKrw;

function BearModeBanner({
  loading,
  filters,
  onScreen,
}: {
  loading: boolean;
  filters: StockFilters;
  onScreen: (filters: StockFilters) => Promise<void>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-red-950/70 border border-red-500/50 rounded-xl px-5 py-4 flex items-start gap-3"
    >
      <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-red-200">약세장 레짐이 감지되었습니다. 약세장 스크리너를 권장합니다.</p>
        <p className="text-xs text-red-300/80 mt-1">
          Gate -1이 약세장 모드입니다. 이 국면에서는 방어적 약세장 스크리닝 후보가 표준 강세장 스크리너보다 안전합니다.
        </p>
      </div>
      <button
        type="button"
        onClick={() => onScreen({ ...filters, mode: 'BEAR_SCREEN' })}
        disabled={loading}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
      >
        전환
      </button>
    </motion.div>
  );
}

function ScreenerField({
  label,
  name,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  name: keyof StockFilters;
  value: number | string | undefined;
  placeholder: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-gray-500 tracking-tight">{label}</label>
      <input
        type="number"
        name={name}
        value={value ?? ''}
        onChange={onChange}
        className="w-full bg-black/40 border border-white/[0.07] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
        placeholder={placeholder}
      />
    </div>
  );
}

function ModeSelect({
  mode,
  onChange,
}: {
  mode: StockFilters['mode'];
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  return (
    <div className="flex-1 space-y-2">
      <label className="text-xs font-medium text-gray-500 tracking-tight">분석 모드</label>
      <select
        name="mode"
        value={mode}
        onChange={onChange}
        className="w-full bg-black/40 border border-white/[0.07] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50 transition-colors appearance-none"
      >
        {MODE_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function ScreenerForm({
  filters,
  loading,
  onSubmit,
  onInputChange,
}: {
  filters: StockFilters;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  return (
    <div className="bg-[#151619] border border-white/[0.07] rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
          <Filter className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">1단계: 퀀트 스크리너</h2>
          <p className="text-sm text-gray-400">밸류에이션, 재무 상태, 시가총액 필터로 유니버스를 좁힙니다.</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <ScreenerField label="최소 ROE (%)" name="minRoe" value={filters.minRoe} placeholder="예: 15" onChange={onInputChange} />
        <ScreenerField label="최대 PER" name="maxPer" value={filters.maxPer} placeholder="예: 20" onChange={onInputChange} />
        <ScreenerField label="최대 부채비율 (%)" name="maxDebtRatio" value={filters.maxDebtRatio} placeholder="예: 100" onChange={onInputChange} />
        <ScreenerField label="최소 시가총액 (억원)" name="minMarketCap" value={filters.minMarketCap} placeholder="예: 1000" onChange={onInputChange} />
        <div className="md:col-span-2 lg:col-span-3 flex items-center gap-4">
          <ModeSelect mode={filters.mode} onChange={onInputChange} />
          <button
            type="submit"
            disabled={loading}
            className={cn(
              'mt-6 h-[46px] px-8 rounded-lg font-bold flex items-center gap-2 transition-all',
              loading
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
            )}
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
            후보 스크리닝 시작
          </button>
        </div>
      </form>
    </div>
  );
}

function PipelineExplainer() {
  return (
    <div className="bg-[#0f1012] border border-blue-500/20 rounded-xl p-5">
      <p className="text-xs font-semibold tracking-tight text-blue-400 mb-4">5단계 하이브리드 발굴 모드</p>
      <div className="flex items-start gap-0">
        {PIPELINE_STAGES.map((stage, idx) => (
          <React.Fragment key={stage.label}>
            <PipelineStageBadge stage={stage} index={idx} />
            {idx < PIPELINE_STAGES.length - 1 && <div className="w-4 h-0.5 bg-white/10 mt-4 shrink-0" />}
          </React.Fragment>
        ))}
      </div>
      <p className="text-[9px] text-gray-600 mt-4 text-center">
        이 모드는 눈에 띄는 화제의 종목 대신 조용한 초기 주도주를 탐색합니다.
      </p>
    </div>
  );
}

function PipelineStageBadge({ stage, index }: { stage: PipelineStage; index: number }) {
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1">
      <div className={cn('w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-black', stage.border, stage.color)}>
        {index + 1}
      </div>
      <p className={cn('text-[9px] font-bold text-center leading-tight', stage.color)}>{stage.label}</p>
      <p className="text-[8px] text-gray-600 text-center leading-tight hidden sm:block">{stage.desc}</p>
    </div>
  );
}

function PipelineLoading({ stageIndex }: { stageIndex: number }) {
  return (
    <div className="bg-[#151619] border border-white/5 rounded-xl p-8 space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-6 h-6 rounded-full border-2 border-blue-500/40 border-t-blue-500 animate-spin" />
        <p className="text-white font-bold">하이브리드 발굴 파이프라인 실행 중</p>
      </div>
      <div className="space-y-3">
        {PIPELINE_STAGES.map((stage, idx) => (
          <PipelineProgressRow key={stage.label} stage={stage} index={idx} activeIndex={stageIndex} />
        ))}
      </div>
      <p className="text-[10px] text-gray-600 text-center">
        노이즈가 적은 초기 주도주 발굴은 표준 스캔보다 다소 오래 걸릴 수 있습니다.
      </p>
    </div>
  );
}

function PipelineProgressRow({
  stage,
  index,
  activeIndex,
}: {
  stage: PipelineStage;
  index: number;
  activeIndex: number;
}) {
  const isDone = activeIndex > index;
  const isActive = activeIndex === index;
  return (
    <div className={cn(
      'flex items-start gap-3 p-3 rounded-lg border transition-all duration-500',
      isDone ? 'border-green-500/20 bg-green-500/5 opacity-60' :
      isActive ? `${stage.border} bg-white/3` :
      'border-white/5 opacity-30'
    )}>
      <div className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black">
        {isDone ? <span className="text-green-400">OK</span> :
          isActive ? <div className="w-4 h-4 rounded-full border-2 border-t-current border-white/20 animate-spin" /> :
          <span className="text-gray-600">{index + 1}</span>}
      </div>
      <div className="flex-1">
        <p className={cn('text-sm font-bold', isDone ? 'text-green-400' : isActive ? stage.color : 'text-gray-600')}>
          {index + 1}단계: {stage.label}
        </p>
        <p className={cn('text-[10px] mt-0.5', isActive ? 'text-gray-400' : 'text-gray-600')}>{stage.desc}</p>
      </div>
    </div>
  );
}

function StandardLoading() {
  return (
    <div className="bg-[#151619] border border-white/5 rounded-xl p-12 flex flex-col items-center justify-center space-y-4">
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
        <Brain className="w-6 h-6 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <div className="text-center">
        <p className="text-white font-medium">시스템이 후보를 검토하고 있습니다.</p>
        <p className="text-sm text-gray-500 mt-1">스크리너가 주도주 사이클, 거시 적합도, 매물대 품질을 점검하고 있습니다.</p>
      </div>
    </div>
  );
}

function RecommendationList({
  recommendations,
  onStockClick,
}: {
  recommendations: StockRecommendation[];
  onStockClick?: (stock: StockRecommendation) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {recommendations.map((stock, idx) => (
        <RecommendationCard key={stock.code} stock={stock} index={idx} onStockClick={onStockClick} />
      ))}
    </div>
  );
}

function RecommendationCard({
  stock,
  index,
  onStockClick,
}: {
  stock: StockRecommendation;
  index: number;
  onStockClick?: (stock: StockRecommendation) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      onClick={() => onStockClick?.(stock)}
      className="bg-[#151619] border border-white/[0.07] rounded-xl p-5 hover:border-purple-500/30 transition-all group cursor-pointer"
    >
      <div className="flex items-start justify-between">
        <div className="flex gap-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-white/5 text-xl font-bold text-white">
            {stock.name[0]}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-lg font-bold text-white">{stock.name}</h4>
              <span className="text-xs text-gray-500 font-mono">{stock.code}</span>
              {stock.isLeadingSector && <LeadingBadge />}
            </div>
            <p className="text-sm text-gray-400 mt-1 line-clamp-2">{stock.reason}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-white">{formatPrice(stock.currentPrice)}</div>
          <div className={cn('text-xs font-bold mt-1', recommendationTone(stock.type))}>
            {stock.type} {stock.gate ? `(Gate ${stock.gate})` : ''}
          </div>
        </div>
      </div>
      <RecommendationMetrics stock={stock} />
    </motion.div>
  );
}

function LeadingBadge() {
  return (
    <span className="text-[10px] font-bold bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase tracking-tighter">
      주도주
    </span>
  );
}

function RecommendationMetrics({ stock }: { stock: StockRecommendation }) {
  return (
    <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-4">
      <Metric label="ROE" value={stock.valuation?.per ? '확인됨' : '-'} />
      <Metric label="PER" value={`${stock.valuation?.per ?? '-'}x`} />
      <Metric label="부채비율" value={`${stock.valuation?.debtRatio ?? '-'}%`} />
      <Metric label="시가총액" value={formatMarketCap(stock.marketCap)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-gray-500 uppercase font-bold">{label}</div>
      <div className="text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="bg-[#151619] border border-white/5 rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
        <BarChart3 className="w-8 h-8 text-gray-600" />
      </div>
      <div>
        <p className="text-gray-400 font-medium">아직 스크리닝 결과가 없습니다.</p>
        <p className="text-sm text-gray-600 mt-1">필터를 조정하고 새 스크리닝을 실행해 후보를 찾아보세요.</p>
      </div>
    </div>
  );
}

function AnalysisResultsPanel({
  loading,
  mode,
  recommendations,
  pipelineStage,
  onStockClick,
}: {
  loading: boolean;
  mode: StockFilters['mode'];
  recommendations: StockRecommendation[];
  pipelineStage: number;
  onStockClick?: (stock: StockRecommendation) => void;
}) {
  return (
    <div className="lg:col-span-2 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-bold text-white">2단계: 후보 스크리닝 결과</h3>
        </div>
        {recommendations.length > 0 && (
          <span className="text-xs font-medium text-purple-400 bg-purple-400/10 px-2 py-1 rounded border border-purple-400/20">
            후보 {recommendations.length}개
          </span>
        )}
      </div>
      {loading ? (
        mode === 'QUANT_SCREEN' ? <PipelineLoading stageIndex={pipelineStage} /> : <StandardLoading />
      ) : recommendations.length > 0 ? (
        <RecommendationList recommendations={recommendations} onStockClick={onStockClick} />
      ) : (
        <EmptyResults />
      )}
    </div>
  );
}

function StrengthPanel() {
  return (
    <div className="bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20 rounded-xl p-6">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Target className="w-5 h-5 text-purple-400" />
        파이프라인 강점
      </h3>
      <ul className="space-y-4">
        <StrengthItem title="퀀트 검증" body="정성 검토 전에 취약한 재무 상태와 저품질 밸류에이션을 걸러냅니다." />
        <StrengthItem title="내러티브 검토" body="주도주 사이클, 거시 적합도, 매물대 품질로 후보 순위를 매깁니다." />
        <StrengthItem title="리스크 규율" body="단순히 인기 종목을 좇기보다 검증된 셋업을 우선합니다." />
      </ul>
    </div>
  );
}

function StrengthItem({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <div className="mt-1 w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 className="w-3 h-3 text-purple-400" />
      </div>
      <div>
        <p className="text-sm font-bold text-white">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{body}</p>
      </div>
    </li>
  );
}

function TrendPanel() {
  return (
    <div className="bg-[#151619] border border-white/[0.07] rounded-xl p-6">
      <h3 className="text-sm font-bold text-gray-400 tracking-tight mb-4">최근 스크리닝 테마</h3>
      <div className="space-y-3">
        {TREND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
            <span className="text-sm text-gray-300">{item.label}</span>
            <span className="text-xs font-bold text-green-400">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SidePanel() {
  return (
    <div className="space-y-6">
      <StrengthPanel />
      <TrendPanel />
    </div>
  );
}

export const QuantScreener: React.FC<QuantScreenerProps> = ({
  onScreen,
  loading,
  recommendations,
  onStockClick,
  bearRegimeResult,
}) => {
  const isBearMode = bearRegimeResult?.regime === 'BEAR';
  const [localFilters, setLocalFilters] = useState<StockFilters>(INITIAL_FILTERS);
  const pipelineStage = usePipelineStage(loading, localFilters.mode);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setLocalFilters(prev => updateFilterValue(prev, name, value));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onScreen(localFilters);
  };

  return (
    <div className="space-y-6">
      {isBearMode && <BearModeBanner loading={loading} filters={localFilters} onScreen={onScreen} />}
      <ScreenerForm
        filters={localFilters}
        loading={loading}
        onSubmit={handleSubmit}
        onInputChange={handleInputChange}
      />
      {localFilters.mode === 'QUANT_SCREEN' && !loading && <PipelineExplainer />}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AnalysisResultsPanel
          loading={loading}
          mode={localFilters.mode}
          recommendations={recommendations}
          pipelineStage={pipelineStage}
          onStockClick={onStockClick}
        />
        <SidePanel />
      </div>
    </div>
  );
};
