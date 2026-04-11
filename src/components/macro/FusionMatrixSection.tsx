import React from 'react';
import { ArrowRight } from 'lucide-react';
import { EconomicRegime, ROEType } from '../../types/quant';
import { useGlobalIntelStore } from '../../stores/useGlobalIntelStore';
import { FUSION_MATRIX, ROE_TYPE_LABELS, REGIME_LABELS, SIGNAL_STYLE, FusionCell, AlphaSignal } from './constants';

interface Props {
  currentRoeType: ROEType;
}

const REGIMES: EconomicRegime[] = ['RECOVERY', 'EXPANSION', 'SLOWDOWN', 'RECESSION', 'UNCERTAIN', 'CRISIS', 'RANGE_BOUND'];
const ROE_TYPES: ROEType[] = [1, 2, 3, 4, 5];

export function FusionMatrixSection({ currentRoeType }: Props) {
  const economicRegimeData = useGlobalIntelStore(s => s.economicRegimeData);
  const currentRegime: EconomicRegime = economicRegimeData?.regime ?? 'EXPANSION';
  return (
    <div className="border border-theme-text bg-theme-card shadow-[8px_8px_0px_0px_rgba(128,128,128,0.3)]">
      <div className="p-8 border-b border-theme-text">
        <h3 className="text-xl font-black uppercase tracking-tight">
          Macro-Micro Fusion Matrix
        </h3>
        <p className="text-[10px] font-mono text-theme-text-muted mt-1">
          경기사이클 4단계 × ROE 5유형 → 20개 투자 국면 알파 지도
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr>
              <th className="p-3 border border-theme-border bg-theme-bg text-[9px] font-black uppercase tracking-widest text-left w-36">
                ROE 유형 ↓ / 레짐 →
              </th>
              {REGIMES.map(r => (
                <th
                  key={r}
                  className={`p-3 border border-theme-border text-[9px] font-black uppercase tracking-widest text-center ${
                    r === currentRegime ? REGIME_LABELS[r].bgColor : 'bg-theme-bg'
                  }`}
                >
                  <span className={r === currentRegime ? REGIME_LABELS[r].color : 'text-theme-text-muted'}>
                    {r === currentRegime ? '▶ ' : ''}{REGIME_LABELS[r].ko}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROE_TYPES.map(roeType => (
              <tr key={roeType}>
                <td
                  className={`p-3 border border-theme-border text-[9px] font-black ${
                    roeType === currentRoeType ? 'bg-theme-text text-white' : 'bg-theme-bg text-theme-text-secondary'
                  }`}
                >
                  {roeType === currentRoeType ? '▶ ' : ''}{ROE_TYPE_LABELS[roeType]}
                </td>
                {REGIMES.map(regime => {
                  const cell = FUSION_MATRIX[regime][roeType];
                  const style = SIGNAL_STYLE[cell.signal];
                  const isCurrentPosition = regime === currentRegime && roeType === currentRoeType;
                  return (
                    <td
                      key={regime}
                      className={`p-3 border-2 transition-all ${
                        isCurrentPosition
                          ? 'border-theme-text ring-2 ring-inset ring-[#141414]'
                          : 'border-theme-border'
                      } ${style.bg}`}
                      title={cell.strategy}
                    >
                      <div className="space-y-1">
                        <span className={`text-[9px] font-black block ${style.text}`}>
                          {style.label}
                        </span>
                        <span className={`text-[8px] font-mono block ${style.text} opacity-80`}>
                          {cell.expectedReturn}
                        </span>
                        <span className={`text-[8px] leading-tight block ${style.text} opacity-70`}>
                          {cell.phase}
                        </span>
                        {isCurrentPosition && (
                          <span className={`text-[8px] font-black block mt-1 underline ${style.text}`}>
                            ← 현재 위치
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 현재 위치 전략 하이라이트 */}
      {(() => {
        const regimeRow = FUSION_MATRIX[currentRegime] as Record<number, FusionCell> | undefined;
        const currentCell = regimeRow?.[currentRoeType as number];
        if (!currentCell) return null;
        const style = SIGNAL_STYLE[currentCell.signal as AlphaSignal];
        if (!style) return null;
        return (
          <div className={`p-6 border-t border-theme-text ${style.bg}`}>
            <div className="flex items-start gap-4">
              <ArrowRight size={20} className={`flex-shrink-0 mt-0.5 ${style.text}`} />
              <div>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${style.text}`}>
                  현재 위치: {REGIME_LABELS[currentRegime]?.ko} + {(ROE_TYPE_LABELS as Record<number, string>)[currentRoeType as number]} → {currentCell.phase}
                </p>
                <p className={`text-sm font-bold leading-relaxed ${style.text}`}>
                  {currentCell.strategy}
                </p>
                <p className={`text-[10px] font-mono mt-2 opacity-80 ${style.text}`}>
                  기대 수익률: {currentCell.expectedReturn}
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
