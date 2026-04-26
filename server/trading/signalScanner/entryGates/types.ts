// @responsibility EntryGate Chain of Responsibility 시그니처 SSOT
/**
 * entryGates/types.ts — Phase B Chain of Responsibility 타입 (ADR-0030).
 *
 * 본 PoC PR (PR-57) 은 동기 게이트 3 개만 다룬다. 후속 PR 에서 async 게이트
 * (portfolioRisk, liveGateRevalidation 등) 추가 시 EntryGate 를 union 으로 확장:
 *   `type EntryGate = SyncEntryGate | AsyncEntryGate;`
 */

import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import type { ScanCounters } from '../scanDiagnostics.js';

export interface EntryGateContext {
  stock: WatchlistEntry;
  shadows: ServerShadowTrade[];
  scanCounters: ScanCounters;
}

export type EntryGateResult =
  | { pass: true }
  | {
      pass: false;
      /** orchestrator 가 console.log 로 출력할 메시지. */
      logMessage: string;
      /** stageLog[key] = value (pushTrace 시 같이 영속). */
      stageLog?: { key: string; value: string };
      /** ScanCounters 의 numeric 카운터 키 (예: 'rrrMisses'). pendingTraces 같은 array 키는 제외. */
      counter?: 'yahooFails' | 'gateMisses' | 'rrrMisses' | 'entries' | 'counterfactualRecordedToday';
      /** orchestrator 가 pushTrace() 를 호출할지 여부. */
      pushTrace?: boolean;
    };

export type EntryGate = (ctx: EntryGateContext) => EntryGateResult;
