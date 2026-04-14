import React from 'react';
import { Target, Activity, DollarSign, TrendingUp } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
}

function getRecommendationColor(rec: string) {
  switch (rec) {
    case '풀 포지션': return 'text-green-600 border-green-600';
    case '절반 포지션': return 'text-blue-600 border-blue-600';
    case '매도': return 'text-red-600 border-red-600';
    default: return 'text-gray-600 border-gray-600';
  }
}

export function MainStatsRow({ result }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
      <div className="p-6 border border-theme-text bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4" />
          <h2 className="col-header">FINAL SCORE</h2>
        </div>
        <p className="text-fluid-5xl font-bold font-mono tracking-tighter">{result.finalScore.toFixed(0)}</p>
        <p className="text-xs opacity-50 mt-1">MAX: 270.0</p>
      </div>

      <div className={cn('p-6 border border-theme-text bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]', getRecommendationColor(result.recommendation))}>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4" />
          <h2 className="col-header">RECOMMENDATION</h2>
        </div>
        <p className="text-2xl font-black uppercase italic">{result.recommendation}</p>
        <p className="text-xs opacity-50 mt-1">DYNAMIC SCORING APPLIED</p>
      </div>

      <div className="p-6 border border-theme-text bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-4 h-4" />
          <h2 className="col-header">POSITION SIZE</h2>
        </div>
        <p className="text-fluid-5xl font-bold font-mono tracking-tighter">{result.positionSize}%</p>
        <p className="text-xs opacity-50 mt-1">KELLY CRITERION ADJUSTED</p>
      </div>

      <div className="p-6 border border-theme-text bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4" />
          <h2 className="col-header">RRR (RISK-REWARD)</h2>
        </div>
        <p className="text-fluid-5xl font-bold font-mono tracking-tighter">{result.rrr.toFixed(1)}</p>
        <p className="text-xs opacity-50 mt-1">MIN THRESHOLD: 2.0</p>
      </div>
    </div>
  );
}
