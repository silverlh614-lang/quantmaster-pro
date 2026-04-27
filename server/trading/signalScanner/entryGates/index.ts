// @responsibility EntryGate Phase B chain SSOT 우선순위 배열 + 7 게이트 barrel
/**
 * entryGates/index.ts — Phase B chain SSOT (ADR-0030, PR-57+58).
 *
 * 순서는 원본 evaluateBuyList 라인 610-715 의 if-블록 순서와 1:1 정합:
 *   1. cooldownGate              — Regret Asymmetry Filter (PR-58)
 *   2. blacklistGate             — Cascade -30% 진입 금지 (PR-57)
 *   3. addBuyBlockGate           — Cascade -7% 추가매수 차단 (PR-57)
 *   4. rrrGate                   — RRR 임계 미달 (PR-57)
 *   5. sectorConcentrationGate   — 동일 섹터 보유 한도 초과 (PR-58, 텔레그램 동반)
 *   6. sectorPreGuardGate        — 섹터 노출 비중 사전 차단 (PR-58)
 *   7. portfolioRiskGate         — 포트폴리오 리스크 통합 (PR-58, async)
 *
 * 후속 PR scope 밖: liveGateRevalidation (다단계 revalidation pipeline) +
 * kellyBudget (Kelly 사이징 로직) — pure gate 패턴에 부적합. 별도 ADR.
 */

import { cooldownGate } from './cooldownGate.js';
import { blacklistGate } from './blacklistGate.js';
import { addBuyBlockGate } from './addBuyBlockGate.js';
import { rrrGate } from './rrrGate.js';
import { sectorConcentrationGate } from './sectorConcentrationGate.js';
import { sectorPreGuardGate } from './sectorPreGuardGate.js';
import { portfolioRiskGate } from './portfolioRiskGate.js';

import type { EntryGate } from './types.js';

export const ENTRY_GATES_PHASE_B: EntryGate[] = [
  cooldownGate,
  blacklistGate,
  addBuyBlockGate,
  rrrGate,
  sectorConcentrationGate,
  sectorPreGuardGate,
  portfolioRiskGate,
];

/** PR-57 호환 alias — 본 PR-58 합류 후 ENTRY_GATES_PHASE_B 사용 권장. */
export const ENTRY_GATES_PHASE_B_POC = ENTRY_GATES_PHASE_B;

export {
  cooldownGate,
  blacklistGate,
  addBuyBlockGate,
  rrrGate,
  sectorConcentrationGate,
  sectorPreGuardGate,
  portfolioRiskGate,
};
export type { EntryGate, EntryGateContext, EntryGateResult } from './types.js';
