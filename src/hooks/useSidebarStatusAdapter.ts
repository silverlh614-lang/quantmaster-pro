// @responsibility 사이드바 메뉴 상태 표시를 위한 전역 스토어 읽기 전용 어댑터 (엔진 상태 변경 불가)
import { useMemo } from 'react';

export type BadgeTone = 'emerald' | 'rose' | 'amber' | 'blue' | 'slate' | 'zinc';

export interface SidebarStatus {
  label: string;
  tone: BadgeTone;
}

export interface SidebarStatuses {
  autoTrade: SidebarStatus | null;
  tradeJournal: SidebarStatus | null;
  recommendation: SidebarStatus | null;
  macroIntel: SidebarStatus | null;
  shadowLearning: SidebarStatus | null;
  learningSanity: SidebarStatus | null;
}

export function useSidebarStatusAdapter(): SidebarStatuses {
  // TODO: 실제 적용 시에는 하단 주석처럼 기존 Zustand Store 상태들을 구독하여 매핑합니다.
  // const { engineMode } = useAutoTradeContext();
  // const { activeTradeCount } = useShadowTradeStore();
  // const { pendingCount } = useRecommendationStore();
  // const { macroEnv } = useGlobalIntelStore();
  // ...

  return useMemo(() => {
    // 이 훅은 엔진의 어떠한 상태도 Mutate하지 않는 100% Read-Only 투영 계층입니다.
    // 엔진 상태값 미수신 시 시스템에 영향을 주지 않는 Fallback 문자열을 반환합니다.
    
    // [가상/Fallback 데이터 매핑 예시]
    // 실제 구현부에서는 store에서 가져온 값을 분기하여 label과 tone을 매핑합니다.
    return {
      autoTrade: {
        label: 'NORMAL',
        tone: 'emerald',
      },
      tradeJournal: {
        label: '2 OPEN',
        tone: 'blue',
      },
      recommendation: {
        label: '5 PENDING',
        tone: 'amber',
      },
      macroIntel: {
        label: 'R4_NEUTRAL',
        tone: 'slate',
      },
      shadowLearning: {
        label: 'ACTIVE',
        tone: 'emerald',
      },
      learningSanity: {
        label: '0 WARN',
        tone: 'zinc',
      },
    };
  }, []);
  // dependencies 배열에는 구독할 실제 Store 값들을 추후 포함시킵니다.
}