// @responsibility EntryGate Phase B PoC chain SSOT 우선순위 배열 + 게이트 barrel
/**
 * entryGates/index.ts — Phase B PoC chain SSOT (ADR-0030).
 *
 * 본 PR (PR-57) 은 가장 단순한 동기 게이트 3 개만 다룬다. 후속 PR 에서
 * cooldown / sectorConcentration / sectorPreGuard / portfolioRisk /
 * liveGateRevalidation / kellyBudget 6 게이트를 추가하며 async 시그니처로 확장한다.
 *
 * 순서는 원본 evaluateBuyList 라인 631-657 의 if-블록 순서와 1:1 정합:
 *   1. blacklistGate     — Cascade -30% 진입 금지
 *   2. addBuyBlockGate   — Cascade -7% 추가매수 차단
 *   3. rrrGate           — RRR < 임계값
 */

import { blacklistGate } from './blacklistGate.js';
import { addBuyBlockGate } from './addBuyBlockGate.js';
import { rrrGate } from './rrrGate.js';

import type { EntryGate } from './types.js';

export const ENTRY_GATES_PHASE_B_POC: EntryGate[] = [
  blacklistGate,
  addBuyBlockGate,
  rrrGate,
];

export { blacklistGate, addBuyBlockGate, rrrGate };
export type { EntryGate, EntryGateContext, EntryGateResult } from './types.js';
