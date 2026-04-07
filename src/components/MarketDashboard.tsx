import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Info, 
  MessageSquare, 
  Hash, 
  Layers, 
  Flame, 
  Zap, 
  Globe, 
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ShieldAlert
} from 'lucide-react';
import { MarketOverview, MarketDataPoint, SnsSentiment } from '../services/stockService';
import { SectorHeatmap } from './SectorHeatmap';
import { EventCalendar } from './EventCalendar';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MarketDashboardProps {
  data: MarketOverview;
  triageSummary?: {
    gate1: number;
    gate2: number;
    gate3: number;
    total: number;
  };
}

const SnsSentimentCard = ({ sentiment }: { sentiment: SnsSentiment }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'EXTREME_GREED': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
      case 'GREED': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'NEUTRAL': return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
      case 'FEAR': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      case 'EXTREME_FEAR': return 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20';
      default: return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'EXTREME_GREED': return '극도의 탐욕';
      case 'GREED': return '탐욕';
      case 'NEUTRAL': return '중립';
      case 'FEAR': return '공포';
      case 'EXTREME_FEAR': return '극도의 공포';
      default: return status;
    }
  };

  return (
    <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-indigo-400" />
          SNS 시장 참여자 분위기
        </h3>
        <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-black border uppercase tracking-widest", getStatusColor(sentiment.status))}>
          {getStatusLabel(sentiment.status)}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-10 items-center">
        <div className="relative w-48 h-48 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="96"
              cy="96"
              r="84"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="16"
            />
            <circle
              cx="96"
              cy="96"
              r="84"
              fill="none"
              stroke="currentColor"
              strokeWidth="16"
              strokeDasharray={527}
              strokeDashoffset={527 - (527 * sentiment.score) / 100}
              strokeLinecap="round"
              className={cn("transition-all duration-1000", getStatusColor(sentiment.status).split(' ')[0])}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-black text-white tracking-tighter">{sentiment.score}</span>
            <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mt-1">Sentiment</span>
          </div>
        </div>

        <div className="flex-1 space-y-6">
          <div className="bg-white/5 p-6 rounded-3xl border border-white/5 italic">
            <p className="text-base text-white/70 leading-relaxed font-medium">
              "{sentiment.summary}"
            </p>
          </div>
          
          <div>
            <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-3 block">실시간 트렌드 키워드</span>
            <div className="flex flex-wrap gap-2">
              {sentiment.trendingKeywords?.map((keyword, idx) => (
                <div key={idx} className="flex items-center gap-2 px-4 py-2 bg-white/5 text-white/60 rounded-xl text-xs font-black border border-white/10 hover:bg-white/10 transition-colors cursor-default">
                  <Hash size={12} className="text-indigo-400" />
                  {keyword}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MarketCard = ({ item }: { item: MarketDataPoint }) => {
  const isPositive = item.change >= 0;
  return (
    <div className="glass-3d p-6 rounded-[2rem] border border-white/10 shadow-xl hover:bg-white/[0.05] transition-all group">
      <div className="flex justify-between items-start mb-4 gap-2">
        <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] truncate" title={item.name}>{item.name}</span>
        <div className={cn(
          "flex items-center px-2 py-1 rounded-lg text-[10px] font-black",
          isPositive ? "bg-red-500/10 text-red-400" : "bg-blue-500/10 text-blue-400"
        )}>
          {isPositive ? <TrendingUp size={12} className="mr-1" /> : <TrendingDown size={12} className="mr-1" />}
          {isPositive ? '+' : ''}{item.changePercent}%
        </div>
      </div>
      <div className="text-3xl font-black text-white tracking-tighter mb-6">
        {item.value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
      </div>
      {item.history && (
        <div className="h-20 w-full opacity-50 group-hover:opacity-100 transition-opacity">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={item.history}>
              <defs>
                <linearGradient id={`color-${item.name.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPositive ? '#ef4444' : '#3b82f6'} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={isPositive ? '#ef4444' : '#3b82f6'} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke={isPositive ? '#ef4444' : '#3b82f6'} 
                fillOpacity={1} 
                fill={`url(#color-${item.name.replace(/\s+/g, '-')})`} 
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

const DynamicWeightsCard = ({ weights }: { weights?: Record<number, number> }) => {
  if (!weights || Object.keys(weights).length === 0) return null;

  const CONDITION_NAMES: Record<number, string> = {
    1: '주도주 사이클', 2: '모멘텀', 3: 'ROE 유형 3', 4: '수급 질', 5: '시장 환경',
    6: '일목균형표', 7: '손절 설정', 8: '경제적 해자', 9: '신규 주도주', 10: '기술적 정배열',
    11: '거래량', 12: '기관/외인 수급', 13: '목표가 여력', 14: '실적 서프라이즈', 15: '실체적 펀더멘털',
    16: '정책/매크로', 17: '심리적 객관성', 18: '터틀 돌파', 19: '피보나치', 20: '엘리엇 파동',
    21: '이익의 질', 22: '마진 가속도', 23: '재무 방어력', 24: '상대강도 RS', 25: 'VCP',
    26: '다이버전스', 27: '촉매제'
  };

  return (
    <div className="glass-3d p-10 rounded-[3rem] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h3 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <Zap className="w-6 h-6 text-yellow-400" />
            AI 동적 가중치 전략 (Dynamic Weighting)
          </h3>
          <p className="text-xs font-bold text-white/30 uppercase tracking-widest mt-2">AI-Driven Adaptive Scoring Strategy</p>
        </div>
        <div className="px-4 py-2 bg-yellow-400/10 border border-yellow-400/20 rounded-2xl">
          <span className="text-[10px] font-black text-yellow-400 uppercase tracking-widest">실시간 최적화 적용 중</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
        {Object.entries(weights).map(([id, multiplier]) => (
          <div key={id} className="bg-white/5 p-6 rounded-3xl border border-white/5 flex flex-col gap-3 group hover:bg-white/10 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">ID {id}</span>
              <div className={cn(
                "w-2 h-2 rounded-full",
                multiplier > 1.0 ? "bg-red-500 animate-pulse" : multiplier < 1.0 ? "bg-blue-500" : "bg-gray-500"
              )} />
            </div>
            <span className="text-sm font-black text-white/80 truncate">{CONDITION_NAMES[Number(id)] || `조건 ${id}`}</span>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-black text-white tracking-tighter">x{multiplier.toFixed(1)}</span>
              <span className={cn(
                "text-[10px] font-black mb-1",
                multiplier > 1.0 ? "text-red-400" : multiplier < 1.0 ? "text-blue-400" : "text-white/20"
              )}>
                {multiplier > 1.0 ? '↑ 상향' : multiplier < 1.0 ? '↓ 하향' : '유지'}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-10 p-6 bg-indigo-500/10 border border-indigo-500/20 rounded-[2rem] flex items-start gap-4">
        <Info className="w-5 h-5 text-indigo-400 mt-1 shrink-0" />
        <p className="text-sm font-medium text-indigo-200/70 leading-relaxed">
          AI가 현재 시장의 변동성, 금리, 환율 및 섹터 순환 데이터를 분석하여 퀀트 엔진의 가중치를 실시간으로 조정합니다. 
          상승장 초기에는 모멘텀 가중치를 높이고, 변동성 확대 시에는 리스크 관리 지표의 비중을 자동으로 강화하여 수익률을 극대화합니다.
        </p>
      </div>
    </div>
  );
};

export const MarketDashboard: React.FC<MarketDashboardProps> = ({ data, triageSummary }) => {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {/* AI Market Summary */}
      <div className="glass-3d p-10 rounded-[3rem] border border-white/10 shadow-2xl relative overflow-hidden group hover:border-white/20 transition-all duration-700">
        <div className="absolute top-0 right-0 p-12 opacity-5 group-hover:opacity-10 transition-opacity duration-700">
          <TrendingUp size={200} />
        </div>
        <div className="absolute -left-20 -bottom-20 w-96 h-96 bg-indigo-500/10 blur-[120px] rounded-full group-hover:bg-indigo-500/20 transition-all duration-1000" />
        <div className="absolute -right-20 -top-20 w-96 h-96 bg-purple-500/10 blur-[120px] rounded-full group-hover:bg-purple-500/20 transition-all duration-1000" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-8">
            <div className="bg-indigo-500/20 p-3 rounded-2xl border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.3)] group-hover:shadow-[0_0_40px_rgba(99,102,241,0.5)] transition-all duration-700">
              <Zap size={24} className="text-indigo-400 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] font-black text-indigo-400/60 uppercase tracking-[0.4em] block mb-1">AI Institutional Grade Analysis</span>
              <h2 className="text-2xl font-black text-white uppercase tracking-tighter drop-shadow-2xl">실시간 시장 지능 요약</h2>
            </div>
          </div>
          <p className="text-xl md:text-3xl font-black text-white/90 leading-tight mb-8 max-w-4xl tracking-tighter drop-shadow-lg">
            {data.summary}
          </p>
          <div className="flex items-center gap-3 text-[10px] font-black text-white/20 uppercase tracking-widest">
            <Clock size={14} />
            <span>최종 업데이트: {data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : '-'}</span>
          </div>
        </div>
      </div>

      {/* 3-Gate Market Triage Summary */}
      {triageSummary && (
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Activity size={80} />
            </div>
            <div className="relative z-10">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-4 block">전체 분석 종목</span>
              <div className="text-4xl font-black text-white tracking-tighter">{triageSummary.total}</div>
              <p className="text-[9px] font-bold text-white/40 mt-2 uppercase tracking-widest">Total Monitored Assets</p>
            </div>
          </div>
          
          <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <ShieldAlert size={80} className="text-red-500" />
            </div>
            <div className="relative z-10">
              <span className="text-[10px] font-black text-red-400/60 uppercase tracking-[0.2em] mb-4 block">Gate 1: 생존 필터 통과</span>
              <div className="text-4xl font-black text-red-400 tracking-tighter">{triageSummary.gate1}</div>
              <div className="h-1.5 bg-white/5 rounded-full mt-4 overflow-hidden">
                <div className="h-full bg-red-500" style={{ width: `${(triageSummary.gate1 / triageSummary.total) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <TrendingUp size={80} className="text-orange-500" />
            </div>
            <div className="relative z-10">
              <span className="text-[10px] font-black text-orange-400/60 uppercase tracking-[0.2em] mb-4 block">Gate 2: 성장 검증 통과</span>
              <div className="text-4xl font-black text-orange-400 tracking-tighter">{triageSummary.gate2}</div>
              <div className="h-1.5 bg-white/5 rounded-full mt-4 overflow-hidden">
                <div className="h-full bg-orange-500" style={{ width: `${(triageSummary.gate2 / triageSummary.total) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Zap size={80} className="text-indigo-500" />
            </div>
            <div className="relative z-10">
              <span className="text-[10px] font-black text-indigo-400/60 uppercase tracking-[0.2em] mb-4 block">Gate 3: 정밀 타이밍 통과</span>
              <div className="text-4xl font-black text-indigo-400 tracking-tighter">{triageSummary.gate3}</div>
              <div className="h-1.5 bg-white/5 rounded-full mt-4 overflow-hidden">
                <div className="h-full bg-indigo-500" style={{ width: `${(triageSummary.gate3 / triageSummary.total) * 100}%` }} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* AI Dynamic Weighting Strategy */}
      <DynamicWeightsCard weights={data.dynamicWeights} />

      {/* Sector Rotation Heatmap */}
      {data.sectorRotation?.topSectors && (
        <SectorHeatmap sectors={data.sectorRotation.topSectors} />
      )}

      {/* Market Phase & Quant Indicators */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Market Phase */}
        <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10 flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-6">
            <Activity className="w-5 h-5 text-purple-400" />
            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">Market Phase</span>
          </div>
          <div className="mb-8">
            <div className={cn(
              "inline-flex items-center gap-3 px-6 py-3 rounded-2xl text-lg font-black uppercase tracking-widest border shadow-2xl",
              data.marketPhase === 'RISK_ON' || data.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
              data.marketPhase === 'RISK_OFF' || data.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" : 
              data.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
              data.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
              "bg-white/10 text-white/40 border-white/10"
            )}>
              {data.marketPhase || 'NEUTRAL'}
            </div>
          </div>
          <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">Active Strategy</span>
            <p className="text-sm font-bold text-white/70">{data.activeStrategy || 'Standard Balanced'}</p>
          </div>
        </div>

        {/* Euphoria Detector */}
        <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <Flame className="w-5 h-5 text-orange-500" />
            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">Euphoria Detector</span>
          </div>
          <div className="flex items-center gap-6 mb-8">
            <div className="text-5xl font-black text-white tracking-tighter">{data.euphoriaSignals?.score || 0}</div>
            <div className="flex-1">
              <div className="h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div 
                  className={cn(
                    "h-full transition-all duration-1000",
                    (data.euphoriaSignals?.score || 0) > 70 ? "bg-red-500" : "bg-orange-500"
                  )}
                  style={{ width: `${data.euphoriaSignals?.score || 0}%` }}
                />
              </div>
              <p className="text-[10px] font-black text-white/30 mt-3 uppercase tracking-widest">
                {data.euphoriaSignals?.status || 'Analyzing...'}
              </p>
            </div>
          </div>
          <p className="text-xs text-white/50 font-medium leading-relaxed">
            시장 과열도를 측정하여 고점 징후를 포착합니다. 70점 이상 시 비중 축소 권고.
          </p>
        </div>

        {/* Regime Shift */}
        <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <Zap className="w-5 h-5 text-yellow-400" />
            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">Regime Shift Detector</span>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-xs font-bold text-white/40 uppercase">Current Regime</span>
              <span className="text-sm font-black text-white">{data.regimeShiftDetector?.currentRegime || 'Stable'}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-xs font-bold text-white/40 uppercase">Shift Probability</span>
              <span className={cn(
                "text-sm font-black",
                (data.regimeShiftDetector?.shiftProbability || 0) > 0.6 ? "text-red-400" : "text-green-400"
              )}>
                {Math.round((data.regimeShiftDetector?.shiftProbability || 0) * 100)}%
              </span>
            </div>
            {data.regimeShiftDetector?.isShiftDetected && (
              <div className="flex items-center gap-2 text-red-400 animate-pulse">
                <ShieldAlert className="w-4 h-4" />
                <span className="text-[10px] font-black uppercase tracking-widest">Regime Shift Detected!</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sector Rotation */}
      {data.sectorRotation && (
        <section>
          <div className="flex items-center gap-4 mb-8">
            <Layers className="w-6 h-6 text-blue-400" />
            <h3 className="text-xl font-black text-white uppercase tracking-tighter">섹터 로테이션 분석 (Sector Rotation)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {data.sectorRotation?.topSectors?.map((sector, i) => (
              <div key={i} className="glass-3d p-6 rounded-[2rem] border border-white/10 relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 text-white/5 font-black text-6xl italic group-hover:scale-110 transition-transform">
                  0{sector.rank}
                </div>
                <div className="relative z-10">
                  <h4 className="text-lg font-black text-white mb-2">{sector.name}</h4>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Strength: {sector.strength}%</span>
                    <div className="flex items-center gap-1 text-green-400">
                      <TrendingUp size={12} />
                      <span className="text-[10px] font-black">Leading</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Major Indices */}
      <section>
        <div className="flex items-center gap-4 mb-8">
          <div className="w-2 h-8 bg-indigo-500 rounded-full" />
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">주요 시장 지수</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {data.indices?.map((idx, i) => (
            <MarketCard key={`${idx.name}-${i}`} item={idx} />
          ))}
        </div>
      </section>

      {/* Global ETF Monitoring */}
      {data.globalEtfMonitoring && (
        <section>
          <div className="flex items-center gap-4 mb-8">
            <Globe className="w-6 h-6 text-indigo-400" />
            <h3 className="text-xl font-black text-white uppercase tracking-tighter">Global ETF Monitoring</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {data.globalEtfMonitoring?.map((etf, i) => {
              const displayLabel = etf.flow ?? (etf.signal === 'BUY' ? 'INFLOW' : etf.signal === 'SELL' ? 'OUTFLOW' : etf.signal ?? '');
              const isInflow = displayLabel === 'INFLOW';
              const displayNote = etf.implication ?? etf.reason ?? '';
              return (
                <div key={i} className="glass-3d p-6 rounded-[2rem] border border-white/10 hover:bg-white/[0.05] transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">{etf.symbol ?? etf.name}</span>
                      {etf.symbol && <h4 className="text-sm font-black text-white truncate max-w-[120px]">{etf.name}</h4>}
                    </div>
                    {displayLabel && (
                      <div className={cn(
                        "px-3 py-1 rounded-lg text-[10px] font-black",
                        isInflow ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                      )}>
                        {displayLabel}
                      </div>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2 mb-4">
                    {etf.price != null && (
                      <span className="text-2xl font-black text-white">${etf.price.toLocaleString()}</span>
                    )}
                    <span className={cn("text-xs font-bold", etf.change >= 0 ? "text-green-400" : "text-red-400")}>
                      {etf.change >= 0 ? '+' : ''}{etf.change}%
                    </span>
                  </div>
                  {displayNote && (
                    <p className="text-[10px] text-white/40 font-medium leading-relaxed line-clamp-2">
                      {displayNote}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sentiment & Macro */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {data.snsSentiment && (
          <SnsSentimentCard sentiment={data.snsSentiment} />
        )}

        <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10 shadow-2xl">
          <h3 className="text-lg font-black text-white uppercase tracking-tighter mb-8 flex items-center gap-3">
            <Globe className="w-5 h-5 text-emerald-400" />
            거시 지표 및 환율
          </h3>
          <div className="grid grid-cols-2 gap-6">
            {data.exchangeRates?.slice(0, 2).map((idx, i) => (
              <div key={`${idx.name}-${i}`} className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">{idx.name}</span>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-black text-white">{idx.value?.toLocaleString() || '0'}</span>
                  <span className={cn("text-[10px] font-black", idx.change >= 0 ? "text-red-400" : "text-blue-400")}>
                    {idx.change >= 0 ? '+' : ''}{idx.changePercent}%
                  </span>
                </div>
              </div>
            ))}
            {data.commodities?.map((idx, i) => (
              <div key={`${idx.name}-${i}`} className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">{idx.name}</span>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-black text-white">{idx.value?.toLocaleString() || '0'}</span>
                  <span className={cn("text-[10px] font-black", idx.change >= 0 ? "text-red-400" : "text-blue-400")}>
                    {idx.change >= 0 ? '+' : ''}{idx.changePercent}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Global Trend Chart */}
      <div className="glass-3d p-10 rounded-[3rem] border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between mb-10">
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">글로벌 지수 통합 추이</h3>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">KOSPI</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">NASDAQ</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">S&P 500</span>
            </div>
          </div>
        </div>
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={(() => {
              const kospi = data.indices.find(idx => 
                (idx.name || '').toUpperCase().includes('KOSPI') || (idx.name || '').includes('코스피')
              );
              const nasdaq = data.indices.find(idx => 
                (idx.name || '').toUpperCase().includes('NASDAQ') || (idx.name || '').includes('나스닥')
              );
              const sp500 = data.indices.find(idx => 
                (idx.name || '').toUpperCase().includes('S&P 500') || (idx.name || '').toUpperCase().includes('SP500') || (idx.name || '').includes('S&P500')
              );

              const baseIndex = kospi || nasdaq || sp500 || data.indices[0];
              if (!baseIndex || !baseIndex.history) return [];

              return baseIndex.history?.map((h, i) => ({
                date: h.date,
                KOSPI: kospi?.history?.[i]?.value || 0,
                NASDAQ: nasdaq?.history?.[i]?.value || 0,
                SP500: sp500?.history?.[i]?.value || 0,
              }));
            })()}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="date" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 10, fill: 'rgba(255,255,255,0.2)', fontWeight: 900}}
                dy={10}
              />
              <YAxis 
                hide 
                domain={['auto', 'auto']}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                  borderRadius: '24px', 
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)'
                }}
                itemStyle={{ fontWeight: 900, fontSize: '12px' }}
              />
              <Line type="monotone" dataKey="KOSPI" stroke="#ef4444" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#ef4444', strokeWidth: 0 }} />
              <Line type="monotone" dataKey="NASDAQ" stroke="#3b82f6" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#3b82f6', strokeWidth: 0 }} />
              <Line type="monotone" dataKey="SP500" stroke="#10b981" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#10b981', strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Macro Event Calendar */}
      {data.upcomingEvents && data.upcomingEvents.length > 0 && (
        <section className="mt-12">
          <EventCalendar events={data.upcomingEvents} />
        </section>
      )}
    </div>
  );
};
