// @responsibility 섹터 로테이션 컴팩트 히트맵 — Leading/Lagging 1줄 시각화 (ADR-0022 PR-E)

import React, { useState } from 'react';
import { Flame, Snowflake, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useGlobalIntelStore } from '../../stores';
import { classifySectorHeat, SECTOR_HEAT_CSS } from '../../utils/sectorHeatColor';
import type { SectorEnergyScore } from '../../types/sectorEnergy';
import { SectorStocksDrilldown } from './SectorStocksDrilldown';

interface SectorChipProps {
  score: SectorEnergyScore;
  showScore?: boolean;
  onSelect?: (sectorName: string, score: number) => void;
}

function SectorChip({ score, showScore = true, onSelect }: SectorChipProps) {
  const tone = classifySectorHeat(score.score);
  const handleClick = () => onSelect?.(score.name, score.score);
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!onSelect}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap border',
        SECTOR_HEAT_CSS[tone],
        onSelect && 'hover:opacity-80 transition-opacity cursor-pointer',
      )}
      title={`${score.name} — 에너지 ${score.energyScore.toFixed(1)} / 정규 ${score.score.toFixed(1)} · 클릭 시 종목 보기`}
      aria-label={`${score.name} 섹터 종목 드릴다운`}
    >
      <span>{score.name}</span>
      {showScore && <span className="font-num opacity-80">{Math.round(score.score)}</span>}
    </button>
  );
}

/**
 * 섹터 로테이션 컴팩트 히트맵.
 * - sectorEnergyResult 부재 시 null 반환 (헤더 스택에 빈 공간 미생성).
 * - 한 줄: 🔥 LEADING 3개 + ⚖️ NEUTRAL N개 + 🧊 LAGGING 3개.
 * - 펼치기 → scores 전체 막대 그래프.
 */
export function SectorRotationHeatmap() {
  const result = useGlobalIntelStore(s => s.sectorEnergyResult);
  const [expanded, setExpanded] = useState(false);
  const [drilldown, setDrilldown] = useState<{ name: string; score: number } | null>(null);

  if (!result || !result.scores || result.scores.length === 0) return null;

  const handleSelect = (name: string, score: number) => setDrilldown({ name, score });

  const sorted = [...result.scores].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  const bottom3 = sorted.slice(-3).reverse();

  return (
    <div
      className="no-print border-b border-white/5 bg-black/10 backdrop-blur-sm"
      role="region"
      aria-label="섹터 로테이션"
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-9 flex items-center gap-3 overflow-x-auto">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white/50 shrink-0 flex items-center gap-1">
          <Flame className="w-3 h-3 text-red-400" />
          섹터 로테이션
        </span>
        <div className="w-px h-3 bg-white/10 shrink-0" />

        {/* Leaders */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] text-white/40 font-bold">🔥</span>
          {top3.map(s => <SectorChip key={s.name} score={s} onSelect={handleSelect} />)}
        </div>

        <div className="w-px h-3 bg-white/10 shrink-0" />

        {/* Laggers */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] text-white/40 font-bold">🧊</span>
          {bottom3.map(s => <SectorChip key={s.name} score={s} onSelect={handleSelect} />)}
        </div>

        {/* Season chip */}
        <span className="hidden md:inline text-[9px] font-num text-white/40 ml-auto shrink-0">
          {result.currentSeason} · {result.scores.length} 섹터
        </span>

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="ml-auto md:ml-0 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white/80 transition-opacity shrink-0"
          aria-expanded={expanded}
          aria-label={expanded ? '섹터 히트맵 접기' : '섹터 히트맵 펼치기'}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded — 전 섹터 막대 */}
      {expanded && (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-3 border-t border-white/10 mt-1 pt-2">
          <ul className="space-y-1">
            {sorted.map(s => {
              const tone = classifySectorHeat(s.score);
              return (
                <li
                  key={s.name}
                  className="flex items-center gap-2 text-[11px] cursor-pointer hover:bg-white/5 px-1 rounded"
                  onClick={() => handleSelect(s.name, s.score)}
                >
                  <span className="w-20 text-white/70 font-bold shrink-0 truncate">{s.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden min-w-[80px]">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        tone === 'HOT'  ? 'bg-red-500/60'   :
                        tone === 'WARM' ? 'bg-amber-500/60' :
                        tone === 'COOL' ? 'bg-cyan-500/60'  :
                                          'bg-blue-500/60',
                      )}
                      style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-num font-black opacity-80 shrink-0">
                    {Math.round(s.score)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-white/40 leading-snug flex items-center gap-1">
            <Snowflake className="w-3 h-3 opacity-70" />
            {result.summary || `${result.currentSeason} 시즌 — Leading ${top3.length} / Lagging ${bottom3.length}`}
          </p>
        </div>
      )}

      {/* PR-K 섹터별 종목 드릴다운 모달 */}
      {drilldown && (
        <SectorStocksDrilldown
          sectorName={drilldown.name}
          score={drilldown.score}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}
