// @responsibility analysis 영역 SeasonalityAttributionSection 컴포넌트
import React from 'react';
import { Calendar, PieChart } from 'lucide-react';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
}

export function SeasonalityAttributionSection({ result }: Props) {
  if (!result.seasonality && !result.attribution) return null;

  return (
    <div className="grid grid-cols-1 gap-8">
      {result.seasonality && (
        <div className="p-8 border border-theme-text bg-white">
          <div className="flex items-center gap-3 mb-6">
            <Calendar className="w-6 h-6 text-purple-500" />
            <h3 className="text-xl font-black uppercase tracking-tight">Seasonality Layer</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-4xl font-black font-mono">{result.seasonality.month}월</span>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Current Month</span>
            </div>
            <div className="text-right">
              <div className="flex gap-4">
                <div>
                  <span className="text-lg font-black text-green-600">+{result.seasonality.historicalPerformance}%</span>
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Avg. Return</span>
                </div>
                <div>
                  <span className="text-lg font-black text-blue-600">{result.seasonality.winRate}%</span>
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Win Rate</span>
                </div>
              </div>
            </div>
          </div>
          {result.seasonality.isPeakSeason && (
            <div className="mt-4 p-2 bg-purple-100 border border-purple-200 text-center">
              <span className="text-[10px] font-black text-purple-700 uppercase tracking-widest">★ PEAK SEASON DETECTED ★</span>
            </div>
          )}
        </div>
      )}

      {result.attribution && (
        <div className="p-8 border border-theme-text bg-white">
          <div className="flex items-center gap-3 mb-6">
            <PieChart className="w-6 h-6 text-green-500" />
            <h3 className="text-xl font-black uppercase tracking-tight">Yield Attribution Analysis</h3>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Sector', value: result.attribution.sectorContribution, color: 'bg-blue-500' },
              { label: 'Momentum', value: result.attribution.momentumContribution, color: 'bg-orange-500' },
              { label: 'Value', value: result.attribution.valueContribution, color: 'bg-green-500' },
              { label: 'Alpha', value: result.attribution.alpha, color: 'bg-purple-500' },
            ].map(item => (
              <div key={item.label}>
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1">
                  <span>{item.label}</span>
                  <span>{item.value}%</span>
                </div>
                <div className="h-1.5 w-full bg-gray-100 border border-theme-text">
                  <div className={`h-full ${item.color}`} style={{ width: `${item.value}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
