// @responsibility analysis 영역 EnemyChecklistSection 컴포넌트
import React from 'react';
import { Skull } from 'lucide-react';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
}

export function EnemyChecklistSection({ result }: Props) {
  if (!result.enemyChecklist) return null;

  return (
    <div className="p-8 border border-theme-text bg-theme-text text-white shadow-[8px_8px_0px_0px_rgba(249,115,22,1)]">
      <div className="flex items-center gap-3 mb-6">
        <Skull className="w-6 h-6 text-orange-500" />
        <h3 className="text-xl font-black uppercase tracking-tight">Enemy's Checklist (Bear Case)</h3>
      </div>
      <div className="space-y-6">
        <div>
          <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest block mb-2">Worst Case Scenario</span>
          <p className="text-sm italic leading-relaxed text-gray-300">"{result.enemyChecklist.bearCase}"</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] font-black text-red-400 uppercase tracking-widest block mb-2">Risk Factors</span>
            <ul className="space-y-1">
              {result.enemyChecklist.riskFactors.map((r, i) => (
                <li key={i} className="text-[10px] flex items-center gap-2">
                  <span className="w-1 h-1 bg-red-400 rounded-full" /> {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest block mb-2">Counter Arguments</span>
            <ul className="space-y-1">
              {result.enemyChecklist.counterArguments.map((c, i) => (
                <li key={i} className="text-[10px] flex items-center gap-2">
                  <span className="w-1 h-1 bg-blue-400 rounded-full" /> {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
