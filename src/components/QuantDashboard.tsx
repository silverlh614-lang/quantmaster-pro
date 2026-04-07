import React, { useState } from 'react';
import { EvaluationResult, EconomicRegimeData, ROEType } from '../types/quant';
import { ALL_CONDITIONS } from '../services/quantEngine';
import { MarketOverview } from '../services/stockService';
import { Shield, Target, Zap, AlertTriangle, TrendingUp, DollarSign, Activity, Layers, Clock, Skull, Calendar, PieChart, Link2, Globe } from 'lucide-react';
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
}

type DashboardTab = 'QUANT' | 'MACRO';

export const QuantDashboard: React.FC<Props> = ({
  result,
  economicRegime,
  currentRoeType = 3,
  marketOverview,
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
    <div className="p-8 bg-[#E4E3E0] text-[#141414] font-sans min-h-screen">
      <header className="mb-8 border-b border-[#141414] pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-serif italic tracking-tight">Living Quant System</h1>
          <p className="col-header mt-2">27-Condition Hierarchical Analysis Engine</p>
        </div>
        <div className="text-right">
          <p className="data-value text-sm">REGIME: BULLISH START</p>
          <p className="data-value text-sm">PROFILE: {result.profile.type}</p>
        </div>
      </header>

      {/* ── Tab Navigation ── */}
      <div className="flex gap-0 mb-10 border-b-2 border-[#141414]">
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
                ? 'bg-[#141414] text-white border-[#141414]'
                : 'bg-[#E4E3E0] text-[#141414] border-[#141414] hover:bg-white'
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
        <div className="p-6 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4" />
            <h2 className="col-header">FINAL SCORE</h2>
          </div>
          <p className="text-5xl font-bold font-mono tracking-tighter">{result.finalScore.toFixed(0)}</p>
          <p className="text-xs opacity-50 mt-1">MAX: 270.0</p>
        </div>

        <div className={`p-6 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] ${getRecommendationColor(result.recommendation)}`}>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4" />
            <h2 className="col-header">RECOMMENDATION</h2>
          </div>
          <p className="text-2xl font-black uppercase italic">{result.recommendation}</p>
          <p className="text-xs opacity-50 mt-1">DYNAMIC SCORING APPLIED</p>
        </div>

        <div className="p-6 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4" />
            <h2 className="col-header">POSITION SIZE</h2>
          </div>
          <p className="text-5xl font-bold font-mono tracking-tighter">{result.positionSize}%</p>
          <p className="text-xs opacity-50 mt-1">KELLY CRITERION ADJUSTED</p>
        </div>

        <div className="p-6 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4" />
            <h2 className="col-header">RRR (RISK-REWARD)</h2>
          </div>
          <p className="text-5xl font-bold font-mono tracking-tighter">{result.rrr.toFixed(1)}</p>
          <p className="text-xs opacity-50 mt-1">MIN THRESHOLD: 2.0</p>
        </div>
      </div>

      {/* 3-Gate Pyramid Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        {/* Gate 1 */}
        <div className={`p-8 border border-[#141414] relative ${result.gate1Passed ? 'bg-white' : 'bg-red-50'}`}>
          <div className="absolute -top-3 left-4 bg-[#E4E3E0] px-2 text-[10px] font-black uppercase tracking-widest">Gate 1: Survival</div>
          <div className="flex justify-between items-center mb-6">
            <Shield className={`w-8 h-8 ${result.gate1Passed ? 'text-green-600' : 'text-red-600'}`} />
            <span className="data-value text-2xl font-bold">{result.gate1Passed ? 'PASSED' : 'FAILED'}</span>
          </div>
          <div className="space-y-4">
            <p className="text-xs italic opacity-70">"살아있는 종목의 최소 조건"</p>
            <div className="h-2 w-full bg-gray-200 border border-[#141414]">
              <div className="h-full bg-[#141414]" style={{ width: result.gate1Passed ? '100%' : '40%' }}></div>
            </div>
            <p className="text-[10px] font-mono">SCORE: {result.gate1Score.toFixed(1)}</p>
          </div>
        </div>

        {/* Gate 2 */}
        <div className={`p-8 border border-[#141414] relative ${result.gate2Passed ? 'bg-white' : 'bg-gray-100 opacity-50'}`}>
          <div className="absolute -top-3 left-4 bg-[#E4E3E0] px-2 text-[10px] font-black uppercase tracking-widest">Gate 2: Growth</div>
          <div className="flex justify-between items-center mb-6">
            <Layers className="w-8 h-8 text-blue-600" />
            <span className="data-value text-2xl font-bold">{result.gate2Passed ? 'VERIFIED' : 'PENDING'}</span>
          </div>
          <div className="space-y-4">
            <p className="text-xs italic opacity-70">"성장성 및 펀더멘털 검증"</p>
            <div className="h-2 w-full bg-gray-200 border border-[#141414]">
              <div className="h-full bg-[#141414]" style={{ width: `${Math.min(100, (result.gate2Score / 100) * 100)}%` }}></div>
            </div>
            <p className="text-[10px] font-mono">SCORE: {result.gate2Score.toFixed(1)}</p>
          </div>
        </div>

        {/* Gate 3 */}
        <div className={`p-8 border border-[#141414] relative ${result.gate3Passed ? 'bg-white' : 'bg-gray-100 opacity-50'}`}>
          <div className="absolute -top-3 left-4 bg-[#E4E3E0] px-2 text-[10px] font-black uppercase tracking-widest">Gate 3: Timing</div>
          <div className="flex justify-between items-center mb-6">
            <Zap className={`w-8 h-8 ${result.lastTrigger ? 'text-orange-500 animate-pulse' : 'text-gray-400'}`} />
            <span className="data-value text-2xl font-bold">{result.lastTrigger ? 'TRIGGERED' : 'WAITING'}</span>
          </div>
          <div className="space-y-4">
            <p className="text-xs italic opacity-70">"정밀 진입 타이밍 및 배팅 사이즈"</p>
            <div className="h-2 w-full bg-gray-200 border border-[#141414]">
              <div className="h-full bg-[#141414]" style={{ width: `${Math.min(100, (result.gate3Score / 100) * 100)}%` }}></div>
            </div>
            <p className="text-[10px] font-mono">SCORE: {result.gate3Score.toFixed(1)}</p>
          </div>
        </div>
      </div>

      {/* Advanced Quant Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* 3-Tranche Plan */}
        {result.tranchePlan && (
          <div className="p-8 border border-[#141414] bg-white shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-3 mb-6">
              <Layers className="w-6 h-6 text-orange-500" />
              <h3 className="text-xl font-black uppercase tracking-tight">3-Tranche Scaling Plan</h3>
            </div>
            <div className="space-y-4">
              {[result.tranchePlan.tranche1, result.tranchePlan.tranche2, result.tranchePlan.tranche3].map((t, i) => (
                <div key={i} className="flex items-center justify-between p-4 border border-[#141414] bg-[#f9f9f9]">
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
          <div className="p-8 border border-[#141414] bg-white shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-3 mb-6">
              <Clock className="w-6 h-6 text-blue-500" />
              <h3 className="text-xl font-black uppercase tracking-tight">Multi-Timeframe Sync</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(result.multiTimeframe).filter(([k]) => k !== 'consistency').map(([tf, status]) => (
                <div key={tf} className="p-4 border border-[#141414] text-center">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">{tf}</span>
                  <span className={cn(
                    "text-xs font-black px-2 py-1 border border-[#141414]",
                    status === 'BULLISH' ? 'bg-green-100 text-green-700' : 
                    status === 'BEARISH' ? 'bg-red-100 text-red-700' : 'bg-gray-100'
                  )}>
                    {status}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 bg-[#141414] text-white text-center">
              <span className="text-[10px] font-black uppercase tracking-widest">Trend Consistency: </span>
              <span className="text-sm font-bold">{result.multiTimeframe.consistency ? 'SYNCHRONIZED' : 'DIVERGED'}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* Enemy's Checklist */}
        {result.enemyChecklist && (
          <div className="p-8 border border-[#141414] bg-[#141414] text-white shadow-[8px_8px_0px_0px_rgba(249,115,22,1)]">
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
            <div className="p-8 border border-[#141414] bg-white">
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
            <div className="p-8 border border-[#141414] bg-white">
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
                    <div className="h-1.5 w-full bg-gray-100 border border-[#141414]">
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
      <div className="mb-12 p-8 border border-[#141414] bg-white">
        <div className="flex items-center gap-3 mb-6">
          <Link2 className="w-6 h-6 text-gray-500" />
          <h3 className="text-xl font-black uppercase tracking-tight">Portfolio Correlation</h3>
        </div>
        <div className="flex items-center gap-8">
          <div className="flex-1">
            <div className="h-4 w-full bg-gray-100 border border-[#141414] relative">
              <div 
                className="absolute top-0 bottom-0 w-1 bg-[#141414]" 
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
        <div className="p-6 border border-[#141414] bg-white">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <h2 className="col-header">EUPHORIA DETECTOR</h2>
          </div>
          <div className="flex gap-2 mb-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div 
                key={i} 
                className={`h-8 flex-1 border border-[#141414] ${i <= result.euphoriaLevel ? 'bg-orange-500' : 'bg-gray-100'}`}
              ></div>
            ))}
          </div>
          <p className="text-xs font-mono uppercase tracking-widest">
            {result.euphoriaLevel >= 3 ? 'WARNING: OVERHEAT DETECTED - PROFIT TAKING RECOMMENDED' : 'STABLE: NO EUPHORIA DETECTED'}
          </p>
        </div>

        <div className={`p-6 border border-[#141414] ${result.emergencyStop ? 'bg-red-600 text-white' : 'bg-white'}`}>
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
      <footer className="mt-12 pt-8 border-t border-[#141414] flex justify-between items-center opacity-50">
        <p className="text-[10px] font-mono">LIVING QUANT SYSTEM V2.0 // SELF-EVOLVING BACKTESTING LOOP ACTIVE</p>
        <p className="text-[10px] font-mono">LAST UPDATED: {new Date().toISOString()}</p>
      </footer>

      </></div>
    </div>
  );
};
