import React from 'react';
import { Layers, TrendingUp } from 'lucide-react';

interface SectorRotation {
  rank: number;
  name: string;
  strength: number;
  isLeading?: boolean;
  sectorLeaderNewHigh?: boolean;
}

interface SectorRotationSectionProps {
  topSectors: SectorRotation[];
}

export const SectorRotationSection: React.FC<SectorRotationSectionProps> = ({ topSectors }) => (
  <section>
    <div className="flex items-center gap-4 mb-8">
      <Layers className="w-6 h-6 text-blue-400" />
      <h3 className="text-xl font-black text-white uppercase tracking-tighter">섹터 로테이션 분석 (Sector Rotation)</h3>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {topSectors.map((sector, i) => (
        <div key={i} className="glass-3d p-6 rounded-[2rem] border border-white/10 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 text-white/5 font-black text-6xl italic group-hover:scale-110 transition-transform">
            0{sector.rank}
          </div>
          <div className="relative z-10">
            <h4 className="text-lg font-black text-white mb-2">{sector.name}</h4>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Strength: {sector.strength}%</span>
              <div className="flex items-center gap-1 text-green-400">
                <TrendingUp size={12} />
                <span className="text-[10px] font-black">Leading</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
);
