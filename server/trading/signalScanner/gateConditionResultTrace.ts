import type { ServerGateResult } from '../../quantFilter.js';

export interface GateConditionResultTrace {
  key: string;
  score: number;
  status:
    | 'FIRED'
    | 'DATA_UNAVAILABLE'
    | 'THRESHOLD_NOT_MET'
    | 'PROVIDER_DEGRADED'
    | 'ERROR'
    | 'SKIPPED_BY_POLICY'
    | 'SANITY_REJECTED'
    | string;
  detail?: string;
  requiredData?: string[];
  availableData?: Record<string, boolean>;
  hadRequiredData?: boolean;
  fired: boolean;
  unavailable: boolean;
  thresholdNotMet: boolean;
  providerDegraded: boolean;
}

export type GateConditionResultsTraceMap = Record<string, GateConditionResultTrace>;

type GateOutput = NonNullable<ServerGateResult['outputs']>[number];

function finiteScore(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inferStatus(output: GateOutput['output']): GateConditionResultTrace['status'] {
  if (typeof output?.status === 'string' && output.status.length > 0) return output.status;
  return finiteScore(output?.score) > 0 ? 'FIRED' : 'THRESHOLD_NOT_MET';
}

export function projectGateOutputsToConditionResultsTrace(
  outputs: ServerGateResult['outputs'] | null | undefined,
): GateConditionResultTrace[] {
  if (!Array.isArray(outputs)) return [];
  return outputs
    .filter((item): item is GateOutput => Boolean(item && typeof item.key === 'string' && item.key.length > 0))
    .map((item) => {
      const score = finiteScore(item.output?.score);
      const status = inferStatus(item.output);
      return {
        key: item.key,
        score,
        status,
        ...(typeof item.output?.detail === 'string' ? { detail: item.output.detail } : {}),
        ...(Array.isArray(item.context?.requiredData) ? { requiredData: [...item.context.requiredData] } : {}),
        ...(item.context?.availableData && typeof item.context.availableData === 'object'
          ? { availableData: { ...item.context.availableData } }
          : {}),
        ...(typeof item.context?.hadRequiredData === 'boolean' ? { hadRequiredData: item.context.hadRequiredData } : {}),
        fired: status === 'FIRED' || score > 0,
        unavailable: status === 'DATA_UNAVAILABLE' || status === 'ERROR',
        thresholdNotMet: status === 'THRESHOLD_NOT_MET',
        providerDegraded: status === 'PROVIDER_DEGRADED',
      } satisfies GateConditionResultTrace;
    });
}

export function conditionResultsTraceToMap(
  trace: readonly GateConditionResultTrace[] | null | undefined,
): GateConditionResultsTraceMap | undefined {
  if (!trace || trace.length === 0) return undefined;
  const out: GateConditionResultsTraceMap = {};
  for (const item of trace) out[item.key] = { ...item };
  return Object.keys(out).length > 0 ? out : undefined;
}

export function projectGateResultToConditionResultsMap(
  gate: Pick<ServerGateResult, 'outputs'> | null | undefined,
): GateConditionResultsTraceMap | undefined {
  return conditionResultsTraceToMap(projectGateOutputsToConditionResultsTrace(gate?.outputs));
}
