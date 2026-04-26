// @responsibility signals 영역 ContradictionDetectorPanel 컴포넌트
/**
 * ContradictionDetectorPanel.tsx — 조건 간 상충 감지기 패널
 *
 * Gate 조건들이 서로 반대 신호를 동시에 보낼 때 경고를 표시하고
 * Gate 3 점수 -20% 패널티 및 STRONG BUY 등급 금지를 안내한다.
 */
import React, { useState } from 'react';
import { Zap, CheckCircle, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { ContradictionDetectionResult } from '../../types/quant';

interface Props {
  result: ContradictionDetectionResult;
}

export const ContradictionDetectorPanel: React.FC<Props> = ({ result }) => {
  const [expanded, setExpanded] = useState(false);

  const hasContradiction = result.hasContradiction;

  return (
    <div className={cn(
      'rounded-xl border px-5 py-4 space-y-4 transition-colors',
      hasContradiction
        ? 'border-orange-700/60 bg-orange-950/20'
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
          <Zap className={cn('w-5 h-5', hasContradiction ? 'text-orange-400' : 'text-emerald-400')} />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              조건 간 상충 감지기
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              반대 신호 동시 발생 감지 · Gate 3 -20% 패널티 · STRONG BUY 금지
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasContradiction ? (
            <span className="text-xs font-medium text-orange-400 bg-orange-950/40 border border-orange-700/50 rounded-full px-2 py-0.5">
              상충 {result.detectedCount}쌍
            </span>
          ) : (
            <span className="text-xs font-medium text-emerald-400 bg-emerald-950/30 border border-emerald-700/40 rounded-full px-2 py-0.5">
              일관성 확인
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* 경고/정상 메시지 */}
      {hasContradiction ? (
        <div className="flex items-start gap-2.5 rounded-lg bg-orange-900/30 border border-orange-700/50 p-3">
          <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-xs text-orange-200 leading-relaxed">{result.message}</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <CheckCircle className="w-3.5 h-3.5" />
          {result.message}
        </div>
      )}

      {/* 확장 영역 */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t border-gray-700/40">
          <p className="text-xs text-gray-500 font-medium">상충 쌍 점검 현황</p>
          <div className="space-y-2">
            {result.contradictionPairs.map((pair) => (
              <div
                key={pair.id}
                className={cn(
                  'rounded-lg border px-3 py-2.5 space-y-2',
                  pair.detected
                    ? 'border-orange-700/50 bg-orange-950/20'
                    : 'border-gray-700/30 bg-gray-800/30',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    'text-xs font-medium',
                    pair.detected ? 'text-orange-300' : 'text-gray-400',
                  )}>
                    {pair.detected ? '⚡ ' : '✓ '}{pair.name}
                  </span>
                  <span className={cn(
                    'text-xs rounded-full px-1.5 py-0.5',
                    pair.detected
                      ? 'text-orange-400 bg-orange-950/40'
                      : 'text-emerald-500 bg-emerald-950/30',
                  )}>
                    {pair.detected ? '상충 감지' : '정상'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className={cn(
                    'rounded px-1.5 py-0.5',
                    pair.conditionA.warnWhen === 'LOW' && pair.conditionA.score < 5
                      ? 'text-red-400 bg-red-950/30'
                      : 'text-gray-400 bg-gray-800/40',
                  )}>
                    {pair.conditionA.name}: {pair.conditionA.score.toFixed(0)}점
                  </span>
                  <span className="text-gray-600">↔</span>
                  <span className={cn(
                    'rounded px-1.5 py-0.5',
                    pair.conditionB.warnWhen === 'HIGH' && pair.conditionB.score >= 5
                      ? 'text-emerald-400 bg-emerald-950/30'
                      : 'text-gray-400 bg-gray-800/40',
                  )}>
                    {pair.conditionB.name}: {pair.conditionB.score.toFixed(0)}점
                  </span>
                </div>
                {pair.detected && (
                  <p className="text-xs text-orange-300/70 leading-relaxed">{pair.description}</p>
                )}
              </div>
            ))}
          </div>

          {/* 설명 */}
          <div className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">핵심 통찰: </span>
            신호의 일관성 자체가 품질 지표다. 상충 신호가 없는 깨끗한 종목일 때만 최고 등급(CONFIRMED_STRONG_BUY)을 허용한다.
            <br />
            <span className="text-gray-400 font-medium">패널티 규칙: </span>
            상충 쌍 1개 이상 → Gate 3 점수 ×0.8(-20%) + STRONG BUY 등급 금지.
          </div>
        </div>
      )}
    </div>
  );
};
