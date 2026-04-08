import React from 'react';
import { 
  X, 
  TrendingUp, 
  ShieldCheck, 
  Activity, 
  PieChart as PieChartIcon,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRightLeft
} from 'lucide-react';
import { motion } from 'motion/react';
import { Portfolio } from '../services/stockService';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PortfolioComparisonProps {
  portfolios: Portfolio[];
  onClose: () => void;
}

export const PortfolioComparison: React.FC<PortfolioComparisonProps> = ({
  portfolios,
  onClose
}) => {
  const chartData = portfolios?.map(p => ({
    name: p.name,
    return: p.lastBacktestResult?.cumulativeReturn || 0,
    sharpe: p.lastBacktestResult?.sharpeRatio || 0,
    drawdown: Math.abs(p.lastBacktestResult?.maxDrawdown || 0),
    volatility: p.lastBacktestResult?.volatility || 0
  })) || [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/80 backdrop-blur-xl"
        onClick={onClose}
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-7xl h-full max-h-[90vh] glass-3d rounded-[4rem] border border-white/10 overflow-hidden flex flex-col shadow-[0_50px_100px_rgba(0,0,0,0.5)]"
      >
        <div className="p-4 sm:p-10 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-4 rounded-3xl bg-indigo-500/20">
              <ArrowRightLeft className="w-8 h-8 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-fluid-3xl font-black text-white tracking-tight uppercase">Portfolio Comparison</h2>
              <p className="text-white/40 font-bold text-sm uppercase tracking-widest">Analyzing {portfolios.length} strategies</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-4 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-12 space-y-16">
          {/* Key Metrics Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="glass-3d rounded-[3rem] p-8 border border-white/5">
              <div className="flex items-center gap-3 mb-8">
                <TrendingUp className="w-5 h-5 text-orange-400" />
                <span className="text-xs font-black text-white/40 uppercase tracking-widest">Cumulative Return</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }}
                      itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                    />
                    <Bar dataKey="return" radius={[8, 8, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.return >= 0 ? '#fb923c' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-3d rounded-[3rem] p-8 border border-white/5">
              <div className="flex items-center gap-3 mb-8">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
                <span className="text-xs font-black text-white/40 uppercase tracking-widest">Sharpe Ratio</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }}
                      itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                    />
                    <Bar dataKey="sharpe" fill="#60a5fa" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-3d rounded-[3rem] p-8 border border-white/5">
              <div className="flex items-center gap-3 mb-8">
                <Activity className="w-5 h-5 text-red-400" />
                <span className="text-xs font-black text-white/40 uppercase tracking-widest">Max Drawdown</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }}
                      itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                    />
                    <Bar dataKey="drawdown" fill="#f87171" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-3d rounded-[3rem] p-8 border border-white/5">
              <div className="flex items-center gap-3 mb-8">
                <PieChartIcon className="w-5 h-5 text-purple-400" />
                <span className="text-xs font-black text-white/40 uppercase tracking-widest">Volatility</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }}
                      itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                    />
                    <Bar dataKey="volatility" fill="#c084fc" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Detailed Table */}
          <div className="glass-3d rounded-[3rem] border border-white/5 overflow-hidden overflow-x-auto">
            <table className="w-full text-left min-w-[600px]">
              <thead>
                <tr className="bg-white/5">
                  <th className="px-3 sm:px-8 py-3 sm:py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Portfolio Name</th>
                  <th className="px-3 sm:px-8 py-3 sm:py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Return</th>
                  <th className="px-3 sm:px-8 py-3 sm:py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Sharpe</th>
                  <th className="px-3 sm:px-8 py-3 sm:py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Max DD</th>
                  <th className="px-3 sm:px-8 py-3 sm:py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Allocation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {portfolios?.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 sm:px-8 py-3 sm:py-8">
                      <div className="font-black text-white text-lg">{p.name}</div>
                      <div className="text-[10px] font-black text-white/20 uppercase tracking-widest mt-1">{p.items?.length || 0} Assets</div>
                    </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-8">
                      <div className={cn(
                        "flex items-center gap-2 font-black text-xl",
                        (p.lastBacktestResult?.cumulativeReturn || 0) >= 0 ? "text-green-400" : "text-red-400"
                      )}>
                        {(p.lastBacktestResult?.cumulativeReturn || 0) >= 0 ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                        {p.lastBacktestResult?.cumulativeReturn || 0}%
                      </div>
                    </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-8 font-black text-white text-xl">{p.lastBacktestResult?.sharpeRatio || 0}</td>
                    <td className="px-3 sm:px-8 py-3 sm:py-8 font-black text-red-400 text-xl">{p.lastBacktestResult?.maxDrawdown || 0}%</td>
                    <td className="px-3 sm:px-8 py-3 sm:py-8">
                      <div className="flex flex-wrap gap-2 max-w-xs">
                        {p.items?.slice(0, 3).map(item => (
                          <span key={item.code} className="px-3 py-1 bg-white/5 rounded-lg text-[10px] font-black text-white/40 uppercase tracking-widest border border-white/5">
                            {item.name} {item.weight}%
                          </span>
                        ))}
                        {p.items.length > 3 && (
                          <span className="px-3 py-1 bg-white/5 rounded-lg text-[10px] font-black text-white/40 uppercase tracking-widest border border-white/5">
                            +{p.items.length - 3} more
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
