/**
 * 아이디어 11: 계절성 Bear Calendar — "통계적으로 하락 확률이 높은 시기"
 *
 * 한국 증시의 통계적 약세 시즌(9~10월, 12월 중순~1월 초, 1Q 실적 직전, FOMC 직전)을
 * 사전에 표시하고, VKOSPI 동반 상승 시 Gate -1 인버스 진입 확률 가중치 +20%p를 자동 부여한다.
 */
import React, { useState, useEffect } from 'react';
import { CalendarDays, TrendingDown, ChevronDown, ChevronUp, X, AlertTriangle } from 'lucide-react';
import { cn } from '../ui/cn';
import { evaluateBearSeasonalCalendar } from '../services/quantEngine';
import type { BearSeasonalCalendarResult, BearSeason, MacroEnvironment } from '../types/quant';

// ── 계절 패턴 뱃지 색상 매핑 ──────────────────────────────────────────────────
function getSeasonColors(season: BearSeason) {
  if (!season.isActive) {
    return {
      border: 'border-theme-border',
      bg: 'bg-theme-bg',
      badge: 'bg-theme-bg border-theme-border text-theme-text-muted',
      badgeText: '대기',
    };
  }
  if (season.vkospiBonus > 0) {
    return {
      border: 'border-red-500',
      bg: 'bg-red-900/15',
      badge: 'bg-red-900/40 border-red-500/70 text-red-300',
      badgeText: '활성 + VKOSPI ↑',
    };
  }
  return {
    border: 'border-amber-500/70',
    bg: 'bg-amber-900/10',
    badge: 'bg-amber-900/30 border-amber-500/50 text-amber-300',
    badgeText: '활성',
  };
}

// ── 개별 계절 카드 ────────────────────────────────────────────────────────────
function SeasonCard({ season }: { season: BearSeason }) {
  const colors = getSeasonColors(season);

  return (
    <div className={cn(
      'p-3 border transition-colors',
      colors.border,
      colors.bg,
    )}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <CalendarDays className={cn(
            'w-3 h-3 flex-shrink-0',
            season.isActive ? (season.vkospiBonus > 0 ? 'text-red-400' : 'text-amber-400') : 'text-theme-text-muted',
          )} />
          <p className={cn(
            'text-[10px] font-black uppercase tracking-widest truncate',
            season.isActive ? 'text-theme-text' : 'text-theme-text-muted',
          )}>
            {season.name}
          </p>
        </div>
        <span className={cn(
          'text-[8px] font-black px-2 py-0.5 border whitespace-nowrap flex-shrink-0',
          colors.badge,
        )}>
          {colors.badgeText}
        </span>
      </div>

      <p className="text-[8px] text-theme-text-muted leading-relaxed mb-2">
        {season.rationale}
      </p>

      <div className="flex items-center justify-between text-[8px]">
        <span className="text-theme-text-muted font-mono">{season.activePeriod}</span>
        {season.isActive && (
          <div className="flex items-center gap-2">
            <span className="text-theme-text-muted">
              기본 <span className="font-black text-theme-text">{season.baseWeight}%p</span>
            </span>
            {season.vkospiBonus > 0 && (
              <span className="text-red-400 font-black">
                + VKOSPI {season.vkospiBonus}%p
              </span>
            )}
            <span className={cn(
              'font-black',
              season.vkospiBonus > 0 ? 'text-red-300' : 'text-amber-300',
            )}>
              = +{season.finalWeight}%p
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 패널 ─────────────────────────────────────────────────────────────────

interface BearSeasonalCalendarPanelProps {
  macroEnv: MacroEnvironment | null;
  result: BearSeasonalCalendarResult | null;
  nextFomcDate: string | null;
  onSetNextFomcDate: (date: string | null) => void;
}

export function BearSeasonalCalendarPanel({
  macroEnv,
  result,
  nextFomcDate,
  onSetNextFomcDate,
}: BearSeasonalCalendarPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [fomcInput, setFomcInput] = useState(nextFomcDate ?? '');

  // Sync fomcInput when nextFomcDate changes externally
  useEffect(() => {
    setFomcInput(nextFomcDate ?? '');
  }, [nextFomcDate]);

  // Compute a local result from macroEnv if no server result yet
  const computed = macroEnv
    ? evaluateBearSeasonalCalendar(macroEnv, nextFomcDate)
    : null;
  const displayed = result ?? computed;

  const activeCount = displayed?.activeSeasons.length ?? 0;
  const totalBoost = displayed?.totalWeightBoost ?? 0;
  const vkospiRising = displayed?.vkospiRising ?? false;

  const hasAlert = activeCount > 0 && vkospiRising;
  const hasActive = activeCount > 0;

  const borderColor = hasAlert
    ? 'border-red-500'
    : hasActive
      ? 'border-amber-500/70'
      : 'border-theme-border';

  const handleSetFomc = () => {
    if (fomcInput) {
      onSetNextFomcDate(fomcInput);
    }
  };

  const handleClearFomc = () => {
    setFomcInput('');
    onSetNextFomcDate(null);
  };

  // Placeholder when no macro data loaded yet
  if (!displayed) {
    return (
      <div className="p-4 sm:p-6 border-2 border-theme-border bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            계절성 Bear Calendar · "달력이 무기가 되는 시기"
          </h3>
        </div>
        <p className="text-xs text-theme-text-muted">
          거시 데이터 로드 후 계절성 패턴이 자동 분석됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(
      'p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      borderColor,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
          <CalendarDays className="w-3.5 h-3.5" />
          계절성 Bear Calendar · "달력이 무기가 되는 시기"
        </h3>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-black px-3 py-1 rounded border',
            hasAlert
              ? 'bg-red-900/60 border-red-400 text-red-200 animate-pulse'
              : hasActive
                ? 'bg-amber-900/40 border-amber-500/50 text-amber-200'
                : 'bg-theme-bg border-theme-border text-theme-text-muted',
          )}>
            {hasAlert
              ? `🔴 ${activeCount}개 시즌 활성 + VKOSPI`
              : hasActive
                ? `🟠 ${activeCount}개 시즌 활성`
                : '🟢 계절 리스크 없음'}
          </span>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-theme-text-muted hover:text-theme-text transition-colors"
            aria-label={expanded ? '접기' : '펼치기'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Alert banner when active season + VKOSPI rising */}
      {hasAlert && (
        <div className="mb-4 p-3 border border-red-500 bg-red-900/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-200 leading-relaxed font-bold">
            {displayed.actionMessage}
          </p>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 border border-theme-border bg-theme-bg text-center">
          <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1">
            활성 시즌
          </p>
          <p className={cn(
            'text-2xl font-black font-mono',
            hasActive ? (hasAlert ? 'text-red-400' : 'text-amber-400') : 'text-theme-text-muted',
          )}>
            {activeCount}
            <span className="text-sm"> / 4</span>
          </p>
          <p className="text-[8px] text-theme-text-muted mt-0.5">패턴 활성</p>
        </div>
        <div className="p-3 border border-theme-border bg-theme-bg text-center">
          <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1">
            Gate -1 가중
          </p>
          <p className={cn(
            'text-2xl font-black font-mono',
            totalBoost >= 30 ? 'text-red-400' : totalBoost > 0 ? 'text-amber-400' : 'text-theme-text-muted',
          )}>
            +{totalBoost}
            <span className="text-sm">%p</span>
          </p>
          <p className="text-[8px] text-theme-text-muted mt-0.5">인버스 감도</p>
        </div>
        <div className="p-3 border border-theme-border bg-theme-bg text-center">
          <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1">
            VKOSPI
          </p>
          <p className={cn(
            'text-2xl font-black font-mono',
            vkospiRising ? 'text-red-400' : 'text-theme-text-muted',
          )}>
            {displayed.vkospiValue.toFixed(1)}
          </p>
          <p className={cn(
            'text-[8px] mt-0.5',
            vkospiRising ? 'text-red-400 font-black' : 'text-theme-text-muted',
          )}>
            {vkospiRising ? '↑ 상승 중' : '─ 안정'}
          </p>
        </div>
      </div>

      {/* Action Message (non-alert case) */}
      {!hasAlert && (
        <div className={cn(
          'mb-4 p-3 border text-xs leading-relaxed',
          hasActive
            ? 'border-amber-500/30 bg-amber-900/10 text-amber-200'
            : 'border-theme-border bg-theme-bg text-theme-text-secondary',
        )}>
          {displayed.actionMessage}
        </div>
      )}

      {/* FOMC Date Input */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 flex-1">
          <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest whitespace-nowrap">
            다음 FOMC
          </label>
          <input
            type="date"
            value={fomcInput}
            onChange={e => setFomcInput(e.target.value)}
            className="flex-1 text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60 min-w-0"
          />
        </div>
        <button
          onClick={handleSetFomc}
          disabled={!fomcInput}
          className="px-3 py-1 text-[10px] font-black uppercase tracking-widest border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors disabled:opacity-40"
        >
          설정
        </button>
        {nextFomcDate && (
          <button
            onClick={handleClearFomc}
            className="p-1 text-theme-text-muted hover:text-red-400 transition-colors"
            aria-label="FOMC 날짜 초기화"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Season Cards */}
      <div className="space-y-2">
        {displayed.seasons.map(season => (
          <SeasonCard key={season.id} season={season} />
        ))}
      </div>

      {/* Expanded: How It Works */}
      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="p-3 border border-theme-border bg-theme-bg">
            <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">
              계절 가중치 작동 원리
            </p>
            <div className="space-y-1.5">
              {[
                { label: '활성 시즌', value: '기본 가중치 적용 (10~15%p)' },
                { label: 'VKOSPI 동반 상승', value: '추가 +20%p 가중치 (인버스 진입 확률 강화)' },
                { label: 'Gate -1 감도', value: '총 가중치만큼 인버스 신호 역치 낮아짐' },
                { label: '복수 시즌 중첩', value: '각 활성 시즌 가중치 합산 적용' },
              ].map(item => (
                <div key={item.label} className="flex items-baseline gap-2">
                  <span className="text-[8px] font-black text-theme-text-muted uppercase tracking-widest whitespace-nowrap">
                    {item.label}:
                  </span>
                  <span className="text-[9px] text-theme-text-secondary">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 border border-amber-500/30 bg-amber-900/10">
            <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mb-1 flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> 계절성 패턴 주의사항
            </p>
            <p className="text-[9px] text-amber-200/70 leading-relaxed">
              계절성 패턴은 통계적 경향이며 매년 반드시 발현되는 것은 아닙니다.
              Gate -1, VKOSPI 트리거, Bear Regime 신호와 함께 복합 판단하시기 바랍니다.
              단일 계절 패턴만으로 인버스 포지션 진입은 권고하지 않습니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
