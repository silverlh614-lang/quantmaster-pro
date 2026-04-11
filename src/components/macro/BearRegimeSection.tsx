import React from 'react';
import { Shield, Activity, CalendarDays, TrendingDown } from 'lucide-react';
import { useGlobalIntelStore } from '../../stores/useGlobalIntelStore';

export function BearRegimeSection() {
  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const vkospiTriggerResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const bearSeasonalityResult = useGlobalIntelStore(s => s.bearSeasonalityResult);
  const inverseGate1Result = useGlobalIntelStore(s => s.inverseGate1Result);

  return (
    <>
      {/* ── Gate -1 Bear Regime Detector + VKOSPI 트리거 (아이디어 1, 4) ── */}
      {(bearRegimeResult || vkospiTriggerResult) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Gate -1 Bear Regime Detector */}
          {bearRegimeResult && (
            <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
              bearRegimeResult.regime === 'BEAR' ? 'border-red-500'
                : bearRegimeResult.regime === 'TRANSITION' ? 'border-amber-500'
                : 'border-green-500'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  Gate -1 · Market Regime Detector
                </h3>
                <span className={`text-xs font-black px-3 py-1 rounded border ${
                  bearRegimeResult.regime === 'BEAR'
                    ? 'bg-red-900/40 border-red-500 text-red-300'
                    : bearRegimeResult.regime === 'TRANSITION'
                    ? 'bg-amber-900/40 border-amber-500 text-amber-300'
                    : 'bg-green-900/40 border-green-500 text-green-300'
                }`}>
                  {bearRegimeResult.regime === 'BEAR' ? '🔴 BEAR'
                    : bearRegimeResult.regime === 'TRANSITION' ? '🟡 TRANSITION'
                    : '🟢 BULL'}
                </span>
              </div>

              {/* Condition bar */}
              <div className="mb-4">
                <div className="flex justify-between text-[9px] font-black text-theme-text-muted mb-1">
                  <span>BEAR 조건 달성</span>
                  <span>{bearRegimeResult.triggeredCount} / {bearRegimeResult.conditions.length} (기준: {bearRegimeResult.threshold}개 이상)</span>
                </div>
                <div className="h-3 bg-theme-bg border border-theme-border relative overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ${
                      bearRegimeResult.regime === 'BEAR' ? 'bg-red-500'
                        : bearRegimeResult.regime === 'TRANSITION' ? 'bg-amber-500'
                        : 'bg-green-500'
                    }`}
                    style={{ width: `${(bearRegimeResult.triggeredCount / bearRegimeResult.conditions.length) * 100}%` }}
                  />
                  {/* Threshold marker */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/60"
                    style={{ left: `${(bearRegimeResult.threshold / bearRegimeResult.conditions.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Conditions list */}
              <ul className="space-y-1.5 mb-4">
                {bearRegimeResult.conditions.map(cond => (
                  <li key={cond.id} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black ${
                      cond.triggered
                        ? 'bg-red-500/30 border-red-400 text-red-300'
                        : 'bg-theme-bg border-theme-border text-theme-text-muted'
                    }`}>
                      {cond.triggered ? '✓' : '–'}
                    </span>
                    <span className={`leading-snug ${cond.triggered ? 'text-theme-text' : 'text-theme-text-muted'}`}>
                      {cond.name}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Action recommendation */}
              <div className={`p-3 border text-xs leading-relaxed ${
                bearRegimeResult.regime === 'BEAR'
                  ? 'border-red-500/40 bg-red-900/20 text-red-200'
                  : bearRegimeResult.regime === 'TRANSITION'
                  ? 'border-amber-500/40 bg-amber-900/20 text-amber-200'
                  : 'border-green-500/40 bg-green-900/20 text-green-200'
              }`}>
                {bearRegimeResult.actionRecommendation}
              </div>
            </div>
          )}

          {/* VKOSPI 공포지수 트리거 시스템 */}
          {vkospiTriggerResult && (
            <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
              vkospiTriggerResult.level === 'HISTORICAL_FEAR' ? 'border-red-600'
                : vkospiTriggerResult.level === 'ENTRY_2' ? 'border-red-500'
                : vkospiTriggerResult.level === 'ENTRY_1' ? 'border-orange-500'
                : vkospiTriggerResult.level === 'WARNING' ? 'border-amber-500'
                : 'border-theme-border'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" />
                  VKOSPI 공포지수 트리거
                </h3>
                <span className={`text-xs font-black px-3 py-1 rounded border font-mono ${
                  vkospiTriggerResult.level === 'HISTORICAL_FEAR' ? 'bg-red-900/50 border-red-500 text-red-200'
                    : vkospiTriggerResult.level === 'ENTRY_2' ? 'bg-red-900/40 border-red-400 text-red-300'
                    : vkospiTriggerResult.level === 'ENTRY_1' ? 'bg-orange-900/40 border-orange-400 text-orange-300'
                    : vkospiTriggerResult.level === 'WARNING' ? 'bg-amber-900/40 border-amber-500 text-amber-300'
                    : 'bg-green-900/40 border-green-500 text-green-300'
                }`}>
                  {vkospiTriggerResult.vkospi.toFixed(1)}
                </span>
              </div>

              {/* VKOSPI Level Gauge */}
              <div className="mb-4 space-y-1">
                {[
                  { label: '정상', threshold: 0, max: 25, color: 'bg-green-500' },
                  { label: '경계', threshold: 25, max: 30, color: 'bg-amber-500' },
                  { label: '1차', threshold: 30, max: 40, color: 'bg-orange-500' },
                  { label: '2차', threshold: 40, max: 50, color: 'bg-red-500' },
                  { label: '역사', threshold: 50, max: 70, color: 'bg-red-700' },
                ].map(tier => {
                  const v = vkospiTriggerResult.vkospi;
                  const inTier = v >= tier.threshold && v < tier.max;
                  const above = v >= tier.max;
                  return (
                    <div key={tier.label} className="flex items-center gap-2 text-[9px] font-black">
                      <span className="w-8 text-right text-theme-text-muted">{tier.threshold}+</span>
                      <div className="flex-1 h-2 bg-theme-bg border border-theme-border overflow-hidden">
                        <div className={`h-full transition-all ${above ? tier.color : inTier ? tier.color + ' opacity-80' : 'bg-transparent'}`}
                          style={{ width: above ? '100%' : inTier ? `${((v - tier.threshold) / (tier.max - tier.threshold)) * 100}%` : '0%' }}
                        />
                      </div>
                      <span className={`w-6 ${inTier ? 'text-white' : 'text-theme-text-muted'}`}>{tier.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Current level description */}
              <p className="text-xs font-bold mb-2">{vkospiTriggerResult.description}</p>
              <div className={`p-3 border text-xs leading-relaxed mb-3 ${
                vkospiTriggerResult.level === 'HISTORICAL_FEAR' ? 'border-red-600/40 bg-red-900/20 text-red-200'
                  : vkospiTriggerResult.level === 'ENTRY_2' ? 'border-red-500/40 bg-red-900/15 text-red-300'
                  : vkospiTriggerResult.level === 'ENTRY_1' ? 'border-orange-500/40 bg-orange-900/20 text-orange-200'
                  : vkospiTriggerResult.level === 'WARNING' ? 'border-amber-500/40 bg-amber-900/20 text-amber-200'
                  : 'border-theme-border bg-theme-bg text-theme-text-secondary'
              }`}>
                {vkospiTriggerResult.actionMessage}
              </div>

              {/* Position summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 border border-theme-border bg-theme-bg text-center">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">현금 비중</p>
                  <p className="text-xl font-black font-mono">{vkospiTriggerResult.cashRatio}%</p>
                </div>
                <div className="p-3 border border-theme-border bg-theme-bg text-center">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">인버스 비중</p>
                  <p className={`text-xl font-black font-mono ${vkospiTriggerResult.inversePosition > 0 ? 'text-red-400' : 'text-theme-text-muted'}`}>
                    {vkospiTriggerResult.inversePosition}%
                  </p>
                </div>
              </div>

              {/* Inverse ETFs */}
              {vkospiTriggerResult.inverseEtfSuggestions.length > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">추천 인버스 ETF</p>
                  <ul className="space-y-1">
                    {vkospiTriggerResult.inverseEtfSuggestions.map(etf => (
                      <li key={etf} className="text-[10px] text-theme-text-secondary">• {etf}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* V-Recovery stocks (HISTORICAL_FEAR only) */}
              {vkospiTriggerResult.dualPositionActive && vkospiTriggerResult.vRecoveryStocks && (
                <div className="mt-4 p-3 border border-green-500/30 bg-green-900/10">
                  <p className="text-[9px] font-black text-green-400 uppercase tracking-widest mb-2">
                    🔄 V자 반등 준비 리스트 (듀얼 포지션)
                  </p>
                  <ul className="space-y-0.5">
                    {vkospiTriggerResult.vRecoveryStocks.map(s => (
                      <li key={s} className="text-[10px] text-green-300/80">• {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 아이디어 11: 계절성 Bear Calendar ── */}
      {bearSeasonalityResult && (
        <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
          bearSeasonalityResult.isBearSeason ? 'border-red-500' : 'border-theme-border'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
              <CalendarDays className="w-3.5 h-3.5" />
              Bear Calendar · 계절성 약세 레이어
            </h3>
            <span className={`text-xs font-black px-3 py-1 rounded border ${
              bearSeasonalityResult.isBearSeason
                ? 'bg-red-900/40 border-red-500 text-red-300'
                : 'bg-theme-bg border-theme-border text-theme-text-muted'
            }`}>
              {bearSeasonalityResult.isBearSeason ? '🔴 HIGH RISK WINDOW' : '🟢 NORMAL WINDOW'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {bearSeasonalityResult.windows.map(window => (
              <div
                key={window.id}
                className={`p-3 border ${
                  window.active
                    ? 'border-red-500/40 bg-red-900/15'
                    : 'border-theme-border bg-theme-bg'
                }`}
              >
                <p className={`text-[10px] font-black uppercase tracking-widest ${window.active ? 'text-red-300' : 'text-theme-text-muted'}`}>
                  {window.name}
                </p>
                <p className="text-[9px] text-theme-text-muted mt-0.5">{window.period}</p>
                <p className={`text-[10px] mt-1.5 leading-relaxed ${window.active ? 'text-theme-text' : 'text-theme-text-secondary'}`}>
                  {window.description}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="p-3 border border-theme-border bg-theme-bg text-center">
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">Gate -1 임계치 조정</p>
              <p className={`text-xl font-black font-mono ${bearSeasonalityResult.gateThresholdAdjustment < 0 ? 'text-red-400' : 'text-theme-text-secondary'}`}>
                {bearSeasonalityResult.gateThresholdAdjustment < 0 ? `${bearSeasonalityResult.gateThresholdAdjustment}` : '0'}
              </p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg text-center">
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">인버스 확률 가중치</p>
              <p className={`text-xl font-black font-mono ${bearSeasonalityResult.inverseEntryWeightPct > 0 ? 'text-red-300' : 'text-theme-text-secondary'}`}>
                +{bearSeasonalityResult.inverseEntryWeightPct}%
              </p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg text-center">
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">VKOSPI 동반 상승</p>
              <p className={`text-sm font-black ${bearSeasonalityResult.vkospiRisingConfirmed ? 'text-red-300' : 'text-theme-text-secondary'}`}>
                {bearSeasonalityResult.vkospiRisingConfirmed ? '확인됨' : '미확인'}
              </p>
            </div>
          </div>

          <div className={`p-3 border text-xs leading-relaxed ${
            bearSeasonalityResult.isBearSeason
              ? 'border-red-500/40 bg-red-900/20 text-red-200'
              : 'border-theme-border bg-theme-bg text-theme-text-secondary'
          }`}>
            {bearSeasonalityResult.actionMessage}
          </div>
        </div>
      )}

      {/* ── 아이디어 2: Inverse Gate 1 — 인버스 ETF 스코어링 시스템 ── */}
      {inverseGate1Result && (
        <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
          inverseGate1Result.signalType === 'STRONG_BEAR' ? 'border-red-600'
            : inverseGate1Result.signalType === 'PARTIAL' ? 'border-orange-500'
            : 'border-theme-border'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
              <TrendingDown className="w-3.5 h-3.5" />
              Inverse Gate 1 · 인버스 ETF 스코어링 시스템
            </h3>
            <span className={`text-xs font-black px-3 py-1 rounded border ${
              inverseGate1Result.signalType === 'STRONG_BEAR'
                ? 'bg-red-900/50 border-red-500 text-red-200 animate-pulse'
                : inverseGate1Result.signalType === 'PARTIAL'
                ? 'bg-orange-900/40 border-orange-500 text-orange-200'
                : 'bg-theme-bg border-theme-border text-theme-text-muted'
            }`}>
              {inverseGate1Result.signalType === 'STRONG_BEAR' ? '🔴 STRONG BEAR'
                : inverseGate1Result.signalType === 'PARTIAL' ? '🟠 PARTIAL'
                : '🟢 INACTIVE'}
            </span>
          </div>

          {/* Condition progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-[9px] font-black text-theme-text-muted mb-1">
              <span>Bear 필수 조건 달성</span>
              <span>{inverseGate1Result.triggeredCount} / {inverseGate1Result.conditions.length} (전부 충족 시 STRONG BEAR)</span>
            </div>
            <div className="h-3 bg-theme-bg border border-theme-border relative overflow-hidden">
              <div
                className={`h-full transition-all duration-700 ${
                  inverseGate1Result.signalType === 'STRONG_BEAR' ? 'bg-red-600'
                    : inverseGate1Result.signalType === 'PARTIAL' ? 'bg-orange-500'
                    : 'bg-theme-border'
                }`}
                style={{ width: `${(inverseGate1Result.triggeredCount / inverseGate1Result.conditions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Conditions list */}
          <ul className="space-y-1.5 mb-4">
            {inverseGate1Result.conditions.map(cond => (
              <li key={cond.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black ${
                  cond.triggered
                    ? 'bg-red-500/30 border-red-400 text-red-300'
                    : 'bg-theme-bg border-theme-border text-theme-text-muted'
                }`}>
                  {cond.triggered ? '✓' : '–'}
                </span>
                <span className={`leading-snug ${cond.triggered ? 'text-theme-text' : 'text-theme-text-muted'}`}>
                  <span className="font-bold">{cond.name}</span>
                  {cond.triggered && (
                    <span className="opacity-70"> — {cond.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* Action recommendation */}
          <div className={`p-3 border text-xs leading-relaxed ${
            inverseGate1Result.signalType === 'STRONG_BEAR'
              ? 'border-red-600/40 bg-red-900/20 text-red-200'
              : inverseGate1Result.signalType === 'PARTIAL'
              ? 'border-orange-500/40 bg-orange-900/20 text-orange-200'
              : 'border-theme-border bg-theme-bg text-theme-text-secondary'
          }`}>
            {inverseGate1Result.actionMessage}
          </div>

          {/* ETF Recommendations (STRONG_BEAR only) */}
          {inverseGate1Result.etfRecommendations.length > 0 && (
            <div className="mt-4 p-3 border border-red-600/40 bg-red-900/15">
              <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-2">
                🔴 STRONG BEAR 시그널 — 추천 인버스 ETF
              </p>
              <ul className="space-y-1">
                {inverseGate1Result.etfRecommendations.map(etf => (
                  <li key={etf} className="text-[10px] text-red-300">• {etf}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
