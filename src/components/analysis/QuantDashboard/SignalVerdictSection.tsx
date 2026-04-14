import React from 'react';
import type { EvaluationResult } from '../../../types/quant';

const CONFLUENCE_LABELS: Record<'technical' | 'supply' | 'fundamental' | 'macro', string> = {
  technical: 'TECH',
  supply: 'SUPL',
  fundamental: 'FUND',
  macro: 'MACR',
};

interface Props {
  result: EvaluationResult;
}

export function SignalVerdictSection({ result }: Props) {
  if (!result.signalVerdict) return null;

  return (
    <div className="mb-12 space-y-6">
      {/* Signal Grade Banner */}
      <div className={`p-6 border-2 ${
        result.signalVerdict.grade === 'CONFIRMED_STRONG_BUY' ? 'border-emerald-500 bg-emerald-50' :
        result.signalVerdict.grade === 'STRONG_BUY' ? 'border-blue-500 bg-blue-50' :
        result.signalVerdict.grade === 'BUY' ? 'border-indigo-400 bg-indigo-50' :
        result.signalVerdict.grade === 'WATCH' ? 'border-amber-400 bg-amber-50' :
        'border-gray-300 bg-gray-50'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className={`text-2xl font-black uppercase tracking-tight ${
              result.signalVerdict.grade === 'CONFIRMED_STRONG_BUY' ? 'text-emerald-700' :
              result.signalVerdict.grade === 'STRONG_BUY' ? 'text-blue-700' :
              result.signalVerdict.grade === 'BUY' ? 'text-indigo-700' :
              result.signalVerdict.grade === 'WATCH' ? 'text-amber-700' : 'text-gray-600'
            }`}>{result.signalVerdict.grade.replace(/_/g, ' ')}</span>
            <span className="text-xs font-bold px-3 py-1 bg-white border border-gray-200">
              Kelly {result.signalVerdict.kellyPct}%
            </span>
          </div>
          <span className="text-[10px] text-gray-500 font-bold">{result.signalVerdict.positionRule}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[9px] font-black text-green-600 uppercase mb-1">PASSED ({result.signalVerdict.passedConditions.length}/7)</p>
            {result.signalVerdict.passedConditions.map((c, i) => (
              <p key={i} className="text-[10px] text-green-700 font-bold">+ {c}</p>
            ))}
          </div>
          <div>
            <p className="text-[9px] font-black text-red-500 uppercase mb-1">FAILED ({result.signalVerdict.failedConditions.length})</p>
            {result.signalVerdict.failedConditions.map((c, i) => (
              <p key={i} className="text-[10px] text-red-600 font-bold">- {c}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Confluence + Cycle + Catalyst + Reliability Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Confluence */}
        {result.confluence && (
          <div className="border border-gray-200 p-4">
            <p className="text-[9px] font-black uppercase text-gray-400 mb-2">합치 스코어</p>
            <p className="text-2xl font-black">{result.confluence.bullishCount}/4</p>
            <div className="flex gap-1 mt-2">
              {(['technical', 'supply', 'fundamental', 'macro'] as const).map(axis => (
                <span key={axis} className={`text-[8px] font-bold px-1.5 py-0.5 border ${
                  result.confluence![axis] === 'BULLISH' ? 'border-green-300 text-green-700 bg-green-50' :
                  result.confluence![axis] === 'BEARISH' ? 'border-red-300 text-red-700 bg-red-50' :
                  'border-gray-200 text-gray-500'
                }`}>{CONFLUENCE_LABELS[axis]}</span>
              ))}
            </div>
          </div>
        )}
        {/* Cycle */}
        {result.cycleAnalysis && (
          <div className="border border-gray-200 p-4">
            <p className="text-[9px] font-black uppercase text-gray-400 mb-2">사이클 위치</p>
            <span className={`text-lg font-black px-3 py-1 border ${
              result.cycleAnalysis.position === 'EARLY' ? 'border-green-400 text-green-700 bg-green-50' :
              result.cycleAnalysis.position === 'LATE' ? 'border-red-400 text-red-700 bg-red-50' :
              'border-amber-400 text-amber-700 bg-amber-50'
            }`}>{result.cycleAnalysis.position}</span>
            <p className="text-[9px] text-gray-500 mt-2">RS {result.cycleAnalysis.sectorRsRank}% · Kelly ×{result.cycleAnalysis.kellyMultiplier}</p>
          </div>
        )}
        {/* Catalyst */}
        {result.catalystAnalysis && (
          <div className="border border-gray-200 p-4">
            <p className="text-[9px] font-black uppercase text-gray-400 mb-2">촉매 등급</p>
            <span className={`text-lg font-black px-3 py-1 border ${
              result.catalystAnalysis.grade === 'A' ? 'border-green-400 text-green-700 bg-green-50' :
              result.catalystAnalysis.grade === 'C' ? 'border-red-400 text-red-700 bg-red-50' :
              'border-amber-400 text-amber-700 bg-amber-50'
            }`}>Grade {result.catalystAnalysis.grade}</span>
            <p className="text-[9px] text-gray-500 mt-2">{result.catalystAnalysis.type}</p>
          </div>
        )}
        {/* Data Reliability */}
        {result.dataReliability && (
          <div className="border border-gray-200 p-4">
            <p className="text-[9px] font-black uppercase text-gray-400 mb-2">데이터 신뢰도</p>
            <p className={`text-2xl font-black ${result.dataReliability.degraded ? 'text-red-600' : 'text-green-600'}`}>
              {result.dataReliability.reliabilityPct}%
            </p>
            <p className="text-[9px] text-gray-500 mt-2">
              실계산 {result.dataReliability.realDataCount} · AI {result.dataReliability.aiEstimateCount}
            </p>
            {result.dataReliability.degraded && (
              <p className="text-[8px] text-red-500 font-bold mt-1">AI 의존 과다 → BUY 강등</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
