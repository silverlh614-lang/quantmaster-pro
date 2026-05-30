/**
 * @responsibility KIS 일별 체결 조회 API를 호출해 정규화된 체결 결과를 반환하는 서비스를 제공한다.
 */

import { kisGet, KIS_IS_REAL } from '../../clients/kisClient.js';
import type { KisApiPriority } from '../../clients/kisClient.js';
import type { FillQueryOrder, FillQueryResult, FillSide } from './fillTypes.js';
import { emitOperationalWarn } from './fillOperationalWarn.js';
import { normalizeFillQueryResult } from './fillQueryNormalizer.js';
export { normalizeFillQueryResult, normalizeKisFillRows } from './fillQueryNormalizer.js';

export interface KisFillQueryServiceDeps {
  kisGet: typeof kisGet;
  isReal: boolean;
  now: () => Date;
}

export interface KisFillQueryInput extends FillQueryOrder {
  priority?: KisApiPriority;
}

const defaultDeps: KisFillQueryServiceDeps = {
  kisGet,
  isReal: KIS_IS_REAL,
  now: () => new Date(),
};

function trIdForSide(side: FillSide, isReal: boolean): string {
  if (side === 'SELL') return isReal ? 'TTTC8001R' : 'VTTC8001R';
  return isReal ? 'TTTC8001R' : 'VTTC8001R';
}

export async function queryKisFill(
  input: KisFillQueryInput,
  deps: KisFillQueryServiceDeps = defaultDeps,
): Promise<FillQueryResult> {
  try {
    const today = deps.now().toISOString().slice(0, 10).replace(/-/g, '');
    const raw = await deps.kisGet(trIdForSide(input.side, deps.isReal), '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      INQR_STRT_DT: today,
      INQR_END_DT: today,
      SLL_BUY_DVSN_CD: input.side === 'SELL' ? '01' : '02',
      INQR_DVSN: '00',
      PDNO: '',
      CCLD_DVSN: '00',
      ORD_GNO_BRNO: '',
      ODNO: '',
      INQR_DVSN_3: '00',
      INQR_DVSN_1: '',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    }, input.priority);

    const result = normalizeFillQueryResult({ order: input, raw, emptyRetryable: true });
    if (result.kind === 'EMPTY_RESPONSE') {
      emitOperationalWarn({
        code: 'P0_FILL_QUERY_EMPTY',
        message: 'KIS fill query returned empty output',
        context: {
          side: input.side,
          symbol: input.symbol,
          ordNo: input.ordNo,
          retryable: result.retryable,
        },
      });
    }
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emitOperationalWarn({
      code: 'P0_FILL_QUERY_FAILED',
      message: 'KIS fill query failed',
      context: {
        side: input.side,
        symbol: input.symbol,
        ordNo: input.ordNo,
        retryable: true,
      },
      cause: error,
    });
    return {
      kind: 'QUERY_FAILED',
      reason,
      retryable: true,
      raw: error,
    };
  }
}
