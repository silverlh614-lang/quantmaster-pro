/**
 * @responsibility AutoTrade 섹션 슬롯 — 컨텍스트별 priority/collapsed 메타데이터를 children 과 함께 declare
 */
import React from 'react';
import type { AutoTradeContext } from '../../hooks/useAutoTradeContext';

/**
 * 각 자식 섹션의 컨텍스트별 정렬 우선순위 (1=최우선, 9=숨김).
 * 미지정 컨텍스트는 5(중간) 기본값.
 */
export type ContextPriorityMap = Partial<Record<AutoTradeContext, number>>;

/**
 * 각 자식 섹션의 컨텍스트별 접힘 상태. true 면 `<details>` 접힘으로 렌더 — 시각 노이즈 제거.
 * 미지정 컨텍스트는 false (펼친 상태).
 */
export type ContextCollapsedMap = Partial<Record<AutoTradeContext, boolean>>;

export interface AutoTradeContextSectionProps {
  /** 디버깅·정렬 동률 안정성 추적용 식별자. AutoTradePage 안에서 unique. */
  id: string;
  /** 사용자에게 노출되는 섹션 제목 — collapsed 모드에서 `<summary>` 라벨로 사용. */
  label?: string;
  /** 컨텍스트별 정렬 우선순위. 1=최우선, 9=숨김. 미지정 컨텍스트는 5. */
  priorityByContext?: ContextPriorityMap;
  /** 컨텍스트별 접힘 여부. 미지정 컨텍스트는 false. */
  collapsedByContext?: ContextCollapsedMap;
  children: React.ReactNode;
}

export const DEFAULT_CONTEXT_PRIORITY = 5;
export const HIDDEN_PRIORITY_THRESHOLD = 9;

/**
 * priority/collapsed 메타데이터를 props 로만 보유하는 marker 컴포넌트.
 * 실제 정렬·렌더는 부모 `AutoTradeContextualLayout` 가 담당하므로 본 컴포넌트는 children 만 그대로 노출한다.
 *
 * 부모가 priority 를 읽기 위해서는 React.Children.toArray + element.props 패턴을 사용한다.
 */
export function AutoTradeContextSection({ children }: AutoTradeContextSectionProps) {
  return <>{children}</>;
}

/**
 * 정렬·접힘 결정 헬퍼 — 단위 테스트가 직접 호출하기 위한 순수 함수.
 */
export function resolvePriority(
  priorityByContext: ContextPriorityMap | undefined,
  ctx: AutoTradeContext,
): number {
  return priorityByContext?.[ctx] ?? DEFAULT_CONTEXT_PRIORITY;
}

export function resolveCollapsed(
  collapsedByContext: ContextCollapsedMap | undefined,
  ctx: AutoTradeContext,
): boolean {
  return collapsedByContext?.[ctx] ?? false;
}

export function isHidden(priority: number): boolean {
  return priority >= HIDDEN_PRIORITY_THRESHOLD;
}
