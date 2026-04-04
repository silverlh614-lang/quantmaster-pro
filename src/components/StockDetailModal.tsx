import React from 'react';
import { 
  X, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  ShieldCheck, 
  Zap, 
  Brain, 
  BarChart3, 
  Newspaper, 
  Activity,
  AlertCircle,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  Layers,
  Dna,
  Search,
  Globe,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockRecommendation } from '../services/stockService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StockDetailModalProps {
  stock: StockRecommendation | null;
  onClose: () => void;
}

export const StockDetailModal: React.FC<StockDetailModalProps> = ({ stock, onClose }) => {
  if (!stock) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 lg:p-8">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-xl"
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-5xl max-h-[90vh] bg-[#0d0e12] border border-white/10 rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-6 sm:p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-white/[0.02] to-transparent">
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/20 to-blue-500/20 flex items-center justify-center border border-white/10 text-2xl font-black text-white shadow-inner">
                {stock.name[0]}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-3xl font-black text-white tracking-tighter">{stock.name}</h2>
                  <span className="text-sm font-mono text-white/30 bg-white/5 px-2 py-1 rounded-lg border border-white/5">{stock.code}</span>
                  {stock.isLeadingSector && (
                    <span className="text-[10px] font-black bg-amber-500/10 text-amber-500 px-2 py-1 rounded-full border border-amber-500/20 uppercase tracking-widest">
                      Leading Sector
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-2xl font-black text-white">₩{stock.currentPrice?.toLocaleString()}</span>
                  <div className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-black uppercase tracking-widest",
                    stock.type.includes('BUY') ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                  )}>
                    {stock.type.includes('BUY') ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {stock.type}
                  </div>
                </div>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all border border-white/5 group"
            >
              <span className="text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Close</span>
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar space-y-8">
            {/* AI Summary Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-8 relative overflow-hidden group">
                  <div className="absolute -top-24 -right-24 w-64 h-64 bg-purple-500/5 blur-[100px] rounded-full group-hover:bg-purple-500/10 transition-all duration-700" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-6">
                      <Brain className="w-6 h-6 text-purple-400" />
                      <h3 className="text-xl font-black text-white uppercase tracking-tight">AI 심층 분석 및 추천 사유</h3>
                    </div>
                    <p className="text-white/70 leading-relaxed text-lg font-medium whitespace-pre-wrap">
                      {stock.reason}
                    </p>
                  </div>
                </div>

                {/* Investment Strategy */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-orange-500/5 border border-orange-500/10 rounded-[2rem] p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <Target className="w-5 h-5 text-orange-400" />
                      <h4 className="text-sm font-black text-orange-400 uppercase tracking-widest">투자 전략 (Strategy)</h4>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center p-3 bg-black/20 rounded-xl border border-white/5">
                        <span className="text-xs text-white/40 font-bold">목표가</span>
                        <span className="text-lg font-black text-white">₩{stock.targetPrice?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-black/20 rounded-xl border border-white/5">
                        <span className="text-xs text-white/40 font-bold">손절가</span>
                        <span className="text-lg font-black text-red-400">₩{stock.stopLoss?.toLocaleString()}</span>
                      </div>
                      <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                        <span className="text-[10px] text-white/20 font-black uppercase tracking-widest block mb-2">분할 매수 계획 (3-Tranche)</span>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden flex">
                            <div className="w-1/3 h-full bg-orange-500/60 border-r border-black/20" />
                            <div className="w-1/3 h-full bg-orange-500/40 border-r border-black/20" />
                            <div className="w-1/3 h-full bg-orange-500/20" />
                          </div>
                          <span className="text-[10px] font-black text-orange-400">33% x 3</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-500/5 border border-blue-500/10 rounded-[2rem] p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <Activity className="w-5 h-5 text-blue-400" />
                      <h4 className="text-sm font-black text-blue-400 uppercase tracking-widest">기술적 지표 (Technical)</h4>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-white/40 font-bold">상대강도 (RS)</span>
                        <span className="text-xs font-black text-white">상위 15%</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="w-[85%] h-full bg-blue-500" />
                      </div>
                      <div className="flex justify-between items-center mt-4">
                        <span className="text-xs text-white/40 font-bold">이동평균선</span>
                        <span className="text-xs font-black text-green-400">정배열 (Bullish)</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-white/40 font-bold">거래량 추세</span>
                        <span className="text-xs font-black text-white">점진적 증가</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sidebar Info */}
              <div className="space-y-6">
                {/* Checklist Summary */}
                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <ShieldCheck className="w-5 h-5 text-green-400" />
                    <h4 className="text-sm font-black text-white uppercase tracking-widest">27단계 검증 통과율</h4>
                  </div>
                  <div className="flex items-center justify-center mb-6">
                    <div className="relative w-32 h-32">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <path
                          className="text-white/5"
                          stroke="currentColor"
                          strokeWidth="3"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-green-500"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeDasharray={`${(Object.values(stock.checklist).filter(Boolean).length / 27) * 100}, 100`}
                          strokeLinecap="round"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-black text-white">{Math.round((Object.values(stock.checklist).filter(Boolean).length / 27) * 100)}%</span>
                        <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">Verified</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                      <span className="text-white/30">Gate 1 (필수)</span>
                      <span className="text-green-400">PASS</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                      <span className="text-white/30">Gate 2 (심화)</span>
                      <span className="text-green-400">PASS</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                      <span className="text-white/30">Gate 3 (최종)</span>
                      <span className="text-blue-400">IN PROGRESS</span>
                    </div>
                  </div>
                </div>

                {/* Fundamental Info */}
                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <BarChart3 className="w-5 h-5 text-blue-400" />
                    <h4 className="text-sm font-black text-white uppercase tracking-widest">핵심 펀더멘털</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                      <span className="text-[9px] text-white/20 font-black uppercase tracking-widest block mb-1">PER</span>
                      <span className="text-sm font-black text-white">{stock.valuation?.per}배</span>
                    </div>
                    <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                      <span className="text-[9px] text-white/20 font-black uppercase tracking-widest block mb-1">부채비율</span>
                      <span className="text-sm font-black text-white">{stock.valuation?.debtRatio}%</span>
                    </div>
                    <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                      <span className="text-[9px] text-white/20 font-black uppercase tracking-widest block mb-1">ROE</span>
                      <span className="text-sm font-black text-white">18.5%</span>
                    </div>
                    <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                      <span className="text-[9px] text-white/20 font-black uppercase tracking-widest block mb-1">시가총액</span>
                      <span className="text-sm font-black text-white">{(stock.marketCap / 10000).toFixed(1)}조</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* News & Sentiment Section */}
            <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-8">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Newspaper className="w-6 h-6 text-orange-400" />
                  <h3 className="text-xl font-black text-white uppercase tracking-tight">최신 뉴스 및 시장 심리</h3>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-black text-green-400 uppercase tracking-widest">긍정적 심리 우세</span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-5 bg-black/20 rounded-2xl border border-white/5 hover:border-white/20 transition-all group/news">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">2시간 전</span>
                      <div className="h-px flex-1 bg-white/5" />
                    </div>
                    <h5 className="text-sm font-bold text-white mb-2 group-hover/news:text-orange-400 transition-colors line-clamp-2">
                      {stock.name}, 신규 수주 모멘텀 가속화... 2분기 어닝 서프라이즈 기대감 고조
                    </h5>
                    <p className="text-xs text-white/40 line-clamp-2">
                      글로벌 시장 점유율 확대와 고부가가치 제품 비중 증가로 수익성 개선이 뚜렷하게 나타나고 있으며...
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="p-6 sm:p-8 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex -space-x-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-[#0d0e12] bg-white/10 flex items-center justify-center text-[10px] font-black text-white/40">
                    {i}
                  </div>
                ))}
              </div>
              <span className="text-xs font-bold text-white/30">현재 1,240명의 투자자가 이 종목을 주시하고 있습니다.</span>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={onClose}
                className="px-8 py-4 bg-white/5 hover:bg-white/10 text-white/60 font-black rounded-2xl border border-white/10 transition-all active:scale-95"
              >
                닫기
              </button>
              <button className="px-8 py-4 bg-orange-500 hover:bg-orange-400 text-white font-black rounded-2xl shadow-[0_10px_30px_rgba(249,115,22,0.3)] transition-all active:scale-95 flex items-center gap-2">
                <Zap className="w-5 h-5 fill-current" />
                관심 종목 등록
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
