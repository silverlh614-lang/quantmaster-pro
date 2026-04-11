import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Gate0Result, EconomicRegime, EconomicRegimeData } from '../../types/quant';
import { REGIME_LABELS } from './constants';
import { MHSBar } from './MHSBar';

interface Props {
  gate0Result?: Gate0Result;
  economicRegime: EconomicRegimeData | null;
  loading: boolean;
  error: string | null;
  onLoadRegime: () => void;
}

const REGIMES: EconomicRegime[] = ['RECOVERY', 'EXPANSION', 'SLOWDOWN', 'RECESSION', 'UNCERTAIN', 'CRISIS', 'RANGE_BOUND'];

export function RegimeGaugeSection({ gate0Result, economicRegime, loading, error, onLoadRegime }: Props) {
  const currentRegime: EconomicRegime = economicRegime?.regime ?? 'EXPANSION';
  const mhs = gate0Result?.macroHealthScore ?? 0;

  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Macro Intelligence</h2>
          <p className="text-[10px] font-mono text-theme-text-muted mt-1">
            거시경제 컨트롤 타워 — 경기 레짐 · MHS · ETF 자금흐름 · FX 임팩트
          </p>
        </div>
        <button
          onClick={onLoadRegime}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-sm font-black uppercase tracking-widest disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'AI 조회 중...' : '레짐 분류 실행'}
        </button>
      </div>

      {error && (
        <div className="p-4 border border-red-400 bg-red-50 text-red-700 text-sm font-bold">
          ⚠ {error}
        </div>
      )}

      {/* ── 경기 레짐 게이지 + MHS 바 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* 경기 레짐 게이지 */}
        <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-6">
            경기 레짐 게이지 — Economic Regime Classifier
          </h3>
          <div className="flex gap-2 mb-6">
            {REGIMES.map(r => {
              const meta = REGIME_LABELS[r];
              const isActive = r === currentRegime;
              return (
                <div
                  key={r}
                  className={`flex-1 p-3 border-2 text-center transition-all ${
                    isActive
                      ? `${meta.bgColor} ${meta.borderColor} ${meta.color}`
                      : 'border-theme-border text-theme-text-muted bg-theme-bg'
                  }`}
                >
                  <p className="text-[9px] font-black uppercase tracking-widest">{r}</p>
                  <p className={`text-base font-black mt-1 ${isActive ? meta.color : 'text-theme-text-muted'}`}>
                    {meta.ko}
                  </p>
                  {isActive && economicRegime && (
                    <p className="text-[9px] font-mono mt-1">{economicRegime.confidence}% 확신</p>
                  )}
                </div>
              );
            })}
          </div>

          {economicRegime ? (
            <div className="space-y-4">
              <p className="text-xs italic text-theme-text-secondary leading-relaxed">"{economicRegime.rationale}"</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(economicRegime.keyIndicators).map(([k, v]) => (
                  <div key={k} className="p-3 bg-theme-bg border border-theme-border">
                    <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">
                      {k === 'exportGrowth' ? '수출증가율' : k === 'bokRateDirection' ? '기준금리' : k === 'oeciCli' ? 'OECD CLI' : 'GDP 성장률'}
                    </p>
                    <p className="text-sm font-black font-mono mt-1">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-theme-text-muted italic text-center py-4">
              "레짐 분류 실행" 버튼을 눌러 Gemini AI로 현재 경기 사이클을 자동 분류합니다.
            </p>
          )}
        </div>

        {/* MHS + FX + 금리 사이클 */}
        <div className="space-y-6">

          {/* MHS 바 */}
          <div className="p-6 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
            <MHSBar score={mhs} />
            {gate0Result && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  { label: '금리', v: gate0Result.details.interestRateScore },
                  { label: '유동성', v: gate0Result.details.liquidityScore },
                  { label: '경기', v: gate0Result.details.economicScore },
                  { label: '리스크', v: gate0Result.details.riskScore },
                ].map(item => (
                  <div key={item.label} className="p-2 border border-theme-border bg-theme-bg">
                    <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">{item.label}</p>
                    <p className="text-lg font-black font-mono">{item.v}<span className="text-[9px] text-theme-text-muted">/25</span></p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* FX + 금리 사이클 인디케이터 */}
          {gate0Result && (
            <div className="p-6 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-4">
                FX · Rate Cycle 임팩트
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-theme-border">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">환율 레짐</p>
                  <p className="text-lg font-black">
                    {gate0Result.fxRegime === 'DOLLAR_STRONG'
                      ? '💵 달러 강세'
                      : gate0Result.fxRegime === 'DOLLAR_WEAK'
                        ? '🌏 달러 약세'
                        : '〰 중립 구간'}
                  </p>
                  <p className="text-[10px] text-theme-text-muted mt-1">
                    {gate0Result.fxRegime === 'DOLLAR_STRONG'
                      ? '수출주 +3pt / 내수주 -3pt'
                      : gate0Result.fxRegime === 'DOLLAR_WEAK'
                        ? '내수주 +3pt / 수출주 -3pt'
                        : 'FX 조정 없음'}
                  </p>
                </div>
                <div className="p-4 border border-theme-border">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">금리 사이클</p>
                  <p className="text-lg font-black">
                    {gate0Result.rateCycle === 'TIGHTENING'
                      ? '🔺 긴축기'
                      : gate0Result.rateCycle === 'EASING'
                        ? '🔻 완화기'
                        : '⏸ 동결기'}
                  </p>
                  <p className="text-[10px] text-theme-text-muted mt-1">
                    {gate0Result.rateCycle === 'TIGHTENING'
                      ? 'ICR 기준 강화 · 레버리지 페널티'
                      : gate0Result.rateCycle === 'EASING'
                        ? '성장주 가중치 +20%'
                        : '기본 모드 유지'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
