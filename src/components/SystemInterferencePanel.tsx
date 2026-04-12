/**
 * SystemInterferencePanel.tsx — 시스템 상호간섭 파라미터 충돌 감지 패널
 *
 * 12개 아이디어를 동시에 실행할 때 발생할 수 있는 레짐 분류기 ↔ 동적 손절 ↔
 * 포지션 생애주기 간 파라미터 충돌을 실시간으로 감지하고 해결 방법을 안내한다.
 */
import React, { useState } from 'react';
import {
  ShieldAlert, ShieldCheck, AlertTriangle, AlertCircle, Info,
  ChevronDown, ChevronUp, ArrowRight,
} from 'lucide-react';
import { cn } from '../ui/cn';
import type { SystemInterferenceResult, ParameterConflict, ConflictSeverity } from '../types/interference';

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  result: SystemInterferenceResult | null;
}

// ─── 심각도 스타일 ─────────────────────────────────────────────────────────────

interface SeverityStyle {
  border: string;
  bg: string;
  badge: string;
  icon: React.ReactNode;
  label: string;
}

function getSeverityStyle(severity: ConflictSeverity): SeverityStyle {
  switch (severity) {
    case 'CRITICAL':
      return {
        border: 'border-red-600/60',
        bg: 'bg-red-950/30',
        badge: 'bg-red-900/70 text-red-300 border-red-700/50',
        icon: <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />,
        label: 'CRITICAL',
      };
    case 'HIGH':
      return {
        border: 'border-orange-600/50',
        bg: 'bg-orange-950/20',
        badge: 'bg-orange-900/60 text-orange-300 border-orange-700/50',
        icon: <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />,
        label: 'HIGH',
      };
    case 'MEDIUM':
      return {
        border: 'border-yellow-600/40',
        bg: 'bg-yellow-950/15',
        badge: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40',
        icon: <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />,
        label: 'MEDIUM',
      };
    case 'LOW':
      return {
        border: 'border-blue-600/40',
        bg: 'bg-blue-950/15',
        badge: 'bg-blue-900/50 text-blue-300 border-blue-700/40',
        icon: <Info className="w-4 h-4 text-blue-400 shrink-0" />,
        label: 'LOW',
      };
  }
}

// ─── 충돌 카드 ─────────────────────────────────────────────────────────────────

function ConflictCard({ conflict }: { conflict: ParameterConflict }) {
  const [open, setOpen] = useState(false);
  const s = getSeverityStyle(conflict.severity);

  return (
    <div className={cn('rounded-lg border p-3 space-y-2', s.border, s.bg)}>
      {/* 카드 헤더 */}
      <div
        className="flex items-start gap-2 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        {s.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded border', s.badge)}>
              {s.label}
            </span>
            {conflict.systems.map((sys, i) => (
              <React.Fragment key={sys}>
                <span className="text-[10px] text-gray-300 font-medium">{sys}</span>
                {i < conflict.systems.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-gray-500 shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
          <p className="text-xs font-semibold text-gray-200 mt-1">{conflict.title}</p>
        </div>
        <div className="shrink-0 text-gray-500">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* 상세 내용 */}
      {open && (
        <div className="space-y-2 pt-1 border-t border-white/5">
          {/* 충돌 설명 */}
          <div>
            <p className="text-[10px] text-gray-400 font-semibold mb-1">충돌 설명</p>
            <p className="text-[11px] text-gray-300 leading-relaxed">{conflict.description}</p>
          </div>

          {/* 파라미터 비교 */}
          {conflict.parameterDetails && (
            <div>
              <p className="text-[10px] text-gray-400 font-semibold mb-1">파라미터 비교</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-emerald-950/40 border border-emerald-800/30 px-2.5 py-1.5">
                  <p className="text-[9px] text-emerald-400 font-bold mb-0.5">권장값</p>
                  <p className="text-[10px] text-emerald-200 font-mono">{conflict.parameterDetails.expected}</p>
                </div>
                <div className="rounded-md bg-red-950/40 border border-red-800/30 px-2.5 py-1.5">
                  <p className="text-[9px] text-red-400 font-bold mb-0.5">현재값</p>
                  <p className="text-[10px] text-red-200 font-mono">{conflict.parameterDetails.actual}</p>
                </div>
              </div>
            </div>
          )}

          {/* 해결 방법 */}
          <div className="rounded-md bg-gray-800/50 border border-gray-600/30 px-2.5 py-2">
            <p className="text-[10px] text-gray-400 font-semibold mb-1">해결 방법</p>
            <p className="text-[11px] text-gray-200 leading-relaxed">{conflict.resolution}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 충돌 카운트 배지 ──────────────────────────────────────────────────────────

function CountBadge({ count, color }: { count: number; color: string }) {
  if (count === 0) return null;
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', color)}>
      {count}
    </span>
  );
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export const SystemInterferencePanel: React.FC<Props> = ({ result }) => {
  const [expanded, setExpanded] = useState(true);

  const hasBlocking = result?.hasBlockingConflict ?? false;
  const total = result?.totalConflicts ?? 0;

  return (
    <div className={cn(
      'rounded-xl border px-5 py-4 space-y-4 transition-colors',
      hasBlocking
        ? 'border-red-600/70 bg-red-950/20'
        : total > 0
          ? 'border-orange-600/50 bg-orange-950/10'
          : 'border-gray-700/40 bg-gray-900/40',
    )}>
      {/* 헤더 */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {hasBlocking ? (
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          ) : total > 0 ? (
            <ShieldAlert className="w-5 h-5 text-orange-400 shrink-0" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <div>
            <h2 className="text-sm font-bold text-white">
              시스템 상호간섭 파라미터 충돌 감지
            </h2>
            <p className="text-[10px] text-gray-400">
              레짐 분류기 ↔ 동적 손절 ↔ 포지션 생애주기
            </p>
          </div>
          {/* 충돌 수 배지 */}
          <div className="flex items-center gap-1.5 ml-1">
            <CountBadge
              count={result?.criticalCount ?? 0}
              color="bg-red-900/70 text-red-300 border-red-700/50"
            />
            <CountBadge
              count={result?.highCount ?? 0}
              color="bg-orange-900/60 text-orange-300 border-orange-700/50"
            />
            <CountBadge
              count={result?.mediumCount ?? 0}
              color="bg-yellow-900/50 text-yellow-300 border-yellow-700/40"
            />
          </div>
        </div>
        <div className="text-gray-500 shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="space-y-4">
          {/* 요약 메시지 */}
          {result && (
            <div className={cn(
              'rounded-lg px-3.5 py-2.5 border text-xs font-medium',
              hasBlocking
                ? 'bg-red-950/40 border-red-700/50 text-red-200'
                : total > 0
                  ? 'bg-orange-950/30 border-orange-700/40 text-orange-200'
                  : 'bg-emerald-950/30 border-emerald-700/40 text-emerald-200',
            )}>
              {result.summary}
            </div>
          )}

          {/* 충돌 없음 */}
          {result && total === 0 && (
            <div className="flex items-center gap-2 text-emerald-400 py-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <p className="text-xs">
                세 시스템의 파라미터가 현재 레짐 조건에서 정합성을 유지하고 있습니다.
              </p>
            </div>
          )}

          {/* 충돌 목록 */}
          {result && result.conflicts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                감지된 충돌 ({total}건)
              </p>
              {result.conflicts.map(conflict => (
                <ConflictCard key={conflict.id} conflict={conflict} />
              ))}
            </div>
          )}

          {/* 결과 없음 */}
          {!result && (
            <p className="text-xs text-gray-500 py-2">
              시장 레짐 자동 분류기를 실행하면 파라미터 충돌 검사가 자동으로 수행됩니다.
            </p>
          )}

          {/* 검사 시각 */}
          {result && (
            <p className="text-[10px] text-gray-600 text-right">
              마지막 검사: {new Date(result.checkedAt).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
