import React from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus,
  ArrowRight,
  Zap,
  Activity,
  Layers
} from 'lucide-react';
import { SectorRotation } from '../types/quant';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SectorHeatmapProps {
  sectors: SectorRotation[];
}

export const SectorHeatmap: React.FC<SectorHeatmapProps> = ({ sectors }) => {
  if (!sectors || sectors.length === 0) return null;

  // Sort by strength
  const sortedSectors = [...sectors].sort((a, b) => b.strength - a.strength);

  return (
    <div className="glass-3d p-8 rounded-[2.5rem] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-4">
          <div className="bg-indigo-500/20 p-3 rounded-2xl border border-indigo-500/30">
            <Layers size={24} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tighter">섹터 로테이션 맵</h2>
            <p className="text-xs font-bold text-white/30 uppercase tracking-widest">Real-time Sector Capital Flow Heatmap</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-indigo-500 rounded-full" />
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">강세 (Strong)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-white/10 rounded-full" />
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">약세 (Weak)</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {sortedSectors.map((sector, index) => {
          const strengthPercent = sector.strength;
          const isHighStrength = strengthPercent > 70;
          const isLowStrength = strengthPercent < 30;
          
          return (
            <div key={sector.name} className="group relative">
              <div className="flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-all duration-300">
                {/* Sector Name */}
                <div className="w-32 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white/20 uppercase tracking-widest">0{index + 1}</span>
                    <span className="text-sm font-black text-white tracking-tight group-hover:text-indigo-400 transition-colors">{sector.name}</span>
                  </div>
                </div>

                {/* Heatmap Bar */}
                <div className="flex-1 h-8 bg-white/5 rounded-xl overflow-hidden relative border border-white/5">
                  <div 
                    className={cn(
                      "h-full transition-all duration-1000 ease-out relative",
                      isHighStrength ? "bg-gradient-to-r from-indigo-600 to-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.3)]" :
                      isLowStrength ? "bg-white/10" : "bg-white/20"
                    )}
                    style={{ width: `${strengthPercent}%` }}
                  >
                    {/* Animated shine effect for leading sectors */}
                    {sector.isLeading && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
                    )}
                  </div>
                  
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex justify-between px-1 pointer-events-none">
                    {[...Array(10)].map((_, i) => (
                      <div key={i} className="w-px h-full bg-white/5" />
                    ))}
                  </div>
                </div>

                {/* Strength Value & Trend */}
                <div className="w-24 flex items-center justify-end gap-3">
                  <div className="text-right">
                    <div className={cn(
                      "text-xl font-black tracking-tighter",
                      isHighStrength ? "text-indigo-400" : "text-white"
                    )}>
                      {sector.strength}
                    </div>
                  </div>
                  <div className={cn(
                    "p-2 rounded-xl",
                    isHighStrength ? "bg-indigo-500/20 text-indigo-400" : "bg-white/5 text-white/20"
                  )}>
                    {sector.strength > 50 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10 p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-[2rem] flex items-start gap-4">
        <Zap className="w-5 h-5 text-indigo-400 mt-1 shrink-0" />
        <div className="space-y-1">
          <p className="text-xs font-black text-indigo-400 uppercase tracking-widest">AI Capital Flow Insight</p>
          <p className="text-sm font-medium text-white/40 leading-relaxed">
            현재 자금은 <span className="text-white font-bold">{sortedSectors[0]?.name}</span> 섹터로 강력하게 유입되고 있으며, 
            <span className="text-white font-bold">{sortedSectors[sortedSectors.length - 1]?.name}</span> 섹터는 상대적으로 소외되고 있습니다. 
            주도주 사이클의 정점 여부를 확인하기 위해 상위 섹터의 거래대금 변화를 주시하십시오.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
};
