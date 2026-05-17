// @responsibility Pure program-flow value normalization for normal supply preview diagnostics.
import type {
  ProgramFlowValueNormalizationResult,
  ProgramFlowValueRawKind,
  ProgramFlowValueReason,
} from './programFlowTypes.js';

export function normalizeProgramFlowValue(input: unknown): ProgramFlowValueNormalizationResult {
  const rawKind = rawKindOf(input);
  if (input === null || input === undefined) return normalizationFailure('PROGRAM_VALUE_NULL', rawKind);
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return normalizationFailure('PROGRAM_VALUE_PARSE_FAILED', 'number', String(input));
    return { ok: true, value: input, reason: input === 0 ? 'PROGRAM_VALUE_ZERO' : 'PROGRAM_VALUE_PARSE_OK', rawKind: 'number', sanitizedSample: safeSample(input), diagnosticOnly: true };
  }
  if (typeof input === 'string') return normalizeProgramFlowString(input, 'string');
  if (Array.isArray(input)) return normalizationFailure('PROGRAM_VALUE_UNSUPPORTED_FORMAT', 'array', safeSample(input));
  if (typeof input === 'object') {
    const wrapper = input as Record<string, unknown>;
    for (const key of ['value', 'amount', 'netBuy', 'netAmount']) {
      if (wrapper[key] === undefined) continue;
      const normalized = normalizeProgramFlowValue(wrapper[key]);
      if (normalized.ok) {
        return { ...normalized, reason: 'PROGRAM_VALUE_OBJECT_WRAPPER', rawKind: 'object', sanitizedSample: normalized.sanitizedSample ?? safeSample(wrapper[key]) };
      }
      return { ...normalized, rawKind: 'object', sanitizedSample: normalized.sanitizedSample ?? safeSample(wrapper[key]) };
    }
    return normalizationFailure('PROGRAM_VALUE_UNSUPPORTED_FORMAT', 'object', safeSample(input));
  }
  if (typeof input === 'boolean') return normalizationFailure('PROGRAM_VALUE_UNSUPPORTED_FORMAT', 'boolean', String(input));
  return normalizationFailure('PROGRAM_VALUE_UNSUPPORTED_FORMAT', rawKind, safeSample(input));
}

function normalizeProgramFlowString(input: string, rawKind: ProgramFlowValueRawKind): ProgramFlowValueNormalizationResult {
  const trimmed = input.trim();
  const sample = safeSample(trimmed);
  if (trimmed.length === 0) return normalizationFailure('PROGRAM_VALUE_EMPTY', rawKind, sample);
  const upper = trimmed.toUpperCase();
  if (upper === 'N/A' || upper === 'NA' || upper === 'NULL') return normalizationFailure('PROGRAM_VALUE_NA', rawKind, sample);
  if (trimmed === '-' || upper === 'UNKNOWN' || upper === 'NONE' || upper === 'UNAVAILABLE') return normalizationFailure('PROGRAM_VALUE_PLACEHOLDER', rawKind, sample);
  if (/백\s*만\s*원|백만원|MILLION/i.test(trimmed)) return normalizationFailure('PROGRAM_VALUE_UNIT_STRING_MILLION', rawKind, sample);
  if (/억/i.test(trimmed)) return normalizationFailure('PROGRAM_VALUE_UNIT_STRING_EOK', rawKind, sample);
  if (/원/.test(trimmed)) {
    const withoutWon = trimmed.replace(/원/g, '').trim();
    const numeric = parsePlainProgramNumericString(withoutWon);
    if (numeric !== undefined) return { ok: true, value: numeric, reason: 'PROGRAM_VALUE_UNIT_STRING_WON', rawKind, sanitizedSample: sample, diagnosticOnly: true };
    return normalizationFailure('PROGRAM_VALUE_UNIT_STRING_WON', rawKind, sample);
  }
  const parsed = parsePlainProgramNumericString(trimmed);
  if (parsed === undefined) return normalizationFailure('PROGRAM_VALUE_UNSUPPORTED_FORMAT', rawKind, sample);
  return { ok: true, value: parsed, reason: programNumericStringReason(trimmed, parsed), rawKind, sanitizedSample: sample, diagnosticOnly: true };
}

function parsePlainProgramNumericString(value: string): number | undefined {
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function programNumericStringReason(value: string, parsed: number): ProgramFlowValueReason {
  if (parsed === 0) return 'PROGRAM_VALUE_ZERO';
  if (/,/.test(value)) return 'PROGRAM_VALUE_COMMA_NUMERIC_STRING';
  if (/^[+-]/.test(value)) return 'PROGRAM_VALUE_SIGNED_NUMERIC_STRING';
  return 'PROGRAM_VALUE_NUMERIC_STRING';
}

function normalizationFailure(
  reason: ProgramFlowValueReason,
  rawKind: ProgramFlowValueRawKind,
  sanitizedSample?: string,
): ProgramFlowValueNormalizationResult {
  return { ok: false, reason, rawKind, ...(sanitizedSample ? { sanitizedSample } : {}), diagnosticOnly: true };
}

function rawKindOf(value: unknown): ProgramFlowValueRawKind {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  return 'unknown';
}

function safeSample(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  let sample: string;
  if (typeof value === 'object' && value !== null) {
    sample = Array.isArray(value) ? '[array]' : '{object}';
  } else {
    sample = String(value);
  }
  const sanitized = sample
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{3,}-\d{2,}-\d{4,}\b/g, '[REDACTED_ID]')
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : undefined;
}
