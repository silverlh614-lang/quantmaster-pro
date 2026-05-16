/**
 * @responsibility evaluateBuyList/Intraday 의 read-only 입력 + mutable 출력 인터페이스 SSOT
 *
 * ADR-0134 (PR-Refactor-2) — perSymbolEvaluation.ts 분해 시 타입 선언만 격리.
 * BuyListLoopContext / BuyListLoopMutables / IntradayLoopContext / IntradayLoopMutables
 * 4 인터페이스를 buyListLoop.ts + intradayLoop.ts 가 공유한다.
 */

import type { MacroState } from '../../../persistence/macroStateRepo.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { loadIntradayWatchlist } from '../../../persistence/intradayWatchlistRepo.js';
import type { BanditDecision } from '../../../learning/probingBandit.js';
import type { FullRegimeConfig } from '../../../../src/types/core.js';
import type { REGIME_CONFIGS } from '../../../../src/services/quant/regimeEngine.js';
import type { LiveBuyTask } from '../../buyPipeline.js';
import type { ScanCounters } from '../scanDiagnostics.js';
import type { SupplyHealthSnapshot } from '../../../learning/supplyHealthLearning.js';
import type { MarketSessionState } from '../../entryPolicySemantics.js';

// ── Step 4b: 메인 buyList 루프 컨텍스트 ──────────────────────────────────────
// signalScanner.ts 의 `for (const stock of buyList)` 루프 본체를 perSymbolEvaluation
// 으로 이식하기 위한 ctx 인터페이스. 외부에서 mutable 상태를 box 패턴으로 전달.

/**
 * mutable 상태 — runAutoSignalScan 의 지역 let 변수들을 box 객체로 wrap.
 * evaluateBuyList 내부에서 `.value++` / `.push()` 등으로 갱신하면 호출자도
 * 동일 객체를 참조하므로 자연스럽게 동기화된다.
 */
export interface BuyListLoopMutables {
  liveBuyQueue: LiveBuyTask[];
  reservedSlots: { value: number };
  probingReservedSlots: { value: number };
  reservedTiers: ('PROBING' | 'OTHER')[];
  reservedIsMomentum: boolean[];
  reservedBudgets: number[];
  reservedSectorValues: { sector: string; value: number }[];
  pendingSectorValue: Map<string, number>;
  currentSectorValue: Map<string, number>;
  orderableCash: { value: number };
  watchlistMutated: { value: boolean };
}

/**
 * evaluateBuyList 컨텍스트 — read-only 입력 + scanCounters/mutables 출력.
 * 원본 runAutoSignalScan 의 closure 변수와 1:1 매핑된다.
 */
export interface BuyListLoopContext {
  // read-only 입력
  buyList: WatchlistEntry[];
  swingList: WatchlistEntry[];
  watchlist: WatchlistEntry[];
  shadows: ServerShadowTrade[];
  shadowMode: boolean;
  totalAssets: number;
  effectiveMaxPositions: number;
  regime: keyof typeof REGIME_CONFIGS;
  regimeConfig: FullRegimeConfig;
  macroState: MacroState | null;
  vixGating: { kellyMultiplier: number; noNewEntry?: boolean; reason?: string };
  fomcProximity: { kellyMultiplier: number; noNewEntry?: boolean; description?: string };
  kellyMultiplier: number;
  accountKellyMultiplier: number;
  banditDecision: BanditDecision;
  sellOnlyExc: { allow: boolean; minLiveGate: number; minMtas: number; kellyFactor: number; maxSlots?: number };
  volumeClock: { allowEntry?: boolean; scoreBonus: number; reason?: string };
  conditionWeights: ReturnType<typeof import('../../../persistence/conditionWeightsRepo.js')['loadConditionWeights']>;
  supplyHealthSnapshot?: SupplyHealthSnapshot;
  resolvedMarketSessionState?: MarketSessionState;
  positionFullDiagnosticOnly?: boolean;
  macroDiagnosticOnly?: boolean;
  diagnosticOnlyLiveBlock?: boolean;
  liveEntryBlockedReason?: string;
  // 출력 / mutable
  scanCounters: ScanCounters;
  mutables: BuyListLoopMutables;
}

// ── Step 4c: 장중 watchlist 루프 컨텍스트 ───────────────────────────────────
// signalScanner.ts 의 `if (!options?.sellOnly && intradayBuyList.length > 0) { ... }`
// 블록(외부 if 가드 + 내부 루프 + 플러시) 을 perSymbolEvaluation 으로 이식.

/**
 * Intraday 루프 mutable 상태 — orderableCash 만 box 로 외부와 공유.
 */
export interface IntradayLoopMutables {
  orderableCash: { value: number };
}

/**
 * evaluateIntradayList 컨텍스트 — read-only 입력 + scanCounters/mutables 출력.
 */
export interface IntradayLoopContext {
  intradayBuyList: ReturnType<typeof loadIntradayWatchlist>;
  shadows: ServerShadowTrade[];
  shadowMode: boolean;
  totalAssets: number;
  accountKellyMultiplier: number;
  kellyMultiplier: number;
  regime: keyof typeof REGIME_CONFIGS;
  regimeConfig: FullRegimeConfig;
  macroState: MacroState | null;
  conditionWeights: ReturnType<typeof import('../../../persistence/conditionWeightsRepo.js')['loadConditionWeights']>;
  supplyHealthSnapshot?: SupplyHealthSnapshot;
  options: { sellOnly?: boolean; forceBuyCodes?: string[] };
  scanCounters: ScanCounters;
  mutables: IntradayLoopMutables;
}
