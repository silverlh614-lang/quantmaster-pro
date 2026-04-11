import fs from 'fs';
import { BEAR_ALERT_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { sendTelegramAlert } from './telegramClient.js';

/** Bear 알림 재발송 최소 간격 (밀리초): 4시간 */
export const BEAR_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export interface BearAlertState {
  lastSentAt: string;   // ISO — 마지막 알림 발송 시각
  lastRegime: string;   // 마지막 알림 당시 regime
}

function loadBearAlertState(): BearAlertState | null {
  ensureDataDir();
  if (!fs.existsSync(BEAR_ALERT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(BEAR_ALERT_FILE, 'utf-8')); } catch { return null; }
}

function saveBearAlertState(state: BearAlertState): void {
  ensureDataDir();
  fs.writeFileSync(BEAR_ALERT_FILE, JSON.stringify(state, null, 2));
}

/**
 * 아이디어 10: Bear Regime 자동 알림 Push 시스템
 * - MacroState를 읽어 regime = 'RED' (Bear) 감지 시 Telegram 즉시 알림
 * - 쿨다운(4시간) 기반 중복 방지 — Bear 구간 내 반복 알림 억제
 * - KIS API 연동 없이 즉시 구현 가능한 세미-자동화 알림
 */
export async function pollBearRegime(): Promise<void> {
  const macro = loadMacroState();
  if (!macro) return; // 매크로 상태 없으면 패스

  // Gate0 buyingHalted 임계값(MHS < 40)과 명시적 RED 레짐 모두 Bear로 간주.
  const isBear = macro.regime === 'RED' || macro.mhs < 40;
  if (!isBear) return;

  // 쿨다운 체크 — 마지막 알림 이후 4시간 미경과 시 스킵
  const alertState = loadBearAlertState();
  if (alertState) {
    const elapsed = Date.now() - new Date(alertState.lastSentAt).getTime();
    if (elapsed < BEAR_ALERT_COOLDOWN_MS) return;
  }

  // 알림 메시지 구성
  const mhs        = macro.mhs;
  const vkospi     = macro.vkospi;
  const sellDays   = macro.foreignFuturesSellDays;
  const iri        = macro.iri;

  const vkospiLine =
    vkospi !== undefined
      ? `VKOSPI: ${vkospi.toFixed(1)} (${vkospi >= 30 ? '↑ 위험' : '관찰'})`
      : 'VKOSPI: N/A';

  const foreignLine =
    sellDays !== undefined
      ? `외국인 선물: ${sellDays}일 연속 순매도`
      : '외국인 선물: N/A';

  const iriLine =
    iri !== undefined
      ? `IRI: ${iri >= 0 ? '+' : ''}${iri.toFixed(1)}pt (${Math.abs(iri) >= 3 ? '위험 임계 초과' : '관찰'})`
      : 'IRI: N/A';

  const message =
    `📱 <b>QuantMaster Pro Alert</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔴 <b>BEAR REGIME 감지</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `MHS: ${mhs}/100 (RED)\n` +
    `${vkospiLine}\n` +
    `${foreignLine}\n` +
    `${iriLine}\n` +
    `\n` +
    `<b>추천 액션:</b>\n` +
    `① KODEX 200선물인버스2X 검토\n` +
    `② 현금 비중 30% 확보\n` +
    `③ 롱 포지션 50% 축소`;

  await sendTelegramAlert(message).catch(console.error);
  console.log(`[BearRegime] BEAR 감지 알림 발송 완료 (MHS=${mhs})`);

  saveBearAlertState({ lastSentAt: new Date().toISOString(), lastRegime: macro.regime });
}
