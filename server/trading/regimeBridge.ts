/**
 * regimeBridge.ts — MacroState → RegimeVariables 변환 + 라이브 레짐 판정
 *
 * 역할: 서버 측 MacroState(지속적으로 축적되는 거시 지표)를
 *       프론트엔드 classifyRegime()이 요구하는 RegimeVariables 7축으로 매핑.
 *
 * 효과: backtestPortfolio()와 라이브 signalScanner가 동일한 classifyRegime()를
 *       공유 → 검증한 것과 실행하는 것이 일치하는 시스템.
 *
 * 레짐 전환 알림: 레짐이 변경되면 즉시 Telegram으로 구조화된 알림 발송.
 */

import type { RegimeVariables, RegimeLevel } from '../../src/types/core.js';
import { classifyRegime, REGIME_CONFIGS } from '../../src/services/quant/regimeEngine.js';
import type { MacroState } from '../persistence/macroStateRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { channelRegimeChange } from '../alerts/channelPipeline.js';
import { renderPlaybook } from '../alerts/regimePlaybook.js';
import { resetConditionWeightsForRegime } from '../persistence/conditionWeightsRepo.js';
import { isForcedRegimeDowngradeActive } from '../learning/learningState.js';

// ── 레짐 전환 감지용 모듈 상태 ──────────────────────────────────────────────

let _previousRegime: RegimeLevel | null = null;
let _previousMhs: number | null = null;
let _previousVkospi: number | null = null;

/**
 * MacroState → RegimeVariables
 * 누락 필드는 보수적 중립값으로 fallback — 판정을 보수적 방향으로 편향.
 */
export function buildRegimeVars(macroState: MacroState): RegimeVariables {
  return {
    // ① 변동성
    vkospi:          macroState.vkospi          ?? 20,
    vkospiDayChange: macroState.vkospiDayChange  ?? 0,
    // vkospi5dTrend: 직접 값 없으면 vkospiRising boolean을 방향 힌트로 대용
    vkospi5dTrend:   macroState.vkospi5dTrend   ??
      (macroState.vkospiRising === false ? -1 : macroState.vkospiRising === true ? 1 : 0),

    // ② 거시 (MHS·환율)
    mhsScore:        macroState.mhs              ?? 50,
    usdKrw:          macroState.usdKrw           ?? 1300,
    usdKrw20dChange: macroState.usdKrw20dChange  ?? 0,
    usdKrwDayChange: macroState.usdKrwDayChange  ?? 0,

    // ③ 수급
    foreignNetBuy5d:  macroState.foreignNetBuy5d  ?? 0,
    passiveActiveBoth: macroState.passiveActiveBoth ?? false,

    // ④ 지수 기술적
    kospiAbove20MA:  macroState.kospiAbove20MA   ?? true,
    kospiAbove60MA:  macroState.kospiAbove60MA   ?? true,
    kospi20dReturn:  macroState.kospi20dReturn   ?? 0,
    kospiDayReturn:  macroState.kospiDayReturn   ?? 0,

    // ⑤ 사이클
    leadingSectorRS:  macroState.leadingSectorRS  ?? 50,
    sectorCycleStage: macroState.sectorCycleStage ?? 'MID',

    // ⑥ 신용·심리
    marginBalance5dChange: macroState.marginBalance5dChange ?? 0,
    shortSellingRatio:     macroState.shortSellingRatio     ?? 5,

    // ⑦ 글로벌
    spx20dReturn: macroState.spx20dReturn ?? 0,
    vix:          macroState.vix          ?? 20,
    dxy5dChange:  macroState.dxy5dChange  ?? 0,

    // ⑧ 레짐 승급 보조
    kospiAboveMA20Pct:        macroState.kospiAboveMA20Pct,
    foreignContinuousBuyDays: macroState.foreignContinuousBuyDays,
  };
}

/** 레짐 순서 (방어 → 공격) — 다운그레이드/업그레이드 판단용 */
const REGIME_ORDER: RegimeLevel[] = [
  'R6_DEFENSE', 'R5_CAUTION', 'R4_NEUTRAL', 'R3_EARLY', 'R2_BULL', 'R1_TURBO',
];

/**
 * MacroState → RegimeLevel
 * macroState가 null이면 R4_NEUTRAL 반환 (신호 스캔 일시 중단 없음, 보수적 운용).
 *
 * 아이디어 7 (Phase 4): isForcedRegimeDowngradeActive() 활성 시 raw 분류 결과를
 * REGIME_ORDER 상 한 단계 방어쪽으로 이동(예: R2_BULL → R3_EARLY).
 */
export function getLiveRegime(macroState: MacroState | null): RegimeLevel {
  const raw: RegimeLevel = macroState ? classifyRegime(buildRegimeVars(macroState)) : 'R4_NEUTRAL';
  if (!isForcedRegimeDowngradeActive()) return raw;
  const idx = REGIME_ORDER.indexOf(raw);
  if (idx <= 0) return raw; // 이미 R6_DEFENSE — 더 내려갈 곳 없음
  return REGIME_ORDER[idx - 1];
}

// ── 레짐 전환 즉시 알림 ──────────────────────────────────────────────────────

/**
 * 레짐 전환 감지 + 즉시 Telegram 알림 발송.
 *
 * getLiveRegime() 호출 후 이 함수를 호출하면,
 * 이전 레짐과 비교하여 변경 시 구조화된 알림을 발송한다.
 *
 * 알림 내용:
 *  ① 전환 방향 (업그레이드/다운그레이드)
 *  ② MHS, VKOSPI 변화량
 *  ③ Kelly 배율, 최대 보유, 손절 기준 변경사항
 *  ④ 보유 포지션 점검 권고
 */
export async function checkAndNotifyRegimeChange(
  macroState: MacroState | null,
): Promise<void> {
  const currentRegime = getLiveRegime(macroState);
  const currentMhs = macroState?.mhs ?? null;
  const currentVkospi = macroState?.vkospi ?? null;

  // 첫 호출: 이전 레짐 초기화만 수행
  if (_previousRegime === null) {
    _previousRegime = currentRegime;
    _previousMhs = currentMhs;
    _previousVkospi = currentVkospi;
    return;
  }

  // 레짐 변경 없으면 상태만 갱신
  if (_previousRegime === currentRegime) {
    _previousMhs = currentMhs;
    _previousVkospi = currentVkospi;
    return;
  }

  // ── 레짐 전환 감지! ──────────────────────────────────────────────────────
  const prevIdx = REGIME_ORDER.indexOf(_previousRegime);
  const currIdx = REGIME_ORDER.indexOf(currentRegime);
  const isDowngrade = currIdx < prevIdx;
  // 아이디어 2: 2단계 이상 급변 시 새 레짐의 학습 가중치 즉시 리셋.
  // 예: R2_BULL(idx=4) → R5_CAUTION(idx=1) → |diff|=3 → 리셋.
  const stepDelta = Math.abs(prevIdx - currIdx);
  const isAbruptShift = stepDelta >= 2;
  let resetNote = '';
  if (isAbruptShift) {
    const prevWeights = resetConditionWeightsForRegime(currentRegime);
    const movedKeys = prevWeights
      ? Object.entries(prevWeights)
          .filter(([, v]) => Math.abs(v - 1.0) > 0.05)
          .map(([k]) => k)
      : [];
    resetNote =
      `\n🧬 <b>가중치 자동 리셋</b>\n` +
      `• ${currentRegime} condition-weights 초기값 1.0 복원 (${stepDelta}단계 급변)\n` +
      (movedKeys.length > 0
        ? `• 리셋된 키: ${movedKeys.slice(0, 6).join(', ')}${movedKeys.length > 6 ? ` 외 ${movedKeys.length - 6}` : ''}\n`
        : '• 이전 저장 없음 — 신규 파일 생성\n') +
      `• 원칙: 직전 장세 주도주는 신장세 주도주가 아니다\n`;
    console.log(
      `[RegimeBridge] ${stepDelta}단계 급변(${_previousRegime}→${currentRegime}) — ${currentRegime} 가중치 리셋`,
    );
  }

  const prevCfg = REGIME_CONFIGS[_previousRegime];
  const currCfg = REGIME_CONFIGS[currentRegime];

  const dirEmoji = isDowngrade ? '🔴' : '🟢';
  const dirLabel = isDowngrade ? '방어 강화' : '공격 전환';

  // MHS/VKOSPI 변화량
  const mhsDelta = (currentMhs != null && _previousMhs != null)
    ? currentMhs - _previousMhs : null;
  const vkospiDelta = (currentVkospi != null && _previousVkospi != null)
    ? currentVkospi - _previousVkospi : null;

  let msg =
    `⚠️ <b>[레짐 전환]</b> ${_previousRegime} → ${currentRegime} ${dirEmoji}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n`;

  // MHS / VKOSPI 변화
  if (mhsDelta !== null) {
    msg += `MHS: ${_previousMhs} → ${currentMhs} (${mhsDelta >= 0 ? '+' : ''}${mhsDelta}pt)\n`;
  }
  if (vkospiDelta !== null) {
    msg += `VKOSPI: ${_previousVkospi?.toFixed(1)} → ${currentVkospi?.toFixed(1)} ` +
           `(${vkospiDelta >= 0 ? '+' : ''}${vkospiDelta.toFixed(1)})\n`;
  }

  // 변경 사항
  msg += `\n<b>변경사항 (${dirLabel}):</b>\n`;
  msg += `• Kelly 배율: ×${prevCfg.kellyMultiplier} → ×${currCfg.kellyMultiplier} 자동 적용\n`;
  msg += `• 신규 진입 한도: ${prevCfg.maxPositions}개 → ${currCfg.maxPositions}개\n`;

  if (isDowngrade) {
    msg += `• 손절 기준: 강화 모드 전환\n`;
  } else {
    msg += `• 손절 기준: 완화 모드 전환\n`;
  }

  if (resetNote) {
    msg += resetNote;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  if (isDowngrade) {
    msg += `📌 현재 보유 포지션 점검 권고`;
  } else {
    msg += `📌 신규 진입 기회 탐색 권고`;
  }

  // IDEA 5 — 레짐별 구체 행동 가이드 블록 주입
  msg += renderPlaybook(currentRegime);

  // Phase 4: 레짐 변화 차등화 — 나빠짐(downgrade) = T1 즉각 행동, 좋아짐(upgrade) = T2 리포트.
  // "긍정 변화는 조용히 기록, 부정 변화는 즉각 경보" (참뮌 스펙 #8).
  await sendTelegramAlert(msg, isDowngrade
    ? { priority: 'CRITICAL', tier: 'T1_ALARM', dedupeKey: `regime-change-${currentRegime}`, category: 'regime_downgrade' }
    : { priority: 'HIGH',     tier: 'T2_REPORT', dedupeKey: `regime-change-${currentRegime}`, category: 'regime_upgrade' },
  ).catch(console.error);

  // 채널: 레짐 변화 경보 (개인 메시지보다 간결하게)
  await channelRegimeChange(
    _previousRegime,
    currentRegime,
    currentMhs ?? 0,
    isDowngrade ? '방어 강화' : '공격 전환',
  ).catch(console.error);

  console.log(`[RegimeBridge] 레짐 전환 알림: ${_previousRegime} → ${currentRegime}`);

  // 상태 갱신
  _previousRegime = currentRegime;
  _previousMhs = currentMhs;
  _previousVkospi = currentVkospi;
}
