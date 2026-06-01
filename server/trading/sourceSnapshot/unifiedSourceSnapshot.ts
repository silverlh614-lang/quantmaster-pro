/**
 * @responsibility UnifiedSourceSnapshot 타입 + snapshotId 생성 헬퍼 — 전 종목 단일 수집 결과 컨테이너
 *
 * ADR-0519: buyListLoop 진입 전 SymbolDataCollector 가 1회 수집하여 생성하는 최상위 컨테이너.
 * 모든 Gate(Gate0~Gate3)와 injectPerSymbolSupplyContext 는 이 스냅샷을 읽기 전용으로 소비한다.
 * Feature flag USE_UNIFIED_SOURCE_SNAPSHOT=false 시 기존 per-gate 수집 경로가 유지된다.
 *
 * 이 파일은 타입 계약 + snapshotId 생성 순수 함수만 포함한다.
 * SymbolDataCollector 구현(fetch 로직)은 engine-dev 영역이다.
 *
 * 불변식 #3: "모든 판단은 단일 SourceSnapshot에서 출발한다"
 */

import { randomUUID } from 'crypto';
import type { SymbolSnapshotData } from './symbolSnapshotData.js';

// ─── 매크로 컨텍스트 (macroState 핵심 필드 스냅샷 시점 복사) ────────────────

/**
 * 스냅샷 생성 시점의 macroState 핵심 필드를 불변으로 고정한다.
 * Gate 는 MacroState 를 직접 참조하지 않고 이 복사본만 소비한다 (불변식 #9).
 *
 * sectorCycleStage: null = 섹터 분류 미수집
 * fomcPhase: FomcCalendar 의 FomcPhase 값을 string 으로 수용 (직접 import 회피)
 *   허용 값 — 'PRE_3' | 'PRE_2' | 'PRE_1' | 'DAY' | 'POST_1' | 'POST_2' | 'NORMAL'
 */
export interface UnifiedMacroContext {
  regime: string;                      // 'GREEN' | 'YELLOW' | 'RED'
  engineMode: string;                  // 'LIVE' | 'DRY_RUN' | 'SHADOW' | 'SELL_ONLY' | 'PAUSED'
  marketSession: string;               // 'PRE_OPEN' | 'OPEN' | 'LUNCH' | 'CLOSE' | 'POST_CLOSE' | 'HOLIDAY'
  sectorCycleStage: string | null;     // 'EARLY' | 'MID' | 'LATE' | 'TURNING' | null
  fomcPhase: string;                   // FomcPhase 값 (위 주석 참조)
  macroStateUpdatedAt: string | null;  // macroState.updatedAt (ISO) 또는 null(스테일)
  kospi20dReturn: number | null;       // KOSPI 20일 수익률 (%) — rsScore 교차 집합 계산용
  /**
   * ADR-0549: KOSPI 당일 수익률 (%) read-only carry — MacroState.kospiDayReturn 시점 고정 복사.
   * Market Rally Lens(recommendation read-model) 가 동일 snapshot 에서 소비 (불변식 #3 강화).
   * 새 판단 출처 아님 — 기존 macroState 값의 carry. 부재/스테일 시 null. optional 로 후방호환.
   */
  kospiDayReturn?: number | null;
}

// ─── 파이프라인 경로 ─────────────────────────────────────────────────────────

/**
 * UNIFIED_SNAPSHOT — USE_UNIFIED_SOURCE_SNAPSHOT=true, SymbolDataCollector 경유
 * LEGACY_PER_SYMBOL — USE_UNIFIED_SOURCE_SNAPSHOT=false, 기존 Gate 내 개별 fetch
 */
export type SnapshotPipelinePath = 'UNIFIED_SNAPSHOT' | 'LEGACY_PER_SYMBOL';

// ─── 최상위 컨테이너 ─────────────────────────────────────────────────────────

/**
 * UnifiedSourceSnapshot — buyListLoop 의 단일 데이터 진입점.
 *
 * 불변 계약:
 *   1. createdAt 이후 perSymbol 레코드는 추가·삭제·변경하지 않는다.
 *   2. Gate 는 perSymbol 을 readonly 로만 접근한다.
 *   3. pipelinePath = 'LEGACY_PER_SYMBOL' 인 경우 perSymbol 은 빈 객체({})이며
 *      Gate 는 기존 fetch 로직을 그대로 사용한다.
 *   4. completionRate < 0.5 이면 스캔 사이클 중단을 검토한다 (engine-dev 정책).
 */
export interface UnifiedSourceSnapshot {
  // 식별
  snapshotId: string;    // UUID v4 (generateSnapshotId() 사용)
  createdAt: string;     // ISO 8601 — 스냅샷 생성 완료 시각
  scanCycleId: string;   // buyListLoop 사이클 식별자 (상위에서 전달)

  // 유니버스 범위
  universeTotalCount: number;   // KRX 거래 가능 전체 종목 수
  screenedCandidates: string[]; // 프리스크린 통과 후보 종목 코드 목록

  // 종목 단위 수집 결과 (단일 수집 SSOT)
  perSymbol: Readonly<Record<string, SymbolSnapshotData>>;

  // 매크로 컨텍스트 (macroState 복사본)
  macroContext: UnifiedMacroContext;

  // 수집 품질 요약
  /**
   * FULL 등급 종목 수 / screenedCandidates.length.
   * 범위: 0.0 ~ 1.0. 1.0 = 전 종목 4개 엔드포인트 완전 수집.
   */
  completionRate: number;

  /** 컨테이너 스키마 버전. 현재 '2.0' (기존 per-gate 방식 = '1.0'). */
  dataSourceVersion: '2.0';

  /** SymbolDataCollector 전체 수집 소요 시간 (ms). */
  collectorDurationMs: number;

  /** 파이프라인 경로 식별자 (feature flag 추적용). */
  pipelinePath: SnapshotPipelinePath;
}

// ─── 헬퍼 함수 ──────────────────────────────────────────────────────────────

/**
 * snapshotId 생성 — UUID v4.
 * SymbolDataCollector 가 스냅샷 빌드 시작 시점에 단 1회 호출한다.
 *
 * @returns 'snap_' 접두어 + UUID v4 (진단 로그에서 snapshot 구분 용이)
 */
export function generateSnapshotId(): string {
  return `snap_${randomUUID()}`;
}

/**
 * LEGACY_PER_SYMBOL 경로용 최소 스냅샷 생성 헬퍼.
 * USE_UNIFIED_SOURCE_SNAPSHOT=false 시 buyListLoop 가 이 값을 생성하여
 * Gate 에 전달한다 (Gate 인터페이스 통일 목적).
 *
 * perSymbol 은 빈 객체로 생성되므로 Gate 는 기존 fetch 로직을 사용해야 한다.
 */
export function buildLegacyPlaceholderSnapshot(params: {
  scanCycleId: string;
  universeTotalCount: number;
  screenedCandidates: string[];
  macroContext: UnifiedMacroContext;
}): UnifiedSourceSnapshot {
  return {
    snapshotId: generateSnapshotId(),
    createdAt: new Date().toISOString(),
    scanCycleId: params.scanCycleId,
    universeTotalCount: params.universeTotalCount,
    screenedCandidates: params.screenedCandidates,
    perSymbol: {},
    macroContext: params.macroContext,
    completionRate: 0,
    dataSourceVersion: '2.0',
    collectorDurationMs: 0,
    pipelinePath: 'LEGACY_PER_SYMBOL',
  };
}
