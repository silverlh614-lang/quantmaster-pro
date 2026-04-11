import React, { useState } from 'react';
import {
  Info, RefreshCw, ShieldCheck, HelpCircle, Zap, TrendingUp,
  Target, CheckCircle2, Shield
} from 'lucide-react';
import { motion } from 'motion/react';
import { performWalkForwardAnalysis, WalkForwardAnalysis } from '../services/stockService';
import { toast } from 'sonner';
import { cn } from '../ui/cn';

export const WalkForwardView: React.FC = () => {
  const [walkForwardAnalysis, setWalkForwardAnalysis] = useState<WalkForwardAnalysis | null>(null);
  const [analyzingWalkForward, setAnalyzingWalkForward] = useState(false);

  const handleWalkForwardAnalysis = async () => {
    setAnalyzingWalkForward(true);
    setWalkForwardAnalysis(null);
    try {
      const result = await performWalkForwardAnalysis();
      if (result) {
        setWalkForwardAnalysis(result);
        toast.success('Walk-Forward Analysis가 완료되었습니다.');
      } else {
        toast.error('분석 결과를 가져오지 못했습니다.');
      }
    } catch (err: any) {
      console.error(err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');

      if (isRateLimit) {
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        toast.error('분석 중 오류가 발생했습니다.');
      }
    } finally {
      setAnalyzingWalkForward(false);
    }
  };

  return (
    <motion.div
      key="walk-forward-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-12"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-3 h-10 bg-purple-500 rounded-full shadow-[0_0_20px_rgba(168,85,247,0.5)]" />
            <h2 className="text-fluid-4xl font-black text-white tracking-tighter uppercase">Walk-Forward Analysis</h2>
          </div>
          <div className="flex flex-col gap-4">
            <p className="text-white/40 font-medium max-w-2xl text-lg leading-relaxed">
              Walk-Forward Analysis는 과거의 성공이 미래에도 이어질 수 있는지 검증하는 시뮬레이션입니다. 2025년 데이터로 학습한 전략이 2026년의 새로운 시장 환경에서도 유효한지 확인하여, 단순한 '과거 끼워맞추기'가 아닌 실전에서도 작동하는 강건한 전략인지 판별합니다.
            </p>
            <div className="flex items-center gap-2">
              <div className="px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full flex items-center gap-2">
                <Info className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">In-Sample: 2025 (Training)</span>
              </div>
              <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full flex items-center gap-2">
                <Info className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Out-of-Sample: 2026 Q1 (Testing)</span>
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={handleWalkForwardAnalysis}
          disabled={analyzingWalkForward}
          className="flex items-center gap-4 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-10 py-5 rounded-[2.5rem] font-black text-lg transition-all shadow-[0_10px_40px_rgba(168,85,247,0.3)] active:scale-95"
        >
          {analyzingWalkForward ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ShieldCheck className="w-6 h-6" />}
          <span>{analyzingWalkForward ? '분석 중...' : '분석 실행'}</span>
        </button>
      </div>

      {walkForwardAnalysis ? (
        <div className="space-y-10">
          {/* WFA Guide Section */}
          <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
            <div className="flex items-center gap-3 mb-6">
              <HelpCircle className="w-5 h-5 text-purple-400" />
              <h4 className="text-lg font-black text-white uppercase tracking-tighter">분석 기준 가이드</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="space-y-2">
                <div className="text-[11px] font-black text-purple-400 uppercase tracking-widest">Robustness Score</div>
                <p className="text-xs text-white/60 leading-relaxed font-bold">
                  전략이 과거 데이터(In-Sample)와 실전 데이터(Out-of-Sample)에서 얼마나 일관된 성과를 내는지 측정합니다. 80점 이상이면 실전 적합성이 매우 높음을 의미합니다.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-black text-yellow-400 uppercase tracking-widest">과최적화 위험도</div>
                <p className="text-xs text-white/60 leading-relaxed font-bold">
                  전략이 특정 과거 시점에만 유리하게 맞춰졌을(Overfitting) 가능성을 분석합니다. 위험도가 'HIGH'일 경우, 시장 환경 변화 시 성과가 급격히 하락할 수 있습니다.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-black text-blue-400 uppercase tracking-widest">트렌드 적응력</div>
                <p className="text-xs text-white/60 leading-relaxed font-bold">
                  AI 및 반도체, 밸류업 프로그램 등 현재 시장을 주도하는 핵심 테마에 전략이 얼마나 민감하게 반응하고 수익화하는지 평가합니다.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-black text-emerald-400 uppercase tracking-widest">성과 지표 (IS vs OOS)</div>
                <p className="text-xs text-white/60 leading-relaxed font-bold">
                  과거(IS)와 실전(OOS)의 성과를 비교합니다. 실전 성과가 과거 성과의 70% 이상을 유지하는 것이 전략의 지속 가능성을 판단하는 핵심 기준입니다.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-6 py-3 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
            <Info className="w-4 h-4 text-blue-400" />
            <p className="text-[11px] text-white/40 font-medium">
              <span className="text-blue-400 font-black mr-1">AI 분석 안내:</span>
              실시간 시장 데이터 검색 및 AI 추론 모델의 특성상 실행 시마다 스코어가 미세하게 변동될 수 있습니다. 이는 최신 트렌드를 반영하기 위한 정상적인 과정입니다.
            </p>
          </div>

          {/* Robustness Score Hero */}
          <div className="glass-3d rounded-[3rem] p-12 border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 blur-[100px] -mr-48 -mt-48" />
            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div className="text-center lg:text-left">
                <span className="text-[11px] font-black text-purple-400 uppercase tracking-[0.4em] block mb-4">Robustness Score</span>
                <div className="text-8xl font-black text-white tracking-tighter mb-6">
                  {walkForwardAnalysis.robustnessScore}<span className="text-4xl text-white/20">/100</span>
                </div>
                <div className={cn(
                  "inline-flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-black uppercase tracking-widest",
                  walkForwardAnalysis.robustnessScore >= 80 ? "bg-green-500/20 text-green-400" :
                  walkForwardAnalysis.robustnessScore >= 60 ? "bg-yellow-500/20 text-yellow-400" :
                  "bg-red-500/20 text-red-400"
                )}>
                  {walkForwardAnalysis.robustnessScore >= 80 ? 'Highly Robust' :
                   walkForwardAnalysis.robustnessScore >= 60 ? 'Moderately Robust' : 'Low Robustness'}
                </div>
              </div>
              <div className="space-y-6">
                <div className="bg-white/5 rounded-[2rem] p-8 border border-white/10">
                  <div className="flex items-center gap-4 mb-4">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">과최적화 위험도</span>
                  </div>
                  <div className="text-2xl font-black text-white">{walkForwardAnalysis.overfittingRisk}</div>
                </div>
                <div className="bg-white/5 rounded-[2rem] p-8 border border-white/10">
                  <div className="flex items-center gap-4 mb-4">
                    <TrendingUp className="w-5 h-5 text-blue-400" />
                    <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">트렌드 적응력</span>
                  </div>
                  <div className="text-2xl font-black text-white">{walkForwardAnalysis.trendAdaptability.overall}/100</div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] font-black text-white/20 uppercase mb-1">AI & Semi</div>
                      <div className="text-sm font-black text-white">{walkForwardAnalysis.trendAdaptability.aiSemiconductor}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-black text-white/20 uppercase mb-1">Value-Up</div>
                      <div className="text-sm font-black text-white">{walkForwardAnalysis.trendAdaptability.valueUp}%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Detailed Analysis Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
              <div className="flex items-center gap-4 mb-8">
                <Target className="w-6 h-6 text-orange-400" />
                <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">핵심 인사이트</span>
              </div>
              <div className="space-y-4">
                {(walkForwardAnalysis.insights || []).map((insight, i) => (
                  <div key={i} className="flex gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="w-6 h-6 bg-orange-500/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-[10px] font-black text-orange-400">{i + 1}</span>
                    </div>
                    <p className="text-sm text-white/70 font-bold leading-relaxed">{insight}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
              <div className="flex items-center gap-4 mb-8">
                <RefreshCw className="w-6 h-6 text-blue-400" />
                <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">전략 최적화 권고</span>
              </div>
              <div className="space-y-4">
                {(walkForwardAnalysis.recommendations || []).map((rec, i) => (
                  <div key={i} className="flex gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="w-6 h-6 bg-blue-500/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <p className="text-sm text-white/70 font-bold leading-relaxed">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em] block mb-10">성과 지표 비교 (IS vs OOS)</span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {Object.entries(walkForwardAnalysis.metrics).map(([key, value]) => {
                const v = value as { inSample: string | number; outOfSample: string | number };
                return (
                <div key={key} className="bg-white/5 rounded-2xl p-6 border border-white/5">
                  <div className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-4">
                    {key === 'sharpeRatio' ? 'Sharpe Ratio' :
                     key === 'maxDrawdown' ? 'Max Drawdown' :
                     key === 'winRate' ? 'Win Rate' : key}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[9px] font-black text-white/10 uppercase mb-1">In-Sample (2025)</div>
                      <div className="text-lg font-black text-white">{v.inSample}</div>
                    </div>
                    <div className="w-px h-8 bg-white/10" />
                    <div className="text-right">
                      <div className="text-[9px] font-black text-white/10 uppercase mb-1">Out-of-Sample (2026 Q1)</div>
                      <div className="text-lg font-black text-purple-400">{v.outOfSample}</div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="py-32 flex flex-col items-center justify-center glass-3d rounded-[3rem] border border-white/10 border-dashed">
          <Shield className="w-16 h-16 text-white/10 mb-6" />
          <h3 className="text-2xl font-black text-white/20 mb-3">분석 결과가 없습니다</h3>
          <p className="text-base text-white/10 font-bold">상단의 '분석 실행' 버튼을 눌러 Walk-Forward 분석을 시작하세요.</p>
        </div>
      )}
    </motion.div>
  );
};
