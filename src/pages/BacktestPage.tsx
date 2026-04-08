import React from 'react';
import {
  TrendingUp, TrendingDown, ShieldCheck, ShieldAlert, Play, RefreshCw,
  Settings, History, Info, Plus, Trash2, GripVertical, Zap, Activity,
  Target, BarChart3, ArrowUpRight, ArrowDownRight, XCircle, Copy,
  AlertTriangle, Lightbulb, Sparkles, Layers, ArrowRightLeft,
  Calendar as CalendarIcon
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import { PortfolioManager } from '../components/PortfolioManager';
import { PortfolioPieChart } from '../components/PortfolioPieChart';
import { useMarketStore, usePortfolioStore } from '../stores';
import { cn } from '../utils/cn';


interface BacktestPageProps {
  onRunBacktest: () => Promise<void>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFromBacktest: (code: string) => void;
  onUpdateWeight: (code: string, weight: number) => void;
  onReorderPortfolioItems: (newItems: { name: string; code: string; weight: number }[]) => void;
  onApplyAIRecommendedWeights: () => void;
  onSelectPortfolio: (id: string) => void;
  onSavePortfolio: (name: string, description?: string) => void;
  onDeletePortfolio: (id: string) => void;
  onUpdatePortfolio: (id: string, name: string, description?: string) => void;
  onCopy: (name: string, code: string) => void;
  copiedCode: string | null;
}

export function BacktestPage({
  onRunBacktest, onFileUpload, onRemoveFromBacktest, onUpdateWeight,
  onReorderPortfolioItems, onApplyAIRecommendedWeights,
  onSelectPortfolio, onSavePortfolio, onDeletePortfolio, onUpdatePortfolio,
  onCopy, copiedCode
}: BacktestPageProps) {
  const {
    backtestPortfolioItems, backtestResult, backtesting,
    initialEquity, setInitialEquity, backtestYears, setBacktestYears, parsingFile
  } = useMarketStore();
  const { portfolios, currentPortfolioId } = usePortfolioStore();

  return (
            <div
              key="backtest-view"
              className="space-y-12"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-3 h-10 bg-blue-500 rounded-full shadow-[0_0_20px_rgba(59,130,246,0.5)]" />
                    <h2 className="text-4xl font-black text-white tracking-tighter uppercase">AI Portfolio Backtest</h2>
                  </div>
                  <p className="text-white/40 font-medium max-w-2xl text-lg">
                    사용자 정의 포트폴리오의 과거 성과를 AI로 시뮬레이션하고, 위험 지표 분석 및 최적화 전략을 제안받으세요.
                  </p>
                </div>
                <button
                  onClick={onRunBacktest}
                  disabled={backtesting || (backtestPortfolioItems || []).length === 0 || (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) !== 100}
                  className="flex items-center gap-4 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-10 py-5 rounded-[2.5rem] font-black text-lg transition-all shadow-[0_10px_40px_rgba(59,130,246,0.3)] active:scale-95"
                >
                  {backtesting ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6" />}
                  <span>{backtesting ? '시뮬레이션 중...' : '백테스팅 시작'}</span>
                </button>
              </div>

              <PortfolioManager 
                portfolios={portfolios}
                currentPortfolioId={currentPortfolioId}
                onSelect={onSelectPortfolio}
                onSave={onSavePortfolio}
                onDelete={onDeletePortfolio}
                onUpdate={onUpdatePortfolio}
              />
              
              {portfolios.find(p => p.id === currentPortfolioId) && (
                <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                  <h3 className="text-xl font-black text-white mb-6 uppercase tracking-widest">포트폴리오 비중</h3>
                  <PortfolioPieChart items={portfolios.find(p => p.id === currentPortfolioId)!.items} />
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                {/* Portfolio Builder */}
                <div className="lg:col-span-1 space-y-8">
                  {/* Backtest Settings */}
                  <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl space-y-8">
                    <div className="flex items-center gap-4">
                      <Settings className="w-6 h-6 text-white/20" />
                      <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">백테스트 설정</span>
                    </div>
                    
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-white/40 uppercase tracking-widest block">초기 자본금 (Initial Equity)</label>
                        <div className="relative">
                          <input 
                            type="number"
                            onChange={(e) => setInitialEquity(parseInt(e.target.value) || 0)}
                            className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-lg font-black text-white focus:outline-none focus:border-blue-500/50 transition-all"
                          />
                          <span className="absolute right-6 top-1/2 -translate-y-1/2 text-sm font-black text-white/20">KRW</span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-white/40 uppercase tracking-widest block">테스트 기간 (Period)</label>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: '1년', value: 1 },
                            { label: '3년', value: 3 },
                            { label: '5년', value: 5 },
                          ].map((p) => (
                            <button
                              key={p.value}
                              onClick={() => setBacktestYears(p.value)}
                              className={cn(
                                "py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border",
                                backtestYears === p.value 
                                  ? "bg-blue-500/20 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]" 
                                  : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                              )}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">포트폴리오 구성</span>
                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer flex items-center gap-2 text-[10px] font-black text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest">
                            <input type="file" accept=".txt" onChange={onFileUpload} className="hidden" />
                            {parsingFile ? <RefreshCw className="w-3 h-3 animate-spin" /> : <History className="w-3 h-3" />}
                            <span>파일 업로드 분석</span>
                          </label>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={cn(
                          "text-[11px] font-black px-3 py-1.5 rounded-xl transition-all duration-500",
                          (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) === 100 
                            ? "bg-green-500/20 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.2)]" 
                            : (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) > 100
                              ? "bg-red-500/20 text-red-400"
                              : "bg-orange-500/20 text-orange-400"
                        )}>
                          Total: {(backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0)}%
                        </span>
                        <div className="w-32 h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full transition-colors duration-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div
                      className="space-y-5"
                    >
                      {(backtestPortfolioItems || []).length === 0 ? (
                        <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-[2.5rem]">
                          <Plus className="w-12 h-12 text-white/10 mx-auto mb-4" />
                          <p className="text-sm text-white/20 font-black leading-relaxed">추천 종목이나 검색 결과에서<br/>종목을 추가하세요.</p>
                        </div>
                      ) : (
                        (backtestPortfolioItems || []).map((item: any) => {
                          const riskyStock = backtestResult?.riskyStocks?.find((s: any) => s.stock === item.name || s.stock === item.code);
                          const isHighRisk = riskyStock?.riskLevel === 'HIGH';
                          const isMediumRisk = riskyStock?.riskLevel === 'MEDIUM';

                          return (
                            <div 
                              key={item.code}
                              className={cn(
                                "bg-white/5 rounded-3xl p-6 border flex items-center justify-between gap-6 group hover:bg-white/[0.08] transition-all cursor-grab active:cursor-grabbing",
                                isHighRisk ? "border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.1)]" : 
                                isMediumRisk ? "border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.05)]" : 
                                "border-white/5"
                              )}
                            >
                              <div className="flex items-center gap-4 flex-1">
                                <div className="p-2 text-white/10 group-hover:text-white/30 transition-colors">
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div className="flex-1 relative group/copy">
                                  <div className="flex items-center gap-2 mb-1">
                                    <div 
                                      onClick={() => onCopy(item.name, item.code)}
                                      className="text-lg font-black text-white cursor-pointer hover:text-orange-500 transition-colors flex items-center gap-2"
                                      title="종목명 복사"
                                    >
                                      {item.name}
                                      <Copy className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-50 transition-opacity" />
                                    </div>
                                    {riskyStock && (
                                      <div className={cn(
                                        "px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest flex items-center gap-1",
                                        isHighRisk ? "bg-red-500 text-white animate-pulse" : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                                      )}>
                                        <ShieldAlert className="w-2.5 h-2.5" />
                                        {riskyStock.riskLevel} RISK
                                      </div>
                                    )}
                                  </div>
                                  <>
                                    {copiedCode === item.code && (
                                      <span
                                        className="absolute -top-6 left-0 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-0.5 rounded-lg border border-green-500/30 z-30"
                                      >
                                        Copied!
                                      </span>
                                    )}
                                  </>
                                  <div className="text-[11px] font-black text-white/20 uppercase tracking-widest">{item.code}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="relative">
                                  <input
                                    type="number"
                                    onChange={(e) => onUpdateWeight(item.code, parseInt(e.target.value) || 0)}
                                    className={cn(
                                      "w-20 bg-black/40 border rounded-2xl px-3 py-2 text-sm font-black text-white text-center focus:outline-none transition-all",
                                      (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) > 100 ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-blue-500/50"
                                    )}
                                  />
                                  <span className="absolute -right-4 top-1/2 -translate-y-1/2 text-xs font-black text-white/20">%</span>
                                </div>
                                <button 
                                  onClick={() => onRemoveFromBacktest(item.code)}
                                  className="p-3 text-white/10 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Results Dashboard */}
                <div className="lg:col-span-2 space-y-10">
                  {backtestResult ? (
                    <>
                      {/* High Risk Alert Banner */}
                      {backtestResult.riskyStocks && backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') && (
                        <div
                          className="bg-red-500/10 border border-red-500/20 rounded-[2.5rem] p-8 mb-10 flex items-center gap-6 relative overflow-hidden group"
                        >
                          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <ShieldAlert className="w-24 h-24 text-red-500" />
                          </div>
                          <div className="w-16 h-16 rounded-3xl bg-red-500/20 flex items-center justify-center shrink-0 animate-pulse">
                            <ShieldAlert className="w-8 h-8 text-red-500" />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-xl font-black text-white uppercase tracking-tighter mb-1">고위험 종목 감지 (High Risk Detected)</h4>
                            <p className="text-sm text-white/60 font-bold leading-relaxed">
                              포트폴리오 내에 AI가 분석한 고위험 종목이 포함되어 있습니다. 아래 리스크 관리 섹션을 확인하여 비중 조절 또는 정리를 고려하십시오.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Summary Metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {[
                          { 
                            label: '누적 수익률', 
                            value: `${backtestResult.cumulativeReturn.toFixed(2)}%`, 
                            icon: TrendingUp, 
                            color: 'text-orange-400',
                            tooltip: {
                              desc: "투자 기간 동안의 총 수익률입니다.",
                              calc: "(기말 자산 / 기초 자산) - 1"
                            }
                          },
                          { 
                            label: '샤프 지수', 
                            value: backtestResult.sharpeRatio.toFixed(2), 
                            icon: ShieldCheck, 
                            color: 'text-blue-400',
                            tooltip: {
                              desc: "위험 대비 수익성을 나타내는 지표입니다. 높을수록 효율적인 투자임을 의미합니다.",
                              calc: "(포트폴리오 수익률 - 무위험 수익률) / 수익률 표준편차"
                            }
                          },
                          { 
                            label: '최대 낙폭', 
                            value: `${backtestResult.maxDrawdown.toFixed(2)}%`, 
                            icon: TrendingDown, 
                            color: 'text-red-400',
                            tooltip: {
                              desc: "투자 기간 중 고점 대비 저점까지의 최대 하락폭입니다.",
                              calc: "포트폴리오 고점 대비 최대 하락 비율 (MDD)"
                            }
                          },
                          { 
                            label: '변동성', 
                            value: `${backtestResult.volatility.toFixed(2)}%`, 
                            icon: Zap, 
                            color: 'text-green-400',
                            tooltip: {
                              desc: "수익률의 표준편차로, 가격의 출렁임 정도를 나타냅니다.",
                              calc: "일간 수익률의 연환산 표준편차"
                            }
                          },
                        ].map((stat: any, i: number) => (
                          <div
                            key={stat.label}
                            className="glass-3d rounded-[2.5rem] p-8 border border-white/10 shadow-xl text-center group/stat relative"
                          >
                            <div className="absolute top-4 right-4 opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-help">
                              <div className="relative group/info">
                                <Info className="w-4 h-4 text-white/20 hover:text-orange-500 transition-colors" />
                                <div className="absolute right-0 top-6 w-56 max-h-[300px] overflow-y-auto p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none text-left">
                                  <h4 className="text-[10px] font-black text-orange-500 mb-2 uppercase tracking-widest">{stat.label} 상세 정보</h4>
                                  <div className="space-y-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">설명</span>
                                      <span className="text-[10px] font-bold text-white/80 leading-tight">{stat.tooltip.desc}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">계산식</span>
                                      <span className="text-[9px] font-medium text-white/50 italic leading-tight">{stat.tooltip.calc}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <stat.icon className={cn("w-6 h-6 mx-auto mb-4", stat.color)} />
                            <div className="text-[11px] font-black text-white/20 uppercase tracking-[0.2em] mb-2">{stat.label}</div>
                            <div className={cn("text-2xl font-black tracking-tighter", stat.color)}>{stat.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Advanced Metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {[
                          { 
                            label: 'CAGR (연평균)', 
                            value: `${backtestResult.cagr.toFixed(2)}%`, 
                            icon: CalendarIcon, 
                            color: 'text-purple-400',
                            tooltip: {
                              desc: "기하평균 수익률로, 매년 평균적으로 얼마나 수익을 냈는지 나타냅니다.",
                              calc: "((기말 자산 / 기초 자산) ^ (1 / 투자 기간(년))) - 1"
                            }
                          },
                          { 
                            label: '승률 (Win Rate)', 
                            value: `${backtestResult.winRate.toFixed(1)}%`, 
                            icon: Target, 
                            color: 'text-yellow-400',
                            tooltip: {
                              desc: "전체 매매 중 수익으로 마감한 매매의 비율입니다.",
                              calc: "수익 매매 횟수 / 전체 매매 횟수"
                            }
                          },
                          { 
                            label: 'Profit Factor', 
                            value: backtestResult.profitFactor.toFixed(2), 
                            icon: BarChart3, 
                            color: 'text-cyan-400',
                            tooltip: {
                              desc: "총 이익을 총 손실로 나눈 값으로, 1보다 크면 수익이 손실보다 큼을 의미합니다.",
                              calc: "총 이익 합계 / 총 손실 합계"
                            }
                          },
                          { 
                            label: '총 매매 횟수', 
                            value: backtestResult.trades, 
                            icon: Activity, 
                            color: 'text-pink-400',
                            tooltip: {
                              desc: "백테스트 기간 동안 발생한 총 매매(진입 및 청산) 횟수입니다.",
                              calc: "전체 체결 횟수"
                            }
                          },
                        ].map((stat, i) => (
                          <div
                            key={stat.label}
                            className="glass-3d rounded-[2.5rem] p-8 border border-white/10 shadow-xl text-center group/stat relative"
                          >
                            <div className="absolute top-4 right-4 opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-help">
                              <div className="relative group/info">
                                <Info className="w-4 h-4 text-white/20 hover:text-orange-500 transition-colors" />
                                <div className="absolute right-0 top-6 w-56 max-h-[300px] overflow-y-auto p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none text-left">
                                  <h4 className="text-[10px] font-black text-orange-500 mb-2 uppercase tracking-widest">{stat.label} 상세 정보</h4>
                                  <div className="space-y-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">설명</span>
                                      <span className="text-[10px] font-bold text-white/80 leading-tight">{stat.tooltip.desc}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">계산식</span>
                                      <span className="text-[9px] font-medium text-white/50 italic leading-tight">{stat.tooltip.calc}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <stat.icon className={cn("w-6 h-6 mx-auto mb-4", stat.color)} />
                            <div className="text-[11px] font-black text-white/20 uppercase tracking-[0.2em] mb-2">{stat.label}</div>
                            <div className={cn("text-2xl font-black tracking-tighter", stat.color)}>{stat.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Advanced Metrics Row 2 */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                        {[
                          { 
                            label: '평균 수익 (Avg Win)', 
                            value: `${backtestResult.avgWin.toFixed(2)}%`, 
                            icon: ArrowUpRight, 
                            color: 'text-green-400',
                            tooltip: {
                              desc: "수익이 발생한 매매들의 평균 수익률입니다.",
                              calc: "총 이익 / 수익 매매 횟수"
                            }
                          },
                          { 
                            label: '평균 손실 (Avg Loss)', 
                            value: `${backtestResult.avgLoss.toFixed(2)}%`, 
                            icon: ArrowDownRight, 
                            color: 'text-red-400',
                            tooltip: {
                              desc: "손실이 발생한 매매들의 평균 손실률입니다.",
                              calc: "총 손실 / 손실 매매 횟수"
                            }
                          },
                          { 
                            label: '최대 연속 손실', 
                            value: `${backtestResult.maxConsecutiveLoss}회`, 
                            icon: XCircle, 
                            color: 'text-orange-400',
                            tooltip: {
                              desc: "가장 길게 이어진 연속 손실 매매 횟수입니다.",
                              calc: "최대 연속 손실 횟수"
                            }
                          },
                        ].map((stat: any, i: number) => (
                          <div
                            key={stat.label}
                            className="glass-3d rounded-[2.5rem] p-8 border border-white/10 shadow-xl text-center group/stat relative"
                          >
                            <div className="absolute top-4 right-4 opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-help">
                              <div className="relative group/info">
                                <Info className="w-4 h-4 text-white/20 hover:text-orange-500 transition-colors" />
                                <div className="absolute right-0 top-6 w-56 max-h-[300px] overflow-y-auto p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none text-left">
                                  <h4 className="text-[10px] font-black text-orange-500 mb-2 uppercase tracking-widest">{stat.label} 상세 정보</h4>
                                  <div className="space-y-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">설명</span>
                                      <span className="text-[10px] font-bold text-white/80 leading-tight">{stat.tooltip.desc}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">계산식</span>
                                      <span className="text-[9px] font-medium text-white/50 italic leading-tight">{stat.tooltip.calc}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <stat.icon className={cn("w-6 h-6 mx-auto mb-4", stat.color)} />
                            <div className="text-[11px] font-black text-white/20 uppercase tracking-[0.2em] mb-2">{stat.label}</div>
                            <div className={cn("text-2xl font-black tracking-tighter", stat.color)}>{stat.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Performance Chart */}
                      <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em] block mb-10">수익률 추이 (vs KOSPI)</span>
                        <div className="h-[400px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={backtestResult.performanceData}>
                              <defs>
                                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorBenchmark" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                              <XAxis 
                                dataKey="date" 
                                stroke="rgba(255,255,255,0.2)" 
                                fontSize={11} 
                                tickLine={false}
                                axisLine={false}
                                tick={{ fontWeight: 900 }}
                              />
                              <YAxis 
                                stroke="rgba(255,255,255,0.2)" 
                                fontSize={11} 
                                tickLine={false}
                                axisLine={false}
                                domain={['auto', 'auto']}
                                tick={{ fontWeight: 900 }}
                              />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', padding: '16px' }}
                                itemStyle={{ fontSize: '13px', fontWeight: '900', padding: '4px 0' }}
                                labelStyle={{ color: 'rgba(255,255,255,0.4)', fontWeight: '900', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                              />
                              <Legend verticalAlign="top" align="right" height={48} iconType="circle" wrapperStyle={{ fontWeight: 900, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }} />
                              <Area type="monotone" dataKey="value" name="Portfolio" stroke="#f97316" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                              <Area type="monotone" dataKey="benchmark" name="KOSPI" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 8" fillOpacity={1} fill="url(#colorBenchmark)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Risk Analysis Section */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {/* Risk Metrics */}
                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center gap-4 mb-8">
                            <ShieldAlert className="w-6 h-6 text-red-400" />
                            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">리스크 지표 (Risk Metrics)</span>
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                              <div className="text-[10px] font-black text-white/30 uppercase mb-2">Beta</div>
                              <div className="text-xl font-black text-white tracking-tighter">{backtestResult.riskMetrics?.beta.toFixed(2) || 'N/A'}</div>
                            </div>
                            <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                              <div className="text-[10px] font-black text-white/30 uppercase mb-2">Alpha</div>
                              <div className="text-xl font-black text-white tracking-tighter">{backtestResult.riskMetrics?.alpha.toFixed(2) || 'N/A'}%</div>
                            </div>
                            <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                              <div className="text-[10px] font-black text-white/30 uppercase mb-2">Treynor</div>
                              <div className="text-xl font-black text-white tracking-tighter">{backtestResult.riskMetrics?.treynorRatio.toFixed(2) || 'N/A'}</div>
                            </div>
                          </div>
                        </div>

                        {/* Risky Stocks List */}
                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center gap-4 mb-8">
                            <AlertTriangle className="w-6 h-6 text-yellow-400" />
                            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">주의 종목 분석</span>
                          </div>
                          <div className="space-y-4">
                            {backtestResult.riskyStocks?.map((stock: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                <div>
                                  <div className="text-xs font-black text-white uppercase">{stock.stock}</div>
                                  <div className="text-[10px] font-bold text-white/40">{stock.reason}</div>
                                </div>
                                <div className={cn(
                                  "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest",
                                  stock.riskLevel === 'HIGH' ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"
                                )}>
                                  {stock.riskLevel}
                                </div>
                              </div>
                            ))}
                            {(!backtestResult.riskyStocks || backtestResult.riskyStocks.length === 0) && (
                              <div className="text-center py-10 text-white/20 font-black uppercase text-xs">특이 리스크 종목 없음</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* AI Analysis & Optimization */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center gap-4 mb-8">
                            <Lightbulb className="w-6 h-6 text-orange-400" />
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">AI 전략 분석</span>
                              <div title="AI가 포트폴리오의 과거 성과와 현재 구성을 분석하여 도출한 전략적 인사이트입니다. 수익률, 변동성, 샤프 지수 등을 종합적으로 고려합니다.">
                                <Info 
                                  className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-orange-400 transition-colors" 
                                />
                              </div>
                            </div>
                          </div>
                          <p className="text-base text-white/70 font-bold leading-relaxed whitespace-pre-wrap">
                            {backtestResult.aiAnalysis}
                          </p>
                        </div>

                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                              <Target className="w-6 h-6 text-blue-400" />
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">포트폴리오 최적화 제안</span>
                                <div title="AI가 현재 시장 상황과 포트폴리오의 리스크/수익 프로파일을 분석하여 제안하는 비중 조절 및 신규 종목 추천입니다.">
                                  <Info 
                                    className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-blue-400 transition-colors" 
                                  />
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={onApplyAIRecommendedWeights}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-2xl text-[10px] font-black text-blue-400 uppercase tracking-widest transition-all active:scale-95"
                            >
                              <Sparkles className="w-3 h-3" />
                              AI 추천 비중 적용
                            </button>
                          </div>

                          {/* Discrepancy Tip Card */}
                          <div className="mb-8 p-6 bg-blue-500/5 border border-blue-500/20 rounded-[2rem] relative overflow-hidden group">
                            <div className="flex items-start gap-4 relative z-10">
                              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center shrink-0">
                                <Lightbulb className="w-5 h-5 text-blue-400" />
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-white mb-2 flex items-center gap-2">
                                  오늘의 추천 종목이 '제거' 대상으로 나오나요?
                                  <span className="text-[10px] font-black bg-blue-500 text-white px-2 py-0.5 rounded-lg uppercase tracking-widest">AI Tip</span>
                                </h4>
                                <div className="space-y-2 text-xs text-white/50 font-medium leading-relaxed">
                                  <p>• <span className="text-blue-400 font-bold">시간 지평의 차이:</span> 오늘의 종목은 단기 모멘텀에 집중하지만, 백테스팅은 1년 이상의 장기 안정성을 평가합니다.</p>
                                  <p>• <span className="text-blue-400 font-bold">포트폴리오 밸런스:</span> 개별 종목이 우수해도 전체 포트폴리오의 변동성을 과도하게 높이면 AI가 비중 축소나 제거를 제안할 수 있습니다.</p>
                                  <p>• <span className="text-blue-400 font-bold">리스크 관리:</span> 급등주는 높은 수익만큼 높은 MDD(최대 낙폭)를 동반하므로, 보수적인 백테스팅 엔진은 이를 위험 요소로 식별합니다.</p>
                                </div>
                              </div>
                            </div>
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[40px] -mr-16 -mt-16 group-hover:bg-blue-500/10 transition-all" />
                          </div>

                          <div className="space-y-5">
                            {(backtestResult.optimizationSuggestions || []).map((s: any, i: number) => (
                              <div key={i} className="bg-white/5 rounded-[2rem] p-6 border border-white/5 group hover:bg-white/[0.08] transition-all">
                                <div className="flex items-center justify-between mb-3 relative group/copy">
                                  <div 
                                    onClick={() => onCopy(s.stock, `opt-${i}`)}
                                    className="text-lg font-black text-white cursor-pointer hover:text-orange-500 transition-colors flex items-center gap-2"
                                    title="종목명 복사"
                                  >
                                    {s.stock}
                                    <Copy className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-50 transition-opacity" />
                                    <>
                                      {copiedCode === `opt-${i}` && (
                                        <span
                                          className="absolute -top-6 left-0 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-0.5 rounded-lg border border-green-500/30 z-30"
                                        >
                                          Copied!
                                        </span>
                                      )}
                                    </>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="flex flex-col items-end">
                                      <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">Weight Change</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-white/40">{s.currentWeight}%</span>
                                        <ArrowRightLeft className="w-2.5 h-2.5 text-white/20" />
                                        <span className="text-[10px] font-black text-blue-400">{s.recommendedWeight}%</span>
                                      </div>
                                    </div>
                                    <span className={cn(
                                      "text-[10px] font-black px-3 py-1 rounded-xl uppercase tracking-widest",
                                      s.action === 'INCREASE' ? "bg-green-500/20 text-green-400" :
                                      s.action === 'DECREASE' ? "bg-red-500/20 text-red-400" :
                                      s.action === 'REMOVE' ? "bg-red-500/40 text-white" :
                                      "bg-white/10 text-white/40"
                                    )}>
                                      {s.action}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-xs text-white/40 font-bold leading-relaxed">{s.reason}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* New Theme Suggestions */}
                        {backtestResult.newThemeSuggestions && backtestResult.newThemeSuggestions.length > 0 && (
                          <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                            <div className="flex items-center gap-4 mb-8">
                              <Layers className="w-6 h-6 text-purple-400" />
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">신규 편입 테마 제안</span>
                                <div title="현재 시장 주도 테마와 관련 유망 종목을 분석하여 포트폴리오 다변화를 제안합니다.">
                                  <Info 
                                    className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-purple-400 transition-colors" 
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="space-y-5">
                              {(backtestResult.newThemeSuggestions || []).map((t: any, i: number) => (
                                <div key={i} className="bg-white/5 rounded-[2rem] p-6 border border-white/5 group hover:bg-white/[0.08] transition-all">
                                  <div className="flex items-center justify-between mb-3">
                                    <span className="text-lg font-black text-purple-400">{t.theme}</span>
                                    <div className="flex gap-2">
                                      {(t.stocks || []).map((stock: string, si: number) => (
                                        <span key={si} className="text-[10px] font-black px-2 py-1 bg-purple-500/10 text-purple-300 rounded-lg border border-purple-500/20">
                                          {stock}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <p className="text-xs text-white/40 font-bold leading-relaxed">{t.reason}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Risky Stocks Section */}
                        {backtestResult.riskyStocks && backtestResult.riskyStocks.length > 0 && (
                          <div className={cn(
                            "glass-3d rounded-[3rem] p-10 border shadow-2xl transition-all duration-500",
                            backtestResult.riskyStocks.some(s => s.riskLevel === 'HIGH') 
                              ? "border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.1)]" 
                              : "border-white/10"
                          )}>
                            <div className="flex items-center gap-4 mb-8">
                              <ShieldAlert className={cn(
                                "w-6 h-6",
                                backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') ? "text-red-500 animate-pulse" : "text-red-400"
                              )} />
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "text-[11px] font-black uppercase tracking-[0.3em]",
                                  backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') ? "text-red-400" : "text-white/20"
                                )}>리스크 관리: 정리 추천</span>
                                <div title="추세 붕괴, 펀더멘털 훼손, 과도한 밸류에이션 등 리스크가 감지된 종목입니다.">
                                  <Info 
                                    className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-red-400 transition-colors" 
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="space-y-5">
                              {(backtestResult.riskyStocks || []).map((rs: any, i: number) => (
                                <div key={i} className={cn(
                                  "rounded-[2rem] p-6 border transition-all",
                                  rs.riskLevel === 'HIGH' 
                                    ? "bg-red-500/10 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.05)]" 
                                    : "bg-red-500/5 border-red-500/10 group hover:bg-red-500/10"
                                )}>
                                  <div className="flex items-center justify-between mb-3">
                                    <span className={cn(
                                      "text-lg font-black",
                                      rs.riskLevel === 'HIGH' ? "text-red-500" : "text-red-400"
                                    )}>{rs.stock}</span>
                                    <span className={cn(
                                      "text-[10px] font-black px-3 py-1 rounded-xl uppercase tracking-widest flex items-center gap-1",
                                      rs.riskLevel === 'HIGH' ? "bg-red-500 text-white animate-pulse" : "bg-orange-500/20 text-orange-400"
                                    )}>
                                      <ShieldAlert className="w-3 h-3" />
                                      {rs.riskLevel} RISK
                                    </span>
                                  </div>
                                  <p className="text-xs text-white/60 font-bold leading-relaxed">{rs.reason}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center py-32 glass-3d rounded-[3rem] border border-white/10 border-dashed">
                      <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-8">
                        <History className="w-12 h-12 text-white/10" />
                      </div>
                      <h3 className="text-2xl font-black text-white/20 mb-3">백테스팅 결과가 없습니다</h3>
                      <p className="text-base text-white/10 font-bold">포트폴리오를 구성하고 시뮬레이션을 시작하세요.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
  );
}
