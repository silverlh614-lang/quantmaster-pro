import React from 'react';
import { CheckCircle2, Activity, XCircle } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { StockRecommendation } from '../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function GateFilterSection({ stock }: Props) {
  if (!stock.gateEvaluation) return null;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-6 px-4">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">3-Gate Filter Pyramid</h3>
        </div>
        <div className={cn(
          "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2",
          stock.gateEvaluation.isPassed ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"
        )}>
          {stock.gateEvaluation.isPassed ? "Total Pass" : "Failed at Gate " + stock.gateEvaluation.currentGate}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((gateNum) => {
          const gate = stock.gateEvaluation?.[`gate${gateNum}` as keyof typeof stock.gateEvaluation] as any;
          const isCurrent = stock.gateEvaluation?.currentGate === gateNum;
          const isPassed = gate?.isPassed;

          return (
            <div
              key={gateNum}
              className={cn(
                "p-8 rounded-[2.5rem] border transition-all relative overflow-hidden group/gate",
                isPassed ? "bg-green-500/[0.03] border-green-500/20" :
                isCurrent ? "bg-orange-500/[0.03] border-orange-500/20" :
                "bg-white/5 border-white/10 opacity-50"
              )}
            >
              <div className="flex items-center justify-between mb-6">
                <div className={cn(
                  "w-10 h-10 rounded-2xl flex items-center justify-center border",
                  isPassed ? "bg-green-500/20 border-green-500/30 text-green-500" :
                  isCurrent ? "bg-orange-500/20 border-orange-500/30 text-orange-500" :
                  "bg-white/5 border-white/10 text-white/20"
                )}>
                  <span className="text-lg font-black">{gateNum}</span>
                </div>
                {isPassed ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : isCurrent ? (
                  <Activity className="w-5 h-5 text-orange-500 animate-pulse" />
                ) : (
                  <XCircle className="w-5 h-5 text-white/10" />
                )}
              </div>
              <h4 className="text-lg font-black text-white mb-3">
                {gateNum === 1 ? "Survival Filter" : gateNum === 2 ? "Growth Verification" : "Precision Timing"}
              </h4>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-black text-white tracking-tighter">{gate?.score || 0}</span>
                <span className="text-xs font-bold text-white/20 uppercase tracking-widest">Score</span>
              </div>
              <p className="text-xs text-white/50 leading-relaxed font-bold">
                {gate?.reason || "Waiting for evaluation..."}
              </p>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
