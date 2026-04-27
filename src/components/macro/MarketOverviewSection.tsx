// @responsibility macro 영역 MarketOverviewSection 컴포넌트
import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { EconomicRegime } from '../../types/quant';
import { useGlobalIntelStore } from '../../stores/useGlobalIntelStore';
import { REGIME_LABELS } from './constants';

interface Props {
  marketOverview?: {
    sectorRotation?: Array<{ sector: string; momentum: number; flow: string }>;
    globalEtfMonitoring?: Array<{ name: string; flow: string; change: number }>;
    exchangeRates?: Array<{ name: string; value: number; change: number }>;
  };
}

export function MarketOverviewSection({ marketOverview }: Props) {
  const economicRegime = useGlobalIntelStore(s => s.economicRegimeData);
  const currentRegime: EconomicRegime = economicRegime?.regime ?? 'EXPANSION';
  const regimeMeta = REGIME_LABELS[currentRegime];

  const sortedSectors = useMemo(
    () => [...(marketOverview?.sectorRotation ?? [])].sort((a, b) => b.momentum - a.momentum),
    [marketOverview?.sectorRotation],
  );

  return (
    <>
      {/* ── 허용 섹터 화이트리스트 ── */}
      {economicRegime && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-4">
              허용 섹터 화이트리스트 ({currentRegime} · {regimeMeta.ko})
            </h3>
            <div className="flex flex-wrap gap-2">
              {economicRegime.allowedSectors.map(s => (
                <span key={s} className={`px-3 py-1 text-xs font-black border-2 ${regimeMeta.borderColor} ${regimeMeta.bgColor} ${regimeMeta.color}`}>
                  ✓ {s}
                </span>
              ))}
            </div>
          </div>
          <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-4">
              회피 섹터 블랙리스트
            </h3>
            <div className="flex flex-wrap gap-2">
              {economicRegime.avoidSectors.length > 0 ? (
                economicRegime.avoidSectors.map(s => (
                  <span key={s} className="px-3 py-1 text-xs font-black border-2 border-red-400 bg-red-50 text-red-700">
                    ✕ {s}
                  </span>
                ))
              ) : (
                <span className="text-xs text-theme-text-muted italic">현재 특별 회피 섹터 없음</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Global ETF 자금 흐름 히트맵 ── */}
      {marketOverview?.globalEtfMonitoring && (
        <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-6">
            글로벌 ETF 자금 흐름 히트맵
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {marketOverview.globalEtfMonitoring.map((etf: any) => {
              const isInflow = etf.flow === 'INFLOW';
              return (
                <div
                  key={etf.name}
                  className={`p-4 border-2 text-center ${
                    isInflow ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'
                  }`}
                >
                  <p className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">{etf.name}</p>
                  <div className={`mt-2 flex items-center justify-center gap-1 font-black ${isInflow ? 'text-green-700' : 'text-red-700'}`}>
                    {isInflow ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    <span className="text-sm">{isInflow ? '+' : ''}{etf.change?.toFixed(2) ?? '—'}%</span>
                  </div>
                  <p className={`text-[9px] font-black mt-1 ${isInflow ? 'text-green-600' : 'text-red-600'}`}>
                    {etf.flow}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 수출 모멘텀 섹터 랭킹 ── */}
      {marketOverview?.sectorRotation && (
        <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-6">
            섹터 모멘텀 랭킹 (수출·자금흐름 기준)
          </h3>
          <div className="space-y-3">
            {sortedSectors.map((s: any, i: number) => {
              const isInflow = s.flow === 'INFLOW';
              return (
                <div key={s.sector} className="flex items-center gap-4">
                  <span className="text-[10px] font-black text-theme-text-muted w-4 text-right">{i + 1}</span>
                  <span className="text-sm font-black w-20">{s.sector}</span>
                  <div className="flex-1 h-3 bg-theme-card border border-theme-border relative">
                    <div
                      className={`h-full ${isInflow ? 'bg-green-600' : 'bg-red-500'}`}
                      style={{ width: `${s.momentum}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-black font-mono w-8 text-right">{s.momentum}</span>
                  <span className={`text-[9px] font-black w-14 ${isInflow ? 'text-green-600' : 'text-red-500'}`}>
                    {isInflow ? '↑ INFLOW' : '↓ OUTFLOW'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
