/**
 * IDEA 3: ROE 유형 전이 감지기 (ROE Type Transition Detector)
 *
 * ROE 분해 공식: ROE = 순이익률 × 자산회전율 × 재무레버리지
 *
 * 유형 전이 감지 규칙:
 *   Rule A — [3,3,3,4] 패턴: 3분기 연속 Type 3 후 Type 4 전이 → Gate 1 패널티
 *   Rule B — 총자산회전율 QoQ 하락 ≥ 5% → Type 3→4 전이 경보
 *
 * 의미: Type 3(매출·마진 동반 성장)에서 Type 4(비용 통제형)로 전이하면
 * 매출 성장 동력이 소진된 것이므로 Gate 1 roeType3 조건을 자동 차단.
 */

import React from 'react';
import { cn } from '../../ui/cn';
import type { ROETransitionResult, ROEType } from '../../types/quant';
import { safePctChange } from '../../utils/safePctChange';

interface ROETransitionPanelProps {
  roeTransition: ROETransitionResult;
  /** 입력에 사용된 전체 이력 (스토어에서 전달) */
  roeTypeHistory: ROEType[];
  assetTurnoverHistory?: number[];
  stockName?: string;
  /** 이력 수동 편집 콜백 */
  onRoeTypeHistoryChange?: (history: ROEType[]) => void;
  onAssetTurnoverHistoryChange?: (history: number[]) => void;
}

const ROE_TYPE_LABELS: Record<ROEType, { short: string; desc: string; color: string }> = {
  1: { short: 'T1', desc: '레버리지 의존형', color: 'text-yellow-400' },
  2: { short: 'T2', desc: '자본경량형', color: 'text-blue-400' },
  3: { short: 'T3', desc: '매출·마진 동반성장', color: 'text-emerald-400' },
  4: { short: 'T4', desc: '비용 통제형', color: 'text-orange-400' },
  5: { short: 'T5', desc: '재무 왜곡형', color: 'text-red-400' },
};

const ALERT_META: Record<ROETransitionResult['alert'], {
  border: string; bg: string; badge: string; badgeText: string; icon: string;
}> = {
  NONE:    { border: 'border-gray-700', bg: 'bg-gray-900',       badge: 'bg-gray-700',   badgeText: 'text-gray-300', icon: '✅' },
  WATCH:   { border: 'border-yellow-500/60', bg: 'bg-yellow-950/30', badge: 'bg-yellow-600', badgeText: 'text-white',     icon: '⚠️' },
  PENALTY: { border: 'border-red-500/70',    bg: 'bg-red-950/30',    badge: 'bg-red-600',    badgeText: 'text-white',     icon: '⛔' },
};

/** 분기 시퀀스 시각화 (최근 4개 강조) */
function QuarterSequence({ pattern, fullHistory }: { pattern: ROEType[]; fullHistory: ROEType[] }) {
  const quarters = fullHistory.slice(-8);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {quarters.map((t, i) => {
        const isInPattern = i >= quarters.length - pattern.length;
        const isLatest = i === quarters.length - 1;
        const meta = ROE_TYPE_LABELS[t];
        return (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <div
              className={cn(
                'w-8 h-8 rounded flex items-center justify-center text-xs font-black border',
                isLatest
                  ? 'border-white/50 scale-110'
                  : isInPattern
                  ? 'border-white/20'
                  : 'border-transparent opacity-40',
                t === 4 ? 'bg-orange-500/20' : t === 3 ? 'bg-emerald-500/20' : 'bg-gray-700/40',
                meta.color,
              )}
            >
              {meta.short}
            </div>
            <span className="text-[9px] text-gray-500">Q{i + 1}</span>
          </div>
        );
      })}
      {quarters.length === 0 && (
        <span className="text-xs text-gray-500">이력 없음</span>
      )}
    </div>
  );
}

/** 총자산회전율 비교 바 */
function AssetTurnoverBar({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  // ADR-0028: stale prev 시 0 fallback.
  const dropPct = prev > 0 ? (safePctChange(prev, curr, { label: 'ROETransition.dropPct' }) ?? 0) : 0;
  const maxVal = Math.max(prev, curr, 0.01);

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-400 font-medium">총자산회전율 QoQ 비교</div>
      <div className="space-y-1.5">
        {[{ label: '전분기', val: prev, color: 'bg-gray-500' }, { label: '당분기', val: curr, color: dropPct >= 5 ? 'bg-orange-500' : 'bg-emerald-500' }].map(({ label, val, color }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-12 shrink-0">{label}</span>
            <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
              <div
                className={cn('h-full rounded transition-all', color)}
                style={{ width: `${Math.min(100, (val / maxVal) * 100)}%` }}
              />
            </div>
            <span className="text-xs font-mono text-gray-300 w-10 text-right">{val.toFixed(2)}x</span>
          </div>
        ))}
      </div>
      {dropPct !== 0 && (
        <div className={cn('text-xs font-semibold', dropPct >= 5 ? 'text-orange-400' : 'text-emerald-400')}>
          QoQ {dropPct > 0 ? '▼' : '▲'} {Math.abs(dropPct).toFixed(1)}%
          {dropPct >= 5 && ' — 경보 임계값 초과'}
        </div>
      )}
    </div>
  );
}

/** 규칙 적용 카드 */
function RuleCard({
  ruleLabel, triggered, description,
}: { ruleLabel: string; triggered: boolean; description: string }) {
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-lg border p-2.5',
      triggered ? 'border-red-500/50 bg-red-950/20' : 'border-gray-700 bg-gray-900',
    )}>
      <span className="text-sm mt-0.5">{triggered ? '🔴' : '⚪'}</span>
      <div>
        <div className={cn('text-xs font-bold', triggered ? 'text-red-300' : 'text-gray-400')}>
          {ruleLabel}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">{description}</div>
      </div>
    </div>
  );
}

export function ROETransitionPanel({
  roeTransition,
  roeTypeHistory,
  assetTurnoverHistory = [],
  stockName,
  onRoeTypeHistoryChange,
  onAssetTurnoverHistoryChange,
}: ROETransitionPanelProps) {
  const alertMeta = ALERT_META[roeTransition.alert];
  const latest = roeTypeHistory[roeTypeHistory.length - 1];
  const latestMeta = latest != null ? ROE_TYPE_LABELS[latest] : null;

  // 분기 추가 핸들러
  const handleAddQuarter = (type: ROEType) => {
    if (!onRoeTypeHistoryChange) return;
    onRoeTypeHistoryChange([...roeTypeHistory, type].slice(-8));
  };

  const handleAddTurnover = (val: number) => {
    if (!onAssetTurnoverHistoryChange) return;
    onAssetTurnoverHistoryChange([...assetTurnoverHistory, val].slice(-8));
  };

  return (
    <div className={cn('rounded-xl border p-4 space-y-4', alertMeta.border, alertMeta.bg)}>
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">{alertMeta.icon}</span>
            <span className="text-sm font-bold text-white">ROE 유형 전이 감지기</span>
            {stockName && (
              <span className="text-xs text-gray-400">— {stockName}</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            매출 성장 동력 소실을 선행 포착 → Gate 1 roeType3 자동 차단
          </div>
        </div>
        <div className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-black', alertMeta.badge, alertMeta.badgeText)}>
          {roeTransition.alert === 'PENALTY' ? 'GATE 1 패널티'
            : roeTransition.alert === 'WATCH' ? 'WATCH'
            : 'NORMAL'}
        </div>
      </div>

      {/* 현재 ROE 유형 + 이력 시퀀스 */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400">현재 유형</div>
          {latestMeta && (
            <div className={cn('text-sm font-black', latestMeta.color)}>
              {latestMeta.short} — {latestMeta.desc}
            </div>
          )}
          {roeTransition.consecutiveType4Count >= 2 && (
            <span className="text-xs bg-orange-600/30 text-orange-300 rounded px-1.5 py-0.5 border border-orange-500/30">
              연속 Type 4 {roeTransition.consecutiveType4Count}분기
            </span>
          )}
        </div>
        <QuarterSequence pattern={roeTransition.pattern} fullHistory={roeTypeHistory} />
      </div>

      {/* 감지 규칙 적용 현황 */}
      <div className="grid grid-cols-1 gap-2">
        <RuleCard
          ruleLabel="Rule A — [3,3,3,4] 패턴"
          triggered={roeTransition.transitionType === 'TYPE3_TO_4' || roeTransition.transitionType === 'BOTH'}
          description="3분기 연속 Type 3(매출·마진 동반 성장) 후 Type 4(비용 통제)로 전이 감지"
        />
        <RuleCard
          ruleLabel="Rule B — 총자산회전율 QoQ ≥ 5% 하락"
          triggered={roeTransition.transitionType === 'ASSET_TURNOVER_DROP' || roeTransition.transitionType === 'BOTH'}
          description={`자산 활용 효율 급락 — 매출 둔화 선행 지표. 현재 ${roeTransition.assetTurnoverDropPct.toFixed(1)}% 하락`}
        />
      </div>

      {/* 총자산회전율 바 차트 */}
      {assetTurnoverHistory.length >= 2 && (
        <AssetTurnoverBar history={assetTurnoverHistory} />
      )}

      {/* 액션 메시지 */}
      <div className={cn(
        'rounded-lg px-3 py-2 text-xs font-medium border',
        roeTransition.alert === 'PENALTY'
          ? 'border-red-500/40 bg-red-900/20 text-red-200'
          : roeTransition.alert === 'WATCH'
          ? 'border-yellow-500/40 bg-yellow-900/20 text-yellow-200'
          : 'border-gray-700 bg-gray-800/50 text-gray-300',
      )}>
        {roeTransition.actionMessage}
      </div>

      {/* 분기 이력 수동 입력 (편집 가능 모드) */}
      {onRoeTypeHistoryChange && (
        <div className="border-t border-gray-700 pt-3 space-y-2">
          <div className="text-xs text-gray-400 font-medium">분기 이력에 추가</div>
          <div className="flex gap-1.5 flex-wrap">
            {([1, 2, 3, 4, 5] as ROEType[]).map(t => (
              <button
                key={t}
                onClick={() => handleAddQuarter(t)}
                className={cn(
                  'px-2 py-1 rounded text-xs font-bold border transition-colors',
                  t === 3 ? 'border-emerald-500 text-emerald-400 hover:bg-emerald-500/20'
                    : t === 4 ? 'border-orange-500 text-orange-400 hover:bg-orange-500/20'
                    : 'border-gray-600 text-gray-400 hover:bg-gray-700',
                )}
              >
                {ROE_TYPE_LABELS[t].short}
              </button>
            ))}
            <button
              onClick={() => onRoeTypeHistoryChange(roeTypeHistory.slice(0, -1))}
              className="px-2 py-1 rounded text-xs border border-gray-600 text-gray-500 hover:bg-gray-700"
              disabled={roeTypeHistory.length === 0}
            >
              ← 되돌리기
            </button>
          </div>
          {onAssetTurnoverHistoryChange && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">총자산회전율 추가 (x):</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="예: 0.72"
                className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs text-white"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseFloat((e.target as HTMLInputElement).value);
                    if (!isNaN(val) && val > 0) {
                      handleAddTurnover(val);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
              />
              <span className="text-xs text-gray-500">Enter로 추가</span>
            </div>
          )}
        </div>
      )}

      {/* 원리 설명 */}
      <div className="text-xs text-gray-500 border-t border-gray-800 pt-2">
        <span className="font-medium text-gray-400">ROE 분해:</span>{' '}
        ROE = <span className="text-emerald-400">순이익률</span> ×{' '}
        <span className="text-blue-400">자산회전율</span> ×{' '}
        <span className="text-yellow-400">재무레버리지</span>
        {' '}— Type 3 강점은 처음 두 항의 동반 상승. Type 4는 마진으로만 버팀.
      </div>
    </div>
  );
}
