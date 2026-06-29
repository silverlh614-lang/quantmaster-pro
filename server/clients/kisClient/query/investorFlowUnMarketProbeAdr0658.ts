/**
 * @responsibility ADR-0658 종목별 투자자매매동향 'UN'(통합) observe-mode probe — J-null shadow-only 행 관찰 전용.
 *
 * J(KRX단일) 호출이 not-materialized(null)인 행에 한해 UN 으로 재조회해 unMaterialized/
 * jMissedRowRecovered/unInvalidOpsq2001 을 분류·기록한다. **LIVE 'J' 선택·gateEligible 무영향**
 * (불변식 #6/#7·ADR-0561). probe 전체 try/catch 격리 — UN 실패가 J/엔진에 절대 전파 금지(불변식 #1).
 * realDataKisGet SSOT 단일통로만 경유(불변식 #2/#9 — raw KIS 금지). OPSQ2001 분류는
 * supplyDiagnostics.classifyEndpointRootIssue 재사용(두 번째 판정 공식 금지·SRP).
 */

import { realDataKisGet } from '../http.js';
import { classifyInvestorFlowPayload } from '../payloadValidators.js';
import { classifyEndpointRootIssue } from '../supplyDiagnostics.js';
import {
  pickMaterializedBucket,
  isAcceptedEmptyKisResponse,
  extractKisNumberOptional,
} from './helpers.js';
import type { KisOutput } from './helpers.js';
import type { KisApiPriority } from '../../kisRateLimiter.js';
import {
  INVESTOR_FLOW_UN_PROBE_LEDGER_SOURCE,
  type InvestorFlowUnProbeResultAdr0658,
} from '../types.js';

/** UN(통합 — KRX+NXT) 마켓코드. J(KRX단일) 변형 — FID_COND_MRKT_DIV_CODE 만 'UN'. */
const INVESTOR_FLOW_UN_MARKET_DIV_CODE = 'UN';

const INVESTOR_FLOW_FOREIGN_NET_BUY_KEYS = ['frgn_ntby_qty', 'frgn_ntby_tr_pbmn', 'FRGN_NTBY_QTY', 'FRGN_NTBY_TR_PBMN'];
const INVESTOR_FLOW_INSTITUTION_NET_BUY_KEYS = ['orgn_ntby_qty', 'orgn_ntby_tr_pbmn', 'ORGN_NTBY_QTY', 'ORGN_NTBY_TR_PBMN'];

/**
 * ADR-0658 — J params 의 FID_COND_MRKT_DIV_CODE 만 'UN' 으로 치환한 UN probe params.
 * 나머지 필드(종목코드·일자·조정·구분)는 J 와 동일 — 동일 영업일·종목에 대한 통합 마켓 재조회.
 */
export function buildInvestorTradeByStockDailyUnParams(
  jParams: Record<string, string>,
): Record<string, string> {
  return { ...jParams, FID_COND_MRKT_DIV_CODE: INVESTOR_FLOW_UN_MARKET_DIV_CODE };
}

function jMissedRowHasNetBuy(rows: KisOutput[]): boolean {
  const row = rows[0];
  if (!row) return false;
  const foreign = extractKisNumberOptional(row, INVESTOR_FLOW_FOREIGN_NET_BUY_KEYS);
  const institution = extractKisNumberOptional(row, INVESTOR_FLOW_INSTITUTION_NET_BUY_KEYS);
  return foreign !== undefined || institution !== undefined;
}

function baseProbeResult(stockCode: string, probedDate?: string): InvestorFlowUnProbeResultAdr0658 {
  return {
    unMaterialized: false,
    jMissedRowRecovered: false,
    unInvalidOpsq2001: false,
    marketSignal: false,
    executionImpact: 'NONE',
    providerIssue: false,
    stockCode,
    ...(probedDate ? { probedDate } : {}),
    observedAt: new Date().toISOString(),
  };
}

/**
 * J-null shadow-only 행에 한해 UN 재조회 — 관찰 산출물만 반환(LIVE 선택·반환값 무변경).
 *
 * - probe 전체 try/catch 격리 — UN 실패(network/throw)가 절대 전파 안 됨(불변식 #1). 실패 시
 *   providerIssue=true 의 격리 결과 반환(throw 금지).
 * - UN OPSQ2001 INVALID 는 classifyEndpointRootIssue 재사용으로 'PARAM_ERROR' 판정 시 분류 기록
 *   (Silent Catch 금지 — UN 미지원 확정 증거).
 * - marketSignal/executionImpact 는 literal 고정(불변식 #6 — bearish 변환 금지).
 *
 * @param trId  J 호출과 동일 TR ID
 * @param apiPath  J 호출과 동일 path
 * @param jParams  J params(FID_COND_MRKT_DIV_CODE='J') — 본 함수가 'UN' 으로 변형
 * @param stockCode  6자리 zero-padded 종목코드
 */
export async function probeInvestorFlowUnMarket(input: {
  trId: string;
  apiPath: string;
  jParams: Record<string, string>;
  stockCode: string;
  priority: KisApiPriority;
}): Promise<InvestorFlowUnProbeResultAdr0658> {
  const probedDate = input.jParams.FID_INPUT_DATE_1;
  const result = baseProbeResult(input.stockCode, probedDate);
  try {
    const unParams = buildInvestorTradeByStockDailyUnParams(input.jParams);
    const data = await realDataKisGet(input.trId, input.apiPath, unParams, input.priority);

    const rootIssue = classifyEndpointRootIssue(data, 'INVESTOR_TRADE_BY_STOCK_DAILY');
    if (rootIssue === 'PARAM_ERROR') {
      // UN 이 OPSQ2001 INVALID FID_COND_MRKT_DIV_CODE 반환 → UN 미지원 확정 증거(swallow 금지).
      result.unInvalidOpsq2001 = true;
      result.providerIssue = true;
      return result;
    }

    if (isAcceptedEmptyKisResponse(data)) {
      // UN 도 빈 응답 — J 가 못 잡은 행을 UN 도 못 잡음(materialize 실패).
      return result;
    }

    const selected = pickMaterializedBucket(
      data,
      ['output2', 'output', 'output1'],
      (rows) => classifyInvestorFlowPayload(rows, { trId: input.trId }),
    );
    const rows = selected?.rows ?? [];
    const payloadClass = classifyInvestorFlowPayload(rows, { trId: input.trId });
    result.unMaterialized = payloadClass.materialized && rows.length > 0;
    result.jMissedRowRecovered = result.unMaterialized && jMissedRowHasNetBuy(rows);
    return result;
  } catch {
    // 불변식 #1 — UN 실패가 J 결과·엔진에 절대 전파 금지. 격리 후 providerIssue=true 로만 분류.
    result.providerIssue = true;
    return result;
  }
}

// ─── observe ledger stamp (ADR-0476 라인·source=INVESTOR_FLOW_UN_PROBE) ────────────
// query 레이어는 signalScanner 도메인 ledger 를 import 하지 않는다(레이어 역전 금지). UN probe
// 관찰 행은 본 모듈의 in-process 버퍼에 source 키로 stamp 하고, 구조화 TELEMETRY 로그로
// 노출한다. scan 진단 경로가 drain 하여 ADR-0476 observe ledger 로 합류한다(downstream).
const unProbeObserveLedger: InvestorFlowUnProbeResultAdr0658[] = [];
const UN_PROBE_OBSERVE_LEDGER_MAX = 200;

function formatUnProbeStamp(result: InvestorFlowUnProbeResultAdr0658): string {
  return `source=${INVESTOR_FLOW_UN_PROBE_LEDGER_SOURCE} stockCode=${result.stockCode} `
    + `unMaterialized=${result.unMaterialized} jMissedRowRecovered=${result.jMissedRowRecovered} `
    + `unInvalidOpsq2001=${result.unInvalidOpsq2001} providerIssue=${result.providerIssue} `
    + `marketSignal=${result.marketSignal} executionImpact=${result.executionImpact} `
    + `probedDate=${result.probedDate ?? 'NONE'} logClass=TELEMETRY`;
}

/** UN probe 결과를 observe ledger 에 stamp — 관측 전용(LIVE 무영향). */
export function stampInvestorFlowUnProbeObservation(result: InvestorFlowUnProbeResultAdr0658): void {
  unProbeObserveLedger.push(result);
  if (unProbeObserveLedger.length > UN_PROBE_OBSERVE_LEDGER_MAX) {
    unProbeObserveLedger.splice(0, unProbeObserveLedger.length - UN_PROBE_OBSERVE_LEDGER_MAX);
  }
  console.info(`[KIS] investorFlow UN probe ${formatUnProbeStamp(result)}`);
}

export const __investorFlowUnProbeTestOnly = {
  drainObserveLedger(): InvestorFlowUnProbeResultAdr0658[] {
    const rows = [...unProbeObserveLedger];
    unProbeObserveLedger.length = 0;
    return rows;
  },
  peekObserveLedger(): readonly InvestorFlowUnProbeResultAdr0658[] {
    return unProbeObserveLedger;
  },
  reset(): void {
    unProbeObserveLedger.length = 0;
  },
};
