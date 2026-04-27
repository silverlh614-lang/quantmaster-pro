/**
 * @responsibility AutoTradeContextSection 자식들을 컨텍스트별 priority 오름차순 + collapsed 분기로 렌더하는 컨테이너
 */
import React from 'react';
import { Stack } from '../../layout/Stack';
import { useAutoTradeContext, type AutoTradeContext } from '../../hooks/useAutoTradeContext';
import {
  AutoTradeContextSection,
  type AutoTradeContextSectionProps,
  resolvePriority,
  resolveCollapsed,
  isHidden,
} from './AutoTradeContextSection';

interface AutoTradeContextualLayoutProps {
  children: React.ReactNode;
  /** 테스트 결정성 — 외부에서 컨텍스트 주입 가능. 미주입 시 useAutoTradeContext() 사용. */
  contextOverride?: AutoTradeContext;
}

interface SortedSection {
  id: string;
  label?: string;
  priority: number;
  collapsed: boolean;
  hidden: boolean;
  originalIndex: number; // 동률 안정 정렬 보존용
  children: React.ReactNode;
}

const CONTEXT_LABEL: Record<AutoTradeContext, string> = {
  PRE_MARKET: '🌅 장 시작 30분 전 — 진입 준비',
  LIVE_MARKET: '🟢 정규장 — 신호·포지션 모니터링',
  POST_MARKET: '🌇 장 마감 — 결산 회고',
  OVERNIGHT: '🌙 야간 — 미국 시장·내일 시나리오',
  WEEKEND_HOLIDAY: '🛌 휴장 — 주간 회고 + 시스템 학습',
};

/**
 * children 중 AutoTradeContextSection 만 골라내어 정렬·렌더한다.
 * 비-section children 은 priority=5 (DEFAULT_CONTEXT_PRIORITY) 로 가정하여 그대로 위치 보존하지 않고
 * 본 컨테이너 *위* 또는 *아래* 에 사용자가 직접 배치해야 한다 (간섭 방지).
 *
 * 정렬: priority 오름차순 → 동률은 originalIndex 오름차순 (안정 정렬).
 * hidden=true (priority ≥ 9) 섹션은 렌더에서 제외.
 */
export function AutoTradeContextualLayout({ children, contextOverride }: AutoTradeContextualLayoutProps) {
  const liveContext = useAutoTradeContext();
  const ctx = contextOverride ?? liveContext;

  const sections = collectSections(children, ctx);

  return (
    <div data-testid="autotrade-contextual-layout" data-context={ctx}>
      <ContextLabelStrip ctx={ctx} />
      <Stack gap="xl">
        {sections.map((section) => (
          <SectionRenderer key={section.id} section={section} />
        ))}
      </Stack>
    </div>
  );
}

/**
 * children 트리에서 AutoTradeContextSection 만 추출하여 메타데이터로 변환.
 * 순수 함수 — 단위 테스트 가능. Fragment 는 재귀 traverse (test wrapper 호환).
 */
export function collectSections(children: React.ReactNode, ctx: AutoTradeContext): SortedSection[] {
  const result: SortedSection[] = [];
  let cursor = 0;
  const visit = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      // Fragment 는 재귀 (Fragment 자체는 type 매칭 안 됨 → children 만 들어감)
      if (child.type === React.Fragment) {
        visit((child.props as { children?: React.ReactNode }).children);
        return;
      }
      if (child.type !== AutoTradeContextSection) return;
      const props = child.props as AutoTradeContextSectionProps;
      const priority = resolvePriority(props.priorityByContext, ctx);
      const collapsed = resolveCollapsed(props.collapsedByContext, ctx);
      const hidden = isHidden(priority);
      if (hidden) return;
      result.push({
        id: props.id,
        label: props.label,
        priority,
        collapsed,
        hidden,
        originalIndex: cursor++,
        children: props.children,
      });
    });
  };
  visit(children);
  // 안정 정렬: priority 오름차순 → 동률 originalIndex 오름차순
  result.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.originalIndex - b.originalIndex;
  });
  return result;
}

function ContextLabelStrip({ ctx }: { ctx: AutoTradeContext }) {
  return (
    <div
      data-testid="autotrade-context-label"
      className="mb-4 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-zinc-600/40"
    >
      {CONTEXT_LABEL[ctx]}
    </div>
  );
}

function SectionRenderer({ section }: { section: SortedSection }) {
  if (section.collapsed) {
    return (
      <details
        data-testid={`autotrade-section-${section.id}`}
        data-priority={section.priority}
        data-collapsed="true"
        className="group rounded-xl border border-zinc-700/40 bg-zinc-900/40 px-4 py-2"
      >
        <summary className="cursor-pointer text-sm font-medium text-zinc-300 hover:text-zinc-100 select-none">
          {section.label ?? section.id} <span className="text-zinc-500 text-xs">(접혀있음 · 클릭하여 펼치기)</span>
        </summary>
        <div className="mt-3">{section.children}</div>
      </details>
    );
  }
  return (
    <div
      data-testid={`autotrade-section-${section.id}`}
      data-priority={section.priority}
      data-collapsed="false"
    >
      {section.children}
    </div>
  );
}
