import React from 'react';
import { ALL_CONDITIONS, CONDITION_SOURCE_MAP } from '../../../services/quant/evolutionEngine';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
}

interface ConditionRowProps {
  id: number;
  result: EvaluationResult;
  passedColor: string;
  barColor: string;
}

function ConditionRow({ id, result, passedColor, barColor }: ConditionRowProps) {
  const score = result.conditionScores![id] ?? 0;
  const src = (result.conditionSources ?? CONDITION_SOURCE_MAP)[id];
  const passed = score >= 5;
  return (
    <div className={`flex items-center gap-2 p-2 border ${passed ? passedColor : 'border-gray-200 bg-gray-50'}`}>
      <span className="text-[9px] font-black text-gray-400 w-4 shrink-0">{id}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold truncate">{ALL_CONDITIONS[id].name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <div className="h-1 flex-1 bg-gray-200">
            <div className={`h-full ${passed ? barColor : 'bg-gray-400'}`} style={{ width: `${score * 10}%` }} />
          </div>
          <span className="text-[9px] font-mono text-gray-500 shrink-0">{score}/10</span>
        </div>
      </div>
      <span className={`text-[8px] font-black px-1 py-0.5 border shrink-0 ${
        src === 'COMPUTED'
          ? 'border-green-400 text-green-700 bg-green-50'
          : 'border-red-300 text-red-600 bg-red-50'
      }`}>{src === 'COMPUTED' ? '실계산' : 'AI'}</span>
    </div>
  );
}

export function ConditionChecklist({ result }: Props) {
  if (!result.conditionScores) return null;

  const sources = result.conditionSources ?? CONDITION_SOURCE_MAP;
  const activeIds = Object.keys(result.conditionScores)
    .map(Number)
    .filter(id => (result.conditionScores![id] ?? 0) >= 5);
  const aiActive = activeIds.filter(id => sources[id] === 'AI').length;
  const total = activeIds.length;
  const isHighSignal = result.recommendation === '풀 포지션' || result.recommendation === '절반 포지션';

  return (
    <div className="mb-12 p-6 border border-theme-text bg-white">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[11px] font-black uppercase tracking-widest">27-Condition Detail</h3>
        {isHighSignal && total > 0 && (
          <span className={`text-[9px] font-black px-2 py-1 border ${
            aiActive / total > 0.5
              ? 'border-red-400 bg-red-50 text-red-700'
              : 'border-amber-300 bg-amber-50 text-amber-700'
          }`}>
            통과 조건 {total}개 중 AI추정 {aiActive}개
          </span>
        )}
      </div>

      {/* Gate 1 conditions */}
      <div className="mb-4">
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">Gate 1 — Survival</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[1, 3, 5, 7, 9].map(id => (
            <ConditionRow key={id} id={id} result={result} passedColor="border-green-200 bg-green-50" barColor="bg-green-500" />
          ))}
        </div>
      </div>

      {/* Gate 2 conditions */}
      <div className="mb-4">
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">Gate 2 — Growth</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24].map(id => (
            <ConditionRow key={id} id={id} result={result} passedColor="border-blue-200 bg-blue-50" barColor="bg-blue-500" />
          ))}
        </div>
      </div>

      {/* Gate 3 conditions */}
      <div>
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">Gate 3 — Timing</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[2, 17, 18, 19, 20, 22, 23, 25, 26, 27].map(id => (
            <ConditionRow key={id} id={id} result={result} passedColor="border-orange-200 bg-orange-50" barColor="bg-orange-500" />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-4 pt-3 border-t border-gray-200">
        <span className="flex items-center gap-1 text-[9px] text-gray-500">
          <span className="inline-block w-3 h-3 border border-green-400 bg-green-50" /> 실계산 — 가격·지표·재무 직접 계산
        </span>
        <span className="flex items-center gap-1 text-[9px] text-gray-500">
          <span className="inline-block w-3 h-3 border border-red-300 bg-red-50" /> AI추정 — Gemini 해석 기반
        </span>
      </div>
    </div>
  );
}
