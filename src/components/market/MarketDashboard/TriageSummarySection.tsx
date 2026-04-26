// @responsibility market 영역 TriageSummarySection 컴포넌트
import React from 'react';
import { Activity, TrendingUp, Zap, ShieldAlert } from 'lucide-react';

interface TriageSummarySectionProps {
  gate1: number;
  gate2: number;
  gate3: number;
  total: number;
}

export const TriageSummarySection: React.FC<TriageSummarySectionProps> = ({ gate1, gate2, gate3, total }) => {
  const safeTotal = total > 0 ? total : 1;

  return (
    <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <Activity size={80} />
        </div>
        <div className="relative z-10">
          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-4 block">전체 분석 종목</span>
          <div className="text-fluid-4xl font-black text-white tracking-tighter">{total}</div>
          <p className="text-[9px] font-bold text-white/40 mt-2 uppercase tracking-widest">Total Monitored Assets</p>
        </div>
      </div>

      <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <ShieldAlert size={80} className="text-red-500" />
        </div>
        <div className="relative z-10">
          <span className="text-[10px] font-black text-red-400/60 uppercase tracking-[0.2em] mb-4 block">Gate 1: 생존 필터 통과</span>
          <div className="text-fluid-4xl font-black text-red-400 tracking-tighter">{gate1}</div>
          <div className="h-1.5 bg-white/5 rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-red-500" style={{ width: `${(gate1 / safeTotal) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <TrendingUp size={80} className="text-orange-500" />
        </div>
        <div className="relative z-10">
          <span className="text-[10px] font-black text-orange-400/60 uppercase tracking-[0.2em] mb-4 block">Gate 2: 성장 검증 통과</span>
          <div className="text-fluid-4xl font-black text-orange-400 tracking-tighter">{gate2}</div>
          <div className="h-1.5 bg-white/5 rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-orange-500" style={{ width: `${(gate2 / safeTotal) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="glass-3d p-6 rounded-[2rem] border border-white/10 flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <Zap size={80} className="text-indigo-500" />
        </div>
        <div className="relative z-10">
          <span className="text-[10px] font-black text-indigo-400/60 uppercase tracking-[0.2em] mb-4 block">Gate 3: 정밀 타이밍 통과</span>
          <div className="text-fluid-4xl font-black text-indigo-400 tracking-tighter">{gate3}</div>
          <div className="h-1.5 bg-white/5 rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-indigo-500" style={{ width: `${(gate3 / safeTotal) * 100}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
};
