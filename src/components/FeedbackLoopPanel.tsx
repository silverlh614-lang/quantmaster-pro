/**
 * FeedbackLoopPanel.tsx — 피드백 폐쇄 루프 패널
 *
 * 30거래 누적 후 27조건 가중치가 실전 데이터로 자동 교정되는 상태를 표시한다.
 * 구현 직후 효과는 적지만 시간이 지날수록 기하급수적으로 가치가 높아진다.
 */
import React, { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react';
import { cn } from '../ui/cn';
import type { FeedbackLoopResult, ConditionCalibration } from '../types/portfolio';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  result: FeedbackLoopResult | null;
}

// ─── 조건 방향 아이콘 ────────────────────────────────────────────────────────

function DirectionIcon({ direction }: { direction: ConditionCalibration['direction'] }) {
  if (direction === 'UP')   return <TrendingUp   className="w-3 h-3 text-emerald-400" />;
  if (direction === 'DOWN') return <TrendingDown className="w-3 h-3 text-red-400"     />;
  return                           <Minus        className="w-3 h-3 text-gray-500"    />;
}

// ─── 진척도 링 ────────────────────────────────────────────────────────────────

function ProgressRing({ progress, size = 60 }: { progress: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#374151" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={progress >= 1 ? '#10b981' : '#6366f1'}
        strokeWidth={4}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const FeedbackLoopPanel: React.FC<Props> = ({ result }) => {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (!result) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900/40 px-5 py-4">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
          <p className="text-sm text-gray-400">피드백 루프 데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  const { calibrationActive, calibrationProgress, closedTradeCount } = result;
  const MIN_TRADES = 30;

  const boosted = result.calibrations.filter(c => c.direction === 'UP');
  const reduced = result.calibrations.filter(c => c.direction === 'DOWN');
  const stable  = result.calibrations.filter(c => c.direction === 'STABLE');

  const displayList = showAll ? result.calibrations : result.calibrations.slice(0, 6);

  return (
    <div className={cn(
      'rounded-xl border-2 bg-gray-900/60 overflow-hidden',
      calibrationActive ? 'border-indigo-500' : 'border-gray-600',
    )}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <RefreshCw className={cn('w-5 h-5', calibrationActive ? 'text-indigo-400 animate-spin' : 'text-gray-500')} style={{ animationDuration: '3s' }} />
          <div>
            <h3 className="text-sm font-black text-white tracking-wide">
              피드백 폐쇄 루프 (Feedback Closed Loop)
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              실전 거래 데이터 기반 27조건 자동 가중치 교정 — 시스템 자기진화
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            'text-xs font-bold px-2.5 py-1 rounded-full',
            calibrationActive ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300',
          )}>
            {calibrationActive ? '🔄 교정 활성' : `${closedTradeCount}/${MIN_TRADES}건`}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Progress Section */}
      <div className="px-5 pb-4 flex items-center gap-5">
        <div className="relative flex items-center justify-center">
          <ProgressRing progress={calibrationProgress} size={64} />
          <div className="absolute flex flex-col items-center">
            <span className="text-xs font-black text-white">{closedTradeCount}</span>
            <span className="text-[8px] text-gray-400">/{MIN_TRADES}</span>
          </div>
        </div>

        <div className="flex-1">
          {calibrationActive ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-indigo-300">✓ {MIN_TRADES}거래 달성 — 자동 교정 활성화</p>
              <div className="flex gap-4">
                <span className="text-[10px] text-emerald-400">↑ 상향 {result.boostedCount}개</span>
                <span className="text-[10px] text-red-400">↓ 하향 {result.reducedCount}개</span>
                <span className="text-[10px] text-gray-500">— 유지 {stable.length}개</span>
              </div>
              {result.lastCalibratedAt && (
                <p className="text-[9px] text-gray-500">
                  마지막 교정: {new Date(result.lastCalibratedAt).toLocaleString('ko-KR')}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${calibrationProgress * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-400">{result.summary}</p>
              <p className="text-[9px] text-gray-500">
                구현 직후 효과는 적지만 시간이 지날수록 기하급수적으로 가치가 높아집니다.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Summary Message */}
      <div className={cn(
        'mx-5 mb-4 px-4 py-2.5 rounded-lg border text-[11px]',
        calibrationActive
          ? 'bg-indigo-900/20 border-indigo-700 text-indigo-200'
          : 'bg-gray-800/50 border-gray-700 text-gray-400',
      )}>
        {result.summary}
      </div>

      {/* Calibration Details (expanded) */}
      {expanded && calibrationActive && result.calibrations.length > 0 && (
        <div className="px-5 pb-5 border-t border-gray-700/50 pt-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-3">
            조건별 가중치 교정 현황
          </p>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-2.5 text-center">
              <p className="text-lg font-black text-emerald-400">{result.boostedCount}</p>
              <p className="text-[9px] text-emerald-300">상향 조정</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-2.5 text-center">
              <p className="text-lg font-black text-red-400">{result.reducedCount}</p>
              <p className="text-[9px] text-red-300">하향 조정</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2.5 text-center">
              <p className="text-lg font-black text-gray-300">{stable.length}</p>
              <p className="text-[9px] text-gray-400">유지</p>
            </div>
          </div>

          {/* Per-Condition List */}
          {result.calibrations.length > 0 ? (
            <>
              <div className="space-y-1.5">
                {displayList.map(c => (
                  <div
                    key={c.conditionId}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg border text-[10px]',
                      c.direction === 'UP'   ? 'bg-emerald-900/20 border-emerald-700/50' :
                      c.direction === 'DOWN' ? 'bg-red-900/20 border-red-700/50'         :
                                               'bg-gray-800/50 border-gray-700/50',
                    )}
                  >
                    <DirectionIcon direction={c.direction} />
                    <span className="font-bold text-gray-200 w-24 flex-shrink-0">
                      {c.conditionId}. {c.conditionName}
                    </span>
                    <span className="text-gray-400 flex-1">
                      승률 {(c.winRate * 100).toFixed(0)}% · 평균 수익 {c.avgReturn.toFixed(1)}%
                    </span>
                    <span className={cn(
                      'font-bold',
                      c.direction === 'UP' ? 'text-emerald-400' :
                      c.direction === 'DOWN' ? 'text-red-400' : 'text-gray-500',
                    )}>
                      {c.prevWeight.toFixed(2)} → {c.newWeight.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              {result.calibrations.length > 6 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="mt-2 text-[10px] text-indigo-400 hover:text-indigo-300 underline"
                >
                  {showAll ? '접기' : `+${result.calibrations.length - 6}개 더 보기`}
                </button>
              )}
            </>
          ) : (
            <p className="text-[10px] text-gray-500">
              조건당 최소 5건의 관련 거래 데이터가 필요합니다.
            </p>
          )}

          {/* Evolution Insight */}
          <div className="mt-4 bg-indigo-900/20 border border-indigo-700/50 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Zap className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-indigo-200 leading-relaxed">
                <span className="font-bold">자기진화 원리:</span> 수익 종목에서 높았던 조건은 가중치를 올리고,
                손실 종목에서 높았던 조건은 낮춘다. 승률 &gt;60% → +10%, 승률 &lt;40% → -10% (범위: 0.5~1.5).
                다음 evaluateStock() 호출부터 즉시 반영된다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Non-active explanation */}
      {expanded && !calibrationActive && (
        <div className="px-5 pb-5 border-t border-gray-700/50 pt-4">
          <div className="bg-gray-800/50 border border-gray-600 rounded-lg p-4 space-y-2">
            <p className="text-[10px] font-bold text-gray-300">교정 활성화 조건</p>
            <ul className="text-[10px] text-gray-400 space-y-1 list-disc list-inside">
              <li>종료된 거래(CLOSED) {MIN_TRADES}건 이상 누적</li>
              <li>조건별 최소 5건 이상의 관련 거래 필요</li>
              <li>승률 &gt;60% → 가중치 +10%, 승률 &lt;40% → -10%</li>
            </ul>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all"
                  style={{ width: `${calibrationProgress * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 font-bold">
                {closedTradeCount}/{MIN_TRADES}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
