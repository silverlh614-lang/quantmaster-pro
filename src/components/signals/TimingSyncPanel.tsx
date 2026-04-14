/**
 * TimingSyncPanel.tsx — 조건 통과 시점 일치도 스코어 패널
 *
 * 조건이 최근 5거래일 이내 통과되었는지를 기준으로 신선도를 평가하고
 * Sync Score로 진입 타이밍의 적절성을 시각화한다.
 */
import React, { useState } from 'react';
import { Clock, CheckCircle, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { TimingSyncResult } from '../../types/quant';

interface Props {
  result: TimingSyncResult;
}

const LEVEL_CONFIG = {
  HIGH: { color: 'text-emerald-400', bg: 'bg-emerald-950/20', border: 'border-emerald-700/40', label: '최적 타이밍', barColor: 'bg-emerald-500' },
  MEDIUM: { color: 'text-yellow-400', bg: 'bg-yellow-950/10', border: 'border-yellow-700/30', label: '보통 타이밍', barColor: 'bg-yellow-500' },
  LOW: { color: 'text-red-400', bg: 'bg-red-950/20', border: 'border-red-700/40', label: '타이밍 주의', barColor: 'bg-red-500' },
};

export const TimingSyncPanel: React.FC<Props> = ({ result }) => {
  const [expanded, setExpanded] = useState(false);

  const cfg = LEVEL_CONFIG[result.level];
  const hasTimestamps = result.conditionFreshness.some(c => c.passedAt !== '');

  return (
    <div className={cn(
      'rounded-xl border px-5 py-4 space-y-4 transition-colors',
      result.level === 'HIGH'
        ? 'border-emerald-700/40 bg-emerald-950/10'
        : result.level === 'MEDIUM'
          ? 'border-yellow-700/30 bg-gray-900/40'
          : 'border-gray-700/40 bg-gray-900/40',
    )}>
      {/* 헤더 */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <Clock className={cn('w-5 h-5', cfg.color)} />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              조건 통과 시점 동기화 스코어
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              최근 5거래일 이내 통과 조건 ×1.5 가중 · 신선도 = 신뢰도
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold', cfg.color)}>
            {result.syncScore}
          </span>
          <span className={cn('text-xs rounded-full px-2 py-0.5 border', cfg.color, cfg.bg, cfg.border)}>
            {cfg.label}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* Sync Score 게이지 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Sync Score</span>
          <span className={cfg.color}>{result.syncScore} / 100</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', cfg.barColor)}
            style={{ width: `${result.syncScore}%` }}
          />
        </div>
      </div>

      {/* 메시지 */}
      <p className={cn('text-xs leading-relaxed', result.level === 'HIGH' ? 'text-emerald-300/80' : result.level === 'MEDIUM' ? 'text-yellow-300/80' : 'text-gray-400')}>
        {result.message}
      </p>

      {/* 타임스탬프 없는 경우 안내 */}
      {!hasTimestamps && (
        <div className="flex items-start gap-2 text-xs text-gray-500">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-600" />
          <span>조건 통과 시점이 기록되지 않았습니다. 정확한 타이밍 분석을 위해 각 조건의 통과 날짜를 입력하세요.</span>
        </div>
      )}

      {/* 확장 영역 */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t border-gray-700/40">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-gray-800/40 p-3 text-center">
              <div className="text-lg font-bold text-gray-200">{result.recentConditionCount}</div>
              <div className="text-xs text-gray-500 mt-0.5">최신 조건</div>
              <div className="text-xs text-gray-600">(5거래일 이내)</div>
            </div>
            <div className="rounded-lg bg-gray-800/40 p-3 text-center">
              <div className="text-lg font-bold text-gray-200">{result.totalPassedCount}</div>
              <div className="text-xs text-gray-500 mt-0.5">전체 통과</div>
              <div className="text-xs text-gray-600">조건 수</div>
            </div>
            <div className="rounded-lg bg-gray-800/40 p-3 text-center">
              <div className={cn('text-lg font-bold', cfg.color)}>{result.freshnessWeightedScore}%</div>
              <div className="text-xs text-gray-500 mt-0.5">신선도</div>
              <div className="text-xs text-gray-600">가중 점수</div>
            </div>
          </div>

          {/* 조건별 신선도 목록 */}
          {hasTimestamps && result.conditionFreshness.filter(c => c.passedAt !== '').length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 font-medium">조건별 신선도</p>
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {result.conditionFreshness
                  .filter(c => c.passedAt !== '')
                  .sort((a, b) => a.tradingDaysAgo - b.tradingDaysAgo)
                  .map((c, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center justify-between rounded px-2.5 py-1.5 text-xs',
                        c.isFresh ? 'bg-emerald-950/20 border border-emerald-700/30' : 'bg-gray-800/30',
                      )}
                    >
                      <span className="text-gray-400">조건 #{c.conditionId}</span>
                      <div className="flex items-center gap-2">
                        {c.isFresh ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            {c.tradingDaysAgo}거래일 전
                          </span>
                        ) : (
                          <span className="text-gray-500">{c.tradingDaysAgo}거래일 전</span>
                        )}
                        <span className={cn(
                          'font-medium',
                          c.isFresh ? 'text-emerald-400' : 'text-gray-500',
                        )}>
                          ×{c.weight.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 해석 */}
          <div className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">해석: </span>
            {result.interpretation}
          </div>

          {/* 설명 */}
          <div className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">핵심 통찰: </span>
            신선도가 신뢰도다. 펀더멘털은 3개월 전부터 좋았지만 기술적 타이밍은 오늘 온 종목이
            모든 조건이 오래전에 통과된 종목보다 우선순위가 높다.
          </div>
        </div>
      )}
    </div>
  );
};
