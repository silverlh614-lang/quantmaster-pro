/**
 * adrGapCalculator.ts — ADR 역산 갭 모니터 (T-8시간 선점 경보)
 *
 * ┌─ 아이디어 ─────────────────────────────────────────────────────────────────┐
 * │ 간밤 미국 시장에서 거래된 한국주 ADR 종가를 활용해                          │
 * │ 한국 시장 개장 전 이론 시가(theoretical open)를 역산한다.                   │
 * │ ADR은 한국 장 마감 이후 7~8시간 동안 뉴욕에서 거래되므로,                   │
 * │ KRX 종가 대비 ADR 종가 괴리 = "간밤 신규 정보가 반영된 가격 발견" 결과.     │
 * │ 한국 개장 시 이 괴리만큼 갭 발생 확률이 높다.                                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 계산:
 *   theoreticalOpen = ADR_close_USD × USD/KRW × adrRatio
 *   gapPct          = (theoreticalOpen − KRX_close_KRW) / KRX_close_KRW × 100
 *
 *   |gapPct| ≥ 2.0% → MEDIUM 경보
 *   |gapPct| ≥ 3.5% → HIGH 경보 (CRITICAL Telegram)
 *
 * 특징:
 *   - Yahoo Finance 재사용 (추가 API 키 불필요)
 *   - 뉴스-수급 학습 DB(newsSupplyLogger)와 연동 → T+1·T+3·T+5 추적 자동화
 *   - KST 08:35 cron 실행 (개장 25분 전 선점)
 */

import fs from 'fs';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { sendTelegramAlert } from './telegramClient.js';
import { ADR_GAP_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { logNewsSupplyEvent } from '../learning/newsSupplyLogger.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface AdrTarget {
  /** 한국 종목 Yahoo 심볼 (예: '005930.KS') — newsSupplyLogger.koreanStockCodes 호환 */
  krxSymbol: string;
  /** 미국 ADR Yahoo 심볼 (예: 'PKX', 'SSNLF', 'HXSCL') */
  adrSymbol: string;
  /** 종목 한국명 */
  koreanName: string;
  /** 섹터 라벨 */
  sector:     string;
  /**
   * ADR 1주가 한국 보통주 몇 주에 해당하는지 (환산 비율).
   * 1이면 1:1, 0.5이면 ADR 2주 = 보통주 1주.
   * 예) POSCO(PKX) = 1, SK하이닉스(HXSCL) = 1, 삼성전자(SSNLF) = 1,
   *     LG디스플레이(LPL) = 2, SK텔레콤(SKM) = 1/9.
   */
  adrRatio:   number;
}

export interface AdrGapResult {
  krxSymbol:        string;
  adrSymbol:        string;
  koreanName:       string;
  sector:           string;
  krxClose:         number;        // KRW
  adrClose:         number;        // USD
  usdKrw:           number;
  theoreticalOpen:  number;        // KRW
  gapPct:           number;        // %
  significance:     'HIGH' | 'MEDIUM' | 'LOW';
  direction:        'UP' | 'DOWN';
}

interface AdrGapState {
  lastSentAt: string;                    // ISO
  lastGaps:   Record<string, number>;    // krxSymbol → gapPct
}

// ── 모니터 대상 ADR (대표 유동성 5종) ────────────────────────────────────────

/**
 * 유의: SSNLF(삼성전자 ADR)는 OTC 거래량이 낮아 가격 신뢰도가 제한적.
 * 대신 ^KS11·EWY·HXSCL·PKX 조합으로 외국인 수급 방향을 상호 검증한다.
 */
export const DEFAULT_ADR_TARGETS: AdrTarget[] = [
  { krxSymbol: '005930.KS', adrSymbol: 'SSNLF', koreanName: '삼성전자',     sector: '반도체',   adrRatio: 1 },
  { krxSymbol: '000660.KS', adrSymbol: 'HXSCL', koreanName: 'SK하이닉스',   sector: '반도체',   adrRatio: 1 },
  { krxSymbol: '005490.KS', adrSymbol: 'PKX',   koreanName: 'POSCO홀딩스',  sector: '철강',     adrRatio: 1 },
  { krxSymbol: '034220.KS', adrSymbol: 'LPL',   koreanName: 'LG디스플레이', sector: 'IT부품',   adrRatio: 2 },
  { krxSymbol: '017670.KS', adrSymbol: 'SKM',   koreanName: 'SK텔레콤',     sector: '통신',     adrRatio: 1 / 9 },
];

// ── 임계값 ────────────────────────────────────────────────────────────────────

const GAP_PCT_MEDIUM = 2.0;
const GAP_PCT_HIGH   = 3.5;

// ── 영속성 ────────────────────────────────────────────────────────────────────

function saveState(state: AdrGapState): void {
  ensureDataDir();
  fs.writeFileSync(ADR_GAP_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── 종가 한 점 조회 헬퍼 ──────────────────────────────────────────────────────

async function fetchLatestClose(symbol: string, range = '10d'): Promise<number | null> {
  const closes = await fetchCloses(symbol, range).catch(() => null);
  if (!closes || closes.length === 0) return null;
  return closes[closes.length - 1];
}

// ── 단일 종목 갭 계산 ─────────────────────────────────────────────────────────

async function computeGap(target: AdrTarget, usdKrw: number): Promise<AdrGapResult | null> {
  const [krxClose, adrClose] = await Promise.all([
    fetchLatestClose(target.krxSymbol),
    fetchLatestClose(target.adrSymbol),
  ]);
  if (krxClose == null || adrClose == null) {
    console.warn(`[AdrGap] 종가 조회 실패: ${target.krxSymbol}=${krxClose}, ${target.adrSymbol}=${adrClose}`);
    return null;
  }
  if (krxClose <= 0 || adrClose <= 0) return null;

  const theoreticalOpen = adrClose * usdKrw * target.adrRatio;
  const gapPct          = ((theoreticalOpen - krxClose) / krxClose) * 100;
  const abs             = Math.abs(gapPct);

  const significance: AdrGapResult['significance'] =
    abs >= GAP_PCT_HIGH   ? 'HIGH'   :
    abs >= GAP_PCT_MEDIUM ? 'MEDIUM' : 'LOW';

  return {
    krxSymbol:       target.krxSymbol,
    adrSymbol:       target.adrSymbol,
    koreanName:      target.koreanName,
    sector:          target.sector,
    krxClose,
    adrClose,
    usdKrw,
    theoreticalOpen: parseFloat(theoreticalOpen.toFixed(0)),
    gapPct:          parseFloat(gapPct.toFixed(2)),
    significance,
    direction:       gapPct >= 0 ? 'UP' : 'DOWN',
  };
}

// ── 알림 메시지 구성 ─────────────────────────────────────────────────────────

function formatAlert(results: AdrGapResult[]): string {
  const withSignal = results.filter(r => r.significance !== 'LOW');
  const lines = withSignal
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    .map(r => {
      const arrow  = r.direction === 'UP' ? '▲' : '▼';
      const tagBox = r.significance === 'HIGH' ? '🚨' : '⚠️';
      const sign   = r.gapPct >= 0 ? '+' : '';
      return (
        `${tagBox} <b>${r.koreanName}</b> (${r.sector}) ${arrow} ${sign}${r.gapPct}%\n` +
        `   KRX종가 ${r.krxClose.toLocaleString()}원 → 이론시가 ${r.theoreticalOpen.toLocaleString()}원\n` +
        `   ADR ${r.adrSymbol} $${r.adrClose.toFixed(2)} × ${r.usdKrw.toFixed(1)}원`
      );
    });

  return (
    `🌙 <b>[ADR 역산 갭 모니터]</b> 08:35 KST\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `간밤 NY 세션 반영 — 한국 개장 전 선점 경보\n\n` +
    (lines.length > 0 ? lines.join('\n\n') : '✅ 유의미한 갭 없음 (|갭| < 2%)') +
    `\n\n<i>⚠️ ADR OTC 유동성 낮은 종목은 가격 왜곡 가능</i>`
  );
}

// ── 학습 DB 연동 (newsSupplyLogger) ──────────────────────────────────────────

function logToNewsSupply(results: AdrGapResult[]): void {
  const highs = results.filter(r => r.significance === 'HIGH');
  if (highs.length === 0) return;

  // 섹터별 그룹핑 — 같은 섹터 다종목이 같이 튀면 하나의 이벤트로 학습
  const bySector = new Map<string, AdrGapResult[]>();
  for (const r of highs) {
    if (!bySector.has(r.sector)) bySector.set(r.sector, []);
    bySector.get(r.sector)!.push(r);
  }

  for (const [sector, group] of bySector) {
    const avgGap = group.reduce((s, r) => s + r.gapPct, 0) / group.length;
    logNewsSupplyEvent({
      newsType:         'ADR갭',
      source:           'EWY_FOREIGN',
      sector,
      koreanStockCodes: group.map(r => r.krxSymbol),
      koreanNames:      group.map(r => r.koreanName),
      detectedAt:       new Date().toISOString(),
      newsHeadline:     `${sector} ADR 간밤 갭 평균 ${avgGap >= 0 ? '+' : ''}${avgGap.toFixed(2)}%`,
      significance:     'HIGH',
    });
  }
}

// ── 메인 엔트리 ───────────────────────────────────────────────────────────────

/**
 * 모든 ADR 대상 종목의 이론 시가/갭률을 계산하고 MEDIUM 이상이면 Telegram 경보.
 * cron 기준 KST 08:35 호출 권장 (NY 마감 후 ~8시간, 개장 25분 전).
 *
 * @returns 계산된 AdrGapResult 배열 (LOW 포함 전체)
 */
export async function runAdrGapScan(
  targets: AdrTarget[] = DEFAULT_ADR_TARGETS,
): Promise<AdrGapResult[]> {
  const usdKrw = await fetchLatestClose('KRW=X');
  if (usdKrw == null || usdKrw <= 0) {
    console.warn('[AdrGap] USD/KRW 조회 실패 — 스킵');
    return [];
  }

  const results: AdrGapResult[] = [];
  for (const t of targets) {
    const r = await computeGap(t, usdKrw).catch(err => {
      console.error(`[AdrGap] ${t.krxSymbol} 갭 계산 실패:`, err);
      return null;
    });
    if (r) results.push(r);
  }

  if (results.length === 0) {
    console.warn('[AdrGap] 유효 결과 0건 — 알림 스킵');
    return [];
  }

  console.log(
    `[AdrGap] ${results.length}개 스캔 완료 — ` +
    results.map(r => `${r.koreanName} ${r.gapPct >= 0 ? '+' : ''}${r.gapPct}%`).join(', '),
  );

  // 유의미 갭이 1건이라도 있으면 알림 발송
  const significant = results.filter(r => r.significance !== 'LOW');
  if (significant.length > 0) {
    const hasHigh = significant.some(r => r.significance === 'HIGH');
    await sendTelegramAlert(formatAlert(results), {
      priority:  hasHigh ? 'CRITICAL' : 'HIGH',
      dedupeKey: `adr_gap:${new Date().toISOString().slice(0, 10)}`,
    }).catch(console.error);
    logToNewsSupply(results);
  } else {
    console.log('[AdrGap] 유의미 갭 없음 — 알림 스킵');
  }

  // 상태 저장
  const lastGaps: Record<string, number> = {};
  for (const r of results) lastGaps[r.krxSymbol] = r.gapPct;
  saveState({ lastSentAt: new Date().toISOString(), lastGaps });

  return results;
}
