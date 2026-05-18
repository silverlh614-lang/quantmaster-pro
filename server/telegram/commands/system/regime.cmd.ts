// @responsibility regime.cmd 텔레그램 모듈
// @responsibility: /regime 명령 — 매크로 레짐(MHS·VKOSPI·VIX·USD/KRW·Bear방어) 1메시지 요약.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { resolveRegimeSnapshot } from '../../../trading/regime/regimeResolver.js';
import { REGIME_CONFIGS } from '../../../../src/services/quant/regimeEngine.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import type { RegimeLevel } from '../../../../src/types/core.js';
import { formatEngineRuntimePolicy, resolveEngineRuntimePolicy } from '../../../runtime/engineRuntimePolicy.js';

const regime: TelegramCommand = {
  name: '/regime',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '매크로 레짐 + 매매 레짐(R1~R6) + MHS + VKOSPI + USD/KRW + Bear방어 현황',
  async execute({ reply }) {
    const macro = loadMacroState();
    if (!macro) {
      await reply('❌ 매크로 상태 데이터 없음');
      return;
    }
    const mhsEmoji = (macro.mhs ?? 0) >= 60 ? '🟢' : (macro.mhs ?? 0) >= 40 ? '🟡' : '🔴';
    const regimeEmoji = macro.regime === 'GREEN' ? '🟢' : macro.regime === 'YELLOW' ? '🟡' : '🔴';
    const regimeSnapshot = resolveRegimeSnapshot({ macroState: macro });
    const resolvedMhsEmoji = regimeSnapshot.riskOverride === 'R6_DEFENSE' ? '🔴' : mhsEmoji;
    const resolvedRegimeEmoji = regimeSnapshot.riskOverride === 'R6_DEFENSE' ? '🔴' : regimeEmoji;
    const freshnessLine = formatRegimeFreshnessLine(macro.updatedAt);
    // ADR-0071: USD/KRW 출처 + 격차 표시 — 사용자 신뢰도 즉시 인지
    const usdKrwLine = formatUsdKrwLine(macro);
    // ADR-0074: macroState.regime (GREEN/YELLOW/RED) vs getLiveRegime (R1~R6) 두 SSOT 동시 노출.
    // 매매 결정에 실제 사용되는 RegimeLevel + Kelly/maxPositions 정책을 1줄로 요약.
    const regimeDiagnostics = regimeSnapshot.diagnostics;
    const liveRegime = regimeSnapshot.effectiveRegime as RegimeLevel;
    const liveRegimeLine = formatLiveRegimeLine(liveRegime);
    const r6RecoveryLine = formatR6RecoveryLine(regimeDiagnostics);
    const r6TriggerLine = formatR6TriggerBreakdownLine(regimeDiagnostics.r6TriggerBreakdown);
    const macroReleaseBlockLine = regimeSnapshot.macroReleaseBlockMessage
      ? `${regimeSnapshot.macroReleaseBlockMessage} ageSec=${regimeSnapshot.macroReleaseBlockDetails?.ageSec ?? 'N/A'} lastRefreshAttemptAt=${regimeSnapshot.macroReleaseBlockDetails?.lastRefreshAttemptAt ?? 'N/A'} refreshJobLastRunAt=${regimeSnapshot.macroReleaseBlockDetails?.refreshJobLastRunAt ?? 'N/A'}`
      : undefined;
    const runtimePolicy = resolveEngineRuntimePolicy({
      engineMode: 'NORMAL',
      macroRegime: regimeDiagnostics.effectiveRegime,
      liveBuyGateAllowed: regimeDiagnostics.effectiveRegime !== 'R6_DEFENSE',
      reasonCodes: regimeDiagnostics.effectiveRegime === 'R6_DEFENSE' ? ['R6_DEFENSE'] : [],
    });
    // ADR-0075 PR-4 wiring: 강세/소외 섹터 1줄 노출 — 운영자가 Gate +2/-1 부스트 영향 즉시 인지
    const sectorEnergyLine = formatSectorEnergyLine(macro);
    // ADR-0107 (사용자 진단 4/29 "MHS 70 을 벗어난 적이 없다"): 4-axis 분해 노출.
    const mhsAxisLine = formatMhsAxisLine(macro);
    await reply(
      `🌐 <b>[매크로 레짐 현황]</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${resolvedMhsEmoji} MHS: ${regimeSnapshot.mhs ?? 'N/A'}\n` +
      `${mhsAxisLine}\n` +
      `${resolvedRegimeEmoji} 매크로: ${regimeSnapshot.displayRegime}\n` +
      `${liveRegimeLine}\n` +
      `snapshotId=${regimeSnapshot.snapshotId} asOf=${regimeSnapshot.asOf} ttlSec=${regimeSnapshot.ttlSec}\n` +
      `rawRegime=${regimeDiagnostics.rawRegime}\n` +
      `effectiveRegime=${regimeDiagnostics.effectiveRegime}\n` +
      `${r6RecoveryLine}\n` +
      `${r6TriggerLine}\n` +
      `${macroReleaseBlockLine ? `${macroReleaseBlockLine}\n` : ''}` +
      `r6ShockLatch=${regimeDiagnostics.r6ShockLatch} recoveryBlockedReason=${regimeDiagnostics.recoveryBlockedReason ?? 'N/A'}\n` +
      `${formatEngineRuntimePolicy(runtimePolicy)}\n` +
      `📊 VKOSPI: ${macro.vkospi?.toFixed(1) ?? 'N/A'}\n` +
      `📊 VIX: ${macro.vix?.toFixed(1) ?? 'N/A'}\n` +
      `💱 USD/KRW: ${usdKrwLine}\n` +
      `📉 MHS추세: ${macro.mhsTrend ?? 'N/A'}\n` +
      `🐻 Bear방어: ${macro.bearDefenseMode ? '🔴 ON' : '🟢 OFF'}\n` +
      `📈 FSS경보: ${macro.fssAlertLevel ?? 'N/A'}\n` +
      `${sectorEnergyLine}\n` +
      `sourceFreshness=${regimeDiagnostics.sourceFreshness}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      freshnessLine,
    );
  },
};

export function formatR6RecoveryLine(input: {
  r6RecoveryStatus: string;
  cooldownUntil?: string;
  transitionReason: string;
  recoveryEvidence: { reasons?: string[]; confirmations?: number; requiredConfirmations?: number };
}): string {
  const reasons = input.recoveryEvidence.reasons?.join(', ') ?? 'N/A';
  const confirmations = `${input.recoveryEvidence.confirmations ?? 0}/${input.recoveryEvidence.requiredConfirmations ?? 0}`;
  return `r6RecoveryStatus=${input.r6RecoveryStatus} cooldownUntil=${input.cooldownUntil ?? 'N/A'} confirmations=${confirmations} recoveryEvidence=${reasons} transitionReason=${input.transitionReason}`;
}

export function formatR6TriggerBreakdownLine(input: { activeR6Triggers: string[]; staleR6Triggers: string[]; kospiDayReturn?: number; kospiCloseReturn?: number; kospiIntradayLowReturn?: number; kospiIntradayHighReturn?: number; vkospiDayChange?: number; usdKrwDayChange?: number; triggerFreshness: string; staleCarryForward: boolean; staleBlockedRecovery: boolean }): string {
  const fmt = (value: number | undefined) => value === undefined ? 'N/A' : value.toFixed(2);
  return `r6TriggerBreakdown activeR6Triggers=[${input.activeR6Triggers.join(',') || 'none'}] staleR6Triggers=[${input.staleR6Triggers.join(',') || 'none'}] kospiDayReturn=${fmt(input.kospiDayReturn)} kospiCloseReturn=${fmt(input.kospiCloseReturn)} kospiIntradayLowReturn=${fmt(input.kospiIntradayLowReturn)} kospiIntradayHighReturn=${fmt(input.kospiIntradayHighReturn)} vkospiDayChange=${fmt(input.vkospiDayChange)} usdKrwDayChange=${fmt(input.usdKrwDayChange)} triggerFreshness=${input.triggerFreshness} staleCarryForward=${input.staleCarryForward} staleBlockedRecovery=${input.staleBlockedRecovery}`;
}

/**
 * ADR-0075 PR-4 wiring: 강세/소외 섹터 라인 SSOT.
 *
 * macroState.sectorEnergyResult (marketDataRefresh 영속) 의 LEADING/LAGGING 결과를
 * 1줄로 노출. 운영자가 "지금 어떤 섹터가 +2 가산점을 받고 있나" 를 즉시 인지.
 *
 * 표시 분기:
 *   - sectorEnergyResult 부재 → "🎯 강세 섹터: N/A (미수집)"
 *   - LEADING 0건 + LAGGING 0건 → "🎯 강세 섹터: 데이터 부족"
 *   - 정상 → "🎯 강세: 반도체, 이차전지, 바이오 / 소외: 건설, 유통"
 */
export function formatSectorEnergyLine(macro: {
  sectorEnergyResult?: {
    leadingSectors: { name: string }[];
    laggingSectors: { name: string }[];
  };
}): string {
  const result = macro.sectorEnergyResult;
  if (!result) return '🎯 섹터 에너지: N/A (미수집)';
  const leading = result.leadingSectors.map(s => s.name).join(', ');
  const lagging = result.laggingSectors.map(s => s.name).join(', ');
  if (!leading && !lagging) return '🎯 섹터 에너지: 데이터 부족';
  const parts: string[] = [];
  if (leading) parts.push(`강세 ${leading}`);
  if (lagging) parts.push(`소외 ${lagging}`);
  return `🎯 ${parts.join(' / ')}`;
}

/**
 * ADR-0074: 매매 레짐(R1~R6) 라인 SSOT.
 *
 * 사용자 운영 보고 (2026-04-27): "거시 regime 정보에 대한 신뢰도가 떨어진다."
 * 직접 원인: /regime 메시지가 macroState.regime (GREEN/YELLOW/RED) 만 표시했고
 * 매매 결정에 실제 사용되는 getLiveRegime() 의 RegimeLevel R1_TURBO~R6_DEFENSE
 * 를 미노출 — 운영자가 "왜 매매가 안 되지" 같은 질문에 메시지로 답을 못 받음.
 *
 * 이모지 분류 (방어 → 공격):
 *   R6_DEFENSE: 🛑 (매수 전면 차단)
 *   R5_CAUTION: 🟡 (CONFIRMED_STRONG_BUY 만)
 *   R4_NEUTRAL: 🟠 (선택적 진입)
 *   R3_EARLY:   🌱 (선취매)
 *   R2_BULL:    🟢 (적극 매수)
 *   R1_TURBO:   🔥 (공격 모드 MAX)
 */
export function formatLiveRegimeLine(liveRegime: RegimeLevel): string {
  const cfg = REGIME_CONFIGS[liveRegime];
  const emoji =
    liveRegime === 'R6_DEFENSE' ? '🛑' :
    liveRegime === 'R5_CAUTION' ? '🟡' :
    liveRegime === 'R4_NEUTRAL' ? '🟠' :
    liveRegime === 'R3_EARLY'   ? '🌱' :
    liveRegime === 'R2_BULL'    ? '🟢' :
    liveRegime === 'R1_TURBO'   ? '🔥' : '⚙️';
  if (!cfg) return `⚙️ 매매: ${liveRegime}`;
  const kellyLabel = cfg.kellyMultiplier === 0
    ? '신규 진입 차단'
    : `Kelly ×${cfg.kellyMultiplier.toFixed(2)}`;
  return `${emoji} 매매: ${liveRegime} (${kellyLabel}, 최대 ${cfg.maxPositions}포지션)`;
}

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

/**
 * ADR-0107 (사용자 진단 4/29): MHS 4-axis 분해 라인 SSOT.
 *
 * 사용자 보고: "MHS 가 계속 70 을 벗어난 적이 없는 것 같다 — 제대로 나오는건지?".
 * 코드 분석 결과 MHS 70 은 *함수 정상 작동* 의 narrow band 자연 수렴 — 4 axis
 * (금리=20, 유동성=15, 경기=15, 리스크=25 → 합 75) fallback 합산. 시장이
 * 중립 zone 에 머무르는 한 70 근방.
 *
 * 본 라인은 axis 분해를 운영자에게 직접 노출 — 어느 축이 *변동* 하고 어느 축이
 * *fallback 으로 고정* 되어 있는지 즉시 진단 가능.
 *
 * 표시 분기:
 *   - mhsAxis 부재 → "🧮 axis: N/A (다음 marketDataRefresh 사이클부터 노출)"
 *   - 정상 → "🧮 axis: 금리 20 / 유동성 15 / 경기 15 / 리스크 25 (합 75)"
 *   - mhsAxisUpdatedAt 동반 (ADR-0187): " · 갱신 Nh 전" 또는 " · 갱신 Nm 전" suffix
 *     ageHours ≥ 24 시 ⚠️ STALE 마커 (운영자 cron 미실행 즉시 인지).
 */
export function formatMhsAxisLine(macro: {
  mhsAxis?: { interestRate: number; liquidity: number; economy: number; risk: number };
  mhsAxisUpdatedAt?: string;
}, now: Date = new Date()): string {
  const a = macro.mhsAxis;
  if (!a) return '🧮 axis: N/A (다음 marketDataRefresh 사이클부터 노출)';
  const sum = a.interestRate + a.liquidity + a.economy + a.risk;
  const base =
    `🧮 axis: 금리 ${a.interestRate} / 유동성 ${a.liquidity} / 경기 ${a.economy} / 리스크 ${a.risk}` +
    ` (합 ${sum})`;
  // ADR-0187: 갱신 시각 read wiring — mhsAxisUpdatedAt 영속만 되고 read 누락이던 dead-read 차단.
  if (!macro.mhsAxisUpdatedAt) return base;
  const t = Date.parse(macro.mhsAxisUpdatedAt);
  if (!Number.isFinite(t)) return base;
  const ageMs = now.getTime() - t;
  if (ageMs < 0) return base;
  const ageMin = Math.floor(ageMs / 60_000);
  const ageHours = Math.floor(ageMs / 3_600_000);
  const suffix =
    ageHours >= 24
      ? ` · 갱신 ${Math.floor(ageHours / 24)}일 전 ⚠️ STALE`
      : ageHours >= 1
        ? ` · 갱신 ${ageHours}h 전`
        : ` · 갱신 ${ageMin}m 전`;
  return base + suffix;
}

commandRegistry.register(regime);

export default regime;
