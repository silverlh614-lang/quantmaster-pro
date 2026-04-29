// @responsibility ConfluenceMeter 4축 (Fundamental/Flow/Technical/Macro) + 축 결손 사유 자동 표기 + 단방향 결합 부품 (ADR-0098 PR-Phase-D #9 #10)

/**
 * 사용자 분석 #9 + #10 통합 — 4축 합치도 시각화 + 축 결손 사유 자동 표기 + 단방향 결합.
 *
 *   <ConfluenceMeter axes={[
 *     { id: 'FUNDAMENTAL', score: 8.2, reason: 'ROE 17.5% / OCF 양호' },
 *     { id: 'FLOW', score: 4.1, reason: '외인 5일 -50억' },
 *     { id: 'TECHNICAL', score: 7.8, reason: 'MA20 돌파 + RSI 62' },
 *     { id: 'MACRO', score: 3.2, reason: 'VKOSPI 28 (불안)' },
 *   ]} />
 *
 * **축 결손 자동 표기 (#9)**:
 * - score < 5 인 약한 축은 결손 사유 1줄 자동 노출
 * - 사용자가 *"왜 이 축이 약한가"* 즉시 인지 → "기다려야 할 것" vs "포기해야 할 것" 구분
 * - DART 발표 대기 → 기다림 / 외인 -50억 → 본질 / Macro 결손 → 시간 외 변수 (기다림 무의미)
 * - reason 부재 시 "데이터 미수집" placeholder
 *
 * **단방향 결합 (#10)**:
 * - ConfluenceMeter 는 VerdictCard 를 *모름* — 외부 의존성 0 (props 만)
 * - VerdictCard.Evidence slot 안 자식으로 박힘 (Phase C 사전 등록)
 * - 동시에 어디서든 단독 사용 가능 (Screener/Backtest 페이지 헤더 KPI 등)
 * - 코드베이스 commandRegistry / SymbolMarketRegistry 같은 작은 SSOT 부품 패턴 정합
 *
 * Blueprint 원칙 6번 *"모름을 표현할 수 있어야 한다"* 의 가장 정교한 구현 — 시스템이 자기
 * 결론의 한계를 자발적으로 노출.
 */
import type { ReactElement } from 'react';
import { cn } from '../../ui/cn';
import { useUIVerbosity } from '../../hooks/useUIVerbosity';

export type ConfluenceAxisId = 'FUNDAMENTAL' | 'FLOW' | 'TECHNICAL' | 'MACRO';

export interface ConfluenceAxis {
  id: ConfluenceAxisId;
  /** 0~10 점수 (≥7 STRONG / 5~7 NEUTRAL / <5 WEAK) */
  score: number;
  /** 약한 축 (score<5) 의 결손 사유 1줄. 부재 시 "데이터 미수집" placeholder. */
  reason?: string;
}

interface ConfluenceMeterProps {
  axes: ConfluenceAxis[];
  /** 컴팩트 모드 (한 줄 4 막대만, 결손 사유 미표시). 기본 false. */
  compact?: boolean;
  className?: string;
  /**
   * Verbosity 분기 강제 override — props 명시 시 useUIVerbosity 무시 (테스트/특수 케이스).
   * ADR-0102 PR-Verbose-Wiring-2 — minimal/balanced 시 미렌더, verbose 한정.
   */
  forceShow?: boolean;
}

const AXIS_LABEL: Record<ConfluenceAxisId, string> = {
  FUNDAMENTAL: '펀더멘털',
  FLOW: '수급',
  TECHNICAL: '기술',
  MACRO: '매크로',
};

/** 축 점수 분류 SSOT (단위 테스트 가능). */
export function classifyAxisScore(score: number): 'STRONG' | 'NEUTRAL' | 'WEAK' {
  if (!Number.isFinite(score)) return 'WEAK';
  if (score >= 7) return 'STRONG';
  if (score >= 5) return 'NEUTRAL';
  return 'WEAK';
}

/** 축 결손 사유 표시 여부 SSOT. */
export function shouldShowReason(score: number): boolean {
  return classifyAxisScore(score) === 'WEAK';
}

const AXIS_COLOR: Record<ReturnType<typeof classifyAxisScore>, string> = {
  STRONG: 'bg-emerald-500',
  NEUTRAL: 'bg-amber-500',
  WEAK: 'bg-red-500',
};

const AXIS_TEXT_COLOR: Record<ReturnType<typeof classifyAxisScore>, string> = {
  STRONG: 'text-emerald-200',
  NEUTRAL: 'text-amber-200',
  WEAK: 'text-red-200',
};

/** 합치도 종합 등급 — STRONG 축 ≥3 → CONVICTION / 2 → CONFIDENT / 1 → MIXED / 0 → DIVERGENT. */
export function classifyConfluence(axes: ConfluenceAxis[]): 'CONVICTION' | 'CONFIDENT' | 'MIXED' | 'DIVERGENT' {
  const strongCount = axes.filter((a) => classifyAxisScore(a.score) === 'STRONG').length;
  if (strongCount >= 3) return 'CONVICTION';
  if (strongCount === 2) return 'CONFIDENT';
  if (strongCount === 1) return 'MIXED';
  return 'DIVERGENT';
}

const CONFLUENCE_LABEL: Record<ReturnType<typeof classifyConfluence>, string> = {
  CONVICTION: '🔥 강한 합치',
  CONFIDENT: '✅ 확신',
  MIXED: '🟡 혼재',
  DIVERGENT: '⚠️ 신호 충돌',
};

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return score.toFixed(1);
}

export function ConfluenceMeter({ axes, compact = false, className, forceShow }: ConfluenceMeterProps): ReactElement | null {
  // ADR-0102 PR-Verbose-Wiring-2: atLeast('verbose') 분기 — verbose 모드 한정 렌더 (사용자 #12)
  // shouldShow('confluence') 매트릭스: minimal/balanced ❌, verbose ✅
  const v = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('confluence');
  if (!shouldRender) return null;

  if (axes.length === 0) {
    return (
      <div
        className={cn('text-xs opacity-50 italic px-2 py-1', className)}
        role="status"
        aria-label="합치도 데이터 미수집"
        data-confluence-empty="true"
      >
        합치도 데이터 미수집
      </div>
    );
  }

  const overall = classifyConfluence(axes);

  if (compact) {
    return (
      <div
        className={cn('flex items-center gap-1', className)}
        role="img"
        aria-label={`합치도 ${CONFLUENCE_LABEL[overall]} (${axes.length}축)`}
        data-confluence-overall={overall}
      >
        {axes.map((axis) => {
          const tier = classifyAxisScore(axis.score);
          return (
            <span
              key={axis.id}
              className={cn('h-1 flex-1 rounded-sm', AXIS_COLOR[tier])}
              style={{ minWidth: '12px' }}
              title={`${AXIS_LABEL[axis.id]}: ${formatScore(axis.score)}`}
              data-confluence-axis={axis.id}
              data-confluence-axis-tier={tier}
              aria-hidden
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn('space-y-1.5', className)}
      role="region"
      aria-label={`합치도 ${CONFLUENCE_LABEL[overall]}`}
      data-confluence-overall={overall}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest opacity-70">
        <span className="font-bold">합치도</span>
        <span className="font-black" data-confluence-overall-label>{CONFLUENCE_LABEL[overall]}</span>
      </div>
      <ul className="space-y-1">
        {axes.map((axis) => {
          const tier = classifyAxisScore(axis.score);
          const showReason = shouldShowReason(axis.score);
          const widthPct = Math.max(0, Math.min(100, (axis.score / 10) * 100));
          return (
            <li
              key={axis.id}
              className="space-y-0.5"
              data-confluence-axis={axis.id}
              data-confluence-axis-tier={tier}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className={cn('font-bold', AXIS_TEXT_COLOR[tier])}>
                  {AXIS_LABEL[axis.id]}
                </span>
                <span className={cn('font-num font-black', AXIS_TEXT_COLOR[tier])}>
                  {formatScore(axis.score)}
                </span>
              </div>
              <div
                className="h-1 rounded-sm bg-zinc-800/60 overflow-hidden"
                role="progressbar"
                aria-valuenow={Math.round(widthPct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${AXIS_LABEL[axis.id]} 점수 ${formatScore(axis.score)}`}
              >
                <div className={cn('h-full transition-all', AXIS_COLOR[tier])} style={{ width: `${widthPct}%` }} />
              </div>
              {showReason && (
                <div
                  className="text-[10px] text-red-300/80 pl-2 border-l border-red-500/40"
                  data-confluence-axis-reason
                >
                  {axis.reason ?? '데이터 미수집'}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
