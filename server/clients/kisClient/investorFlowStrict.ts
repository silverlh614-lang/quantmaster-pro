/**
 * @responsibility Strict KIS investor-flow parser that blocks field-missing zero fallback.
 *
 * KIS `FHKST01010300 / inquire-investor` can return a normal rt_cd=0 payload with
 * `output: array(...)` containing price/time fields such as `stck_prpr` and `cntg_vol`,
 * not investor net-buy fields. The legacy parser converted missing investor fields to
 * 0 and made `/sh` report `success 10/10, zero-filled 10/10`.
 *
 * This module keeps the old public function name via the barrel export, but returns
 * null when required investor fields are missing. Missing fields mean unusable data,
 * not real zero supply.
 */

import { HAS_REAL_DATA_CLIENT } from './constants.js';
import { realDataKisGet } from './http.js';
import { getKisOverrides } from './overrides.js';
import type { KisInvestorFlow } from './types.js';
import type { KisApiPriority } from '../kisRateLimiter.js';

type KisOutput = Record<string, string>;

const INVESTOR_FLOW_TR_ID = process.env.KIS_INVESTOR_FLOW_TR_ID ?? 'FHKST01010300';
const INVESTOR_FLOW_PATH =
  process.env.KIS_INVESTOR_FLOW_PATH
  ?? '/uapi/domestic-stock/v1/quotations/inquire-investor';

function pickKisOutput(data: unknown): KisOutput | undefined {
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown } | null;
  if (root?.output && typeof root.output === 'object' && !Array.isArray(root.output)) return root.output as KisOutput;
  if (Array.isArray(root?.output) && root.output.length > 0 && typeof root.output[0] === 'object') return root.output[0] as KisOutput;
  if (root?.output1 && typeof root.output1 === 'object' && !Array.isArray(root.output1)) return root.output1 as KisOutput;
  if (Array.isArray(root?.output1) && root.output1.length > 0 && typeof root.output1[0] === 'object') return root.output1[0] as KisOutput;
  if (Array.isArray(root?.output2) && root.output2.length > 0 && typeof root.output2[0] === 'object') return root.output2[0] as KisOutput;
  return undefined;
}

function maybeKisNumber(out: KisOutput, keys: string[]): number | null {
  for (const key of keys) {
    const raw = out[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function fetchKisInvestorFlow(
  code: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisInvestorFlow | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisInvestorFlow) return overrides.fetchKisInvestorFlow(code);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;

  try {
    const data = await realDataKisGet(
      INVESTOR_FLOW_TR_ID,
      INVESTOR_FLOW_PATH,
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code.padStart(6, '0'),
      },
      priority,
    );
    const out = pickKisOutput(data);
    if (!out) return null;

    const foreignNetBuy = maybeKisNumber(out, ['frgn_ntby_qty', 'FRGN_NETBUY_QTY']);
    const institutionalNetBuy = maybeKisNumber(out, ['orgn_ntby_qty', 'INST_NETBUY_QTY']);
    const individualNetBuy = maybeKisNumber(out, ['prsn_ntby_qty', 'INDV_NETBUY_QTY']);

    if (foreignNetBuy === null || institutionalNetBuy === null || individualNetBuy === null) {
      console.warn('[KIS] investor flow fields missing; suppress zero fallback', {
        code,
        trId: INVESTOR_FLOW_TR_ID,
        path: INVESTOR_FLOW_PATH,
        outputKeys: Object.keys(out).slice(0, 12),
      });
      return null;
    }

    return {
      foreignNetBuy,
      institutionalNetBuy,
      individualNetBuy,
      source: 'KIS_API',
    };
  } catch {
    return null;
  }
}
