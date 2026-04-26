// @responsibility analysis 영역 AdvancedQuantSections 컴포넌트
import React from 'react';
import { Layers, Clock } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
}

export function AdvancedQuantSections({ result }: Props) {
  if (!result.tranchePlan && !result.multiTimeframe) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
      {/* 3-Tranche Plan */}
      {result.tranchePlan && (
        <div className="p-8 border border-theme-text bg-white shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center gap-3 mb-6">
            <Layers className="w-6 h-6 text-orange-500" />
            <h3 className="text-xl font-black uppercase tracking-tight">3-Tranche Scaling Plan</h3>
          </div>
          <div className="space-y-4">
            {[result.tranchePlan.tranche1, result.tranchePlan.tranche2, result.tranchePlan.tranche3].map((t, i) => (
              <div key={i} className="flex items-center justify-between p-4 border border-theme-text bg-[#f9f9f9]">
                <div>
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Tranche {i + 1}</span>
                  <span className="text-sm font-bold">{t?.trigger || '-'}</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-black font-mono">{t?.size || 0}%</span>
                  <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest block">{t?.status || '-'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Multi-Timeframe Analysis */}
      {result.multiTimeframe && (
        <div className="p-8 border border-theme-text bg-white shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center gap-3 mb-6">
            <Clock className="w-6 h-6 text-blue-500" />
            <h3 className="text-xl font-black uppercase tracking-tight">Multi-Timeframe Sync</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.entries(result.multiTimeframe).filter(([k]) => k !== 'consistency').map(([tf, status]) => (
              <div key={tf} className="p-4 border border-theme-text text-center">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">{tf}</span>
                <span className={cn(
                  'text-xs font-black px-2 py-1 border border-theme-text',
                  status === 'BULLISH' ? 'bg-green-100 text-green-700' :
                  status === 'BEARISH' ? 'bg-red-100 text-red-700' : 'bg-gray-100'
                )}>
                  {status}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 bg-theme-text text-white text-center">
            <span className="text-[10px] font-black uppercase tracking-widest">Trend Consistency: </span>
            <span className="text-sm font-bold">{result.multiTimeframe.consistency ? 'SYNCHRONIZED' : 'DIVERGED'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
