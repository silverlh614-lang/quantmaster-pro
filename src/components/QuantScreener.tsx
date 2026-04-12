import React, { useState, useEffect, useRef } from 'react';
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
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockFilters, StockRecommendation } from '../services/stockService';
import type { BearRegimeResult } from '../types/quant';
import { cn } from '../ui/cn';

interface QuantScreenerProps {
  onScreen: (filters: StockFilters) => Promise<void>;
  loading: boolean;
  recommendations: StockRecommendation[];
  onStockClick?: (stock: StockRecommendation) => void;
  /** Bear Regime 감지 시 Bear Screener 자동 전환 안내용 */
  bearRegimeResult?: BearRegimeResult | null;
}

// ─── 5단계 파이프라인 정의 (QUANT_SCREEN 모드 전용) ──────────────────────────
const PIPELINE_STAGES = [
  { label: '정량 스크리닝', desc: '수치 이상 신호 — 거래량·기관·52주 고가 근접', color: 'text-blue-400', border: 'border-blue-500/40' },
  { label: 'DART 공시 스캔', desc: '수주·설비투자·자사주·내부자매수 탐지', color: 'text-amber-400', border: 'border-amber-500/40' },
  { label: '종목 통합·점수화', desc: '정량 40% + 공시 30% + 뉴스역점수 30%', color: 'text-green-400', border: 'border-green-500/40' },
  { label: '조용한 매집 감지', desc: 'VWAP·기관분할매수·공매도 감소 복합 신호', color: 'text-purple-400', border: 'border-purple-500/40' },
  { label: 'AI 정밀 분석', desc: '수치 변동의 근본 원인 · 27조건 평가', color: 'text-pink-400', border: 'border-pink-500/40' },
] as const;

export const QuantScreener: React.FC<QuantScreenerProps> = ({ onScreen, loading, recommendations, onStockClick, bearRegimeResult }) => {
  const isBearMode = bearRegimeResult?.regime === 'BEAR';

  const [localFilters, setLocalFilters] = useState<StockFilters>({
    minRoe: 15,
    maxPer: 20,
    maxDebtRatio: 100,
    minMarketCap: 1000,
    mode: 'MOMENTUM'
  });

  // ── QUANT_SCREEN 파이프라인 진행 단계 추적 ──────────────────────────────────
  const [pipelineStage, setPipelineStage] = useState<number>(-1); // -1 = 미시작
  const pipelineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // loading 상태가 바뀔 때 파이프라인 스테이지 관리
  useEffect(() => {
    if (loading && localFilters.mode === 'QUANT_SCREEN') {
      setPipelineStage(0);
      // 각 단계는 약 10-15초 간격으로 자동 진행 (실제 완료 시점과 무관한 UI 피드백)
      const delays = [0, 12000, 22000, 32000, 42000];
      delays.forEach((delay, idx) => {
        pipelineTimerRef.current = setTimeout(() => setPipelineStage(idx), delay);
      });
    } else {
      setPipelineStage(-1);
      if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current);
    }
    return () => {
      if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current);
    };
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* Bear Regime 자동 전환 알림 배너 */}
      {isBearMode && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-950/70 border border-red-500/50 rounded-xl px-5 py-4 flex items-start gap-3"
        >
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-red-200">
              🔴 Bear Regime 감지 — Bear Screener 자동 활성화 권고
            </p>
            <p className="text-xs text-red-300/80 mt-1">
              Gate -1이 Bear Mode를 감지했습니다. 기존 27조건 Bull 스크리너 대신{' '}
              <strong className="text-red-200">방어형 Bear Screener</strong>를 사용하십시오.
              스크리닝 페이지 상단의 Bear Screener 패널에서 하락 수혜주를 자동 탐색할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onScreen({ ...localFilters, mode: 'BEAR_SCREEN' })}
            disabled={loading}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            Bear Screener로 전환
          </button>
        </motion.div>
      )}

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
                   <option value="BEAR_SCREEN">[Bear] 하락 수혜주 탐색 (Bear Screener)</option>
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

      {/* QUANT_SCREEN 모드: 파이프라인 흐름 설명 */}
      {localFilters.mode === 'QUANT_SCREEN' && !loading && (
        <div className="bg-[#0f1012] border border-blue-500/20 rounded-xl p-5">
          <p className="text-xs font-black uppercase tracking-widest text-blue-400 mb-4">5단계 파이프라인 — 숨은 종목 발굴 모드</p>
          <div className="flex items-start gap-0">
            {PIPELINE_STAGES.map((stage, idx) => (
              <React.Fragment key={idx}>
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className={`w-8 h-8 rounded-full border-2 ${stage.border} flex items-center justify-center text-[10px] font-black ${stage.color}`}>
                    {idx + 1}
                  </div>
                  <p className={`text-[9px] font-bold text-center leading-tight ${stage.color}`}>{stage.label}</p>
                  <p className="text-[8px] text-gray-600 text-center leading-tight hidden sm:block">{stage.desc}</p>
                </div>
                {idx < PIPELINE_STAGES.length - 1 && (
                  <div className="w-4 h-0.5 bg-white/10 mt-4 shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
          <p className="text-[9px] text-gray-600 mt-4 text-center">
            뉴스 인기도 0% · 수치 이상 신호 100% — AI가 "시끄러운 종목"이 아닌 조용한 초기 주도주를 봅니다
          </p>
        </div>
      )}

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
            localFilters.mode === 'QUANT_SCREEN' ? (
              /* ── QUANT_SCREEN: 5단계 파이프라인 진행 표시 ── */
              <div className="bg-[#151619] border border-white/5 rounded-xl p-8 space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-6 h-6 rounded-full border-2 border-blue-500/40 border-t-blue-500 animate-spin" />
                  <p className="text-white font-bold">2단계 파이프라인 실행 중</p>
                </div>
                <div className="space-y-3">
                  {PIPELINE_STAGES.map((stage, idx) => {
                    const isDone = pipelineStage > idx;
                    const isActive = pipelineStage === idx;
                    return (
                      <div key={idx} className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border transition-all duration-500',
                        isDone ? 'border-green-500/20 bg-green-500/5 opacity-60' :
                        isActive ? `${stage.border} bg-white/3` :
                        'border-white/5 opacity-30'
                      )}>
                        <div className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black">
                          {isDone ? (
                            <span className="text-green-400">✓</span>
                          ) : isActive ? (
                            <div className="w-4 h-4 rounded-full border-2 border-t-current border-white/20 animate-spin" />
                          ) : (
                            <span className="text-gray-600">{idx + 1}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={cn('text-sm font-bold', isDone ? 'text-green-400' : isActive ? stage.color : 'text-gray-600')}>
                            {idx + 1}단계: {stage.label}
                          </p>
                          <p className={cn('text-[10px] mt-0.5', isActive ? 'text-gray-400' : 'text-gray-600')}>
                            {stage.desc}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-600 text-center">
                  뉴스가 없는 조용한 초기 주도주를 발굴합니다 — 완료까지 약 1-2분 소요
                </p>
              </div>
            ) : (
              /* ── 일반 모드: 기본 스피너 ── */
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
            )
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
