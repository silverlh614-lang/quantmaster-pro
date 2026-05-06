// @responsibility /health_full 통합 진단 명령 — 다중 SSOT 진단 API 결합 (ADR-0258)
/**
 * healthFull.cmd.ts — `/health_full` 텔레그램 명령.
 *
 * 본 세션 5/6 9 PR 사슬 (#622~#633) 의 진단 API 들을 단일 화면으로 통합:
 *   ① R3 Sanity (ADR-0211 / r3SanityBlockRepo)
 *   ② 워치리스트 시장 다양성 (ADR-0248 / watchlistDiversityMonitor)
 *   ③ KRX cooldown 상태 (ADR-0251 / 0259 / krxClient.getKrxBldFailureStates)
 *   ④ Yahoo 갱신 신뢰도 분포 (ADR-0255 / yahooFreshnessLedger.summarize)
 *   ⑤ 결함 진화 ledger 요약 (ADR-0260 / defectEvolutionLedger.summarize)
 *
 * 운영자가 단일 명령으로 모든 진단 데이터 한 화면에서 인지.
 * Read-only — LIVE 매매 무관, 진단 API 만 호출.
 */

import { loadR3SanityBlockState } from '../../../persistence/r3SanityBlockRepo.js';
import { computeWatchlistDiversity } from '../../../learning/watchlistDiversityMonitor.js';
import { getKrxBldFailureStates } from '../../../clients/krxClient.js';
import { summarizeFreshnessLedger } from '../../../persistence/yahooFreshnessLedger.js';
import { summarizeDefectEvolution } from '../../../learning/defectEvolutionLedger.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const healthFull: TelegramCommand = {
  name: '/health_full',
  aliases: ['/healthfull', '/hf'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '통합 진단 — R3 / 워치리스트 다양성 / KRX cooldown / Yahoo 신뢰도 / 결함 진화 (ADR-0258)',
  async execute({ reply }) {
    await reply(buildHealthFullMessage());
  },
};

commandRegistry.register(healthFull);

export default healthFull;

// ─── 텍스트 포맷팅 ────────────────────────────────────────────────────────

export function buildHealthFullMessage(): string {
  const lines: string[] = [
    '🔬 <b>QuantMaster Health Full Diagnostics</b>',
    '',
  ];

  // ① R3 Sanity (ADR-0211)
  try {
    const r3 = loadR3SanityBlockState();
    const status = r3.active ? '🔴 ON' : '🟢 OFF';
    lines.push('<b>① R3 Sanity Latch (ADR-0211)</b>');
    lines.push(`Status: ${status}`);
    if (r3.active) {
      lines.push(`사유: ${r3.violation} | 레짐: ${r3.regime}`);
      lines.push(`발동: ${r3.triggeredAt}`);
      if (r3.acknowledgedAt) {
        lines.push(`ack: ${r3.acknowledgedBy ?? 'unknown'} @ ${r3.acknowledgedAt}`);
      }
    }
    lines.push('');
  } catch (e) {
    lines.push('<b>① R3 Sanity</b>: 조회 실패');
    lines.push('');
  }

  // ② 워치리스트 시장 다양성 (ADR-0248)
  try {
    const div = computeWatchlistDiversity();
    const levelEmoji = div.alertLevel === 'OK' ? '✅'
      : div.alertLevel === 'INSUFFICIENT_SAMPLE' ? 'ℹ️'
      : '⚠️';
    lines.push('<b>② 워치리스트 시장 다양성 (ADR-0248)</b>');
    lines.push(
      `${levelEmoji} ${div.alertLevel} | SWING ${div.swingCount}건 (총 ${div.totalCount})`,
    );
    lines.push(
      `KOSPI ${(div.kospiRatio * 100).toFixed(0)}% | ` +
      `KOSDAQ ${(div.kosdaqRatio * 100).toFixed(0)}% | ` +
      `UNKNOWN ${(div.unknownRatio * 100).toFixed(0)}%`,
    );
    if (div.alertReason) lines.push(`  └ ${div.alertReason}`);
    lines.push('');
  } catch {
    lines.push('<b>② 워치리스트 다양성</b>: 조회 실패');
    lines.push('');
  }

  // ③ KRX cooldown (ADR-0251 / 0259)
  try {
    const krx = getKrxBldFailureStates();
    const activeCooldown = krx.filter(s => s.cooldownActive);
    const inProbe = krx.filter(s => s.recoveryProbe);
    lines.push('<b>③ KRX Cooldown (ADR-0251 / 0259)</b>');
    if (activeCooldown.length === 0 && inProbe.length === 0) {
      lines.push('✅ 활성 cooldown 0건');
    } else {
      if (activeCooldown.length > 0) {
        const preview = activeCooldown
          .slice(0, 3)
          .map(s => `${s.bld} (${(s.cooldownRemainingMs / 60_000).toFixed(0)}분)`)
          .join(', ');
        lines.push(
          `❌ Cooldown 활성 ${activeCooldown.length}건: ${preview}` +
          (activeCooldown.length > 3 ? ` 외 ${activeCooldown.length - 3}건` : ''),
        );
      }
      if (inProbe.length > 0) {
        lines.push(`🔄 Probe 윈도우 ${inProbe.length}건 (cooldown 만료 30분 안)`);
      }
    }
    lines.push('');
  } catch {
    lines.push('<b>③ KRX Cooldown</b>: 조회 실패');
    lines.push('');
  }

  // ④ Yahoo 신뢰도 분포 (ADR-0255)
  try {
    const fr = summarizeFreshnessLedger();
    lines.push('<b>④ Yahoo 갱신 신뢰도 (ADR-0255)</b>');
    lines.push(`총 ${fr.totalCodes}개 종목 추적`);
    lines.push(
      `✅ TRUSTED ${fr.trusted} | 🟡 DEGRADED ${fr.degraded} | 🔴 UNRELIABLE ${fr.unreliable}`,
    );
    if (fr.unreliable > 0) {
      const preview = fr.unreliableSymbols.slice(0, 3).join(', ');
      lines.push(
        `  └ UNRELIABLE: ${preview}` +
        (fr.unreliable > 3 ? ` 외 ${fr.unreliable - 3}건` : ''),
      );
    }
    lines.push('');
  } catch {
    lines.push('<b>④ Yahoo 신뢰도</b>: 조회 실패');
    lines.push('');
  }

  // ⑤ 결함 진화 ledger (ADR-0260)
  try {
    const de = summarizeDefectEvolution();
    lines.push('<b>⑤ 결함 진화 Ledger (ADR-0260)</b>');
    lines.push(
      `총 ${de.total}건 (진행 ${de.inProgress} / 해결 ${de.resolved} / 포기 ${de.abandoned})`,
    );
    if (de.longestChain) {
      lines.push(
        `최장 사슬: ${de.longestChain.evolutionId} (${de.longestChain.layers} layer)`,
      );
    }
    if (de.total > 0) {
      lines.push(`평균 ${de.averageLayers.toFixed(1)} layer / incident`);
    }
  } catch {
    lines.push('<b>⑤ 결함 진화</b>: 조회 실패');
  }

  return lines.join('\n');
}
