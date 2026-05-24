// @responsibility UI 정보 밀도 토글 게이트키퍼 hook + 가시성 분기 SSOT (ADR-0099 PR-Verbose, 사용자 #12)

/**
 * 사용자 분석 #12 직접 구현 — V-E-R Card / ConfluenceMeter / DataQuality 정보가 다 들어가면
 * 사용자에 따라 정보 과잉. minimal 은 Verdict 만, balanced 는 V-E-R, verbose 는
 * ConfluenceMeter+축 사유까지. 사용자가 자기 인지 부하를 직접 제어.
 *
 * **사용 패턴**:
 *   const v = useUIVerbosity();
 *   if (v.shouldShow('confluence')) return <ConfluenceMeter axes={...} />;
 *   if (v.atLeast('verbose')) return <AxisReasonsExpanded />;
 *
 * 페르소나 운영자 = verbose (모든 신호 노출), 신규 사용자 = minimal (Verdict 만), 기본 = balanced.
 *
 * Phase B/C/D 모든 컴포넌트가 본 hook 으로 자기 가시성 분기 — wiring 은 후속 PR (각 컴포넌트
 * PR 별도, 회귀 위험 격리). 본 PR 은 SSOT + hook + toggle 컴포넌트만.
 */
import { useMemo } from 'react';
import { useSettingsStore, type UIVerbosity } from '../stores/useSettingsStore';

/** 컴포넌트 또는 정보 영역의 *자기 식별 키* — useUIVerbosity().shouldShow(key) 로 가시성 결정. */
export type VerbosityContent =
  | 'verdict'           // 판정 라벨 (STRONG_BUY 등) — 모든 모드
  | 'evidence'          // V-E-R Evidence slot — balanced 이상
  | 'risk'              // V-E-R Risk slot (Stop-loss First) — balanced 이상
  | 'time-band'         // Verdict 만료 띠 — balanced 이상
  | 'confluence'        // ConfluenceMeter 4축 — verbose 만
  | 'axis-reasons'      // 축 결손 사유 — verbose 만
  | 'data-quality'      // DataQualityBadge — balanced 이상
  | 'data-quality-ribbon' // 페이지 상단 띠 — verbose 만
  | 'idontknow'         // IDontKnow placeholder — balanced 이상 (모름은 항상 정보)
  | 'gate-status'       // GateStatusCard 풀카드 — verbose 만 (미니는 항상)
  | 'gate-mini';        // GateMiniIndicator — 모든 모드

/**
 * 가시성 분기 SSOT 매트릭스 (단위 테스트 가능 순수 함수).
 *
 * 매트릭스 — 사용자 분석 #12 정합:
 *
 * | content              | minimal | balanced | verbose |
 * |----------------------|---------|----------|---------|
 * | verdict              | ✅      | ✅       | ✅      |
 * | gate-mini            | ✅      | ✅       | ✅      |
 * | idontknow            | ❌      | ✅       | ✅      |
 * | evidence             | ❌      | ✅       | ✅      |
 * | risk                 | ❌      | ✅       | ✅      |
 * | time-band            | ❌      | ✅       | ✅      |
 * | data-quality         | ❌      | ✅       | ✅      |
 * | confluence           | ❌      | ❌       | ✅      |
 * | axis-reasons         | ❌      | ❌       | ✅      |
 * | data-quality-ribbon  | ❌      | ❌       | ✅      |
 * | gate-status          | ❌      | ❌       | ✅      |
 *
 * minimal: Verdict + 미니 게이트만 (신규 사용자, 빠른 결정)
 * balanced: V-E-R + 데이터 품질 배지 + 모름 표현 (기본 디폴트)
 * verbose: 합치도 + 축 사유 + 신뢰도 띠 + 풀 게이트 (시스템 운영자)
 */
export function shouldShowAtVerbosity(content: VerbosityContent, verbosity: UIVerbosity): boolean {
  // minimal — Verdict + 미니 게이트만
  if (verbosity === 'minimal') {
    return content === 'verdict' || content === 'gate-mini';
  }

  // verbose — 모든 컨텐츠 노출
  if (verbosity === 'verbose') {
    return true;
  }

  // balanced (default) — verbose 전용 컨텐츠 4종 제외
  const VERBOSE_ONLY: VerbosityContent[] = [
    'confluence',
    'axis-reasons',
    'data-quality-ribbon',
    'gate-status',
  ];
  return !VERBOSE_ONLY.includes(content);
}

const VERBOSITY_RANK: Record<UIVerbosity, number> = {
  minimal: 0,
  balanced: 1,
  verbose: 2,
};

/** verbosity 가 threshold 이상인지 — atLeast('verbose') 같은 가독성 체크용. */
export function atLeastVerbosity(current: UIVerbosity, threshold: UIVerbosity): boolean {
  return VERBOSITY_RANK[current] >= VERBOSITY_RANK[threshold];
}

export interface UIVerbosityHook {
  /** 현재 verbosity 값 */
  verbosity: UIVerbosity;
  /** verbosity 변경 setter */
  setVerbosity: (v: UIVerbosity) => void;
  /** 컨텐츠 키로 가시성 결정 (SSOT 매트릭스) */
  shouldShow: (content: VerbosityContent) => boolean;
  /** verbosity 가 threshold 이상인지 */
  atLeast: (threshold: UIVerbosity) => boolean;
}

export function useUIVerbosity(): UIVerbosityHook {
  const verbosity = useSettingsStore((s) => s.uiVerbosity);
  const setVerbosity = useSettingsStore((s) => s.setUIVerbosity);

  return useMemo(
    () => ({
      verbosity,
      setVerbosity,
      shouldShow: (content) => shouldShowAtVerbosity(content, verbosity),
      atLeast: (threshold) => atLeastVerbosity(verbosity, threshold),
    }),
    [verbosity, setVerbosity],
  );
}
