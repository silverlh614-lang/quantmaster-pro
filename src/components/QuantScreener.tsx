import React, { useState } from 'react';
import { 
  Search, 
  Filter, 
  Zap, 
  Brain, 
  ChevronRight, 
  BarChart3, 
  Target,
  AlertCircle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockFilters, StockRecommendation } from '../services/stockService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface QuantScreenerProps {
  onScreen: (filters: StockFilters) => Promise<void>;
  loading: boolean;
  recommendations: StockRecommendation[];
  onStockClick?: (stock: StockRecommendation) => void;
}

export const QuantScreener: React.FC<QuantScreenerProps> = ({ onScreen, loading, recommendations, onStockClick }) => {
  const [localFilters, setLocalFilters] = useState<StockFilters>({
    minRoe: 15,
    maxPer: 20,
    maxDebtRatio: 100,
    minMarketCap: 1000,
    mode: 'MOMENTUM'
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setLocalFilters(prev => ({
      ...prev,
      [name]: name === 'mode' ? value : Number(value)
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onScreen(localFilters);
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Quant Filter Header */}
      <div className="bg-[#151619] border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
            <Filter className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">1단계: 정량적 퀀트 스크리닝</h2>
            <p className="text-sm text-gray-400">재무 지표를 기반으로 2,500개 종목 중 후보군을 압축합니다.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">최소 ROE (%)</label>
            <input
              type="number"
              name="minRoe"
              value={localFilters.minRoe}
              onChange={handleInputChange}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              placeholder="예: 15"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">최대 PER (배)</label>
            <input
              type="number"
              name="maxPer"
              value={localFilters.maxPer}
              onChange={handleInputChange}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              placeholder="예: 20"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">최대 부채비율 (%)</label>
            <input
              type="number"
              name="maxDebtRatio"
              value={localFilters.maxDebtRatio}
              onChange={handleInputChange}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              placeholder="예: 100"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">최소 시가총액 (억원)</label>
            <input
              type="number"
              name="minMarketCap"
              value={localFilters.minMarketCap}
              onChange={handleInputChange}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              placeholder="예: 1000"
            />
          </div>
          
          <div className="md:col-span-2 lg:col-span-3 flex items-center gap-4">
             <div className="flex-1 space-y-2">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">분석 모드</label>
                <select
                  name="mode"
                  value={localFilters.mode}
                  onChange={handleInputChange}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50 transition-colors appearance-none"
                >
                  <option value="MOMENTUM">모멘텀 추종 (주도주 포착)</option>
                  <option value="EARLY_DETECT">선행 신호 탐색 (급등 전 포착)</option>
                  <option value="QUANT_SCREEN">숨은 종목 발굴 (정량+공시+매집)</option>
                </select>
             </div>
             <button
                type="submit"
                disabled={loading}
                className={cn(
                  "mt-6 h-[46px] px-8 rounded-lg font-bold flex items-center gap-2 transition-all",
                  loading 
                    ? "bg-gray-800 text-gray-500 cursor-not-allowed" 
                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20"
                )}
              >
                {loading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Zap className="w-5 h-5" />
                )}
                스크리닝 시작
              </button>
          </div>
        </form>
      </div>

      {/* Step 2: AI Analysis Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-bold text-white">2단계: AI 심층 질적 분석 결과</h3>
            </div>
            {recommendations.length > 0 && (
              <span className="text-xs font-medium text-purple-400 bg-purple-400/10 px-2 py-1 rounded border border-purple-400/20">
                {recommendations.length}개 종목 엄선됨
              </span>
            )}
          </div>

          {loading ? (
            <div className="bg-[#151619] border border-white/5 rounded-xl p-12 flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
                <Brain className="w-6 h-6 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="text-center">
                <p className="text-white font-medium">AI가 후보군을 정밀 분석 중입니다...</p>
                <p className="text-sm text-gray-500 mt-1">현재 주도주 사이클 및 매크로 환경 부합 여부를 검증합니다.</p>
              </div>
            </div>
          ) : recommendations.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {recommendations.map((stock, idx) => (
                <motion.div
                  key={stock.code}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  onClick={() => onStockClick?.(stock)}
                  className="bg-[#151619] border border-white/10 rounded-xl p-5 hover:border-purple-500/30 transition-all group cursor-pointer"
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
                          {stock.isLeadingSector && (
                            <span className="text-[10px] font-bold bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase tracking-tighter">
                              Leading
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">{stock.reason}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-white">{stock.currentPrice?.toLocaleString()}원</div>
                      <div className={cn(
                        "text-xs font-bold mt-1",
                        (stock.type || '').includes('BUY') ? "text-green-400" : "text-red-400"
                      )}>
                        {stock.type} (Gate {stock.gate})
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">ROE</div>
                      <div className="text-sm font-medium text-white">{stock.valuation?.per ? '검증됨' : '-'}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">PER</div>
                      <div className="text-sm font-medium text-white">{stock.valuation?.per}배</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">부채비율</div>
                      <div className="text-sm font-medium text-white">{stock.valuation?.debtRatio}%</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">시가총액</div>
                      <div className="text-sm font-medium text-white">{(stock.marketCap / 10000).toFixed(1)}조</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="bg-[#151619] border border-white/5 rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                <BarChart3 className="w-8 h-8 text-gray-600" />
              </div>
              <div>
                <p className="text-gray-400 font-medium">스크리닝 결과가 없습니다.</p>
                <p className="text-sm text-gray-600 mt-1">상단의 필터를 조정하여 새로운 후보군을 찾아보세요.</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <Target className="w-5 h-5 text-purple-400" />
              2단계 파이프라인의 장점
            </h3>
            <ul className="space-y-4">
              <li className="flex gap-3">
                <div className="mt-1 w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">정량적 검증 (Quant)</p>
                  <p className="text-xs text-gray-400 mt-0.5">재무적으로 탄탄한 종목들로만 후보군을 제한하여 리스크를 원천 차단합니다.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="mt-1 w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">질적 분석 (AI)</p>
                  <p className="text-xs text-gray-400 mt-0.5">AI가 현재 주도주 사이클, 매크로 환경, 수급의 질을 심층 분석하여 최종 3~5개를 엄선합니다.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="mt-1 w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">승률 극대화</p>
                  <p className="text-xs text-gray-400 mt-0.5">"아무 종목이나"가 아닌, 이미 검증된 종목 중 최적의 타이밍을 찾아냅니다.</p>
                </div>
              </li>
            </ul>
          </div>

          <div className="bg-[#151619] border border-white/10 rounded-xl p-6">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">최근 스크리닝 트렌드</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
                <span className="text-sm text-gray-300">저PBR 밸류업</span>
                <span className="text-xs font-bold text-green-400">+12.4%</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
                <span className="text-sm text-gray-300">AI 반도체 소부장</span>
                <span className="text-xs font-bold text-green-400">+8.7%</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
                <span className="text-sm text-gray-300">K-방산 수출 모멘텀</span>
                <span className="text-xs font-bold text-green-400">+15.2%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
