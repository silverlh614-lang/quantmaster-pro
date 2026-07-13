// @responsibility "모름" 표현 4-variant 컴포넌트 — 페르소나 "모름도 정보다" (ADR-0096 PR-Phase-B)

/**
 * 사용자 분석 #4 직접 구현 — "모름"의 4 종류를 시각적으로 분리:
 *
 *   <IDontKnow.Delayed>     데이터 소스 동기화 지연 — "기다리면 해결됨"
 *   <IDontKnow.Insufficient> 표본/이력 부족    — "지금은 못 함, 시간이 흘러야 함"
 *   <IDontKnow.Stale>        시장 외 시간      — "지금은 의미 없음"
 *   <IDontKnow.Conflicted>   신호 충돌 감지    — "신호들이 서로 모순"
 *
 * 각 variant 다른 아이콘 / 다른 색상 / 다른 권고 액션.
 *
 * 페르소나 "Stop-loss is operating cost" 의 거꾸로 적용 — *모름도 정보다, 정보의 비용이다*.
 *
 * 메시지는 UI_LANG.empty (ADR-0094 SSOT) 기본값 + props.message 옵션 override.
 *
 * 후속 PR 에서 OffHoursBanner / MarketDataStaleBadge / RecommendationWarningsBanner 가
 * 본 4-variant 아래로 통합 흡수 — 같은 시각 언어로 통일.
 */
import type { ReactElement, ReactNode } from 'react';
import { Clock, BarChart3, Moon, AlertCircle } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useUILang } from '../../hooks/useUILang';
import { useUIVerbosity } from '../../hooks/useUIVerbosity';

interface VariantProps {
  /** 기본 메시지를 override. 부재 시 UI_LANG.empty.* SSOT 사용. */
  message?: string;
  /** 권고 액션 (옵셔널) — 미지정 시 variant 기본 권고문 */
  action?: ReactNode;
  className?: string;
  /** 컴팩트 모드 (배지 형태). 기본 false (배너 형태). */
  compact?: boolean;
  /**
   * Verbosity 분기 강제 override — props 명시 시 useUIVerbosity 무시 (테스트/특수 케이스).
   * ADR-0103 PR-Verbose-Wiring-3 — minimal 시 미렌더, balanced/verbose 렌더.
   */
  forceShow?: boolean;
}

interface VariantStyleSpec {
  icon: typeof Clock;
  label: string;
  defaultAction: string;
  /** outer container Tailwind class */
  container: string;
  /** icon Tailwind class */
  iconColor: string;
  /** title Tailwind class */
  titleColor: string;
  /** body text Tailwind class */
  bodyColor: string;
}

const VARIANT_STYLES: Record<'DELAYED' | 'INSUFFICIENT' | 'STALE' | 'CONFLICTED', VariantStyleSpec> = {
  DELAYED: {
    icon: Clock,
    label: '동기화 중',
    defaultAction: '잠시 후 자동 갱신',
    container: 'bg-slate-500/10 border-slate-500/30',
    iconColor: 'text-slate-300',
    titleColor: 'text-slate-100',
    bodyColor: 'text-slate-300',
  },
  INSUFFICIENT: {
    icon: BarChart3,
    label: '표본 부족',
    defaultAction: '데이터 누적 후 활성화',
    container: 'bg-zinc-500/10 border-zinc-500/30',
    iconColor: 'text-zinc-300',
    titleColor: 'text-zinc-100',
    bodyColor: 'text-zinc-300',
  },
  STALE: {
    icon: Moon,
    label: '시장 외',
    defaultAction: '다음 영업일 09:00 갱신',
    container: 'bg-blue-500/10 border-blue-500/30',
    iconColor: 'text-blue-300',
    titleColor: 'text-blue-100',
    bodyColor: 'text-blue-200',
  },
  CONFLICTED: {
    icon: AlertCircle,
    label: '신호 충돌',
    defaultAction: '운영자 검토 필요',
    container: 'bg-amber-500/10 border-amber-500/30',
    iconColor: 'text-amber-300',
    titleColor: 'text-amber-100',
    bodyColor: 'text-amber-200',
  },
};

function makeVariant(emptyKey: 'DELAYED' | 'INSUFFICIENT' | 'STALE' | 'CONFLICTED') {
  return function VariantComponent({ message, action, className, compact = false, forceShow }: VariantProps): ReactElement | null {
    // ADR-0103 PR-Verbose-Wiring-3: shouldShow('idontknow') 분기 — minimal 시 미렌더, balanced/verbose 렌더
    const v = useUIVerbosity();
    const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('idontknow');
    if (!shouldRender) return null;

    const t = useUILang();
    const spec = VARIANT_STYLES[emptyKey];
    const Icon = spec.icon;
    const text = message ?? t.empty(emptyKey);
    const actionText = action ?? spec.defaultAction;

    if (compact) {
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap border',
            spec.container,
            spec.titleColor,
            className,
          )}
          role="status"
          aria-label={`${spec.label}: ${text}`}
          title={text}
          data-idontknow-variant={emptyKey}
        >
          <Icon className={cn('w-3 h-3', spec.iconColor)} aria-hidden />
          <span>{spec.label}</span>
        </span>
      );
    }

    return (
      <div
        className={cn(
          'flex items-start gap-2 px-3 py-2 rounded-xl border text-xs',
          spec.container,
          className,
        )}
        role="status"
        aria-label={`${spec.label}: ${text}`}
        data-idontknow-variant={emptyKey}
      >
        <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', spec.iconColor)} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className={cn('font-bold leading-tight', spec.titleColor)}>{spec.label}</div>
          <div className={cn('mt-0.5 leading-snug', spec.bodyColor)}>{text}</div>
          {actionText && (
            <div className={cn('mt-1 text-[10px] opacity-70', spec.bodyColor)}>→ {actionText}</div>
          )}
        </div>
      </div>
    );
  };
}

const Delayed = makeVariant('DELAYED');
const Insufficient = makeVariant('INSUFFICIENT');
const Stale = makeVariant('STALE');
const Conflicted = makeVariant('CONFLICTED');

/**
 * IDontKnow compound component — 4 sub-variant.
 *
 * 사용:
 *   <IDontKnow.Delayed />
 *   <IDontKnow.Insufficient compact />
 *   <IDontKnow.Stale message="장이 닫혀 있어 갱신 불가" />
 *   <IDontKnow.Conflicted action="운영자 /reset 후 재시도" />
 */
export const IDontKnow = {
  Delayed,
  Insufficient,
  Stale,
  Conflicted,
};
