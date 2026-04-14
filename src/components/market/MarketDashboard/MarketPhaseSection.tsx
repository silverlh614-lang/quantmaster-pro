import React from 'react';
import { Activity, Flame, Zap, ShieldAlert } from 'lucide-react';
import { cn } from '../../../ui/cn';

interface MarketPhaseSectionProps {
  marketPhase?: string;
  activeStrategy?: string;
  euphoriaSignals?: {
    score: number;
    status: string;
  };
  regimeShiftDetector?: {
    currentRegime: string;
    shiftProbability: number;
    leadingIndicator: string;
    isShiftDetected?: boolean;
  };
}

export const MarketPhaseSection: React.FC<MarketPhaseSectionProps> = React.memo(({
  marketPhase,
  activeStrategy,
  euphoriaSignals,
  regimeShiftDetector,
}) => (
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
          marketPhase === 'RISK_ON' || marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
          marketPhase === 'RISK_OFF' || marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" :
          marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
          marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
          "bg-white/10 text-white/40 border-white/10"
        )}>
          {marketPhase || 'NEUTRAL'}
        </div>
      </div>
      <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">Active Strategy</span>
        <p className="text-sm font-bold text-white/70">{activeStrategy || 'Standard Balanced'}</p>
      </div>
    </div>

    {/* Euphoria Detector */}
    <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10">
      <div className="flex items-center gap-3 mb-6">
        <Flame className="w-5 h-5 text-orange-500" />
        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">Euphoria Detector</span>
      </div>
      <div className="flex items-center gap-6 mb-8">
        <div className="text-fluid-5xl font-black text-white tracking-tighter">{euphoriaSignals?.score ?? 0}</div>
        <div className="flex-1">
          <div className="h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
            <div
              className={cn(
                "h-full transition-all duration-1000",
                (euphoriaSignals?.score ?? 0) > 70 ? "bg-red-500" : "bg-orange-500"
              )}
              style={{ width: `${euphoriaSignals?.score ?? 0}%` }}
            />
          </div>
          <p className="text-[10px] font-black text-white/30 mt-3 uppercase tracking-widest">
            {euphoriaSignals?.status || 'Analyzing...'}
          </p>
        </div>
      </div>
      <p className="text-xs text-white/50 font-medium leading-relaxed">
        시장 과열도를 측정하여 고점 징후를 포착합니다. 70점 이상 시 비중 축소 권고.
      </p>
    </div>

    {/* Regime Shift Detector */}
    <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10">
      <div className="flex items-center gap-3 mb-6">
        <Zap className="w-5 h-5 text-yellow-400" />
        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">Regime Shift Detector</span>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
          <span className="text-xs font-bold text-white/40 uppercase">Current Regime</span>
          <span className="text-sm font-black text-white">{regimeShiftDetector?.currentRegime || 'Stable'}</span>
        </div>
        <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
          <span className="text-xs font-bold text-white/40 uppercase">Shift Probability</span>
          <span className={cn(
            "text-sm font-black",
            (regimeShiftDetector?.shiftProbability ?? 0) > 0.6 ? "text-red-400" : "text-green-400"
          )}>
            {Math.round((regimeShiftDetector?.shiftProbability ?? 0) * 100)}%
          </span>
        </div>
        {regimeShiftDetector?.isShiftDetected && (
          <div className="flex items-center gap-2 text-red-400 animate-pulse">
            <ShieldAlert className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Regime Shift Detected!</span>
          </div>
        )}
      </div>
    </div>
  </div>
));
