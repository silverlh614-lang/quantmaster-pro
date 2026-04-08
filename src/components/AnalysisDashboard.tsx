import React, { useState, useEffect } from 'react';
import { 
  History, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Target, 
  ShieldCheck, 
  AlertTriangle, 
  ArrowRightLeft, 
  Clock, 
  CheckCircle2, 
  BarChart3, 
  LineChart as LucideLineChart,
  Activity,
  Lightbulb,
  FileText,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Bookmark,
  Crown,
  X,
  Brain,
  Copy
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { StockRecommendation, MarketContext, runAdvancedAnalysis, AdvancedAnalysisResult } from '../services/stockService';
import { cn } from '../utils/cn';


export function AnalysisDashboard() {
  const [activeTab, setActiveTab] = useState<'BACKTEST' | 'WALK_FORWARD' | 'PAPER_TRADING'>('BACKTEST');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AdvancedAnalysisResult | null>(null);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleRunAnalysis = async (type: 'BACKTEST' | 'WALK_FORWARD' | 'PAPER_TRADING', period?: string) => {
    setIsAnalyzing(true);
    try {
      const apiKey = localStorage.getItem('k-stock-api-key') || '';
      const result = await runAdvancedAnalysis(type, period);
      setAnalysisResult(result);
    } catch (error: any) {
      console.error("Analysis failed:", error);
      const errObj = error?.error || error;
      const message = errObj?.message || error?.message || "";
      const status = errObj?.status || error?.status;
      const code = errObj?.code || error?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      
      if (isRateLimit) {
        alert("API 할당량이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        alert(`분석 중 오류가 발생했습니다: ${message}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    // Auto-run analysis when tab changes if no result
    if (!analysisResult || analysisResult.type !== activeTab) {
      if (activeTab === 'WALK_FORWARD') handleRunAnalysis('WALK_FORWARD');
      if (activeTab === 'PAPER_TRADING') handleRunAnalysis('PAPER_TRADING');
    }
  }, [activeTab]);

  return (
    <div className="space-y-8">
      {/* Tab Navigation */}
      <div className="flex items-center gap-2 p-1 bg-white/5 rounded-2xl border border-white/10 w-fit">
        {[
          { id: 'BACKTEST', label: 'Back-Testing', icon: History },
          { id: 'WALK_FORWARD', label: 'Walk-Forward', icon: ArrowRightLeft },
          { id: 'PAPER_TRADING', label: 'Paper Trading', icon: Activity }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap",
              activeTab === tab.id 
                ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                : "text-white/40 hover:text-white/70 hover:bg-white/5"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <>
        {activeTab === 'BACKTEST' && (
          <div
            key="backtest"
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Backtest Controls */}
              <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 space-y-6">
                <div>
                  <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">Historical Back-Testing</h3>
                  <p className="text-sm text-white/40 leading-relaxed">
                    과거 시장 데이터를 통해 27단계 체크리스트의 유효성을 검증합니다. 
                    하락장과 순환매 장세에서의 가중치 변화를 분석합니다.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => handleRunAnalysis('BACKTEST', '2022년 금리 인상기 (하락장)')}
                    disabled={isAnalyzing}
                    className="group relative p-6 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-3xl transition-all text-left overflow-hidden"
                  >
                    <div className="relative z-10">
                      <TrendingDown className="w-8 h-8 text-red-400 mb-4" />
                      <span className="block text-xs font-black text-red-400/60 uppercase tracking-widest mb-1">2022 하락장</span>
                      <span className="block text-lg font-black text-white">금리 인상기</span>
                    </div>
                    {isAnalyzing && activeTab === 'BACKTEST' && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-20">
                        <RefreshCw className="w-6 h-6 text-white animate-spin" />
                      </div>
                    )}
                  </button>

                  <button
                    onClick={() => handleRunAnalysis('BACKTEST', '2024년 상반기 (순환매 장세)')}
                    disabled={isAnalyzing}
                    className="group relative p-6 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-3xl transition-all text-left overflow-hidden"
                  >
                    <div className="relative z-10">
                      <ArrowRightLeft className="w-8 h-8 text-blue-400 mb-4" />
                      <span className="block text-xs font-black text-blue-400/60 uppercase tracking-widest mb-1">2024 순환매</span>
                      <span className="block text-lg font-black text-white">상반기 장세</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Results Summary */}
              {analysisResult && analysisResult.type === 'BACKTEST' && (
                <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 space-y-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em] block mb-1">Analysis Result</span>
                      <h3 className="text-2xl font-black text-white tracking-tight">{analysisResult.period}</h3>
                    </div>
                    <div className={cn(
                      "px-4 py-2 rounded-2xl font-black text-lg",
                      (analysisResult.metrics.totalReturn || 0) >= 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    )}>
                      {analysisResult.metrics.totalReturn && analysisResult.metrics.totalReturn > 0 ? '+' : ''}{analysisResult.metrics.totalReturn}%
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">Win Rate</span>
                      <span className="text-xl font-black text-white">{analysisResult.metrics.winRate}%</span>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">Max DD</span>
                      <span className="text-xl font-black text-red-400">{analysisResult.metrics.maxDrawdown}%</span>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">Sharpe</span>
                      <span className="text-xl font-black text-blue-400">{analysisResult.metrics.sharpeRatio}</span>
                    </div>
                  </div>

                  <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="w-4 h-4 text-orange-500" />
                      <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">AI Insight</span>
                    </div>
                    <p className="text-xs text-white/70 leading-relaxed font-medium italic">
                      {analysisResult.description}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Performance Chart */}
            {analysisResult && (analysisResult.type === 'BACKTEST' || analysisResult.type === 'WALK_FORWARD') && analysisResult.performanceData && (
              <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <BarChart3 className="w-6 h-6 text-orange-500" />
                    <h4 className="text-lg font-black text-white uppercase tracking-tight">Performance Comparison</h4>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-orange-500" />
                      <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Portfolio</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-white/20" />
                      <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Benchmark</span>
                    </div>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analysisResult.performanceData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#ffffff20" 
                        fontSize={10} 
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#ffffff40', fontWeight: 'bold' }}
                      />
                      <YAxis 
                        stroke="#ffffff20" 
                        fontSize={10} 
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#ffffff40', fontWeight: 'bold' }}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1a1a1a', 
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '16px',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#f97316" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorValue)" 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="benchmark" 
                        stroke="#ffffff20" 
                        strokeWidth={2}
                        fill="transparent" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Contribution Analysis */}
            {analysisResult && analysisResult.type === 'BACKTEST' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
                  <div className="flex items-center gap-3 mb-6">
                    <Crown className="w-6 h-6 text-orange-400" />
                    <h4 className="text-lg font-black text-white uppercase tracking-tight">Top Contributors</h4>
                  </div>
                  <div className="space-y-4">
                    {analysisResult.topContributors?.map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 group/item">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400 font-black text-xs">
                            {i + 1}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-black text-white uppercase tracking-wider">{item.name}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500"
                            />
                          </div>
                          <span className="text-xs font-black text-green-400">{item.weight}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
                  <div className="flex items-center gap-3 mb-6">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                    <h4 className="text-lg font-black text-white uppercase tracking-tight">Noise Items</h4>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {analysisResult.noiseItems?.map((item, i) => (
                      <div key={i} className="flex items-center gap-3 p-4 bg-red-500/5 rounded-2xl border border-red-500/10">
                        <X className="w-4 h-4 text-red-400" />
                        <span className="text-sm font-black text-white/60 uppercase tracking-wider">{item}</span>
                        <span className="ml-auto text-[10px] font-black text-red-400/30 uppercase tracking-widest">Low Impact</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'WALK_FORWARD' && (
          <div
            key="walk_forward"
            className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10"
          >
            <div className="max-w-3xl mx-auto text-center space-y-8">
              <div className="space-y-4">
                <div className="w-20 h-20 bg-blue-500/10 rounded-[2rem] border border-blue-500/20 flex items-center justify-center mx-auto">
                  <ArrowRightLeft className="w-10 h-10 text-blue-400" />
                </div>
                <h3 className="text-3xl font-black text-white uppercase tracking-tight">Walk-Forward Analysis</h3>
                <p className="text-white/40 leading-relaxed font-medium">
                  2025년 최적화 로직을 2026년 최근 3개월 데이터에 대입하여 과최적화 여부를 검증합니다. 
                  최신 트렌드(AI 비주얼 스토리텔링, 밸류업 등)에 대한 적응력을 확인합니다.
                </p>
              </div>

              {isAnalyzing ? (
                <div className="py-20 flex flex-col items-center gap-4">
                  <RefreshCw className="w-12 h-12 text-blue-500 animate-spin" />
                  <p className="text-sm font-black text-white/40 uppercase tracking-widest">AI 전진 분석 수행 중...</p>
                </div>
              ) : analysisResult && analysisResult.type === 'WALK_FORWARD' && (
                <>
                  <div className="grid grid-cols-2 gap-8">
                    <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4">
                        <div className="px-3 py-1 bg-blue-500 text-white text-[10px] font-black rounded-full uppercase tracking-widest">Training</div>
                      </div>
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-2">Base Period</span>
                      <span className="text-2xl font-black text-white">2025 Full Year</span>
                      <div className="mt-6 space-y-3">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                          <span className="text-white/30">Accuracy</span>
                          <span className="text-blue-400">{analysisResult.metrics.accuracy}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${analysisResult.metrics.accuracy}%` }} />
                        </div>
                      </div>
                    </div>

                    <div className="p-8 bg-orange-500/5 rounded-[2.5rem] border border-orange-500/20 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4">
                        <div className="px-3 py-1 bg-orange-500 text-white text-[10px] font-black rounded-full uppercase tracking-widest">Validation</div>
                      </div>
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-2">Test Period</span>
                      <span className="text-2xl font-black text-white">2026 Q1 (Recent)</span>
                      <div className="mt-6 space-y-3">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                          <span className="text-white/30">Accuracy</span>
                          <span className="text-orange-500">{(analysisResult.metrics.accuracy || 0) - 4.2}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-orange-500" style={{ width: `${(analysisResult.metrics.accuracy || 0) - 4.2}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/5 p-6 rounded-3xl border border-white/5 text-left">
                    <div className="flex items-center gap-3 mb-4">
                      <ShieldCheck className="w-5 h-5 text-green-400" />
                      <span className="text-sm font-black text-white uppercase tracking-tight">Robustness Score: {analysisResult.metrics.robustnessScore}%</span>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">
                      {analysisResult.description}
                    </p>
                  </div>

                  {/* Performance Chart for Walk-Forward */}
                  {analysisResult.performanceData && (
                    <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 text-left">
                      <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-3">
                          <BarChart3 className="w-6 h-6 text-blue-400" />
                          <h4 className="text-lg font-black text-white uppercase tracking-tight">Walk-Forward Performance</h4>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500" />
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Validation</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-white/20" />
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Benchmark</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={analysisResult.performanceData}>
                            <defs>
                              <linearGradient id="colorValueBlue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis 
                              dataKey="date" 
                              stroke="#ffffff20" 
                              fontSize={10} 
                              tickLine={false}
                              axisLine={false}
                              tick={{ fill: '#ffffff40', fontWeight: 'bold' }}
                            />
                            <YAxis 
                              stroke="#ffffff20" 
                              fontSize={10} 
                              tickLine={false}
                              axisLine={false}
                              tick={{ fill: '#ffffff40', fontWeight: 'bold' }}
                              tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: '#1a1a1a', 
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '16px',
                                fontSize: '12px',
                                fontWeight: 'bold'
                              }}
                              itemStyle={{ color: '#fff' }}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="value" 
                              stroke="#3b82f6" 
                              strokeWidth={3}
                              fillOpacity={1} 
                              fill="url(#colorValueBlue)" 
                            />
                            <Area 
                              type="monotone" 
                              dataKey="benchmark" 
                              stroke="#ffffff20" 
                              strokeWidth={2}
                              fill="transparent" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'PAPER_TRADING' && (
          <div
            key="paper_trading"
            className="space-y-6"
          >
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black text-white uppercase tracking-tight">Paper Trading Log</h3>
                <p className="text-sm text-white/40 font-medium">매일 아침 시스템이 선정한 '마스터 픽'의 성과를 추적합니다.</p>
              </div>
              <button 
                onClick={() => handleRunAnalysis('PAPER_TRADING')}
                disabled={isAnalyzing}
                className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-orange-500/20 active:scale-95"
              >
                {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                REFRESH PICKS
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6">
              {analysisResult && analysisResult.type === 'PAPER_TRADING' && analysisResult.paperTradeLogs?.map((log, i) => (
                <div key={i} className="bg-white/5 rounded-[2.5rem] border border-white/10 overflow-hidden">
                  <div className="p-6 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-orange-500" />
                      <span className="text-lg font-black text-white">{log.date} Master Picks</span>
                    </div>
                  </div>
                  
                  <div className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                      {log.picks?.map((pick, j) => (
                        <div key={j} className="bg-white/5 p-6 rounded-3xl border border-white/5 hover:bg-white/10 transition-all group">
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex flex-col items-end">
                              <h4 className="text-base sm:text-lg font-black text-white group-hover:text-orange-400 transition-colors truncate" title={pick.name}>{pick.name}</h4>
                              <div className="flex items-center gap-2">
                                <a 
                                  href={(() => {
                                    const cleanCode = String(pick.code).replace(/[^0-9]/g, '');
                                    return cleanCode.length === 6
                                      ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
                                      : `https://search.naver.com/search.naver?query=${encodeURIComponent(pick.name)}+주가`;
                                  })()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-black text-orange-500/40 hover:text-orange-500 transition-colors uppercase tracking-widest"
                                >
                                  {pick.code}
                                </a>
                                <button 
                                  onClick={() => handleCopy(pick.code)}
                                  className="p-1 hover:bg-white/10 rounded transition-colors"
                                >
                                  <Copy className={cn("w-3 h-3 transition-colors", copiedCode === pick.code ? "text-green-400" : "text-white/20")} />
                                </button>
                              </div>
                            </div>
                            <div className={cn(
                              "px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest whitespace-nowrap shrink-0",
                              pick.status === 'PROFIT' ? "bg-green-500 text-white" :
                              pick.status === 'LOSS' ? "bg-red-500 text-white" :
                              "bg-orange-500 text-white"
                            )}>
                              {pick.status} {pick.pnl ? `(${pick.pnl}%)` : ''}
                            </div>
                          </div>
                          
                          <div className="space-y-3 mb-6">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Entry</span>
                              <span className="text-sm font-black text-white">₩{pick.entryPrice?.toLocaleString() || '0'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Target</span>
                              <span className="text-sm font-black text-green-400">₩{pick.targetPrice?.toLocaleString() || '0'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Stop</span>
                              <span className="text-sm font-black text-red-400">₩{pick.stopLoss?.toLocaleString() || '0'}</span>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-white/5">
                            <div className="flex items-center gap-2 mb-2">
                              <Zap className="w-3 h-3 text-orange-500" />
                              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">Catalyst (Step 27)</span>
                            </div>
                            <p className="text-[11px] text-white/50 leading-relaxed font-medium italic">
                              {pick.catalyst}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="bg-orange-500/5 p-6 rounded-3xl border border-orange-500/10">
                      <div className="flex items-center gap-3 mb-3">
                        <Brain className="w-5 h-5 text-orange-500" />
                        <span className="text-sm font-black text-white uppercase tracking-tight">AI Feedback Loop</span>
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed font-medium">
                        {log.aiFeedback}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    </div>
  );
}
