// @responsibility Priority-aware KIS circuit breaker for core vs diagnostic requests.

import type { KisRequestPriority } from './kisRequestClassifier.js';
import { isDiagnosticKisPriority } from './kisRequestClassifier.js';
import { recordKisProviderFailure } from './kisProviderHealth.js';

interface CircuitState {
  failures: number;
  openUntil: number;
  lastReason?: string;
}

const circuits = new Map<string, CircuitState>();

function circuitKey(priority: KisRequestPriority, endpoint: string): string {
  const group = isDiagnosticKisPriority(priority) ? 'DIAGNOSTIC' : 'CORE';
  return `${group}:${priority}:${endpoint}`;
}

function thresholdFor(priority: KisRequestPriority): number {
  return isDiagnosticKisPriority(priority) ? 2 : 3;
}

function cooldownFor(priority: KisRequestPriority): number {
  return isDiagnosticKisPriority(priority) ? 60_000 : 5 * 60_000;
}

export function isKisCoreCircuitOpen(input: {
  priority: KisRequestPriority;
  endpoint: string;
  trId?: string;
}): boolean {
  const key = circuitKey(input.priority, input.endpoint);
  const state = circuits.get(key);
  if (!state) return false;
  if (Date.now() < state.openUntil) {
    if (!isDiagnosticKisPriority(input.priority)) {
      recordKisProviderFailure({
        priority: input.priority,
        reason: state.lastReason ?? 'circuit-open',
        providerHealth: 'CIRCUIT_OPEN',
        trId: input.trId,
      });
    }
    return true;
  }
  if (state.openUntil > 0) state.openUntil = 0;
  return false;
}

export function recordKisCoreCircuitFailure(input: {
  priority: KisRequestPriority;
  endpoint: string;
  status?: number;
  reason: string;
  trId?: string;
}): void {
  const key = circuitKey(input.priority, input.endpoint);
  const state = circuits.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  state.lastReason = input.reason;
  if (state.failures >= thresholdFor(input.priority)) {
    state.openUntil = Date.now() + cooldownFor(input.priority);
    if (!isDiagnosticKisPriority(input.priority)) {
      recordKisProviderFailure({
        priority: input.priority,
        reason: input.reason,
        status: input.status,
        providerHealth: 'CIRCUIT_OPEN',
        trId: input.trId,
      });
    }
  }
  circuits.set(key, state);
}

export function recordKisCoreCircuitSuccess(input: {
  priority: KisRequestPriority;
  endpoint: string;
}): void {
  circuits.delete(circuitKey(input.priority, input.endpoint));
}

export function __resetKisCoreCircuitBreakerForTests(): void {
  circuits.clear();
}
