import React, { useState } from 'react';
import {
  Zap,
  Search,
  Calculator,
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  ShieldCheck,
  Activity,
  BarChart3,
  ArrowRight,
  Info,
  Wallet,
  Globe,
} from 'lucide-react';
import { evaluateStock } from '../services/quant/gateEngine';
import { ConditionId, MarketRegime, SectorRotation, EvaluationResult, MacroEnvironment } from '../types/quant';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ManualQuantInputProps {
  regime: MarketRegime;
  sectorRotation: SectorRotation;
}

export const ManualQuantInput: React.FC<ManualQuantInputProps> = ({ regime, sectorRotation }) => {
  const [stockInfo, setStockInfo] = useState({
    name: '',
    code: '',
    currentPrice: '',
  });

  const [indicators, setIndicators] = useState({
    rsi: '50',
    maAlignment: 'UP', // UP, DOWN, NEUTRAL
    ichimokuCloud: 'ABOVE', // ABOVE, BELOW, INSIDE
    foreignBuying: '0', // in billions
    icr: '1.0', // Interest Coverage Ratio
    volumeSurge: false,
    cycleMatch: true,
    roeGrowth: true,
    marketCap: '1000', // in billions
  });

  // Gate 0 매크로 환경 입력
  const [macroInputs, setMacroInputs] = useState({
    bokRateDirection: 'HOLDING' as 'HIKING' | 'HOLDING' | 'CUTTING',
    usdKrw: '1320',
    vkospi: '18',
    vix: '18',
    exportGrowth3mAvg: '0',
    stockExportRatio: '50', // 종목 수출 비중 (0-100%)
  });

  const [result, setResult] = useState<EvaluationResult | null>(null);

  const handleCalculate = () => {
    // Map manual indicators to ConditionId (1-27)
    // This is a simplified mapping for the hybrid mode
    const stockData: Record<number, number> = {};
    
    // Initialize all with 5 (neutral)
    for (let i = 1; i <= 27; i++) {
      stockData[i] = 5;
    }

    // Map inputs to specific conditions
    // Gate 1
    stockData[1] = indicators.cycleMatch ? 9 : 3; // 주도주 사이클
    stockData[3] = indicators.roeGrowth ? 8 : 4; // ROE 유형 3
    stockData[5] = 7; // 시장 환경 (from regime usually)
    stockData[7] = 10; // 기계적 손절 (assumed set)
    stockData[9] = 8; // 신규 주도주

    // Gate 2
    stockData[4] = Number(indicators.foreignBuying) > 0 ? 8 : 4; // 수급 질
    stockData[6] = indicators.ichimokuCloud === 'ABOVE' ? 9 : indicators.ichimokuCloud === 'BELOW' ? 2 : 5; // 일목균형표
    stockData[10] = indicators.maAlignment === 'UP' ? 9 : indicators.maAlignment === 'DOWN' ? 2 : 5; // 기술적 정배열
    stockData[11] = indicators.volumeSurge ? 9 : 5; // 거래량
    stockData[12] = Number(indicators.foreignBuying) > 10 ? 9 : 5; // 기관/외인 수급
    
    // Gate 3
    const rsiVal = Number(indicators.rsi);
    stockData[26] = (rsiVal > 30 && rsiVal < 70) ? 8 : 3; // 다이버전스/RSI
    stockData[23] = Number(indicators.icr) > 3 ? 9 : Number(indicators.icr) > 1 ? 6 : 2; // 재무 방어력 ICR

    // 매크로 환경 구성 (Gate 0 입력)
    const macroEnv: MacroEnvironment = {
      bokRateDirection: macroInputs.bokRateDirection,
      us10yYield: 4.3,          // 기본값
      krUsSpread: -1.3,         // 기본값 (한미 금리 역전)
      m2GrowthYoY: 6.5,         // 기본값
      bankLendingGrowth: 5.0,   // 기본값
      nominalGdpGrowth: 4.0,    // 기본값
      oeciCliKorea: 100,        // 기본값 (중립)
      exportGrowth3mAvg: Number(macroInputs.exportGrowth3mAvg),
      vkospi: Number(macroInputs.vkospi),
      samsungIri: regime.samsungIri,
      vix: Number(macroInputs.vix),
      usdKrw: Number(macroInputs.usdKrw),
    };

    const evaluation = evaluateStock(
      stockData as Record<ConditionId, number>,
      regime,
      'B',
      sectorRotation,
      0,
      false,
      2.5,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      macroEnv,
      Number(macroInputs.stockExportRatio)
    );

    setResult(evaluation);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10 shadow-2xl">
        <div className="flex items-center gap-4 mb-8">
          <div className="bg-indigo-500/20 p-3 rounded-2xl border border-indigo-500/30">
            <Calculator size={24} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tighter">수동 지표 입력 모드</h2>
            <p className="text-xs font-bold text-white/30 uppercase tracking-widest">Manual Indicator Input & Quant Engine</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Basic Info */}
          <div className="space-y-6">
            <h3 className="text-sm font-black text-white/40 uppercase tracking-widest flex items-center gap-2">
              <Info size={14} /> 기본 정보
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">종목명</label>
                <input 
                  type="text" 
                  placeholder="예: HD현대중공업"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                  value={stockInfo.name}
                  onChange={(e) => setStockInfo({...stockInfo, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">종목코드</label>
                <input 
                  type="text" 
                  placeholder="예: 329180"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                  value={stockInfo.code}
                  onChange={(e) => setStockInfo({...stockInfo, code: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">현재가 (원)</label>
              <input 
                type="text" 
                placeholder="예: 245000"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                value={stockInfo.currentPrice}
                onChange={(e) => setStockInfo({...stockInfo, currentPrice: e.target.value})}
              />
            </div>
          </div>

          {/* Indicators */}
          <div className="space-y-6">
            <h3 className="text-sm font-black text-white/40 uppercase tracking-widest flex items-center gap-2">
              <Activity size={14} /> 핵심 기술/재무 지표
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">RSI (14)</label>
                <input 
                  type="number" 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                  value={indicators.rsi}
                  onChange={(e) => setIndicators({...indicators, rsi: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">이자보상배율 (ICR)</label>
                <input 
                  type="number" 
                  step="0.1"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                  value={indicators.icr}
                  onChange={(e) => setIndicators({...indicators, icr: e.target.value})}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">이평선 배열</label>
                <select 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all appearance-none"
                  value={indicators.maAlignment}
                  onChange={(e) => setIndicators({...indicators, maAlignment: e.target.value})}
                >
                  <option value="UP">정배열 ✅</option>
                  <option value="NEUTRAL">혼조세</option>
                  <option value="DOWN">역배열 ❌</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">구름대 위치</label>
                <select 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all appearance-none"
                  value={indicators.ichimokuCloud}
                  onChange={(e) => setIndicators({...indicators, ichimokuCloud: e.target.value})}
                >
                  <option value="ABOVE">구름대 위 ✅</option>
                  <option value="INSIDE">구름대 안</option>
                  <option value="BELOW">구름대 아래 ❌</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">외국인 5일 순매수 (억원)</label>
              <input 
                type="number" 
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                value={indicators.foreignBuying}
                onChange={(e) => setIndicators({...indicators, foreignBuying: e.target.value})}
              />
            </div>
          </div>
        </div>

        {/* Macro Environment Inputs — Gate 0 */}
        <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
          <h3 className="text-sm font-black text-white/40 uppercase tracking-widest flex items-center gap-2">
            <Globe size={14} /> 매크로 환경 (Gate 0)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">한국은행 금리 방향</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all appearance-none"
                value={macroInputs.bokRateDirection}
                onChange={(e) => setMacroInputs({ ...macroInputs, bokRateDirection: e.target.value as any })}
              >
                <option value="HIKING">인상 (Tightening)</option>
                <option value="HOLDING">동결 (Pause)</option>
                <option value="CUTTING">인하 (Easing)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">원/달러 환율 (USD/KRW)</label>
              <input
                type="number"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                value={macroInputs.usdKrw}
                onChange={(e) => setMacroInputs({ ...macroInputs, usdKrw: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">VKOSPI</label>
              <input
                type="number"
                step="0.1"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                value={macroInputs.vkospi}
                onChange={(e) => setMacroInputs({ ...macroInputs, vkospi: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">VIX</label>
              <input
                type="number"
                step="0.1"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                value={macroInputs.vix}
                onChange={(e) => setMacroInputs({ ...macroInputs, vix: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">수출증가율 3MA (%)</label>
              <input
                type="number"
                step="0.1"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                value={macroInputs.exportGrowth3mAvg}
                onChange={(e) => setMacroInputs({ ...macroInputs, exportGrowth3mAvg: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-2">종목 수출 비중 (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500/50 transition-all"
                value={macroInputs.stockExportRatio}
                onChange={(e) => setMacroInputs({ ...macroInputs, stockExportRatio: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <button
            onClick={handleCalculate}
            className="group relative px-12 py-4 bg-indigo-500 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(99,102,241,0.4)] hover:shadow-[0_0_60px_rgba(99,102,241,0.6)] transition-all duration-500"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative flex items-center gap-3">
              <Zap size={20} className="text-white fill-white" />
              <span className="text-lg font-black text-white uppercase tracking-tighter">퀀트 엔진 실행</span>
            </div>
          </button>
        </div>
      </div>

      {/* Result Section */}
      {result && (
        <div className="glass-3d p-10 rounded-[3rem] border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-700">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-12">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-fluid-4xl font-black text-white tracking-tighter">{stockInfo.name || '분석 종목'}</h3>
                <span className="text-sm font-black text-white/20 uppercase tracking-[0.3em]">{stockInfo.code}</span>
              </div>
              <p className="text-sm font-bold text-white/40 uppercase tracking-widest">Quant Engine Evaluation Result</p>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="text-right">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">Final Score</span>
                <div className="text-fluid-5xl font-black text-indigo-400 tracking-tighter">{result.finalScore.toFixed(1)}</div>
              </div>
              <div className={cn(
                "px-8 py-4 rounded-3xl border-2 flex flex-col items-center justify-center min-w-[160px]",
                (result.gate1Passed && result.gate2Passed && result.gate3Passed) ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"
              )}>
                <span className="text-[10px] font-black uppercase tracking-widest mb-1">Status</span>
                <span className="text-2xl font-black uppercase tracking-tighter">
                  {(result.gate1Passed && result.gate2Passed && result.gate3Passed) ? 'PASS ✅' : 'FAIL ❌'}
                </span>
              </div>
            </div>
          </div>

          {/* Gate 0 Result */}
          {result.gate0Result && (
            <div className={cn(
              "p-6 rounded-[2rem] border mb-8",
              result.gate0Result.mhsLevel === 'HIGH'
                ? "bg-emerald-500/10 border-emerald-500/30"
                : result.gate0Result.mhsLevel === 'MEDIUM'
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-red-500/10 border-red-500/30"
            )}>
              <div className="flex items-center gap-3 mb-4">
                <Globe size={18} className={
                  result.gate0Result.mhsLevel === 'HIGH' ? "text-emerald-400"
                    : result.gate0Result.mhsLevel === 'MEDIUM' ? "text-amber-400"
                      : "text-red-400"
                } />
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Gate 0: 거시 환경 생존 게이트</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">MHS 점수</p>
                  <p className={cn(
                    "text-fluid-3xl font-black tracking-tighter",
                    result.gate0Result.mhsLevel === 'HIGH' ? "text-emerald-400"
                      : result.gate0Result.mhsLevel === 'MEDIUM' ? "text-amber-400"
                        : "text-red-400"
                  )}>
                    {result.gate0Result.macroHealthScore}
                    <span className="text-sm text-white/30 ml-1">/100</span>
                  </p>
                  <p className="text-xs font-bold text-white/30 mt-1">
                    {result.gate0Result.mhsLevel === 'HIGH' ? '✅ 정상 운용'
                      : result.gate0Result.mhsLevel === 'MEDIUM' ? `⚠️ MAPC Kelly ${Math.round((1 - result.gate0Result.kellyReduction) * 100)}% 운용`
                        : '🚫 매수 중단'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">금리 사이클</p>
                  <p className="text-lg font-black text-white tracking-tighter">
                    {result.gate0Result.rateCycle === 'TIGHTENING' ? '🔺 긴축'
                      : result.gate0Result.rateCycle === 'EASING' ? '🔻 완화'
                        : '⏸ 동결'}
                  </p>
                  <p className="text-xs font-bold text-white/30 mt-1">
                    {result.gate0Result.rateCycle === 'TIGHTENING' ? 'ICR 기준 강화'
                      : result.gate0Result.rateCycle === 'EASING' ? '성장주 가중치 +20%'
                        : '기본 모드'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">환율 레짐</p>
                  <p className="text-lg font-black text-white tracking-tighter">
                    {result.gate0Result.fxRegime === 'DOLLAR_STRONG' ? '💵 달러 강세'
                      : result.gate0Result.fxRegime === 'DOLLAR_WEAK' ? '🌏 달러 약세'
                        : '〰 중립'}
                  </p>
                  <p className="text-xs font-bold text-white/30 mt-1">
                    FX 조정: {result.fxAdjustmentFactor >= 0 ? '+' : ''}{result.fxAdjustmentFactor.toFixed(2)}pt
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">세부 점수</p>
                  <div className="space-y-0.5 text-[10px] font-bold text-white/40">
                    <p>금리 {result.gate0Result.details.interestRateScore}/25</p>
                    <p>유동성 {result.gate0Result.details.liquidityScore}/25</p>
                    <p>경기 {result.gate0Result.details.economicScore}/25</p>
                    <p>리스크 {result.gate0Result.details.riskScore}/25</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="bg-white/5 p-8 rounded-[2rem] border border-white/5 relative overflow-hidden group">
              <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <ShieldCheck size={80} />
              </div>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-4">Gate 1: 생존 필터</span>
              <div className="flex items-center gap-3">
                {result.gate1Passed ? <CheckCircle2 className="text-green-400" /> : <XCircle className="text-red-400" />}
                <span className="text-xl font-black text-white uppercase tracking-tighter">
                  {result.gate1Passed ? '통과' : '탈락'}
                </span>
              </div>
            </div>

            <div className="bg-white/5 p-8 rounded-[2rem] border border-white/5 relative overflow-hidden group">
              <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <TrendingUp size={80} />
              </div>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-4">Gate 2: 성장 검증</span>
              <div className="flex items-center gap-3">
                {result.gate2Passed ? <CheckCircle2 className="text-green-400" /> : <XCircle className="text-red-400" />}
                <span className="text-xl font-black text-white uppercase tracking-tighter">
                  {result.gate2Passed ? '통과' : '탈락'}
                </span>
              </div>
            </div>

            <div className="bg-white/5 p-8 rounded-[2rem] border border-white/5 relative overflow-hidden group">
              <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Zap size={80} />
              </div>
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-4">Gate 3: 정밀 타이밍</span>
              <div className="flex items-center gap-3">
                {result.gate3Passed ? <CheckCircle2 className="text-green-400" /> : <XCircle className="text-red-400" />}
                <span className="text-xl font-black text-white uppercase tracking-tighter">
                  {result.gate3Passed ? '통과' : '탈락'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-indigo-500/10 p-8 rounded-[2.5rem] border border-indigo-500/20">
              <div className="flex items-center gap-3 mb-6">
                <Wallet className="w-5 h-5 text-indigo-400" />
                <h4 className="text-sm font-black text-white uppercase tracking-widest">Kelly Criterion Position Sizing</h4>
              </div>
              <div className="flex items-end gap-4 mb-4">
                <div className="text-fluid-6xl font-black text-white tracking-tighter">
                  {(result.gate1Passed && result.gate2Passed && result.gate3Passed) ? result.positionSize.toFixed(1) : '0.0'}%
                </div>
                <span className="text-sm font-bold text-white/40 uppercase tracking-widest mb-2">Recommended Weight</span>
              </div>
              <p className="text-xs font-medium text-white/40 leading-relaxed">
                켈리 공식에 기반한 최적 투자 비중입니다. 승률과 손익비를 고려하여 파산 위험을 최소화하면서 복리 수익을 극대화하는 비중을 산출했습니다.
              </p>
            </div>

            <div className="bg-white/5 p-8 rounded-[2.5rem] border border-white/5">
              <div className="flex items-center gap-3 mb-6">
                <BarChart3 className="w-5 h-5 text-purple-400" />
                <h4 className="text-sm font-black text-white uppercase tracking-widest">Risk/Reward Analysis</h4>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Risk-Reward Ratio</span>
                  <span className="text-lg font-black text-white">2.5 : 1</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Stop Loss</span>
                  <span className="text-lg font-black text-red-400">-12.0%</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Target Profit</span>
                  <span className="text-lg font-black text-green-400">+30.0%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
