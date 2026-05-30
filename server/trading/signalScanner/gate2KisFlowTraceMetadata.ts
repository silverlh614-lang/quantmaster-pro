/**
 * @responsibility Gate2 KIS investor-flow trace 표시용 canonical apiPath/trId SSOT 헬퍼.
 * 표시 전용 — kisClient/외부 KIS/KRX 호출 0건, 매매/스코어 무영향.
 */

export const KIS_INVESTOR_FLOW_CANONICAL = {
  apiPath: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
  trId: 'FHPTJ04160001',
  sourceProvider: 'KIS_API',
} as const;

const UNKNOWN_METADATA = 'UNKNOWN_METADATA_NOT_CARRIED';
const TRACE_BREAK_POINT_METADATA_DROPPED = 'PROVIDER_METADATA_DROPPED_AFTER_ROUTER';
const TRACE_BREAK_POINT_METADATA_CARRIED_OK = 'METADATA_CARRIED_OK';
const NOT_APPLICABLE_KRX = 'NOT_APPLICABLE_KRX_PROVIDER';

const KRX_PROVIDER_PATTERN = /KRX/i;

export type Gate2KisFlowUseScope =
  | 'GATE_SCORE_ELIGIBLE'
  | 'SHADOW_ONLY_NEUTRAL_UNKNOWN'
  | 'DIAGNOSTIC_ONLY';

export interface BuildKisFlowTraceInput {
  /** router 가 선택한 provider (예: 'KIS_API' | 'KRX' | 'KRX_API' | 'NONE'). */
  selectedProvider: string | null | undefined;
  /** router 가 실제로 carry 한 KIS apiPath. 미carry 시 undefined/null. */
  apiPath?: string | null;
  /** router 가 실제로 carry 한 KIS trId. 미carry 시 undefined/null. */
  trId?: string | null;
  /** KRX 계열일 때 endpoint(BLD) 표기용. */
  krxEndpoint?: string | null;
  /** selected actual row path (router selectedActualRowPath 등). */
  selectedRowPath?: string | null;
  /** selected actual field keys. */
  selectedFieldKeys?: readonly string[] | null;
  /** gate semantic flat row 의 외인 순매수. */
  foreignNetBuy?: number | null;
  /** gate semantic flat row 의 기관 순매수. */
  institutionNetBuy?: number | null;
  /** 표시용 use scope. 'GATE_SCORE_ELIGIBLE' 가 아니면 diagnosticOnly=true. */
  useScope: Gate2KisFlowUseScope;
  /**
   * canonical resolver(runtimeResolverTraceStep26) 가 산출한 metadata carry 불변식 신호.
   * 'OK' = canonical apiPath/trId 가 SSOT 로 알려진 truth (KIS_API). 이 경우 router 가 apiPath/trId
   * 를 carry 하지 않았더라도 UNKNOWN_METADATA_NOT_CARRIED 마커를 top-level apiPath/trId 에 부착하지
   * 않고 canonical 단일 truth 만 출력한다 (표시 전용 — 산출/게이팅 무영향). undefined/'MISSING' 면 기존 분기.
   */
  metadataCarryInvariant?: 'OK' | 'MISSING';
}

function isKrxProvider(provider: string | null | undefined): boolean {
  return typeof provider === 'string' && KRX_PROVIDER_PATTERN.test(provider);
}

function isKisProvider(provider: string | null | undefined): boolean {
  return provider === 'KIS_API';
}

function fieldKeysText(keys: readonly string[] | null | undefined): string {
  if (!keys || keys.length === 0) return '[]';
  return `[${keys.join('|')}]`;
}

function numText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'UNKNOWN';
}

/**
 * Gate2 KIS investor-flow trace 필드를 `- key=value` 문자열 배열로 구성한다.
 *
 * 분기:
 *  - KIS_API & canonical metadataCarryInvariant=OK → canonical apiPath/trId 를 마커 없는 단일 truth
 *    로 출력 + traceBreakPoint=METADATA_CARRIED_OK. router 가 apiPath/trId 를 carry 안 했어도
 *    legacy drop 사실은 diagnosticLegacyMetadataDrop 하위필드로만 부기(top-level 마커 부착 금지).
 *  - KIS_API & metadata 미carry(canonical 신호 없음/MISSING) → apiPath/trId=canonical(;UNKNOWN_METADATA_NOT_CARRIED)
 *    + traceBreakPoint=PROVIDER_METADATA_DROPPED_AFTER_ROUTER + canonical 참조값 동시 표기(기존 동작 보존).
 *  - KRX 계열 → apiPath 위치에 endpoint(BLD) 표기, trId=NOT_APPLICABLE_KRX_PROVIDER.
 *  - metadata 정상 carry → 호출자가 넘긴 실제 apiPath/trId 표기.
 *
 * executionImpact 는 항상 'NONE'. providerIssue→marketSignal 변환 절대 금지 (표시 전용).
 */
export function buildKisFlowTraceFields(input: BuildKisFlowTraceInput): string[] {
  const provider = input.selectedProvider ?? 'UNKNOWN';
  const diagnosticOnly = input.useScope !== 'GATE_SCORE_ELIGIBLE';

  let apiPathValue: string;
  let trIdValue: string;
  let traceBreakPoint: string | null = null;
  let emitCanonical = false;
  let legacyMetadataDrop = false;

  if (isKrxProvider(provider)) {
    apiPathValue = input.krxEndpoint && input.krxEndpoint.length > 0 ? input.krxEndpoint : UNKNOWN_METADATA;
    trIdValue = NOT_APPLICABLE_KRX;
  } else if (isKisProvider(provider)) {
    const hasApiPath = typeof input.apiPath === 'string' && input.apiPath.length > 0;
    const hasTrId = typeof input.trId === 'string' && input.trId.length > 0;
    if (hasApiPath && hasTrId) {
      apiPathValue = input.apiPath as string;
      trIdValue = input.trId as string;
    } else if (input.metadataCarryInvariant === 'OK') {
      // P1: canonical resolver 가 metadataCarryInvariant=OK 로 단언했으면 canonical apiPath/trId 는
      // SSOT truth 다. router 가 apiPath/trId 를 carry 하지 않았더라도 top-level apiPath/trId 에는
      // UNKNOWN_METADATA_NOT_CARRIED 마커를 절대 붙이지 않고 canonical 단일 truth 만 출력한다.
      // traceBreakPoint=METADATA_CARRIED_OK 로 carry 정상을 명시. legacy drop 사실(있다면)은
      // diagnosticLegacyMetadataDrop 하위필드로만 부기(user-facing 모순 출력 방지). 표시 전용.
      apiPathValue = KIS_INVESTOR_FLOW_CANONICAL.apiPath;
      trIdValue = KIS_INVESTOR_FLOW_CANONICAL.trId;
      traceBreakPoint = TRACE_BREAK_POINT_METADATA_CARRIED_OK;
      legacyMetadataDrop = !hasApiPath || !hasTrId;
    } else {
      // canonical 신호 없음/MISSING — metadata drop 시 apiPath/trId 를 bare UNKNOWN 으로 두지 않고
      // canonical 값을 참조(METADATA_NOT_CARRIED 마커 부기). traceBreakPoint 로 drop 사실 별도 노출.
      apiPathValue = `${KIS_INVESTOR_FLOW_CANONICAL.apiPath} (canonical;${UNKNOWN_METADATA})`;
      trIdValue = `${KIS_INVESTOR_FLOW_CANONICAL.trId} (canonical;${UNKNOWN_METADATA})`;
      traceBreakPoint = TRACE_BREAK_POINT_METADATA_DROPPED;
      emitCanonical = true;
    }
  } else {
    // 그 외 provider(NONE/NAVER 등) — 실제 carry 값이 있으면 표기, 없으면 UNKNOWN.
    apiPathValue = typeof input.apiPath === 'string' && input.apiPath.length > 0 ? input.apiPath : UNKNOWN_METADATA;
    trIdValue = typeof input.trId === 'string' && input.trId.length > 0 ? input.trId : UNKNOWN_METADATA;
  }

  const fields: string[] = [
    `- apiPath=${apiPathValue}`,
    `- trId=${trIdValue}`,
    `- sourceProvider=${provider}`,
    `- selectedRowPath=${input.selectedRowPath ?? 'NONE'}`,
    `- selectedFieldKeys=${fieldKeysText(input.selectedFieldKeys)}`,
    `- foreignNetBuy=${numText(input.foreignNetBuy)}`,
    `- institutionNetBuy=${numText(input.institutionNetBuy)}`,
    `- useScope=${input.useScope}`,
    `- diagnosticOnly=${diagnosticOnly ? 'true' : 'false'}`,
    '- executionImpact=NONE',
  ];

  if (traceBreakPoint) {
    fields.push(`- traceBreakPoint=${traceBreakPoint}`);
  }
  if (legacyMetadataDrop) {
    // 하위 진단 필드(표시 부기 전용) — top-level apiPath/trId 에는 마커를 붙이지 않으므로
    // canonical OK 단일 truth 와 모순 없음. 실행/게이팅 0 소비.
    fields.push('- diagnosticLegacyMetadataDrop=apiPathTrIdNotCarriedByRouter');
  }
  if (emitCanonical) {
    fields.push(`- canonicalApiPath=${KIS_INVESTOR_FLOW_CANONICAL.apiPath}`);
    fields.push(`- canonicalTrId=${KIS_INVESTOR_FLOW_CANONICAL.trId}`);
  }

  return fields;
}
