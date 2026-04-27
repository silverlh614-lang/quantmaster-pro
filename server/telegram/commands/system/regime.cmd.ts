// @responsibility regime.cmd 텔레그램 모듈
// @responsibility: /regime 명령 — 매크로 레짐(MHS·VKOSPI·VIX·USD/KRW·Bear방어) 1메시지 요약.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const regime: TelegramCommand = {
  name: '/regime',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '매크로 레짐 + MHS + VKOSPI + USD/KRW + Bear방어 현황',
  async execute({ reply }) {
    const macro = loadMacroState();
    if (!macro) {
      await reply('❌ 매크로 상태 데이터 없음');
      return;
    }
    const mhsEmoji = (macro.mhs ?? 0) >= 60 ? '🟢' : (macro.mhs ?? 0) >= 40 ? '🟡' : '🔴';
    const regimeEmoji = macro.regime === 'GREEN' ? '🟢' : macro.regime === 'YELLOW' ? '🟡' : '🔴';
    const freshnessLine = formatRegimeFreshnessLine(macro.updatedAt);
    // ADR-0071: USD/KRW 출처 + 격차 표시 — 사용자 신뢰도 즉시 인지
    const usdKrwLine = formatUsdKrwLine(macro);
    await reply(
      `🌐 <b>[매크로 레짐 현황]</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${mhsEmoji} MHS: ${macro.mhs ?? 'N/A'}\n` +
      `${regimeEmoji} 레짐: ${macro.regime ?? 'N/A'}\n` +
      `📊 VKOSPI: ${macro.vkospi?.toFixed(1) ?? 'N/A'}\n` +
      `📊 VIX: ${macro.vix?.toFixed(1) ?? 'N/A'}\n` +
      `💱 USD/KRW: ${usdKrwLine}\n` +
      `📉 MHS추세: ${macro.mhsTrend ?? 'N/A'}\n` +
      `🐻 Bear방어: ${macro.bearDefenseMode ? '🔴 ON' : '🟢 OFF'}\n` +
      `📈 FSS경보: ${macro.fssAlertLevel ?? 'N/A'}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      freshnessLine,
    );
  },
};

/**
 * /regime 메시지의 신선도 라인 SSOT (PR-2 사용자 보고 #5).
 * 사용자가 "환율 1380 vs 실제 1474" 같은 stale 격차를 즉시 인지할 수 있도록
 * 마지막 갱신 시각 + N시간 경과 + ⚠️/❌ 마커 동시 노출.
 */
export function formatRegimeFreshnessLine(updatedAt?: string): string {
  if (!updatedAt) return '업데이트: N/A';
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return '업데이트: N/A';
  const ageMs = Date.now() - t;
  const ageHours = ageMs / 3600_000;
  const kstFull = new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const ageLabel = ageHours < 24
    ? `${ageHours.toFixed(1)}h 경과`
    : `${(ageHours / 24).toFixed(1)}d 경과`;
  let marker = '';
  if (ageHours > 24) marker = ' ❌ STALE 24h+ — /health 진단 권장';
  else if (ageHours > 8) marker = ' ⚠️ 갱신 지연';
  return `업데이트: ${kstFull} (${ageLabel})${marker}`;
}

/**
 * ADR-0071: USD/KRW 라벨 + 출처 + 격차 표시 SSOT.
 *
 * 사용자 보고 (2026-04-27): 환율 1,380 표시되지만 실제 시장 1,474. 신선도 라인은
 * ✅ 0.4h 인데 *값이 잘못됨*. Yahoo `KRW=X` 단일 소스 stale 이 원인이었으나
 * 운영자가 즉시 알 수 없었음. 본 라인이 출처(Yahoo/ECOS)와 격차 % 노출.
 *
 * 표시 분기:
 *   - AGREED + Yahoo (정상): "1,380 (Yahoo)"
 *   - WARN/CRITICAL: "1,474 (ECOS) ⚠️ Yahoo 1,380 격차 6.40%"
 *   - PRIMARY_ONLY: "1,380 (Yahoo·ECOS 미수집)"
 *   - SECONDARY_ONLY: "1,474 (ECOS·Yahoo 미수집)"
 *   - 데이터 부재: "N/A"
 */
export function formatUsdKrwLine(macro: {
  usdKrw?: number;
  usdKrwSource?: 'PRIMARY' | 'SECONDARY' | null;
  usdKrwDivergencePct?: number | null;
  usdKrwDivergenceTier?: string;
}): string {
  if (typeof macro.usdKrw !== 'number' || !Number.isFinite(macro.usdKrw)) return 'N/A';
  const valueLabel = macro.usdKrw.toLocaleString();
  const tier = macro.usdKrwDivergenceTier;
  const sourceLabel = macro.usdKrwSource === 'SECONDARY' ? 'ECOS' : 'Yahoo';

  if (!tier || tier === 'AGREED') {
    return `${valueLabel} (${sourceLabel})`;
  }
  if (tier === 'PRIMARY_ONLY') {
    return `${valueLabel} (Yahoo·ECOS 미수집)`;
  }
  if (tier === 'SECONDARY_ONLY') {
    return `${valueLabel} (ECOS·Yahoo 미수집)`;
  }
  if (tier === 'NO_DATA') {
    return `${valueLabel} (${sourceLabel}·격차 계산 불가)`;
  }
  // WARN / CRITICAL
  const divPct = macro.usdKrwDivergencePct;
  const divLabel = typeof divPct === 'number' ? `${divPct.toFixed(2)}%` : 'N/A';
  const marker = tier === 'CRITICAL' ? '❌' : '⚠️';
  return `${valueLabel} (${sourceLabel}) ${marker} 격차 ${divLabel}`;
}

commandRegistry.register(regime);

export default regime;
