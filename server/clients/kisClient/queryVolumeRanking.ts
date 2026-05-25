/**
 * @responsibility KIS 거래량순위 (FHPST01710000) — KOSPI+KOSDAQ 거래 가능 종목 실시간 스캔
 *
 * ADR-0519 Phase 5: KRX 파일 의존 대체 후보. KIS volume-rank로 거래 활발 종목 유니버스 구성.
 * fid_trgt_exls_cls_code로 ETF/ETN/SPAC/관리종목/거래정지 자동 제외.
 * executionImpact=NONE (universeScanner feature flag 뒤에서 사용 예정).
 */

import { realDataKisGet } from './http.js';
import { logger } from '../../utils/logger.js';

const API_PATH = '/uapi/domestic-stock/v1/quotations/volume-rank';
const TR_ID = 'FHPST01710000';

export interface KisVolumeRankEntry {
  code: string;        // 종목코드 (6자리)
  name: string;        // 한글 종목명
  currentPrice: number; // 현재가
  volume: number;      // 거래량
  changePercent: number; // 전일 대비율 (%)
  marketCode: 'J';     // 현재는 KRX만 지원
}

interface KisVolumeRankRawRow {
  mksc_shrn_iscd?: string; // 종목코드
  hts_kor_isnm?: string;   // 한글 종목명
  stck_prpr?: string;      // 현재가
  acml_vol?: string;       // 누적 거래량
  prdy_ctrt?: string;      // 전일 대비율
}

/**
 * KIS 거래량순위 조회 (KOSPI+KOSDAQ 통합, 보통주 한정).
 *
 * 기본 제외: 투자위험/경고/주의(1), 관리종목(0), 정리매매(0), 불성실공시(0),
 *            우선주(0), 거래정지(1), ETF(1), ETN(1), 신용불가(0), SPAC(1)
 * fid_trgt_exls_cls_code = "1000010111" — ETF/ETN/SPAC/거래정지/투자위험 제외
 *
 * @param topN 조회 종목 수 (기본 300)
 */
export async function fetchKisVolumeRanking(
  topN = 300,
): Promise<KisVolumeRankEntry[]> {
  const results: KisVolumeRankEntry[] = [];

  try {
    const data = await realDataKisGet(TR_ID, API_PATH, {
      FID_COND_MRKT_DIV_CODE: 'J',       // KRX
      FID_COND_SCR_DIV_CODE: '20171',
      FID_INPUT_ISCD: '0000',             // 전체
      FID_DIV_CLS_CODE: '0',              // 전체 (보통주+우선주)
      FID_BLNG_CLS_CODE: '0',             // 평균거래량
      FID_TRGT_CLS_CODE: '111111111',     // 증거금 전 구간 포함
      FID_TRGT_EXLS_CLS_CODE: '1000010111', // ETF/ETN/SPAC/거래정지/투자위험 제외
      FID_INPUT_PRICE_1: '',
      FID_INPUT_PRICE_2: '',
      FID_VOL_CNT: '',
      FID_INPUT_DATE_1: '',
    });

    if (!Array.isArray(data?.output)) {
      logger.warn('[KIS/VolumeRank] output이 배열이 아님');
      return [];
    }

    for (const row of data.output as KisVolumeRankRawRow[]) {
      const code = row.mksc_shrn_iscd?.padStart(6, '0');
      if (!code || code.length !== 6) continue;
      results.push({
        code,
        name: row.hts_kor_isnm ?? '',
        currentPrice: row.stck_prpr ? parseFloat(row.stck_prpr) || 0 : 0,
        volume: row.acml_vol ? parseInt(row.acml_vol, 10) || 0 : 0,
        changePercent: row.prdy_ctrt ? parseFloat(row.prdy_ctrt) || 0 : 0,
        marketCode: 'J',
      });
      if (results.length >= topN) break;
    }

    logger.info('[KIS/VolumeRank] 조회 완료', { count: results.length, topN });
  } catch (err) {
    logger.warn(
      '[KIS/VolumeRank] 조회 실패:',
      err instanceof Error ? err.message : String(err),
    );
  }

  return results;
}
