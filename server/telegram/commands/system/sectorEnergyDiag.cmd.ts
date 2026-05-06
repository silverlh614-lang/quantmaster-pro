// @responsibility sectorEnergyDiag.cmd 텔레그램 모듈
// @responsibility: /sector_energy_diag — sectorEnergy 4-axis 통합 진단. SYS ADMIN read-only.
//
// ADR-0398 (= 사용자 명시 ADR-0373) — 사용자 명시 진단 명령:
//   1. sourceTier (KRX_CODE/STOCK_DAILY/CACHE/YAHOO_ETF/FAILED)
//   2. freshness (FRESH/DEGRADED/EXPIRED)
//   3. coverage (validSectorCount / 12)
//   4. confidence (0~1, sourceWeight × freshnessWeight × coverage)
//   5. dataQuality (OK/PARTIAL/STALE/DEGRADED/FAILED)
//   + STRONG_BUY 차단 여부 + 차단 사유 (ADR-0398 SSOT 호출)
//
// 외부 호출 0건 — read-only macroStateRepo. 부수효과 없음.

import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import {
  evaluateSectorEnergyStrongBuyGate,
  isSectorEnergyStrongBuyGateDisabled,
} from '../../../trading/sectorEnergyStrongBuyGate.js';
import type {
  SectorEnergyDataQuality5,
  SectorEnergySourceTier,
  SectorEnergyFreshness,
} from '../../../clients/sectorEnergyDataQuality.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/**
 * /sector_energy_diag 메시지 빌더 SSOT (단위 테스트 가능).
 *
 * 안전 invariant — read-only, 외부 호출 0건, manual override 트리거 0건.
 */
export function formatSectorEnergyDiagMessage(): string {
  const macro = loadMacroState();
  const lines: string[] = [];
  lines.push('🌐 <b>[Sector Energy 4-axis 진단]</b>');
  lines.push('');

  if (!macro) {
    lines.push('⚠️ <i>macroState 부재 — sectorEnergy 미수집</i>');
    return lines.join('\n');
  }

  // 5단계 dataQuality 마커 SSOT (ADR-0396 정합)
  const dataQuality = macro.sectorEnergyDataQuality as SectorEnergyDataQuality5 | undefined;
  const qualityEmoji =
    dataQuality === 'OK' ? '✅'
      : dataQuality === 'PARTIAL' ? '🟡'
      : dataQuality === 'STALE' ? '🟠'
      : dataQuality === 'DEGRADED' ? '🔶'
      : dataQuality === 'FAILED' ? '❌'
      : '⚪';

  lines.push(`${qualityEmoji} dataQuality: <b>${dataQuality ?? '미수집'}</b>`);

  // 4-axis 개별 표시 (ADR-0396 신규 필드)
  const sourceTier = macro.sectorEnergySourceTier as SectorEnergySourceTier | undefined;
  const freshness = macro.sectorEnergyFreshness as SectorEnergyFreshness | undefined;
  const coverage = macro.sectorEnergyCoverage;
  const confidence = macro.sectorEnergyConfidence;
  const validCount = macro.sectorEnergyValidSectorCount;

  if (sourceTier !== undefined) {
    lines.push(`📡 sourceTier: <b>${sourceTier}</b>`);
  } else {
    lines.push(`📡 sourceTier: <i>미수집 (ADR-0396 격상 전 영속 데이터)</i>`);
  }

  if (freshness !== undefined) {
    const freshEmoji = freshness === 'FRESH' ? '✅' : freshness === 'DEGRADED' ? '🟡' : '❌';
    lines.push(`⏱️ freshness: ${freshEmoji} <b>${freshness}</b>`);
  } else {
    lines.push(`⏱️ freshness: <i>미수집</i>`);
  }

  if (typeof coverage === 'number' && Number.isFinite(coverage)) {
    lines.push(`📊 coverage: <b>${(coverage * 100).toFixed(1)}%</b> (${validCount ?? '?'}/12 섹터)`);
  } else if (typeof validCount === 'number') {
    lines.push(`📊 coverage: <i>미수집</i> (${validCount}/12 섹터)`);
  } else {
    lines.push(`📊 coverage: <i>미수집</i>`);
  }

  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    const confEmoji = confidence >= 0.8 ? '✅' : confidence >= 0.6 ? '🟡' : confidence >= 0.3 ? '🟠' : '❌';
    lines.push(`🎯 confidence: ${confEmoji} <b>${(confidence * 100).toFixed(1)}%</b>`);
  } else {
    lines.push(`🎯 confidence: <i>미수집</i>`);
  }

  // ADR-0399 (= 사용자 명시 ADR-0374): KRX 원천 복구 진단 메타.
  // sourceTierAttempts / candidateDates / fallbackReason — 운영자 *어느 layer 가 작동했는지* 추적.
  // 사용자 명시 9 핵심 원칙 #9 — fallback 작동 시 UI 와 diagnostics 에 반드시 표시.
  const diag = macro.sectorEnergyDiagnostics;
  if (diag) {
    lines.push('');
    lines.push('🔍 <b>[KRX 원천 복구 진단 (ADR-0399)]</b>');
    if (diag.candidateDates && diag.candidateDates.length > 0) {
      lines.push(`📅 candidateDates: <code>${diag.candidateDates.join(', ')}</code>`);
    }
    if (diag.sourceTierAttempts && diag.sourceTierAttempts.length > 0) {
      lines.push(`🪜 sourceTierAttempts:`);
      for (const a of diag.sourceTierAttempts) {
        const reason = a.reason ? ` — ${a.reason}` : '';
        lines.push(`  • <b>${a.tier}</b>: validCount=${a.validCount}${reason}`);
      }
    }
    if (diag.fallbackReason) {
      lines.push(`⚠️ fallbackReason: <i>${diag.fallbackReason}</i>`);
    }
  }

  // ADR-0398 STRONG_BUY 게이트 결과
  lines.push('');
  if (isSectorEnergyStrongBuyGateDisabled()) {
    lines.push('🔓 <b>[STRONG_BUY 게이트 비활성]</b> (ENV `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true`)');
  } else if (
    sourceTier !== undefined &&
    dataQuality !== undefined &&
    typeof confidence === 'number'
  ) {
    const gate = evaluateSectorEnergyStrongBuyGate({
      confidence,
      dataQuality,
      sourceTier,
    });
    if (gate.forbidStrongBuy) {
      lines.push('🚫 <b>[STRONG_BUY 차단]</b> — 4 조건 OR 충족 (ADR-0398)');
      for (const reason of gate.reasons) {
        lines.push(`  • ${reason}`);
      }
      lines.push('');
      lines.push('<i>일반 BUY 는 차단되지 않음 — 섹터에너지는 보조 신호 (사용자 명시 정책).</i>');
    } else {
      lines.push('✅ <b>[STRONG_BUY 승격 허용]</b> — 4 조건 모두 통과');
    }
  } else {
    lines.push('⚠️ <b>[STRONG_BUY 게이트 평가 불가]</b> — 4-axis 데이터 미수집');
  }

  return lines.join('\n');
}

const sectorEnergyDiag: TelegramCommand = {
  name: '/sector_energy_diag',
  aliases: ['/sed', '/sector_diag'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Sector Energy 4-axis 진단 + STRONG_BUY 차단 사유 (ADR-0398)',
  usage: '/sector_energy_diag',
  async execute({ reply }) {
    try {
      const message = formatSectorEnergyDiagMessage();
      await reply(message);
    } catch (err) {
      console.error('[sectorEnergyDiag.cmd] failed', err);
      await reply('❌ Sector Energy 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(sectorEnergyDiag);

export default sectorEnergyDiag;
