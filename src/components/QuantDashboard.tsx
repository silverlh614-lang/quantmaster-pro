import React, { useState } from 'react';
import { EvaluationResult, EconomicRegimeData, ROEType } from '../types/quant';
import { ALL_CONDITIONS, CONDITION_SOURCE_MAP } from '../services/quantEngine';
import { MarketOverview } from '../services/stockService';
import { Shield, Target, Zap, AlertTriangle, TrendingUp, DollarSign, Activity, Layers, Clock, Skull, Calendar, PieChart, Link2, Globe, PlayCircle } from 'lucide-react';
import { TMAPanel } from './TMAPanel';
import { SRRPanel } from './SRRPanel';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MacroIntelligenceDashboard } from './MacroIntelligenceDashboard';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Props {
  result: EvaluationResult;
  economicRegime?: EconomicRegimeData;
  currentRoeType?: ROEType;
  marketOverview?: MarketOverview | null;
  stockCode?: string;
  stockName?: string;
  currentPrice?: number;
  onShadowTrade?: (stockCode: string, stockName: string, currentPrice: number) => void;
}

type DashboardTab = 'QUANT' | 'MACRO';

export const QuantDashboard: React.FC<Props> = ({
  result,
  economicRegime,
  currentRoeType = 3,
  marketOverview,
  stockCode,
  stockName,
  currentPrice,
  onShadowTrade,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('QUANT');
  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case '풀 포지션': return 'text-green-600 border-green-600';
      case '절반 포지션': return 'text-blue-600 border-blue-600';
      case '매도': return 'text-red-600 border-red-600';
      default: return 'text-gray-600 border-gray-600';
    }
  };

  return (
    <div className="p-4 sm:p-8 bg-theme-bg text-theme-text font-sans min-h-screen">
      <header className="mb-8 border-b border-theme-border pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-fluid-4xl font-serif italic tracking-tight">Living Quant System</h1>
          <p className="col-header mt-2">27-Condition Hierarchical Analysis Engine</p>
        </div>
        <div className="text-right">
          <p className="data-value text-sm">REGIME: BULLISH START</p>
          <p className="data-value text-sm">PROFILE: {result.profile.type}</p>
        </div>
      </header>

      {/* ── Tab Navigation ── */}
      <div className="flex gap-0 mb-10 border-b-2 border-theme-text">
        {([
          { id: 'QUANT', label: 'QUANT ANALYSIS', icon: <Target size={14} /> },
          { id: 'MACRO', label: 'MACRO INTELLIGENCE', icon: <Globe size={14} /> },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-6 py-3 text-[11px] font-black uppercase tracking-widest border-2 border-b-0 transition-all',
              activeTab === tab.id
                ? 'bg-theme-text text-theme-bg border-theme-text'
                : 'bg-theme-bg text-theme-text border-theme-text hover:bg-theme-card'
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── MACRO INTELLIGENCE Tab (항상 마운트, 탭 전환 시 hidden으로 상태 보존) ── */}
      <div className={activeTab !== 'MACRO' ? 'hidden' : ''}>
        <MacroIntelligenceDashboard
          gate0Result={result.gate0Result}
          currentRoeType={currentRoeType}
          marketOverview={marketOverview as any}
          externalRegime={economicRegime}
        />
      </div>

      {/* ── QUANT ANALYSIS Tab ── */}
      <div className={activeTab !== 'QUANT' ? 'hidden' : ''}><>

      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        <div className="p-6 border border-theme-text bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4" />
            <h2 className="col-header">FINAL SCORE</h2>
          </div>
          <p className="text-fluid-5xl font-bold font-mono tracking-tighter">{result.finalScore.toFixed(0)}</p>
          <p className="text-xs opacity-50 mt-1">MAX: 270.0</p>
        </div>

        <div className={`p-6 border border-theme-text bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] ${getRecommendationColor(result.recommendation)}`}>
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

      {/* ── Signal Verdict + Confluence + Cycle ────────────────────────── */}
      {result.signalVerdict && (
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
                    }`}>{axis.slice(0,4).toUpperCase()}</span>
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
      )}

      {/* ── Shadow Trading Action Bar ── */}
      {stockCode && stockName && currentPrice && currentPrice > 0 && (
        <div className="mb-12 p-6 border-2 border-dashed border-violet-400 bg-violet-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black text-violet-500 uppercase tracking-widest mb-1">SHADOW TRADING</p>
            <p className="text-sm font-bold text-theme-text">
              {stockName} ({stockCode}) — {currentPrice.toLocaleString()}원
            </p>
            <p className="text-[10px] text-gray-500 mt-1">
              {result.recommendation === '풀 포지션' || result.recommendation === '절반 포지션'
                ? 'Kelly ' + result.positionSize + '% · RRR ' + result.rrr.toFixed(1) + ' — 신호 조건 충족'
                : '관망/매도 신호 — Shadow 기록만 가능'}
            </p>
          </div>
          <button
            onClick={() => onShadowTrade?.(stockCode, stockName, currentPrice)}
            disabled={!onShadowTrade}
            className={cn(
              "flex items-center gap-2 px-6 py-3 font-black text-sm uppercase tracking-widest border-2 transition-all",
              onShadowTrade
                ? "border-violet-500 bg-violet-500 text-white hover:bg-violet-600 active:scale-95"
                : "border-gray-300 bg-gray-200 text-gray-400 cursor-not-allowed"
            )}
          >
            <PlayCircle className="w-4 h-4" />
            모의계좌 실행 / Shadow 기록
          </button>
        </div>
      )}

      {/* 3-Gate Pyramid Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        {/* Gate 1 */}
        <div className={`p-8 border border-theme-text relative ${result.gate1Passed ? 'bg-white' : 'bg-red-50'}`}>
          <div className="absolute -top-3 left-4 bg-theme-bg px-2 text-[10px] font-black uppercase tracking-widest">Gate 1: Survival</div>
          <div className="flex justify-between items-center mb-6">
            <Shield className={`w-8 h-8 ${result.gate1Passed ? 'text-green-600' : 'text-red-600'}`} />
            <span className="data-value text-2xl font-bold">{result.gate1Passed ? 'PASSED' : 'FAILED'}</span>
          </div>
          <div className="space-y-4">
            <p className="text-xs italic opacity-70">"살아있는 종목의 최소 조건"</p>
            <div className="h-2 w-full bg-gray-200 border border-theme-text">
              <div className="h-full bg-theme-text" style={{ width: result.gate1Passed ? '100%' : '40%' }}></div>
            </div>
            <p className="text-[10px] font-mono">SCORE: {result.gate1Score.toFixed(1)}</p>
          </div>
        </div>

        {/* Gate 2 */}
        <div className={`p-8 border border-theme-text relative ${result.gate2Passed ? 'bg-white' : 'bg-gray-100 opacity-50'}`}>
          <div className="absolute -top-3 left-4 bg-theme-bg px-2 text-[10px] font-black uppercase tracking-widest">Gate 2: Growth</div>
          <div className="flex justify-between items-center mb-6">
            <Layers className="w-8 h-8 text-blue-600" />
            <span className="data-value text-2xl font-bold">{result.gate2Passed ? 'VERIFIED' : 'PENDING'}</span>
          </div>
          <div className="space-y-4">
            <p className="text-xs italic opacity-70">"성장성 및 펀더멘털 검증"</p>
            <div className="h-2 w-full bg-gray-200 border border-theme-text">
              <div className="h-full bg-theme-text" style={{ width: `${Math.min(100, (result.gate2Score / 100) * 100)}%` }}></div>
            </div>
            <p className="text-[10px] font-mono">SCORE: {result.gate2Score.toFixed(1)}</p>
          </div>
        </div>

        {/* Gate 3 */}
        <div className={`p-8 border border-theme-text relative ${result.gate3Passed ? 'bg-white' : 'bg-gray-100 opacity-50'}`}>
          <div className="absolute -top-3 left-4 bg-theme-bg px-2 text-[10px] font-black uppercase tracking-widest">Gate 3: Timing</div>
          <div className="flex justify-between items-center mb-6">
            <Zap className={`w-8 h-8 ${result.lastTrigger ? 'text-orange-500 animate-pulse' : 'text-gray-400'}`} />
            <span className="data-value text-2xl font-bold">{result.lastTrigger ? 'TRIGGERED' : 'WAITING'}</span>
          </div>
          <div className="space-y-4">
            <p className="text-xs italic opacity-70">"정밀 진입 타이밍 및 배팅 사이즈"</p>
            <div className="h-2 w-full bg-gray-200 border border-theme-text">
              <div className="h-full bg-theme-text" style={{ width: `${Math.min(100, (result.gate3Score / 100) * 100)}%` }}></div>
            </div>
            <p className="text-[10px] font-mono">SCORE: {result.gate3Score.toFixed(1)}</p>
          </div>
        </div>
      </div>

      {/* ── 27-Condition Checklist with Source Badges ── */}
      {result.conditionScores && (
        <div className="mb-12 p-6 border border-theme-text bg-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[11px] font-black uppercase tracking-widest">27-Condition Detail</h3>
            {/* AI 추정 개수 경고 (STRONG_BUY 계열일 때) */}
            {(() => {
              const sources = result.conditionSources ?? CONDITION_SOURCE_MAP;
              const activeIds = Object.keys(result.conditionScores)
                .map(Number)
                .filter(id => (result.conditionScores![id] ?? 0) >= 5);
              const aiActive = activeIds.filter(id => sources[id] === 'AI').length;
              const total = activeIds.length;
              const isHighSignal = result.recommendation === '풀 포지션' || result.recommendation === '절반 포지션';
              return isHighSignal && total > 0 ? (
                <span className={`text-[9px] font-black px-2 py-1 border ${
                  aiActive / total > 0.5
                    ? 'border-red-400 bg-red-50 text-red-700'
                    : 'border-amber-300 bg-amber-50 text-amber-700'
                }`}>
                  통과 조건 {total}개 중 AI추정 {aiActive}개
                </span>
              ) : null;
            })()}
          </div>

          {/* Gate 1 conditions */}
          <div className="mb-4">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">Gate 1 — Survival</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[1, 3, 5, 7, 9].map(id => {
                const score = result.conditionScores![id] ?? 0;
                const src = (result.conditionSources ?? CONDITION_SOURCE_MAP)[id];
                const passed = score >= 5;
                return (
                  <div key={id} className={`flex items-center gap-2 p-2 border ${passed ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <span className="text-[9px] font-black text-gray-400 w-4 shrink-0">{id}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold truncate">{ALL_CONDITIONS[id].name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="h-1 flex-1 bg-gray-200">
                          <div className={`h-full ${passed ? 'bg-green-500' : 'bg-gray-400'}`} style={{ width: `${score * 10}%` }} />
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
              })}
            </div>
          </div>

          {/* Gate 2 conditions */}
          <div className="mb-4">
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">Gate 2 — Growth</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24].map(id => {
                const score = result.conditionScores![id] ?? 0;
                const src = (result.conditionSources ?? CONDITION_SOURCE_MAP)[id];
                const passed = score >= 5;
                return (
                  <div key={id} className={`flex items-center gap-2 p-2 border ${passed ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                    <span className="text-[9px] font-black text-gray-400 w-4 shrink-0">{id}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold truncate">{ALL_CONDITIONS[id].name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="h-1 flex-1 bg-gray-200">
                          <div className={`h-full ${passed ? 'bg-blue-500' : 'bg-gray-400'}`} style={{ width: `${score * 10}%` }} />
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
              })}
            </div>
          </div>

          {/* Gate 3 conditions */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">Gate 3 — Timing</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[2, 17, 18, 19, 20, 22, 23, 25, 26, 27].map(id => {
                const score = result.conditionScores![id] ?? 0;
                const src = (result.conditionSources ?? CONDITION_SOURCE_MAP)[id];
                const passed = score >= 5;
                return (
                  <div key={id} className={`flex items-center gap-2 p-2 border ${passed ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}>
                    <span className="text-[9px] font-black text-gray-400 w-4 shrink-0">{id}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold truncate">{ALL_CONDITIONS[id].name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="h-1 flex-1 bg-gray-200">
                          <div className={`h-full ${passed ? 'bg-orange-500' : 'bg-gray-400'}`} style={{ width: `${score * 10}%` }} />
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
              })}
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
      )}

      {/* Advanced Quant Sections */}
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
                    "text-xs font-black px-2 py-1 border border-theme-text",
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

      {/* ── TMA 추세 모멘텀 가속도 측정기 (IDEA 7) ── */}
      {result.tma && (
        <div className="mb-8">
          <TMAPanel tmaResult={result.tma} stockName={stockName} />
        </div>
      )}

      {/* ── SRR 섹터 내 상대강도 역전 감지 (IDEA 8) ── */}
      {result.srr && (
        <div className="mb-8">
          <SRRPanel srrResult={result.srr} stockName={stockName} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* Enemy's Checklist */}
        {result.enemyChecklist && (
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
        )}

        {/* Seasonality & Attribution */}
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
      </div>

      {/* Portfolio Correlation */}
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
                style={{ left: `${(result.correlationScore || 0.5) * 100}%` }} 
              />
              <div className="absolute -top-6 left-0 text-[8px] font-black text-gray-400">LOW (-1.0)</div>
              <div className="absolute -top-6 right-0 text-[8px] font-black text-gray-400">HIGH (+1.0)</div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black font-mono">{(result.correlationScore || 0.5).toFixed(2)}</span>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Correlation Index</p>
          </div>
        </div>
        <p className="mt-4 text-[10px] italic text-gray-500">
          * 상관관계가 낮을수록 포트폴리오 분산 효과가 극대화됩니다. (현재: {(result.correlationScore || 0.5) < 0.3 ? '분산 효과 우수' : '중복 위험 주의'})
        </p>
      </div>

      {/* Risk & Alert Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="p-6 border border-theme-text bg-white">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <h2 className="col-header">EUPHORIA DETECTOR</h2>
          </div>
          <div className="flex gap-2 mb-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div 
                key={i} 
                className={`h-8 flex-1 border border-theme-text ${i <= result.euphoriaLevel ? 'bg-orange-500' : 'bg-gray-100'}`}
              ></div>
            ))}
          </div>
          <p className="text-xs font-mono uppercase tracking-widest">
            {result.euphoriaLevel >= 3 ? 'WARNING: OVERHEAT DETECTED - PROFIT TAKING RECOMMENDED' : 'STABLE: NO EUPHORIA DETECTED'}
          </p>
        </div>

        <div className={`p-6 border border-theme-text ${result.emergencyStop ? 'bg-red-600 text-white' : 'bg-white'}`}>
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className={`w-5 h-5 ${result.emergencyStop ? 'text-white' : 'text-red-600'}`} />
            <h2 className={`col-header ${result.emergencyStop ? 'text-white' : ''}`}>EMERGENCY STOP</h2>
          </div>
          <p className="text-2xl font-black italic uppercase mb-2">
            {result.emergencyStop ? 'SYSTEM HALTED' : 'SYSTEM OPERATIONAL'}
          </p>
          <p className="text-xs opacity-70 font-mono">
            {result.emergencyStop ? 'BLACK SWAN EVENT DETECTED. ALL POSITIONS PROTECTED.' : 'NO CRITICAL MARKET ANOMALIES DETECTED.'}
          </p>
        </div>
      </div>

      {/* Footer / Meta */}
      <footer className="mt-12 pt-8 border-t border-theme-text flex justify-between items-center opacity-50">
        <p className="text-[10px] font-mono">LIVING QUANT SYSTEM V2.0 // SELF-EVOLVING BACKTESTING LOOP ACTIVE</p>
        <p className="text-[10px] font-mono">LAST UPDATED: {new Date().toISOString()}</p>
      </footer>

      </></div>
    </div>
  );
};
