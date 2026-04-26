// @responsibility 항상 표시되는 시장 모드 배너 — MHS+Regime+VKOSPI+USD/KRW+허용·금지 정책 (ADR-0028 §1)

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Activity, Globe, Shield } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useGlobalIntelStore } from '../../stores';
import { evaluateGate0 } from '../../services/quant/macroEngine';
import { deriveRegimeLevel } from '../../utils/regimeMapping';
import {
  REGIME_TRADING_POLICY,
  REGIME_TRADING_POLICY_FALLBACK,
} from '../../types/ui';

const VERDICT_STYLE = {
  '🟢': {
    border: 'border-green-500/30',
    bg: 'bg-green-950/40',
    accent: 'text-green-300',
    chip: 'bg-green-500/20 border-green-500/40 text-green-200',
  },
  '🟡': {
    border: 'border-amber-500/30',
    bg: 'bg-amber-950/40',
    accent: 'text-amber-300',
    chip: 'bg-amber-500/20 border-amber-500/40 text-amber-200',
  },
  '🔴': {
    border: 'border-red-500/30',
    bg: 'bg-red-950/40',
    accent: 'text-red-300',
    chip: 'bg-red-500/20 border-red-500/40 text-red-200',
  },
} as const;

function fmtNumber(n: number | null | undefined, digits = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function fmtKrw(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

/**
 * 페이지 상단에 항상 표시되는 시장 모드 SSOT 배너.
 * - macroEnv null → fallback verdict='🟡' headline='데이터 적재 중'.
 * - non-null → MHS / Regime / VKOSPI / USD/KRW + REGIME_TRADING_POLICY allowed·forbidden.
 * - 모바일: 한 줄 + 펼치기 토글, 데스크탑: 풀 박스 항상 표시.
 *
 * MarketRegimeBanner 와 책임 분리 (ADR-0028 §2): 본 배너는 *항상 렌더 + 정책*,
 * MarketRegimeBanner 는 *Risk-Off 경보 전용*.
 */
export function MarketModeBanner() {
  const macroEnv = useGlobalIntelStore(s => s.macroEnv);
  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const [expanded, setExpanded] = useState(false);

  const gate0 = useMemo(() => (macroEnv ? evaluateGate0(macroEnv) : null), [macroEnv]);

  const regime = deriveRegimeLevel(gate0, bearRegimeResult, macroEnv?.vkospi);
  const policy = REGIME_TRADING_POLICY[regime] ?? REGIME_TRADING_POLICY_FALLBACK;
  const isLoading = !macroEnv || !gate0;
  const verdict = isLoading ? '🟡' : policy.verdict;
  const style = VERDICT_STYLE[verdict];

  const mhs = gate0?.macroHealthScore;
  const vkospi = macroEnv?.vkospi;
  const usdKrw = macroEnv?.usdKrw;
  const headline = isLoading ? '데이터 적재 중 — 시장 모드 판단 대기' : policy.headline;

  return (
    <div
      className={cn('no-print border-b backdrop-blur-sm', style.border, style.bg)}
      role="region"
      aria-label="현재 시장 모드"
      aria-live="polite"
    >
      {/* Compact one-line header (모바일/데스크탑 공통) */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-11 flex items-center gap-3">
        <span aria-hidden className="text-base shrink-0">{verdict}</span>
        <span className={cn('text-[11px] font-black uppercase tracking-[0.15em] shrink-0', style.accent)}>
          현재 시장 모드
        </span>
        <div className="w-px h-4 bg-white/10 shrink-0" />
        <span className={cn(
          'text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest shrink-0',
          style.chip,
        )}>
          {regime}
        </span>
        <span className="text-[11px] text-white/70 truncate flex-1">{headline}</span>

        {/* Stats chips — 데스크탑만 한 줄 */}
        <div className="hidden md:flex items-center gap-3 text-[10px] font-bold font-num text-white/60 shrink-0">
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 opacity-70" />
            MHS {fmtNumber(mhs, 0)}/100
          </span>
          <span>VKOSPI {fmtNumber(vkospi, 1)}</span>
          <span>USD/KRW {fmtKrw(usdKrw)}</span>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white/80 transition-opacity shrink-0"
          aria-expanded={expanded}
          aria-label={expanded ? '시장 모드 정책 접기' : '시장 모드 정책 펼치기'}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded panel — 정책 박스 (모바일도 표시) */}
      {expanded && (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-3 border-t border-white/10 mt-1 pt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Stats (모바일 grid) */}
          <div className="md:hidden grid grid-cols-3 gap-2 text-[10px] font-bold font-num text-white/70 col-span-1">
            <span>MHS<br /><span className={cn('text-base font-black', style.accent)}>{fmtNumber(mhs, 0)}</span><span className="opacity-60">/100</span></span>
            <span>VKOSPI<br /><span className="text-base font-black text-white/90">{fmtNumber(vkospi, 1)}</span></span>
            <span>USD/KRW<br /><span className="text-base font-black text-white/90">{fmtKrw(usdKrw)}</span></span>
          </div>

          {/* Allowed */}
          <div className="md:col-span-1">
            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2 flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> 허용 전략
            </h4>
            <ul className="space-y-1">
              {policy.allowed.map(item => (
                <li key={item} className="text-xs flex items-start gap-1.5">
                  <span className="text-green-400 mt-0.5">✓</span>
                  <span className="opacity-90 leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Forbidden */}
          <div className="md:col-span-1">
            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2 flex items-center gap-1.5">
              <Globe className="w-3 h-3" /> 금지 전략
            </h4>
            <ul className="space-y-1">
              {policy.forbidden.map(item => (
                <li key={item} className="text-xs flex items-start gap-1.5">
                  <span className="text-red-400 mt-0.5">✕</span>
                  <span className="opacity-90 leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Headline detail (데스크탑 전용 컬럼) */}
          <div className="hidden md:block">
            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2">레짐 요약</h4>
            <p className={cn('text-xs leading-relaxed font-bold', style.accent)}>
              {regime}
            </p>
            <p className="text-xs opacity-70 mt-1 leading-snug">{headline}</p>
          </div>
        </div>
      )}
    </div>
  );
}
