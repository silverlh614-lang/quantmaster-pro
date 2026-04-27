// @responsibility analysis 영역 GateFilterSection 컴포넌트
import React from 'react';
import { CheckCircle2, Activity, XCircle } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function GateFilterSection({ stock }: Props) {
  if (!stock.gateEvaluation) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 bg-blue-500 rounded-full" />
          <h3 className="text-base font-black text-white uppercase tracking-tighter">3-Gate Filter Pyramid</h3>
        </div>
        <div className={cn(
          "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
          stock.gateEvaluation.isPassed ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"
        )}>
          {stock.gateEvaluation.isPassed ? "Total Pass" : "Failed at Gate " + stock.gateEvaluation.currentGate}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[1, 2, 3].map((gateNum) => {
          const gate = stock.gateEvaluation?.[`gate${gateNum}` as keyof typeof stock.gateEvaluation] as any;
          const isCurrent = stock.gateEvaluation?.currentGate === gateNum;
          const isPassed = gate?.isPassed;

          return (
            <div
              key={gateNum}
              className={cn(
                "p-5 rounded-2xl border transition-all relative overflow-hidden",
                isPassed ? "bg-green-500/[0.03] border-green-500/20" :
                isCurrent ? "bg-orange-500/[0.03] border-orange-500/20" :
                "bg-white/5 border-white/10 opacity-50"
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center border",
                  isPassed ? "bg-green-500/20 border-green-500/30 text-green-500" :
                  isCurrent ? "bg-orange-500/20 border-orange-500/30 text-orange-500" :
                  "bg-white/5 border-white/10 text-white/20"
                )}>
                  <span className="text-sm font-black">{gateNum}</span>
                </div>
                {isPassed ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : isCurrent ? (
                  <Activity className="w-4 h-4 text-orange-500 animate-pulse" />
                ) : (
                  <XCircle className="w-4 h-4 text-white/10" />
                )}
              </div>
              <h4 className="text-sm font-black text-white mb-1.5">
                {gateNum === 1 ? "Survival Filter" : gateNum === 2 ? "Growth Verification" : "Precision Timing"}
              </h4>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-2xl font-black text-white tracking-tighter">{gate?.score || 0}</span>
                <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Score</span>
              </div>
              <p className="text-[11px] text-white/50 leading-relaxed font-bold">
                {gate?.reason || "Waiting for evaluation..."}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
