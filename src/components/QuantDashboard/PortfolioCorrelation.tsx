import React from 'react';
import { Link2 } from 'lucide-react';
import type { EvaluationResult } from '../../types/quant';

interface Props {
  result: EvaluationResult;
}

export function PortfolioCorrelation({ result }: Props) {
  const score = result.correlationScore || 0.5;

  return (
    <div className="mb-12 p-8 border border-theme-text bg-white">
      <div className="flex items-center gap-3 mb-6">
        <Link2 className="w-6 h-6 text-gray-500" />
        <h3 className="text-xl font-black uppercase tracking-tight">Portfolio Correlation</h3>
      </div>
      <div className="flex items-center gap-8">
        <div className="flex-1">
          <div className="h-4 w-full bg-gray-100 border border-theme-text relative">
            <div
              className="absolute top-0 bottom-0 w-1 bg-theme-text"
              style={{ left: `${score * 100}%` }}
            />
            <div className="absolute -top-6 left-0 text-[8px] font-black text-gray-400">LOW (-1.0)</div>
            <div className="absolute -top-6 right-0 text-[8px] font-black text-gray-400">HIGH (+1.0)</div>
          </div>
        </div>
        <div className="text-right">
          <span className="text-2xl font-black font-mono">{score.toFixed(2)}</span>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Correlation Index</p>
        </div>
      </div>
      <p className="mt-4 text-[10px] italic text-gray-500">
        * 상관관계가 낮을수록 포트폴리오 분산 효과가 극대화됩니다. (현재: {score < 0.3 ? '분산 효과 우수' : '중복 위험 주의'})
      </p>
    </div>
  );
}
