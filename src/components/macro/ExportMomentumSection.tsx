import React, { useState } from 'react';
import { RefreshCw, Cpu, Ship } from 'lucide-react';
import { ExportMomentumData } from '../../types/quant';
import { getExportMomentum } from '../../services/stockService';

export function ExportMomentumSection() {
  const [exportMomentum, setExportMomentum] = useState<ExportMomentumData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setExportMomentum(await getExportMomentum()); }
    catch (err) { console.error('[ERROR] Export Momentum 조회 실패:', err); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            <Cpu size={12} className="inline mr-1" />
            수출 모멘텀 섹터 로테이션 엔진
          </h3>
          {exportMomentum && (
            <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {exportMomentum.lastUpdated}</p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? '조회 중...' : '수출 모멘텀 조회'}
        </button>
      </div>

      {exportMomentum ? (
        <div className="space-y-4">
          {/* Hot Sector Badges */}
          {exportMomentum.hotSectors.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {exportMomentum.hotSectors.map(s => (
                <span key={s} className="px-3 py-1 bg-amber-100 border-2 border-amber-500 text-amber-800 text-xs font-black">
                  🔥 {s} +5% 보너스 적용
                </span>
              ))}
              {exportMomentum.semiconductorGate2Relax && (
                <span className="px-3 py-1 bg-blue-100 border-2 border-blue-500 text-blue-800 text-xs font-black">
                  ★ 반도체 3개월 연속 성장 → Gate 2 완화
                </span>
              )}
              {exportMomentum.shipyardBonus && (
                <span className="px-3 py-1 bg-cyan-100 border-2 border-cyan-500 text-cyan-800 text-xs font-black">
                  <Ship size={10} className="inline mr-1" />조선 +30% YoY 보너스
                </span>
              )}
            </div>
          )}

          {/* Product Heatmap */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {exportMomentum.products.map(p => {
              const hot = p.isHot;
              const positive = p.yoyGrowth >= 0;
              return (
                <div
                  key={p.product}
                  className={`p-4 border-2 text-center ${
                    hot ? 'border-amber-500 bg-amber-50'
                    : positive ? 'border-green-300 bg-green-50'
                    : 'border-red-300 bg-red-50'
                  }`}
                >
                  <p className="text-[10px] font-black">{p.product}</p>
                  <p className={`text-2xl font-black font-mono mt-2 ${
                    positive ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {positive ? '+' : ''}{p.yoyGrowth.toFixed(1)}%
                  </p>
                  <p className="text-[8px] text-theme-text-muted mt-1">YoY</p>
                  {hot && <p className="text-[8px] font-black text-amber-700 mt-1">🔥 HOT</p>}
                  {p.consecutiveGrowthMonths && (
                    <p className="text-[8px] text-blue-600 font-black mt-1">{p.consecutiveGrowthMonths}개월 연속↑</p>
                  )}
                  <p className="text-[8px] text-theme-text-muted mt-1 leading-tight">{p.sector}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-theme-text-muted italic text-center py-4">
          "수출 모멘텀 조회" 버튼을 눌러 주요 수출 품목별 YoY 성장률을 분석합니다.
        </p>
      )}
    </div>
  );
}
