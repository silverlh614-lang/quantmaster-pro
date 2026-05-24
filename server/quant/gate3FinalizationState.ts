// @responsibility Lightweight in-process Gate3 finalization state for learning pulse display.

import type { Gate3CompletionSummaryInput } from './gate3CompletionScore.js';

let lastGate3FinalizationSummary: Gate3CompletionSummaryInput | null = null;

export function rememberGate3FinalizationSummary(summary: Gate3CompletionSummaryInput | null | undefined): void {
  lastGate3FinalizationSummary = summary ?? null;
}

export function getLastGate3FinalizationSummary(): Gate3CompletionSummaryInput | null {
  return lastGate3FinalizationSummary;
}

export function __resetGate3FinalizationSummaryForTests(): void {
  lastGate3FinalizationSummary = null;
}
