// @responsibility macro 영역 GeoRiskSection 컴포넌트
import React, { useState } from 'react';
import { RefreshCw, Globe } from 'lucide-react';
import { GeopoliticalRiskData } from '../../types/quant';
import { getGeopoliticalRiskScore } from '../../services/stockService';

export function GeoRiskSection() {
  const [geoRisk, setGeoRisk] = useState<GeopoliticalRiskData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setGeoRisk(await getGeopoliticalRiskScore()); }
    catch (err) { console.error('[ERROR] Geo Risk 조회 실패:', err); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            <Globe size={12} className="inline mr-1" />
            지정학 리스크 스코어링 모듈 (GOS)
          </h3>
          {geoRisk && (
            <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {geoRisk.lastUpdated}</p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? '조회 중...' : '지정학 리스크 조회'}
        </button>
      </div>

      {geoRisk ? (
        <div className="space-y-6">
          {/* Score + Level */}
          <div className="flex items-center gap-6">
            <div className={`text-center p-4 border-2 w-28 ${
              geoRisk.level === 'OPPORTUNITY' ? 'border-green-600 bg-green-50'
              : geoRisk.level === 'RISK' ? 'border-red-600 bg-red-50'
              : 'border-gray-400 bg-theme-bg'
            }`}>
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">GOS</p>
              <p className="text-fluid-4xl font-black font-mono mt-1">{geoRisk.score}</p>
              <p className="text-[9px] text-theme-text-muted font-mono">/10</p>
            </div>
            <div className="flex-1 space-y-2">
              <div className={`inline-flex items-center gap-2 px-4 py-2 font-black text-sm border-2 ${
                geoRisk.level === 'OPPORTUNITY' ? 'border-green-600 bg-green-50 text-green-700'
                : geoRisk.level === 'RISK' ? 'border-red-600 bg-red-50 text-red-700'
                : 'border-gray-400 bg-theme-bg text-theme-text-secondary'
              }`}>
                {geoRisk.level === 'OPPORTUNITY' ? '★ 지정학 기회 (방산·조선·원자력 Gate 3 완화)'
                : geoRisk.level === 'RISK' ? '⚠ 지정학 리스크 (지정학 섹터 Kelly 30% 축소)'
                : '— 중립 구간'}
              </div>
              <div className="flex gap-2">
                {geoRisk.affectedSectors.map(s => (
                  <span key={s} className="px-2 py-0.5 text-[9px] font-black border border-theme-border bg-theme-card">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* GOS Bar */}
          <div>
            <div className="h-3 w-full bg-theme-card border border-theme-border relative">
              <div
                className={`h-full transition-all duration-700 ${
                  geoRisk.score >= 7 ? 'bg-green-600' : geoRisk.score >= 4 ? 'bg-theme-text-muted' : 'bg-red-600'
                }`}
                style={{ width: `${geoRisk.score * 10}%` }}
              />
              {[3, 7].map(t => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 w-px bg-theme-text opacity-40"
                  style={{ left: `${t * 10}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[8px] text-red-500 font-black">0 Kelly축소</span>
              <span className="text-[8px] text-theme-text-muted font-black">3↑ 중립 7↑</span>
              <span className="text-[8px] text-green-600 font-black">Gate3완화 10</span>
            </div>
          </div>

          {/* Tone Breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            {[
              { label: '긍정', val: geoRisk.toneBreakdown.positive, color: 'text-green-700 bg-green-50 border-green-300' },
              { label: '중립', val: geoRisk.toneBreakdown.neutral,  color: 'text-theme-text-secondary bg-theme-bg border-theme-border' },
              { label: '부정', val: geoRisk.toneBreakdown.negative, color: 'text-red-700 bg-red-50 border-red-300' },
            ].map(item => (
              <div key={item.label} className={`p-3 border ${item.color}`}>
                <p className="text-[9px] font-black uppercase tracking-widest">{item.label}</p>
                <p className="text-2xl font-black font-mono mt-1">{item.val}%</p>
              </div>
            ))}
          </div>

          {/* Headlines */}
          {geoRisk.headlines.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted">주요 뉴스 헤드라인</p>
              {geoRisk.headlines.map((h, i) => (
                <div key={i} className="flex items-start gap-2 p-2 border border-theme-border bg-theme-bg">
                  <span className="text-[9px] font-black text-theme-text-muted mt-0.5">{i + 1}.</span>
                  <p className="text-xs text-theme-text leading-snug">{h}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-theme-text-muted italic text-center py-4">
          "지정학 리스크 조회" 버튼을 눌러 Gemini AI 기반 GOS를 산출합니다.
        </p>
      )}
    </div>
  );
}
