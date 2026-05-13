// @responsibility Shadow case ledger — append/update 가능한 저장소 인터페이스와 메모리 구현
import { DEFAULT_MAX_LEDGER_ITEMS } from './shadowConstants.js';
import { isShadowNoImpactMode } from './shadowStateMachine.js';
import type { EngineMode, ExecutionImpact, ShadowCase, ShadowStateTransition } from './shadowTypes.js';

export interface ShadowCaseLedgerStore {
  upsertCase(input: ShadowCase): ShadowCase;
  updateCase(caseId: string, patch: Partial<ShadowCase>): ShadowCase | undefined;
  getCase(caseId: string): ShadowCase | undefined;
  listCases(): ShadowCase[];
  recordTransition(t: ShadowStateTransition): void;
  listTransitions(caseId?: string): ShadowStateTransition[];
}

function normalizeImpact(engineMode: EngineMode, impact: ExecutionImpact): ExecutionImpact {
  return isShadowNoImpactMode(engineMode) ? 'NONE' : impact;
}

export class InMemoryShadowCaseLedger implements ShadowCaseLedgerStore {
  private readonly cases = new Map<string, ShadowCase>();
  private readonly transitions: ShadowStateTransition[] = [];
  constructor(private readonly maxItems = DEFAULT_MAX_LEDGER_ITEMS) {}

  upsertCase(input: ShadowCase): ShadowCase {
    const now = new Date().toISOString();
    const existing = this.cases.get(input.caseId);
    const next: ShadowCase = {
      ...existing,
      ...input,
      executionImpact: normalizeImpact(input.engineMode, input.executionImpact),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    this.cases.set(next.caseId, next);
    this.trim();
    return next;
  }

  updateCase(caseId: string, patch: Partial<ShadowCase>): ShadowCase | undefined {
    const existing = this.cases.get(caseId);
    if (!existing) return undefined;
    const engineMode = patch.engineMode ?? existing.engineMode;
    const executionImpact = normalizeImpact(engineMode, patch.executionImpact ?? existing.executionImpact);
    const next = { ...existing, ...patch, engineMode, executionImpact, updatedAt: new Date().toISOString() };
    this.cases.set(caseId, next);
    return next;
  }

  getCase(caseId: string): ShadowCase | undefined { return this.cases.get(caseId); }
  listCases(): ShadowCase[] { return Array.from(this.cases.values()); }
  recordTransition(t: ShadowStateTransition): void { this.transitions.push({ ...t, executionImpact: normalizeImpact(t.engineMode, t.executionImpact) }); }
  listTransitions(caseId?: string): ShadowStateTransition[] { return caseId ? this.transitions.filter((t) => t.caseId === caseId) : [...this.transitions]; }

  private trim(): void {
    while (this.cases.size > this.maxItems) {
      const first = this.cases.keys().next().value as string | undefined;
      if (!first) return;
      this.cases.delete(first);
    }
  }
}

export const shadowCaseLedger = new InMemoryShadowCaseLedger();
