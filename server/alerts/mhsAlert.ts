// @responsibility mhsAlert 알림 모듈
import fs from 'fs';
import { MHS_MORNING_ALERT_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { sendTelegramAlert } from './telegramClient.js';
import { dispatchAlert } from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';

export interface MhsMorningAlertState {
  prevMhs: number;   // 직전 알림 시점의 MHS
  checkedAt: string; // ISO — 마지막 체크 시각
}

function loadMhsMorningAlertState(): MhsMorningAlertState | null {
  ensureDataDir();
  if (!fs.existsSync(MHS_MORNING_ALERT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(MHS_MORNING_ALERT_FILE, 'utf-8')); } catch { return null; }
}

function saveMhsMorningAlertState(state: MhsMorningAlertState): void {
  ensureDataDir();
  fs.writeFileSync(MHS_MORNING_ALERT_FILE, JSON.stringify(state, null, 2));
}

/**
 * 아이디어 8: MHS 임계값 모닝 알림
 * - 매일 09:00 KST(평일) cron에서 호출.
 * - MHS < 40: RED 레짐 진입 — 전면 매수 중단 신호 (Telegram 알림).
 * - MHS ≥ 70 AND prevMhs < 70: GREEN 레짐 전환 진입 — 매수 재개 조건 충족 알림.
 * - prevMhs 를 파일에 저장하여 Railway 재시작 후에도 레짐 전환 감지 유지.
 */
export async function pollMhsMorningAlert(): Promise<void> {
  const macro = loadMacroState();
  if (!macro) return; // 매크로 상태 미설정 시 패스

  const mhs = macro.mhs;
  const alertState = loadMhsMorningAlertState();
  const prevMhs = alertState?.prevMhs ?? -1; // 초기값 -1 → 첫 실행에서 GREEN 전환 알림 억제

  if (mhs < 40) {
    const message =
      `📱 <b>QuantMaster Pro — MHS 아침 알림</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🔴 <b>RED 레짐 진입</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `⚠️ MHS ${mhs}/100 — RED 레짐 진입\n` +
      `전면 매수 중단 신호\n` +
      `\n` +
      `<b>추천 액션:</b>\n` +
      `① 신규 매수 전면 중단\n` +
      `② 현금 비중 확대 검토\n` +
      `③ 기존 롱 포지션 리스크 점검`;
    await sendTelegramAlert(message).catch(console.error);
    await dispatchAlert(AlertCategory.INFO, message, { disableNotification: false }).catch(console.error);
    console.log(`[MhsMorningAlert] RED 레짐 알림 발송 완료 (MHS=${mhs})`);
  }

  if (mhs >= 70 && prevMhs >= 0 && prevMhs < 70) {
    const message =
      `📱 <b>QuantMaster Pro — MHS 아침 알림</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🟢 <b>GREEN 레짐 전환 진입</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `✅ MHS ${mhs}/100 — GREEN 레짐 진입\n` +
      `매수 재개 조건 충족\n` +
      `\n` +
      `<b>추천 액션:</b>\n` +
      `① 관심 종목 매수 재개 검토\n` +
      `② 퀀트 엔진 평가 신호 재활성화\n` +
      `③ 분할 매수 스케줄 점검`;
    await sendTelegramAlert(message).catch(console.error);
    await dispatchAlert(AlertCategory.INFO, message, { disableNotification: true }).catch(console.error);
    console.log(`[MhsMorningAlert] GREEN 레짐 전환 알림 발송 완료 (MHS=${mhs}, prevMhs=${prevMhs})`);
  }

  saveMhsMorningAlertState({ prevMhs: mhs, checkedAt: new Date().toISOString() });
}
