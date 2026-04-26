// @responsibility signals 영역 SectorOverheatPanel 컴포넌트
/**
 * 아이디어 7: 섹터 과열 감지 + 섹터 인버스 ETF 자동 매칭
 * 섹터 로테이션 히트맵과 연동하여 과열 섹터에 대한 인버스 ETF를 자동 매칭한다.
 *
 * 과열 4대 조건:
 *   1. 섹터 RS 상위 1% 진입 (과열)
 *   2. 뉴스 빈도 CROWDED/OVERHYPED 단계
 *   3. 주봉 RSI 80 이상
 *   4. 외국인 Active 매수 6주 연속 과잉
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Flame, ChevronDown, ChevronUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { cn } from '../../ui/cn';
import { evaluateSectorOverheat } from '../../services/quant/sectorEngine';
import type { SectorOverheatInput, SectorOverheatResult, OverheatedSectorMatch } from '../../types/quant';

const NEWS_PHASE_OPTIONS: SectorOverheatInput['newsPhase'][] = [
  'SILENT', 'EARLY', 'GROWING', 'CROWDED', 'OVERHYPED',
];

const NEWS_PHASE_KO: Record<SectorOverheatInput['newsPhase'], string> = {
  SILENT: '침묵',
  EARLY: '초기',
  GROWING: '성장',
  CROWDED: '과밀',
  OVERHYPED: '과열',
};

interface SectorOverheatPanelProps {
  inputs: SectorOverheatInput[];
  onInputsChange: (inputs: SectorOverheatInput[]) => void;
  result: SectorOverheatResult | null;
}

function ConditionBadge({ triggered, label, value }: { triggered: boolean; label: string; value: string }) {
  return (
    <div className={cn(
      'flex items-center justify-between p-2 border text-[9px]',
      triggered
        ? 'border-red-500/60 bg-red-900/20 text-red-300'
        : 'border-theme-border bg-theme-bg text-theme-text-muted',
    )}>
      <span className="font-black uppercase tracking-widest flex items-center gap-1">
        {triggered ? '🔴' : '🟢'} {label}
      </span>
      <span className="font-mono font-bold ml-2 shrink-0">{value}</span>
    </div>
  );
}

function SectorCard({
  match,
  input,
  onInputChange,
  expanded,
  onToggleExpand,
}: {
  match: OverheatedSectorMatch;
  input: SectorOverheatInput;
  onInputChange: (updated: SectorOverheatInput) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const isOverheated = match.isFullyOverheated;
  const borderColor = match.isFullyOverheated
    ? 'border-red-500'
    : match.triggeredCount >= 3
      ? 'border-orange-500/80'
      : isOverheated
        ? 'border-amber-500/70'
        : 'border-theme-border';

  return (
    <div className={cn('border-2 bg-theme-card', borderColor)}>
      {/* Card Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={onToggleExpand}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex items-center justify-center w-8 h-8 rounded border text-sm font-black',
            match.isFullyOverheated ? 'border-red-500 bg-red-900/40 text-red-300'
              : isOverheated ? 'border-amber-500/70 bg-amber-900/30 text-amber-300'
                : 'border-theme-border bg-theme-bg text-theme-text-muted',
          )}>
            {match.overheatScore}
          </div>
          <div>
            <p className="text-sm font-black text-theme-text tracking-tight">{match.sectorName}</p>
            <p className="text-[9px] font-bold text-theme-text-muted uppercase tracking-widest">
              {match.triggeredCount}/4 조건 충족
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-[9px] font-black px-2 py-0.5 border tracking-widest',
            match.isFullyOverheated
              ? 'border-red-500 bg-red-900/40 text-red-300 animate-pulse'
              : match.triggeredCount >= 3
                ? 'border-orange-500/80 bg-orange-900/30 text-orange-300'
                : isOverheated
                  ? 'border-amber-500/70 bg-amber-900/20 text-amber-300'
                  : 'border-theme-border bg-theme-bg text-theme-text-muted',
          )}>
            {match.isFullyOverheated ? '🔴 완전과열' : match.triggeredCount >= 3 ? '🟠 강한과열' : isOverheated ? '🟡 과열주의' : '🟢 정상'}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-theme-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-theme-border">
          {/* Condition summary */}
          <div className="grid grid-cols-1 gap-1 pt-3">
            {match.conditions.map(cond => (
              <ConditionBadge key={cond.id} triggered={cond.triggered} label={cond.label} value={cond.value} />
            ))}
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-2 gap-2">
            {/* RS Rank */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                섹터 RS 상위 %
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={input.sectorRsRank}
                onChange={e => onInputChange({ ...input, sectorRsRank: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-amber-500/60"
              />
              <p className="text-[8px] text-theme-text-muted">1% 미만 = 과열</p>
            </div>

            {/* News Phase */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                뉴스 빈도
              </label>
              <select
                value={input.newsPhase}
                onChange={e => onInputChange({ ...input, newsPhase: e.target.value as SectorOverheatInput['newsPhase'] })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-amber-500/60"
              >
                {NEWS_PHASE_OPTIONS.map(p => (
                  <option key={p} value={p}>{p} ({NEWS_PHASE_KO[p]})</option>
                ))}
              </select>
              <p className="text-[8px] text-theme-text-muted">CROWDED/OVERHYPED = 과열</p>
            </div>

            {/* Weekly RSI */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                주봉 RSI
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={input.weeklyRsi}
                onChange={e => onInputChange({ ...input, weeklyRsi: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-amber-500/60"
              />
              <p className="text-[8px] text-theme-text-muted">80 이상 = 과열</p>
            </div>

            {/* Foreign Buying Weeks */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                외국인 매수 연속 주
              </label>
              <input
                type="number"
                min={0}
                max={52}
                step={1}
                value={input.foreignActiveBuyingWeeks}
                onChange={e => onInputChange({ ...input, foreignActiveBuyingWeeks: Math.max(0, Math.min(52, parseInt(e.target.value, 10) || 0)) })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-amber-500/60"
              />
              <p className="text-[8px] text-theme-text-muted">6주 이상 = 과잉</p>
            </div>
          </div>

          {/* Inverse ETF Match */}
          {isOverheated && (
            <div className={cn(
              'p-3 border',
              match.isFullyOverheated
                ? 'border-red-500/60 bg-red-900/20'
                : match.triggeredCount >= 3
                  ? 'border-orange-500/40 bg-orange-900/10'
                  : 'border-amber-500/40 bg-amber-900/10',
            )}>
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                <TrendingDown className="w-3 h-3" /> 자동 매칭 인버스 ETF
              </p>
              <p className={cn(
                'text-xs font-black tracking-tight',
                match.isFullyOverheated ? 'text-red-300' : match.triggeredCount >= 3 ? 'text-orange-300' : 'text-amber-300',
              )}>
                {match.inverseEtf}
              </p>
            </div>
          )}

          {/* Recommendation */}
          <div className={cn(
            'p-2 border text-[10px] leading-relaxed',
            match.isFullyOverheated
              ? 'border-red-500/40 bg-red-900/15 text-red-300'
              : isOverheated
                ? 'border-amber-500/30 bg-amber-900/10 text-amber-300'
                : 'border-theme-border bg-theme-bg text-theme-text-secondary',
          )}>
            {match.recommendation}
          </div>
        </div>
      )}
    </div>
  );
}

export function SectorOverheatPanel({ inputs, onInputsChange, result }: SectorOverheatPanelProps) {
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({});
  const [headerExpanded, setHeaderExpanded] = useState(true);

  const fallbackComputed = useMemo(() => evaluateSectorOverheat(inputs), [inputs]);
  const computed = result ?? fallbackComputed;
  const { overheatedCount, actionMessage, allSectors } = computed;

  const handleInputChange = useCallback((idx: number, updated: SectorOverheatInput) => {
    const newInputs = [...inputs];
    newInputs[idx] = updated;
    onInputsChange(newInputs);
  }, [inputs, onInputsChange]);

  const toggleSector = useCallback((name: string) => {
    setExpandedSectors(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const headerBorderColor = overheatedCount === 0
    ? 'border-theme-border'
    : allSectors.some(s => s.isFullyOverheated)
      ? 'border-red-500'
      : overheatedCount > 0
        ? 'border-amber-500/70'
        : 'border-theme-border';

  return (
    <div className={cn(
      'p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      headerBorderColor,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
          <Flame className="w-3.5 h-3.5" />
          섹터 과열 감지 · 인버스 ETF 자동 매칭
        </h3>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-black px-3 py-1 rounded border',
            overheatedCount === 0
              ? 'bg-theme-bg border-theme-border text-theme-text-muted'
              : allSectors.some(s => s.isFullyOverheated)
                ? 'bg-red-900/40 border-red-500 text-red-300 animate-pulse'
                : 'bg-amber-900/30 border-amber-500/70 text-amber-300',
          )}>
            {overheatedCount === 0 ? '🟢 정상' : `🔴 ${overheatedCount}개 과열`}
          </span>
          <button
            onClick={() => setHeaderExpanded(v => !v)}
            className="text-theme-text-muted hover:text-theme-text transition-colors"
            aria-label={headerExpanded ? '접기' : '펼치기'}
          >
            {headerExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Overheated sector alert */}
      {overheatedCount > 0 && (
        <div className={cn(
          'mb-4 p-3 border flex items-start gap-2',
          allSectors.some(s => s.isFullyOverheated)
            ? 'border-red-500 bg-red-900/30'
            : 'border-amber-500/50 bg-amber-900/20',
        )}>
          <AlertTriangle className={cn(
            'w-4 h-4 flex-shrink-0 mt-0.5',
            allSectors.some(s => s.isFullyOverheated) ? 'text-red-400' : 'text-amber-400',
          )} />
          <p className={cn(
            'text-xs leading-relaxed font-bold',
            allSectors.some(s => s.isFullyOverheated) ? 'text-red-200' : 'text-amber-200',
          )}>
            {actionMessage}
          </p>
        </div>
      )}

      {headerExpanded && (
        <div className="space-y-3">
          {/* Sector cards */}
          {allSectors.map((match, idx) => (
            <SectorCard
              key={match.sectorName}
              match={match}
              input={inputs[idx]}
              onInputChange={updated => handleInputChange(idx, updated)}
              expanded={!!expandedSectors[match.sectorName]}
              onToggleExpand={() => toggleSector(match.sectorName)}
            />
          ))}

          {/* Action message when no overheating */}
          {overheatedCount === 0 && (
            <div className="p-3 border border-theme-border bg-theme-bg text-xs leading-relaxed text-theme-text-secondary">
              {actionMessage}
            </div>
          )}

          {/* Legend */}
          <div className="p-3 border border-theme-border/50 bg-theme-bg/50">
            <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">
              과열 조건 기준
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {[
                { label: 'RS 상위 1%', threshold: '섹터 RS 순위 < 1%' },
                { label: '뉴스 과열', threshold: 'CROWDED 또는 OVERHYPED' },
                { label: '주봉 RSI', threshold: 'RSI ≥ 80' },
                { label: '외국인 매수', threshold: '6주 연속 Active 매수' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-theme-text-muted uppercase tracking-widest">{item.label}:</span>
                  <span className="text-[8px] text-theme-text-secondary">{item.threshold}</span>
                </div>
              ))}
            </div>
            <p className="text-[8px] text-theme-text-muted mt-2">
              * 4개 조건 모두 충족 시 과열 판정 → 해당 섹터 인버스 ETF 자동 매칭
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
