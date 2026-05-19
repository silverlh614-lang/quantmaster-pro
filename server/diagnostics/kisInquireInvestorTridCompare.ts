// @responsibility KIS inquire-investor TR_ID comparison diagnostic.
import {
  realDataKisGet,
} from '../clients/kisClient/http.js';
import { HAS_REAL_DATA_CLIENT } from '../clients/kisClient/constants.js';

export type KisInquireInvestorTridVariant = 'LEGACY_01010300' | 'OFFICIAL_01010900';

export interface KisInquireInvestorTridCompareInput {
  code: string;
  marketDivCode?: string;
  dryRun?: boolean;
}

export interface KisInquireInvestorTridVariantResult {
  variant: KisInquireInvestorTridVariant;
  trId: string;
  path: string;
  attempted: boolean;
  ok: boolean;
  httpStatus?: number;
  rtCd?: string | null;
  msgCd?: string | null;
  msg1?: string | null;
  outputBucket?: string | null;
  outputEmpty: boolean;
  outputType: 'ARRAY' | 'OBJECT' | 'EMPTY' | 'UNKNOWN';
  fieldKeys: string[];
  numericFieldKeys: string[];
  semanticCandidateKeys: {
    foreignKeys: string[];
    institutionKeys: string[];
    programKeys: string[];
    netBuyKeys: string[];
  };
  sampleOutput?: Record<string, unknown> | null;
  error?: string;
}

export interface KisInquireInvestorTridCompareResult {
  code: string;
  marketDivCode: string;
  path: string;
  executionImpact: 'NONE';
  useScope: 'DIAGNOSTIC_ONLY';
  providerIssueMeansMarketSignal: false;
  comparedAt: string;
  legacy: KisInquireInvestorTridVariantResult;
  official: KisInquireInvestorTridVariantResult;
  summary: {
    bothOk: boolean;
    officialOk: boolean;
    legacyOk: boolean;
    sameOutputShape: boolean;
    bothEmpty: boolean;
    officialHasMoreFields: boolean;
    legacyHasMoreFields: boolean;
    recommendedNextAction:
      | 'KEEP_LEGACY'
      | 'CONSIDER_OFFICIAL'
      | 'NEED_FIELD_MAPPING_REVIEW'
      | 'BOTH_EMPTY'
      | 'BOTH_FAILED'
      | 'DO_NOT_CHANGE';
    reason: string;
  };
}

export const INQUIRE_INVESTOR_PATH = '/uapi/domestic-stock/v1/quotations/inquire-investor';
export const LEGACY_TR_ID = 'FHKST01010300';
export const OFFICIAL_TR_ID = 'FHKST01010900';

type OutputType = KisInquireInvestorTridVariantResult['outputType'];
type SemanticCandidateKeys = KisInquireInvestorTridVariantResult['semanticCandidateKeys'];

interface OutputProbe {
  bucket: string | null;
  empty: boolean;
  type: OutputType;
  sample: Record<string, unknown> | null;
}

const OUTPUT_BUCKETS = [
  'output',
  'output1',
  'output2',
  'output3',
  'response.output',
  'body.output',
] as const;

const SENSITIVE_KEY_RE = /token|secret|appkey|appsecret|authorization|account|acnt|cano|password/i;

function emptySemanticCandidateKeys(): SemanticCandidateKeys {
  return {
    foreignKeys: [],
    institutionKeys: [],
    programKeys: [],
    netBuyKeys: [],
  };
}

function baseVariantResult(
  variant: KisInquireInvestorTridVariant,
  trId: string,
  patch: Partial<KisInquireInvestorTridVariantResult> = {},
): KisInquireInvestorTridVariantResult {
  return {
    variant,
    trId,
    path: INQUIRE_INVESTOR_PATH,
    attempted: false,
    ok: false,
    rtCd: null,
    msgCd: null,
    msg1: null,
    outputBucket: null,
    outputEmpty: true,
    outputType: 'EMPTY',
    fieldKeys: [],
    numericFieldKeys: [],
    semanticCandidateKeys: emptySemanticCandidateKeys(),
    sampleOutput: null,
    ...patch,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function readPath(root: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, root);
}

function probeOutputValue(bucket: string, value: unknown): OutputProbe {
  if (Array.isArray(value)) {
    const firstRecord = value.find(isRecord) ?? null;
    return {
      bucket,
      empty: value.length === 0,
      type: 'ARRAY',
      sample: firstRecord,
    };
  }

  if (isRecord(value)) {
    return {
      bucket,
      empty: Object.keys(value).length === 0,
      type: 'OBJECT',
      sample: value,
    };
  }

  if (value === null || value === undefined) {
    return {
      bucket,
      empty: true,
      type: 'EMPTY',
      sample: null,
    };
  }

  return {
    bucket,
    empty: false,
    type: 'UNKNOWN',
    sample: null,
  };
}

function findOutput(root: Record<string, unknown>): OutputProbe {
  const probes = OUTPUT_BUCKETS
    .map((bucket) => ({ bucket, value: readPath(root, bucket) }))
    .filter(({ value }) => value !== undefined)
    .map(({ bucket, value }) => probeOutputValue(bucket, value));

  return probes.find((probe) => !probe.empty) ?? probes[0] ?? {
    bucket: null,
    empty: true,
    type: 'EMPTY',
    sample: null,
  };
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const normalized = value.trim().replace(/,/g, '');
  if (normalized.length === 0) return false;
  return Number.isFinite(Number(normalized));
}

function collectSemanticCandidateKeys(fieldKeys: string[]): SemanticCandidateKeys {
  const semantic = emptySemanticCandidateKeys();
  for (const key of fieldKeys) {
    const lower = key.toLowerCase();
    if (/(foreign|frgn|외국|외인)/i.test(lower)) semantic.foreignKeys.push(key);
    if (/(institution|inst|org|기관)/i.test(lower)) semantic.institutionKeys.push(key);
    if (/(program|prgm|프로그램)/i.test(lower)) semantic.programKeys.push(key);
    if (/(net|buy|sell|ntby|순매수|매수|매도)/i.test(lower)) semantic.netBuyKeys.push(key);
  }
  return semantic;
}

function sampleOutput(sample: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!sample) return null;
  const limited = Object.entries(sample).slice(0, 30).map(([key, value]) => [
    key,
    SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : value,
  ]);
  return Object.fromEntries(limited);
}

function sanitizeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const key of [
    'KIS_APP_KEY',
    'KIS_APP_SECRET',
    'KIS_REAL_DATA_APP_KEY',
    'KIS_REAL_DATA_APP_SECRET',
    'KIS_ACCESS_TOKEN',
  ]) {
    const value = process.env[key];
    if (value && value.length >= 4) message = message.split(value).join('[REDACTED]');
  }
  return message;
}

function analyzeResponse(
  variant: KisInquireInvestorTridVariant,
  trId: string,
  data: Record<string, unknown>,
): KisInquireInvestorTridVariantResult {
  const output = findOutput(data);
  const sample = output.sample;
  const fieldKeys = sample ? Object.keys(sample) : [];
  const numericFieldKeys = sample
    ? fieldKeys.filter((key) => isNumericValue(sample[key]))
    : [];
  const rtCd = nullableString(data.rt_cd);
  const msgCd = nullableString(data.msg_cd);
  const msg1 = nullableString(data.msg1);

  return baseVariantResult(variant, trId, {
    attempted: true,
    ok: rtCd === '0' || (rtCd === null && !output.empty),
    rtCd,
    msgCd,
    msg1,
    outputBucket: output.bucket,
    outputEmpty: output.empty,
    outputType: output.type,
    fieldKeys,
    numericFieldKeys,
    semanticCandidateKeys: collectSemanticCandidateKeys(fieldKeys),
    sampleOutput: sampleOutput(sample),
  });
}

async function runVariant(
  variant: KisInquireInvestorTridVariant,
  trId: string,
  code: string,
  marketDivCode: string,
  dryRun: boolean,
): Promise<KisInquireInvestorTridVariantResult> {
  if (dryRun) {
    return baseVariantResult(variant, trId);
  }

  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) {
    return baseVariantResult(variant, trId, {
      error: 'KIS_APP_KEY missing; no KIS request was sent',
    });
  }

  try {
    const data = await realDataKisGet(
      trId,
      INQUIRE_INVESTOR_PATH,
      {
        FID_COND_MRKT_DIV_CODE: marketDivCode,
        FID_INPUT_ISCD: code,
      },
      'LOW',
    );

    if (!isRecord(data)) {
      return baseVariantResult(variant, trId, {
        attempted: true,
        error: 'KIS response was empty or unavailable',
      });
    }

    return analyzeResponse(variant, trId, data);
  } catch (error) {
    return baseVariantResult(variant, trId, {
      attempted: true,
      error: sanitizeErrorMessage(error),
    });
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const right = new Set(b);
  return a.every((key) => right.has(key));
}

function summarize(
  legacy: KisInquireInvestorTridVariantResult,
  official: KisInquireInvestorTridVariantResult,
): KisInquireInvestorTridCompareResult['summary'] {
  const bothOk = legacy.ok && official.ok;
  const officialOk = official.ok;
  const legacyOk = legacy.ok;
  const sameOutputShape = sameSet(legacy.fieldKeys, official.fieldKeys);
  const bothEmpty = legacy.outputEmpty && official.outputEmpty;
  const officialHasMoreFields = official.fieldKeys.length > legacy.fieldKeys.length;
  const legacyHasMoreFields = legacy.fieldKeys.length > official.fieldKeys.length;

  if (!legacyOk && !officialOk) {
    return {
      bothOk,
      officialOk,
      legacyOk,
      sameOutputShape,
      bothEmpty,
      officialHasMoreFields,
      legacyHasMoreFields,
      recommendedNextAction: 'BOTH_FAILED',
      reason: 'Both TR_IDs failed or returned unavailable responses. Do not change runtime mapping.',
    };
  }

  if (bothEmpty) {
    return {
      bothOk,
      officialOk,
      legacyOk,
      sameOutputShape,
      bothEmpty,
      officialHasMoreFields,
      legacyHasMoreFields,
      recommendedNextAction: 'BOTH_EMPTY',
      reason: 'Both returned empty output. This may be valid market, session, or provider behavior, not a bearish signal.',
    };
  }

  if (legacyOk && !officialOk) {
    return {
      bothOk,
      officialOk,
      legacyOk,
      sameOutputShape,
      bothEmpty,
      officialHasMoreFields,
      legacyHasMoreFields,
      recommendedNextAction: 'KEEP_LEGACY',
      reason: 'Legacy TR_ID returned OK while official did not. Keep legacy until official behavior is reviewed.',
    };
  }

  if (!legacyOk && officialOk) {
    return {
      bothOk,
      officialOk,
      legacyOk,
      sameOutputShape,
      bothEmpty,
      officialHasMoreFields,
      legacyHasMoreFields,
      recommendedNextAction: 'CONSIDER_OFFICIAL',
      reason: 'Official returned OK while legacy did not. Compare semantic fields before migration.',
    };
  }

  if (bothOk && sameOutputShape) {
    return {
      bothOk,
      officialOk,
      legacyOk,
      sameOutputShape,
      bothEmpty,
      officialHasMoreFields,
      legacyHasMoreFields,
      recommendedNextAction: 'CONSIDER_OFFICIAL',
      reason: 'Both TR_IDs returned OK with the same output shape. Official TR_ID can be considered after field-level regression.',
    };
  }

  if (bothOk && !sameOutputShape) {
    return {
      bothOk,
      officialOk,
      legacyOk,
      sameOutputShape,
      bothEmpty,
      officialHasMoreFields,
      legacyHasMoreFields,
      recommendedNextAction: 'NEED_FIELD_MAPPING_REVIEW',
      reason: 'Both TR_IDs returned OK but field shapes differ. Review field mapping before any runtime change.',
    };
  }

  return {
    bothOk,
    officialOk,
    legacyOk,
    sameOutputShape,
    bothEmpty,
    officialHasMoreFields,
    legacyHasMoreFields,
    recommendedNextAction: 'DO_NOT_CHANGE',
    reason: 'Diagnostic result is inconclusive. Do not change runtime mapping.',
  };
}

function dryRunSummary(): KisInquireInvestorTridCompareResult['summary'] {
  return {
    bothOk: false,
    officialOk: false,
    legacyOk: false,
    sameOutputShape: true,
    bothEmpty: true,
    officialHasMoreFields: false,
    legacyHasMoreFields: false,
    recommendedNextAction: 'DO_NOT_CHANGE',
    reason: 'dryRun enabled; no KIS request was sent',
  };
}

export async function compareKisInquireInvestorTrid(
  input: KisInquireInvestorTridCompareInput,
): Promise<KisInquireInvestorTridCompareResult> {
  const code = input.code.trim().padStart(6, '0');
  const marketDivCode = input.marketDivCode?.trim() || 'J';
  const dryRun = input.dryRun === true;

  const legacy = await runVariant('LEGACY_01010300', LEGACY_TR_ID, code, marketDivCode, dryRun);
  const official = await runVariant('OFFICIAL_01010900', OFFICIAL_TR_ID, code, marketDivCode, dryRun);

  return {
    code,
    marketDivCode,
    path: INQUIRE_INVESTOR_PATH,
    executionImpact: 'NONE',
    useScope: 'DIAGNOSTIC_ONLY',
    providerIssueMeansMarketSignal: false,
    comparedAt: new Date().toISOString(),
    legacy,
    official,
    summary: dryRun ? dryRunSummary() : summarize(legacy, official),
  };
}
