import fs from 'fs';
import { IPS_ALERT_FILE, ensureDataDir } from '../persistence/paths.js';
import { type MacroState, loadMacroState } from '../persistence/macroStateRepo.js';
import { sendTelegramAlert } from './telegramClient.js';
import { dispatchAlert } from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';
import { updateKellyDampenerFromIps } from '../trading/kellyDampener.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';

/** IPS 알림 단계별 재발송 최소 간격 */
export const IPS_ALERT_COOLDOWN_MS: Record<string, number> = {
  WARNING:  2 * 60 * 60 * 1000, // WARNING: 2시간
  CRITICAL: 4 * 60 * 60 * 1000, // CRITICAL: 4시간
  EXTREME:  6 * 60 * 60 * 1000, // EXTREME: 6시간
};

export interface IpsAlertState {
  lastSentAt: string;  // ISO — 마지막 알림 발송 시각
  lastLevel: string;   // 마지막 발송 단계
  lastIps: number;     // 마지막 발송 IPS 점수
}

function loadIpsAlertState(): IpsAlertState | null {
  ensureDataDir();
  if (!fs.existsSync(IPS_ALERT_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(IPS_ALERT_FILE, 'utf-8')); } catch { return null; }
}

function saveIpsAlertState(state: IpsAlertState): void {
  ensureDataDir();
  fs.writeFileSync(IPS_ALERT_FILE, JSON.stringify(state, null, 2));
}

/**
 * MacroState 필드를 사용하여 서버사이드 IPS를 계산한다.
 * 클라이언트 evaluateIPS()와 동일한 가중치 적용.
 */
function computeServerIps(macro: MacroState): { ips: number; signals: string[] } {
  const mhs       = macro.mhs;
  const regime    = macro.regime;
  const vkospi    = macro.vkospi ?? 0;
  const vix       = macro.vix ?? 0;

  const signals: string[] = [];
  let ips = 0;

  // THS 역전 (20%): MHS 하락 추세 / 매수 중단 임계 미달
  const thsTriggered =
    regime === 'RED' ||
    mhs < 40 ||
    macro.mhsTrend === 'DETERIORATING' ||
    mhs < 50;
  if (thsTriggered) { ips += 20; signals.push(`THS 역전 (MHS=${mhs})`); }

  // VDA (15%): VIX / VKOSPI 공포지수 상승 이탈
  const vdaTriggered = vix >= 22 || vkospi >= 22 || macro.vkospiRising === true;
  if (vdaTriggered) { ips += 15; signals.push(`VDA (VIX=${vix.toFixed(1)}, VKOSPI=${vkospi.toFixed(1)})`); }

  // FSS 음수 (20%): Bear Regime 조건 3개 이상 발동
  const bearCount = macro.bearRegimeTriggeredCount ?? 0;
  const fssTriggered = bearCount >= 3;
  if (fssTriggered) { ips += 20; signals.push(`FSS 음수 (Bear 조건 ${bearCount}개)`); }

  // FBS 2단계 (20%): Bear 레짐 진입 / 방어 모드
  const fbsTriggered = regime === 'RED' || macro.bearDefenseMode === true;
  if (fbsTriggered) { ips += 20; signals.push(`FBS 2단계 (${regime}${macro.bearDefenseMode ? ' 방어모드' : ''})`); }

  // TMA 감속 (15%): OECD CLI 하강 / 수출 증가율 음수
  const cli         = macro.oeciCliKorea ?? 100;
  const exportGrowth = macro.exportGrowth3mAvg ?? 0;
  const tmaTriggered = cli < 100 || exportGrowth < 0;
  if (tmaTriggered) { ips += 15; signals.push(`TMA 감속 (CLI=${cli.toFixed(1)}, 수출=${exportGrowth >= 0 ? '+' : ''}${exportGrowth.toFixed(1)}%)`); }

  // SRR 역전 (10%): DXY 강세 / KOSPI 120일선 하회
  const srrTriggered = macro.dxyBullish === true || macro.kospiBelow120ma === true;
  if (srrTriggered) { ips += 10; signals.push(`SRR 역전 (DXY강세:${macro.dxyBullish ?? false}, KOSPI<120MA:${macro.kospiBelow120ma ?? false})`); }

  return { ips, signals };
}

/**
 * 아이디어 11: IPS 변곡점 경보 폴링
 * - 15분 간격 24/7 실행 (장 외 시간 포함)
 * - IPS ≥ 60% → ⚠️ WARNING 텔레그램 알림
 * - IPS ≥ 80% → 🚨 CRITICAL 50% 비중 축소 트리거
 * - IPS ≥ 90% → 🔴 EXTREME Pre-Mortem 체크리스트
 * - 단계별 쿨다운(2/4/6시간)으로 중복 알림 억제
 */
export async function pollIpsAlert(): Promise<void> {
  const macro = loadMacroState();
  if (!macro) return; // 매크로 상태 미설정 시 패스

  const { ips, signals } = computeServerIps(macro);

  // ── IPS × MAPC 피드백 루프 ─────────────────────────────────────────────
  // IPS 값 변화에 맞춰 Kelly 감쇠 배율을 갱신한다. 배율이 변했으면
  // 기존 포지션 보유자에게 "변곡 감지 알림"을 별도로 송출한다.
  const dampener = updateKellyDampenerFromIps(ips);
  if (dampener.changed) {
    const openShadowCount = loadShadowTrades().filter((s) => isOpenShadowStatus(s.status)).length;
    const direction = dampener.multiplier < dampener.prevMultiplier ? '강화' : '완화';
    const arrow = `×${dampener.prevMultiplier.toFixed(2)} → ×${dampener.multiplier.toFixed(2)}`;
    await sendTelegramAlert(
      `🔔 <b>[변곡 감지 알림]</b> IPS ${ips}% (${dampener.level})\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `• Kelly 감쇠 ${direction}: <b>${arrow}</b>\n` +
      `• 활성 포지션: ${openShadowCount}개\n` +
      `• 신규 진입 크기가 자동으로 조정됩니다`,
      { priority: dampener.multiplier < 0.5 ? 'CRITICAL' : 'HIGH', dedupeKey: `ips_kelly:${dampener.multiplier}` },
    ).catch(console.error);
    console.log(`[IpsAlert] Kelly 감쇠 업데이트 ${arrow} (IPS=${ips}%, 포지션 ${openShadowCount}개)`);
  }

  // IPS < 60 → NORMAL, 알림 없음
  if (ips < 60) return;

  const level = ips >= 90 ? 'EXTREME' : ips >= 80 ? 'CRITICAL' : 'WARNING';

  // 쿨다운 체크
  const alertState = loadIpsAlertState();
  if (alertState) {
    const elapsed   = Date.now() - new Date(alertState.lastSentAt).getTime();
    const cooldown  = IPS_ALERT_COOLDOWN_MS[level] ?? 2 * 60 * 60 * 1000;
    // 같은 단계이면 쿨다운 적용, 더 심각한 단계로 상승하면 즉시 발송
    const levelOrder = ['WARNING', 'CRITICAL', 'EXTREME'];
    const lastIdx    = levelOrder.indexOf(alertState.lastLevel);
    const curIdx     = levelOrder.indexOf(level);
    if (elapsed < cooldown && curIdx <= lastIdx) return;
  }

  // 단계별 이모지 및 행동 메시지
  let levelEmoji: string;
  let action1: string;
  let action2: string;
  let action3: string;
  if (level === 'EXTREME') {
    levelEmoji = '🔴';
    action1 = 'Pre-Mortem 체크리스트 즉시 실행';
    action2 = '포지션 전면 재검토 및 손절 라인 재설정';
    action3 = '현금 비중 50% 이상 확보 권고';
  } else if (level === 'CRITICAL') {
    levelEmoji = '🚨';
    action1 = '포지션 50% 비중 즉시 축소';
    action2 = '인버스 ETF 또는 현금 전환 검토';
    action3 = '손절 강화 및 신규 매수 중단';
  } else {
    levelEmoji = '⚠️';
    action1 = '신규 매수 자제';
    action2 = '기존 포지션 손절 라인 재점검';
    action3 = '변동성 대비 현금 10~20% 확보';
  }

  const signalLines = signals.map(s => `  • ${s}`).join('\n');

  const message =
    `📱 <b>QuantMaster Pro — IPS 변곡점 경보</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${levelEmoji} <b>[${level}] IPS ${ips}%</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>발동 신호:</b>\n${signalLines}\n` +
    `\n` +
    `<b>추천 액션:</b>\n` +
    `① ${action1}\n` +
    `② ${action2}\n` +
    `③ ${action3}`;

  await sendTelegramAlert(message).catch(console.error);
  await dispatchAlert(
    AlertCategory.INFO,
    message,
    { disableNotification: level !== 'CRITICAL' && level !== 'EXTREME' },
  ).catch(console.error);
  console.log(`[IpsAlert] ${level} 경보 발송 완료 (IPS=${ips}%)`);

  saveIpsAlertState({ lastSentAt: new Date().toISOString(), lastLevel: level, lastIps: ips });
}
