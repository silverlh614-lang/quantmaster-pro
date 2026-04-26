// @responsibility portfolioRiskEngine 매매 엔진 모듈
/**
 * portfolioRiskEngine.ts — 포트폴리오 수준 리스크 관리 엔진
 *
 * 개별 종목 신호가 아무리 정교해도 포트폴리오 전체가 동일 방향으로 쏠리면
 * 체계적 리스크에 노출된다. 이 엔진은 4가지 포트폴리오 리스크를 실시간 평가하여
 * 신규 진입을 차단하거나 경보를 발송한다.
 *
 * ① 섹터 집중도: 동일 섹터 합산 > 포트폴리오 30% → 신규 진입 차단
 * ② 가중 베타 합산: 포트폴리오 가중 베타 > 1.5 → 진입 제한
 * ③ 상관관계 경보: 60일 수익률 상관 ≥ 0.7 쌍 ≥ 3개 → "허위 분산 경보"
 * ④ 일일 최대 손실: 계좌 기준 -2% → 신규 진입 중단
 */

import {
  loadShadowTrades,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { isOpenShadowStatus } from './entryEngine.js';
import { getRealtimePrice } from '../clients/kisStreamClient.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { getDailyLossPct } from '../state.js';
import { safePctChange } from '../utils/safePctChange.js';

// ─── 설정 상수 ───────────────────────────────────────────────────────────────

/** 동일 섹터 최대 비중 (30%) */
const MAX_SECTOR_WEIGHT      = parseFloat(process.env.MAX_SECTOR_WEIGHT ?? '0.30');
/** 포트폴리오 가중 베타 한도 */
const MAX_PORTFOLIO_BETA     = parseFloat(process.env.MAX_PORTFOLIO_BETA ?? '1.5');
/** 상관관계 경보 임계: 상관계수 */
const CORRELATION_THRESHOLD  = 0.7;
/** 상관관계 경보 임계: 고상관 쌍 수 */
const CORRELATION_PAIR_LIMIT = 3;
/** 일일 손실 한도 (계좌 기준 %) — checkDailyLossLimit과 별도로 진입 차단용 */
const DAILY_LOSS_ENTRY_BLOCK = parseFloat(process.env.DAILY_LOSS_ENTRY_BLOCK ?? '2');

// ─── 종목별 섹터 베타 데이터 ─────────────────────────────────────────────────
// 실제로는 외부 DB/API에서 가져와야 하지만, 한국 주요 섹터의 대표 베타 값을 사용.
// watchlist의 sector 필드와 매칭하여 사용한다.

const SECTOR_BETA: Record<string, number> = {
  '반도체':     1.3,
  '이차전지':   1.4,
  '자동차':     1.1,
  '조선':       1.2,
  '바이오':     1.5,
  '금융':       0.8,
  '방산':       0.9,
  '소프트웨어': 1.2,
  '화학':       1.0,
  '철강':       1.1,
  '유통':       0.9,
  '건설':       1.0,
  '통신':       0.7,
  '에너지':     1.1,
  '엔터':       1.3,
  'AI':         1.5,
  '로봇':       1.4,
};

const DEFAULT_BETA = 1.0;

// ─── 포트폴리오 리스크 평가 결과 ─────────────────────────────────────────────

export interface PortfolioRiskResult {
  /** 신규 진입 가능 여부 */
  entryAllowed: boolean;
  /** 차단 사유 목록 */
  blockReasons: string[];
  /** 경고 메시지 (차단 아니지만 주의 필요) */
  warnings: string[];

  // 세부 지표
  sectorWeights: Record<string, number>;     // 섹터별 비중 (0-1)
  portfolioBeta: number;                      // 가중 베타
  highCorrelationPairs: [string, string, number][]; // [종목A, 종목B, 상관계수]
  dailyLossPct: number;                       // 당일 손실률
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

interface PositionSnapshot {
  stockCode: string;
  stockName: string;
  sector: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  marketValue: number;   // currentPrice × quantity
  beta: number;
}

async function buildPositionSnapshots(): Promise<PositionSnapshot[]> {
  const shadows = loadShadowTrades();
  const watchlist = loadWatchlist();
  const wlMap = new Map(watchlist.map(w => [w.code, w]));

  const openPositions = shadows.filter(s => isOpenShadowStatus(s.status) && s.quantity > 0);
  const snapshots: PositionSnapshot[] = [];

  for (const pos of openPositions) {
    const currentPrice = getRealtimePrice(pos.stockCode)
      ?? await fetchCurrentPrice(pos.stockCode).catch(() => null)
      ?? pos.shadowEntryPrice;

    const wl = wlMap.get(pos.stockCode);
    // NOTE: profileType은 A/B/C/D 품질 티어이지 산업 섹터가 아니다. 과거 fallback에
    // pos.profileType이 포함돼 섹터 집중도·상관 계산이 전부 티어 기준으로 왜곡됐다.
    const sector = wl?.sector ?? '기타';
    const beta = SECTOR_BETA[sector] ?? DEFAULT_BETA;

    snapshots.push({
      stockCode: pos.stockCode,
      stockName: pos.stockName,
      sector,
      entryPrice: pos.shadowEntryPrice,
      currentPrice,
      quantity: pos.quantity,
      marketValue: currentPrice * pos.quantity,
      beta,
    });
  }

  return snapshots;
}

// ─── ① 섹터 집중도 체크 ──────────────────────────────────────────────────────

function checkSectorConcentration(
  snapshots: PositionSnapshot[],
  totalValue: number,
  candidateSector?: string,
): { weights: Record<string, number>; blocked: boolean; reason?: string } {
  const sectorValues: Record<string, number> = {};
  for (const s of snapshots) {
    sectorValues[s.sector] = (sectorValues[s.sector] ?? 0) + s.marketValue;
  }

  const weights: Record<string, number> = {};
  for (const [sector, value] of Object.entries(sectorValues)) {
    weights[sector] = totalValue > 0 ? value / totalValue : 0;
  }

  // 후보 종목 섹터가 이미 30% 초과인지 확인
  // '기타'는 섹터 미분류 버킷이므로 집중도 판정에서 제외.
  if (candidateSector && candidateSector !== '기타' && (weights[candidateSector] ?? 0) >= MAX_SECTOR_WEIGHT) {
    return {
      weights,
      blocked: true,
      reason: `섹터 집중도 초과: ${candidateSector} ${((weights[candidateSector] ?? 0) * 100).toFixed(1)}% ≥ ${(MAX_SECTOR_WEIGHT * 100).toFixed(0)}%`,
    };
  }

  return { weights, blocked: false };
}

// ─── ② 가중 베타 합산 ───────────────────────────────────────────────────────

function checkPortfolioBeta(
  snapshots: PositionSnapshot[],
  totalValue: number,
): { beta: number; blocked: boolean; reason?: string } {
  if (totalValue <= 0 || snapshots.length === 0) return { beta: 0, blocked: false };

  let weightedBeta = 0;
  for (const s of snapshots) {
    const weight = s.marketValue / totalValue;
    weightedBeta += weight * s.beta;
  }

  if (weightedBeta > MAX_PORTFOLIO_BETA) {
    return {
      beta: weightedBeta,
      blocked: true,
      reason: `포트폴리오 가중 베타 초과: ${weightedBeta.toFixed(2)} > ${MAX_PORTFOLIO_BETA}`,
    };
  }

  return { beta: weightedBeta, blocked: false };
}

// ─── ③ 상관관계 경보 ────────────────────────────────────────────────────────
// 보유 종목 간 60일 일별 수익률 상관계수를 계산.
// 실시간 일별 수익률 히스토리는 없으므로, 같은 섹터 내 종목 쌍을
// 높은 상관(0.8) 으로 간주하는 휴리스틱 사용 (섹터 기반 프록시).
// 향후 일별 수익률 DB 구축 시 피어슨 상관으로 교체 가능.

function checkCorrelation(
  snapshots: PositionSnapshot[],
): { pairs: [string, string, number][]; warning: boolean; reason?: string } {
  const pairs: [string, string, number][] = [];

  for (let i = 0; i < snapshots.length; i++) {
    for (let j = i + 1; j < snapshots.length; j++) {
      const a = snapshots[i];
      const b = snapshots[j];
      // 동일 섹터 → 높은 상관 (0.8 가정)
      if (a.sector === b.sector && a.sector !== '기타') {
        pairs.push([a.stockName, b.stockName, 0.8]);
      }
    }
  }

  const highPairs = pairs.filter(p => p[2] >= CORRELATION_THRESHOLD);
  if (highPairs.length >= CORRELATION_PAIR_LIMIT) {
    return {
      pairs: highPairs,
      warning: true,
      reason: `허위 분산 경보: 상관계수 ≥${CORRELATION_THRESHOLD} 쌍 ${highPairs.length}개 (≥${CORRELATION_PAIR_LIMIT})`,
    };
  }

  return { pairs: highPairs, warning: false };
}

// ─── ④ 일일 손실 한도 ───────────────────────────────────────────────────────

function checkDailyLossForEntry(): { lossPct: number; blocked: boolean; reason?: string } {
  const lossPct = getDailyLossPct();
  if (lossPct >= DAILY_LOSS_ENTRY_BLOCK) {
    return {
      lossPct,
      blocked: true,
      reason: `일일 손실 한도: -${lossPct.toFixed(2)}% ≥ -${DAILY_LOSS_ENTRY_BLOCK}% — 신규 진입 중단`,
    };
  }
  return { lossPct, blocked: false };
}

// ─── 통합 평가 함수 ──────────────────────────────────────────────────────────

/**
 * 포트폴리오 리스크를 종합 평가하여 신규 진입 가능 여부를 반환한다.
 *
 * @param candidateSector 진입 후보 종목의 섹터 (optional — 섹터 집중도 체크용)
 * @returns PortfolioRiskResult
 */
export async function evaluatePortfolioRisk(
  candidateSector?: string,
): Promise<PortfolioRiskResult> {
  const snapshots = await buildPositionSnapshots();
  const totalValue = snapshots.reduce((sum, s) => sum + s.marketValue, 0);

  const blockReasons: string[] = [];
  const warnings: string[] = [];

  // ① 섹터 집중도
  const sector = checkSectorConcentration(snapshots, totalValue, candidateSector);
  if (sector.blocked && sector.reason) blockReasons.push(sector.reason);

  // ② 가중 베타
  const beta = checkPortfolioBeta(snapshots, totalValue);
  if (beta.blocked && beta.reason) blockReasons.push(beta.reason);

  // ③ 상관관계 경보
  const corr = checkCorrelation(snapshots);
  if (corr.warning && corr.reason) warnings.push(corr.reason);

  // ④ 일일 손실
  const loss = checkDailyLossForEntry();
  if (loss.blocked && loss.reason) blockReasons.push(loss.reason);

  return {
    entryAllowed: blockReasons.length === 0,
    blockReasons,
    warnings,
    sectorWeights: sector.weights,
    portfolioBeta: beta.beta,
    highCorrelationPairs: corr.pairs,
    dailyLossPct: loss.lossPct,
  };
}

// ─── 정기 리스크 모니터링 (cron 연동) ────────────────────────────────────────

/** 허위 분산 경보 발송 이력 (같은 장중 중복 방지) */
let _lastCorrelationAlertDate = '';
/** 섹터 집중도 긴급 경보 발송 이력 (섹터별, 장중 1회) */
let _lastSectorAlertDate = '';
const _alertedSectors = new Set<string>();

/**
 * 포트폴리오 리스크 정기 점검 — scheduler에서 호출.
 * 경보 조건 충족 시 텔레그램 발송.
 * 섹터 한도 초과 시 해당 섹터 포지션을 exitPending으로 마킹하여 자동 청산을 유도한다.
 */
export async function runPortfolioRiskCheck(): Promise<void> {
  const result = await evaluatePortfolioRisk();
  const today = new Date().toISOString().slice(0, 10);

  // 날짜 변경 시 경보 이력 초기화
  if (_lastSectorAlertDate !== today) {
    _lastSectorAlertDate = today;
    _alertedSectors.clear();
  }

  // 허위 분산 경보 (하루 1회)
  if (result.warnings.length > 0 && _lastCorrelationAlertDate !== today) {
    _lastCorrelationAlertDate = today;
    const pairList = result.highCorrelationPairs
      .map(([a, b, r]) => `  • ${a} ↔ ${b} (${r.toFixed(2)})`)
      .join('\n');
    await sendTelegramAlert(
      `⚠️ <b>[허위 분산 경보]</b>\n` +
      `고상관 종목 쌍 ${result.highCorrelationPairs.length}개 감지:\n` +
      `${pairList}\n\n` +
      `포트폴리오 β: ${result.portfolioBeta.toFixed(2)}\n` +
      `일일 손실: -${result.dailyLossPct.toFixed(2)}%`,
      { priority: 'HIGH', dedupeKey: `portfolio_corr_${today}` },
    ).catch(console.error);
  }

  // 베타 경고 (차단 시)
  if (result.blockReasons.some(r => r.includes('베타'))) {
    console.warn(`[PortfolioRisk] ${result.blockReasons.find(r => r.includes('베타'))}`);
  }

  // ── 섹터 집중도 자동 대응 ──────────────────────────────────────────────────
  const shadows = loadShadowTrades();
  const wlMap = new Map(loadWatchlist().map(w => [w.code, w]));
  let shadowsChanged = false;

  for (const [sector, weight] of Object.entries(result.sectorWeights)) {
    // '기타'는 섹터 미분류 버킷이므로 집중 판정 대상에서 제외한다.
    // checkCorrelation도 동일하게 '기타'를 무시하는 것과 일관성을 맞춘다.
    if (sector === '기타') continue;
    const weightPct = (weight * 100).toFixed(1);

    if (weight >= MAX_SECTOR_WEIGHT) {
      // ── 한도 초과: 해당 섹터 최저수익 포지션의 손절선을 현재가로 올려 청산을 유도 ──
      const sectorPositions = shadows.filter(s => {
        if (!isOpenShadowStatus(s.status)) return false;
        const wl = wlMap.get(s.stockCode);
        return (wl?.sector ?? '기타') === sector;
      });

      if (sectorPositions.length > 0) {
        // 수익률 기준 오름차순 정렬 → 가장 낮은 수익률 포지션부터 청산 대상
        const sorted = sectorPositions
          .map(s => {
            const currentPrice = getRealtimePrice(s.stockCode) ?? s.shadowEntryPrice;
            // ADR-0049: stale currentPrice 시 0 fallback — 섹터 약체 정렬 입력 보호.
            const pnlPct = safePctChange(currentPrice, s.shadowEntryPrice, {
              label: `portfolioRisk:${s.stockCode}`,
            }) ?? 0;
            return { shadow: s, pnlPct, currentPrice };
          })
          .sort((a, b) => a.pnlPct - b.pnlPct);

        // 최저수익 포지션의 손절선을 현재가 -1%로 긴축 → exitEngine이 다음 틱에서 청산
        const exitTarget = sorted[0];
        const tightStop = Math.round(exitTarget.currentPrice * 0.99);
        if (exitTarget.shadow.stopLoss < tightStop) {
          exitTarget.shadow.stopLoss = tightStop;
          exitTarget.shadow.exitRuleTag = 'HARD_STOP';
          shadowsChanged = true;
          console.warn(
            `[PortfolioRisk] 🚨 섹터 ${sector} 비중 ${weightPct}% 초과 → ` +
            `${exitTarget.shadow.stockName}(${exitTarget.shadow.stockCode}) 손절선 ${tightStop.toLocaleString()}원으로 긴축 (PnL: ${exitTarget.pnlPct.toFixed(1)}%)`,
          );
        }
      }

      // Telegram 긴급 경보 (섹터별 장중 1회)
      if (!_alertedSectors.has(sector)) {
        _alertedSectors.add(sector);
        const posNames = sectorPositions.map(s => s.stockName).join(', ');
        await sendTelegramAlert(
          `🚨 <b>[섹터 집중도 초과 — 자동 대응]</b>\n` +
          `섹터: <b>${sector}</b> — ${weightPct}% (한도 ${(MAX_SECTOR_WEIGHT * 100).toFixed(0)}%)\n` +
          `보유 종목: ${posNames}\n` +
          `⚡ 최저수익 포지션 손절선 긴축 → 다음 스캔에서 청산 예정\n` +
          `LIVE 전환 전 섹터 분산 필수!`,
          { priority: 'HIGH', dedupeKey: `sector_conc_${sector}_${today}` },
        ).catch(console.error);
      }
    } else if (weight >= MAX_SECTOR_WEIGHT * 0.8) {
      // 80% 접근 시 사전 경고
      console.warn(`[PortfolioRisk] 섹터 ${sector} 비중 ${weightPct}% — 한도(${(MAX_SECTOR_WEIGHT * 100).toFixed(0)}%) 접근 중`);
    }
  }

  if (shadowsChanged) {
    const { saveShadowTrades } = await import('../persistence/shadowTradeRepo.js');
    saveShadowTrades(shadows);
  }
}
