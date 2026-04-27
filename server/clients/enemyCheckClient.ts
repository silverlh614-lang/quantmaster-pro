// @responsibility enemyCheckClient 외부 클라이언트 모듈
/**
 * enemyCheckClient.ts — 역검증(Enemy Checklist) 데이터 수집
 *
 * Gate 통과 종목에 대해 "팔아야 할 이유"를 역방향으로 검증.
 * 현재는 관찰 레이어만 구현 — Telegram 승인 메시지에 참고 정보로만 표시.
 * 자동 감점/차단은 모의매매 데이터가 충분히 쌓인 후 유효성 검증 시 도입 예정.
 *
 * 수집 항목:
 *   신용잔고율    — KIS FHKST01010100 (cred_vals)  → 레버리지 잠재 매도 압력
 *   개인 지배 비중 — KIS FHKST01010300              → 스마트머니 이탈 신호
 *
 * 캐시 TTL: 10분 (장중 갱신 주기)
 */

import { realDataKisGet, HAS_REAL_DATA_CLIENT } from './kisClient.js';

export interface EnemyCheckResult {
  /** 신용잔고율 (%) — KIS FHKST01010100 cred_vals */
  creditRate: number | null;
  /** 개인 순매수 절대값 / 전체 순매수 절대값 합산 (%) — 스마트머니 이탈 지표 */
  individualDominance: number | null;
  /** 데이터 신뢰도 */
  source: 'KIS_FULL' | 'KIS_PARTIAL' | 'UNAVAILABLE';
}

const _cache = new Map<string, { data: EnemyCheckResult; exp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

/**
 * 주어진 종목의 역검증 데이터를 KIS API로 수집한다.
 * KIS 미설정 또는 오류 시 UNAVAILABLE 반환 (진입 차단 없음).
 */
export async function fetchEnemyCheckData(code: string): Promise<EnemyCheckResult> {
  const key = code.padStart(6, '0');
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.exp) return hit.data;

  const empty: EnemyCheckResult = {
    creditRate: null,
    individualDominance: null,
    source: 'UNAVAILABLE',
  };

  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) {
    return empty;
  }

  let creditRate: number | null = null;
  let individualDominance: number | null = null;
  let hitCount = 0;

  try {
    // ── FHKST01010100: 주식현재가 (신용잔고율 포함) ──────────────────────
    const priceData = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: key },
    );
    const priceOut = (priceData as { output?: Record<string, string> } | null)?.output;
    if (priceOut) {
      const raw = parseFloat(priceOut['cred_vals'] ?? '0');
      if (!isNaN(raw) && raw >= 0) {
        creditRate = raw;
        hitCount++;
      }
    }
  } catch {
    // KIS 일시 장애 — 해당 항목만 null 유지
  }

  try {
    // ── FHKST01010300: 투자자별 순매수 ─────────────────────────────────
    const flowData = await realDataKisGet(
      'FHKST01010300',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: key },
    );
    const flowOut = (flowData as { output?: Record<string, string> } | null)?.output;
    if (flowOut) {
      const foreignNet = parseInt(flowOut['frgn_ntby_qty'] ?? '0', 10);
      const instNet    = parseInt(flowOut['orgn_ntby_qty']  ?? '0', 10);
      const indivNet   = parseInt(flowOut['prsn_ntby_qty']  ?? '0', 10);
      const totalAbs = Math.abs(foreignNet) + Math.abs(instNet) + Math.abs(indivNet);
      if (totalAbs > 0) {
        individualDominance = (Math.abs(indivNet) / totalAbs) * 100;
        hitCount++;
      }
    }
  } catch {
    // KIS 일시 장애 — 해당 항목만 null 유지
  }

  const result: EnemyCheckResult = {
    creditRate,
    individualDominance,
    source: hitCount >= 2 ? 'KIS_FULL' : hitCount === 1 ? 'KIS_PARTIAL' : 'UNAVAILABLE',
  };

  _cache.set(key, { data: result, exp: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * 역검증 데이터를 한 줄 요약 문자열로 반환 (Telegram HTML 용).
 * 경고 임계값 초과 시 ⚠️ 표시.
 */
export function formatEnemyCheckSummary(e: EnemyCheckResult): string | null {
  if (e.source === 'UNAVAILABLE') return null;

  const lines: string[] = [];

  if (e.creditRate !== null) {
    const warn = e.creditRate > 8 ? ' ⚠️⚠️' : e.creditRate > 5 ? ' ⚠️' : '';
    lines.push(`신용잔고율: ${e.creditRate.toFixed(1)}%${warn}`);
  }

  if (e.individualDominance !== null) {
    const warn = e.individualDominance > 80 ? ' ⚠️⚠️' : e.individualDominance > 70 ? ' ⚠️' : '';
    lines.push(`개인 비중: ${e.individualDominance.toFixed(0)}%${warn}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
