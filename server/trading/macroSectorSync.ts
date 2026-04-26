// @responsibility macroSectorSync 매매 엔진 모듈
/**
 * macroSectorSync.ts — 거시-섹터-종목 실시간 정렬 루프 (Macro↔Sector↔Stock Sync Loop)
 *
 * 문제: 거시(08:40), 섹터(06:00), 종목(intraday)이 각각 다른 시간에 독립적으로
 * 업데이트되어, 거시 상황이 악화되어도 시스템이 계속 매수 신호를 내는 인과 역전이 발생.
 *
 * 해결: 장중 30분마다 세 레이어를 동기화하는 macroSectorAlignmentCheck를 실행.
 *
 * ┌─ VIX 장중 급등 감지 ─────────────────────────────────────────────────────────┐
 * │  VIX가 장중 3% 이상 급등하면:                                                │
 * │    ① positionPct 20% 축소 (getVixConservativeMode 플래그)                    │
 * │    ② 신규 진입 일시 중단                                                     │
 * │    ③ Telegram "⚠️ 장중 VIX 급등 — 진입 보수 모드 전환" 알림                  │
 * │  VIX가 정상화되면 보수 모드 자동 해제.                                        │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 3레이어 정렬도 검사 ──────────────────────────────────────────────────────────┐
 * │  매크로(MHS/VIX/레짐) × 섹터(EWY/섹터ETF) × 종목(워치리스트 Gate Score)       │
 * │  을 동기화하여 레이어 간 불일치(misalignment) 시 경고 발송.                    │
 * │                                                                              │
 * │  예: 거시 악화(MHS↓) + 섹터 ETF 약세 → 워치리스트 진입 보류 신호              │
 * │  예: 거시 양호(MHS↑) + EWY 급등 → 워치리스트 공격적 진입 가능 신호             │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * 스케줄: 장중 30분 간격 (KST 09:30~15:00 = UTC 00:30~06:00)
 */

import { loadMacroState, saveMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadGlobalScanReport } from '../alerts/globalScanAgent.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { getVixConservativeMode, setVixConservativeMode } from '../state.js';
import { getLiveRegime } from './regimeBridge.js';
import { fetchCloses } from './marketDataRefresh.js';
import { MACRO_SYNC_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadPrevRegime, savePrevRegime } from '../learning/learningState.js';
import { calibrateByRegimeSingle } from '../learning/incrementalCalibrator.js';
import { safePctChange } from '../utils/safePctChange.js';
import fs from 'fs';

// ── 타입 ──────────────────────────────────────────────────────────────────────

type AlignmentLevel = 'ALIGNED' | 'PARTIAL' | 'MISALIGNED';

interface LayerSnapshot {
  macro: {
    mhs: number;
    regime: string;
    vix: number | null;
    vixDayOpen: number | null;
    vixCurrent: number | null;
    vixIntradayChangePct: number | null;
  };
  sector: {
    ewyChangePct: number | null;
    sectorAlertCount: number;
    dominantDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  stock: {
    watchlistCount: number;
    avgGateScore: number;
    highConvictionCount: number;  // gateScore >= 7
  };
}

interface AlignmentResult {
  alignment: AlignmentLevel;
  score: number;              // 0~100, 높을수록 정렬됨
  layerSnapshot: LayerSnapshot;
  warnings: string[];
  vixSpikeDetected: boolean;
}

export interface MacroSyncState {
  vixDayOpen: number | null;         // 장 시작 시점 VIX
  lastCheckAt: string | null;        // 마지막 동기화 시각 ISO
  conservativeModeActivatedAt: string | null;
  lastAlignmentScore: number;
  consecutiveMisalignments: number;  // 연속 불일치 횟수
}

// ── 상태 영속화 ───────────────────────────────────────────────────────────────

function loadMacroSyncState(): MacroSyncState {
  ensureDataDir();
  if (!fs.existsSync(MACRO_SYNC_STATE_FILE)) {
    return {
      vixDayOpen: null,
      lastCheckAt: null,
      conservativeModeActivatedAt: null,
      lastAlignmentScore: 100,
      consecutiveMisalignments: 0,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(MACRO_SYNC_STATE_FILE, 'utf-8'));
  } catch {
    return {
      vixDayOpen: null,
      lastCheckAt: null,
      conservativeModeActivatedAt: null,
      lastAlignmentScore: 100,
      consecutiveMisalignments: 0,
    };
  }
}

function saveMacroSyncState(state: MacroSyncState): void {
  ensureDataDir();
  fs.writeFileSync(MACRO_SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── VIX 실시간 조회 ──────────────────────────────────────────────────────────

/**
 * Yahoo Finance에서 VIX 최신 종가를 가져온다.
 * 장중 호출 시 현재 가격에 가까운 값이 반환된다.
 */
async function fetchCurrentVix(): Promise<number | null> {
  const closes = await fetchCloses('^VIX', '1d');
  if (!closes || closes.length === 0) return null;
  return closes[closes.length - 1];
}

// ── 3레이어 스냅샷 수집 ──────────────────────────────────────────────────────

async function collectLayerSnapshot(
  syncState: MacroSyncState,
): Promise<LayerSnapshot> {
  const macro = loadMacroState();
  const globalScan = loadGlobalScanReport();
  const watchlist = loadWatchlist();

  // ── 거시 레이어 ──────────────────────────────────────────────────────────
  const currentVix = await fetchCurrentVix();
  const vixDayOpen = syncState.vixDayOpen ?? macro?.vix ?? null;

  let vixIntradayChangePct: number | null = null;
  if (currentVix !== null && vixDayOpen !== null && vixDayOpen > 0) {
    // ADR-0028: 동일일자 데이터지만 sanity 적용으로 데이터 오류·스토리지 손상 차단.
    vixIntradayChangePct = safePctChange(currentVix, vixDayOpen, { label: 'macroSector.vixIntraday' });
  }

  // ── 섹터 레이어 ──────────────────────────────────────────────────────────
  const sectorAlerts = globalScan?.sectorAlerts ?? [];
  const bullishCount = sectorAlerts.filter(a => a.direction === 'BULLISH').length;
  const bearishCount = sectorAlerts.filter(a => a.direction === 'BEARISH').length;
  const dominantDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    bullishCount > bearishCount ? 'BULLISH' :
    bearishCount > bullishCount ? 'BEARISH' : 'NEUTRAL';

  // ── 종목 레이어 ──────────────────────────────────────────────────────────
  const gateScores = watchlist
    .filter(w => w.gateScore != null)
    .map(w => w.gateScore!);
  const avgGateScore = gateScores.length > 0
    ? gateScores.reduce((a, b) => a + b, 0) / gateScores.length
    : 0;
  const highConvictionCount = gateScores.filter(gs => gs >= 7).length;

  return {
    macro: {
      mhs: macro?.mhs ?? 50,
      regime: macro?.regime ?? 'R4_NEUTRAL',
      vix: macro?.vix ?? null,
      vixDayOpen,
      vixCurrent: currentVix,
      vixIntradayChangePct,
    },
    sector: {
      ewyChangePct: macro?.ewyDayChange ?? null,
      sectorAlertCount: sectorAlerts.length,
      dominantDirection,
    },
    stock: {
      watchlistCount: watchlist.length,
      avgGateScore,
      highConvictionCount,
    },
  };
}

// ── 정렬도 평가 ───────────────────────────────────────────────────────────────

function evaluateAlignment(snapshot: LayerSnapshot): AlignmentResult {
  const warnings: string[] = [];
  let score = 100; // 감점 방식

  const { macro, sector, stock } = snapshot;

  // ── VIX 장중 급등 감지 (+3% 이상) ───────────────────────────────────────
  const vixSpikeDetected =
    macro.vixIntradayChangePct !== null && macro.vixIntradayChangePct >= 3;

  if (vixSpikeDetected) {
    score -= 30;
    warnings.push(
      `VIX 장중 +${macro.vixIntradayChangePct!.toFixed(1)}% 급등 ` +
      `(${macro.vixDayOpen?.toFixed(1)} → ${macro.vixCurrent?.toFixed(1)})`,
    );
  }

  // ── 거시-섹터 불일치 감지 ───────────────────────────────────────────────
  // MHS 하락(방어적) + 섹터 BULLISH → 의심스러운 강세
  if (macro.mhs < 50 && sector.dominantDirection === 'BULLISH') {
    score -= 15;
    warnings.push(`거시 악화(MHS ${macro.mhs}) vs 섹터 강세 — 혼조 신호`);
  }

  // MHS 양호 + 섹터 BEARISH → 의심스러운 약세
  if (macro.mhs >= 70 && sector.dominantDirection === 'BEARISH') {
    score -= 10;
    warnings.push(`거시 양호(MHS ${macro.mhs}) vs 섹터 약세 — 선행 하락 경계`);
  }

  // ── 거시-종목 불일치 감지 ───────────────────────────────────────────────
  // R5_CAUTION 이상 방어적 레짐 + 고확신 종목 다수 → 인과 역전 위험
  const isDefensiveRegime = macro.regime === 'R5_CAUTION' || macro.regime === 'R6_DEFENSE';
  if (isDefensiveRegime && stock.highConvictionCount >= 3) {
    score -= 20;
    warnings.push(
      `방어 레짐(${macro.regime}) 중 고확신 종목 ${stock.highConvictionCount}개 — 인과 역전 주의`,
    );
  }

  // ── 섹터-종목 불일치 감지 ───────────────────────────────────────────────
  // EWY 급락(−2%+) + 워치리스트 다수 유지 → 외국인 매도 선행 경보
  if (sector.ewyChangePct !== null && sector.ewyChangePct <= -2 && stock.watchlistCount >= 10) {
    score -= 15;
    warnings.push(
      `EWY ${sector.ewyChangePct.toFixed(1)}% 약세 + 워치리스트 ${stock.watchlistCount}개 유지 — 수급 역행 주의`,
    );
  }

  // ── VIX 절대 수준 반영 ─────────────────────────────────────────────────
  if (macro.vixCurrent !== null) {
    if (macro.vixCurrent > 30) {
      score -= 20;
      warnings.push(`VIX ${macro.vixCurrent.toFixed(1)} > 30 — 극단 공포`);
    } else if (macro.vixCurrent > 25) {
      score -= 10;
      warnings.push(`VIX ${macro.vixCurrent.toFixed(1)} > 25 — 공포 경계`);
    }
  }

  // ── 워치리스트 빈곤 경고 ───────────────────────────────────────────────
  if (stock.watchlistCount === 0 && macro.mhs >= 50) {
    score -= 5;
    warnings.push(`거시 양호(MHS ${macro.mhs}) 대비 워치리스트 비어있음 — 발굴 파이프라인 점검`);
  }

  score = Math.max(0, score);

  const alignment: AlignmentLevel =
    score >= 70 ? 'ALIGNED' :
    score >= 40 ? 'PARTIAL' :
    'MISALIGNED';

  return { alignment, score, layerSnapshot: snapshot, warnings, vixSpikeDetected };
}

// ── 보수 모드 적용/해제 ──────────────────────────────────────────────────────

async function handleVixSpike(
  result: AlignmentResult,
  syncState: MacroSyncState,
): Promise<void> {
  const wasConservative = getVixConservativeMode();

  if (result.vixSpikeDetected && !wasConservative) {
    // ── 보수 모드 진입 ──────────────────────────────────────────────────
    setVixConservativeMode(true);
    syncState.conservativeModeActivatedAt = new Date().toISOString();

    const { macro } = result.layerSnapshot;
    await sendTelegramAlert(
      `⚠️ <b>[장중 VIX 급등 — 진입 보수 모드 전환]</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `VIX: ${macro.vixDayOpen?.toFixed(1)} → ${macro.vixCurrent?.toFixed(1)} ` +
      `(+${macro.vixIntradayChangePct?.toFixed(1)}%)\n` +
      `\n` +
      `<b>자동 조치:</b>\n` +
      `• positionPct 20% 축소 적용\n` +
      `• 신규 진입 일시 중단\n` +
      `• 기존 포지션 모니터링 강화\n` +
      `\n` +
      `레짐: ${macro.regime} | MHS: ${macro.mhs}\n` +
      `VIX 정상화 시 자동 해제됩니다.`,
      // 자동 조치(positionPct 축소 + 신규 진입 차단) 후 통보 — 사람이 개입할 필요 없음.
      // T2 REPORT 로 두고 참뮌은 인지 후 필요 시 /pause 여부만 판단한다.
      { priority: 'HIGH', tier: 'T2_REPORT', dedupeKey: 'vix-conservative-on' },
    ).catch(console.error);

    console.log(`[MacroSync] VIX 급등 감지 — 보수 모드 활성화 (VIX +${macro.vixIntradayChangePct?.toFixed(1)}%)`);

  } else if (!result.vixSpikeDetected && wasConservative) {
    // ── 보수 모드 해제 ──────────────────────────────────────────────────
    setVixConservativeMode(false);
    syncState.conservativeModeActivatedAt = null;

    const { macro } = result.layerSnapshot;
    await sendTelegramAlert(
      `✅ <b>[VIX 정상화 — 보수 모드 해제]</b>\n` +
      `VIX: ${macro.vixCurrent?.toFixed(1)} ` +
      `(장중 변화: ${macro.vixIntradayChangePct !== null ? `${macro.vixIntradayChangePct >= 0 ? '+' : ''}${macro.vixIntradayChangePct.toFixed(1)}%` : 'N/A'})\n` +
      `positionPct 정상 복원 | 신규 진입 재개`,
      { priority: 'HIGH', dedupeKey: 'vix-conservative-off' },
    ).catch(console.error);

    console.log('[MacroSync] VIX 정상화 — 보수 모드 해제');
  }
}

// ── 정렬 경고 발송 ────────────────────────────────────────────────────────────

async function notifyAlignmentWarnings(
  result: AlignmentResult,
  syncState: MacroSyncState,
): Promise<void> {
  // 연속 불일치 추적
  if (result.alignment === 'MISALIGNED') {
    syncState.consecutiveMisalignments++;
  } else {
    syncState.consecutiveMisalignments = 0;
  }

  // 경고 없으면 스킵
  if (result.warnings.length === 0) return;

  // ALIGNED면 경고 미발송 (경미한 감점은 무시)
  if (result.alignment === 'ALIGNED') return;

  const alignEmoji = result.alignment === 'MISALIGNED' ? '🔴' : '🟡';
  const { macro, sector, stock } = result.layerSnapshot;

  const now = new Date(Date.now() + 9 * 3_600_000);
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mm = now.getUTCMinutes().toString().padStart(2, '0');

  const warningLines = result.warnings.map(w => `• ${w}`).join('\n');

  let message =
    `${alignEmoji} <b>[거시-섹터-종목 정렬 점검] ${hh}:${mm}</b>\n` +
    `정렬도: ${result.alignment} (${result.score}/100)\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>거시:</b> ${macro.regime} | MHS ${macro.mhs} | VIX ${macro.vixCurrent?.toFixed(1) ?? 'N/A'}\n` +
    `<b>섹터:</b> ${sector.dominantDirection} | EWY ${sector.ewyChangePct?.toFixed(1) ?? 'N/A'}% | 경보 ${sector.sectorAlertCount}건\n` +
    `<b>종목:</b> 워치리스트 ${stock.watchlistCount}개 | 평균Gate ${stock.avgGateScore.toFixed(1)} | 고확신 ${stock.highConvictionCount}개\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>경고:</b>\n${warningLines}`;

  // 연속 불일치 3회 이상이면 강조
  if (syncState.consecutiveMisalignments >= 3) {
    message += `\n\n🚨 <b>연속 ${syncState.consecutiveMisalignments}회 불일치</b> — 시스템 전체 점검 권고`;
  }

  await sendTelegramAlert(message, {
    priority: result.alignment === 'MISALIGNED' ? 'HIGH' : 'NORMAL',
    dedupeKey: `macro-sync-${result.alignment}`,
    cooldownMs: 30 * 60 * 1000, // 30분 쿨다운 (루프 주기와 동일)
  }).catch(console.error);
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 장 시작 시 VIX 기준값 설정.
 * scheduler.ts에서 09:00 KST(장 시작)에 호출.
 */
export async function initMacroSyncDayOpen(): Promise<void> {
  const syncState = loadMacroSyncState();
  const macro = loadMacroState();

  // 전날 글로벌 스캔에서 저장된 VIX를 장 시작 기준값으로 사용
  // 가능하면 실시간 VIX도 시도
  const freshVix = await fetchCurrentVix().catch(() => null);
  syncState.vixDayOpen = freshVix ?? macro?.vix ?? null;
  syncState.consecutiveMisalignments = 0;
  syncState.lastCheckAt = null;
  syncState.conservativeModeActivatedAt = null;

  // 보수 모드 초기화 (일별 리셋)
  setVixConservativeMode(false);

  saveMacroSyncState(syncState);
  console.log(`[MacroSync] 장 시작 VIX 기준값 설정: ${syncState.vixDayOpen?.toFixed(1) ?? 'N/A'}`);
}

/**
 * 거시-섹터-종목 실시간 정렬 루프.
 * scheduler.ts에서 장중 30분 간격으로 호출.
 *
 * 1. 3레이어 스냅샷 수집 (거시/섹터/종목)
 * 2. VIX 장중 급등 감지 → 보수 모드 전환/해제
 * 3. 정렬도 평가 + 경고 발송
 * 4. MacroState 장중 VIX 갱신
 */
export async function macroSectorAlignmentCheck(): Promise<void> {
  console.log('[MacroSync] 거시-섹터-종목 정렬 점검 시작');

  const syncState = loadMacroSyncState();

  try {
    // ── 1. 스냅샷 수집 ───────────────────────────────────────────────────────
    const snapshot = await collectLayerSnapshot(syncState);

    // ── 2. 정렬도 평가 ───────────────────────────────────────────────────────
    const result = evaluateAlignment(snapshot);

    // ── 3. VIX 급등 처리 (보수 모드 전환/해제) ───────────────────────────────
    await handleVixSpike(result, syncState);

    // ── 4. 정렬 경고 발송 ────────────────────────────────────────────────────
    await notifyAlignmentWarnings(result, syncState);

    // ── 5. MacroState에 장중 VIX 갱신 ────────────────────────────────────────
    if (snapshot.macro.vixCurrent !== null) {
      const macro = loadMacroState();
      if (macro) {
        macro.vix = snapshot.macro.vixCurrent;
        macro.updatedAt = new Date().toISOString();
        saveMacroState(macro);
      }
    }

    // ── 6. 동기화 상태 저장 ──────────────────────────────────────────────────
    syncState.lastCheckAt = new Date().toISOString();
    syncState.lastAlignmentScore = result.score;
    saveMacroSyncState(syncState);

    // ── 7. 아이디어 5 — 레짐 전환 감지 즉시 해당 레짐 캘리브레이션 트리거 ───────
    // macroState 갱신 이후의 "현재 레짐"을 확정한다. 이전 저장분과 다르면 신규 레짐 재보정.
    const updatedMacro = loadMacroState();
    const currRegime = updatedMacro ? getLiveRegime(updatedMacro) : null;
    const prevRegime = loadPrevRegime();
    if (currRegime && prevRegime && prevRegime !== currRegime) {
      savePrevRegime(currRegime);
      console.log(`[MacroSync] 레짐 전환 감지: ${prevRegime} → ${currRegime}`);
      // 상태 저장이 완전히 반영되도록 30초 지연 후 단일 레짐만 재보정
      setTimeout(() => {
        calibrateByRegimeSingle(currRegime)
          .then(() =>
            sendTelegramAlert(
              `🔄 <b>[레짐 전환 학습]</b> ${prevRegime} → ${currRegime}\n` +
              `해당 레짐 가중치 즉시 재보정 완료`,
              { priority: 'HIGH', dedupeKey: `regime_switch:${prevRegime}->${currRegime}` },
            ).catch(console.error),
          )
          .catch((e) => console.error('[MacroSync] 레짐 전환 재보정 실패:', e));
      }, 30_000);
    } else if (currRegime && !prevRegime) {
      // 첫 실행 — 비교 기준만 저장
      savePrevRegime(currRegime);
    }

    console.log(
      `[MacroSync] 완료 — 정렬도: ${result.alignment} (${result.score}/100), ` +
      `VIX: ${snapshot.macro.vixCurrent?.toFixed(1) ?? 'N/A'}, ` +
      `보수모드: ${getVixConservativeMode() ? 'ON' : 'OFF'}`,
    );
  } catch (e) {
    console.error('[MacroSync] 정렬 점검 실패:', e instanceof Error ? e.message : e);
  }
}
