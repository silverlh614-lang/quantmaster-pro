/**
 * @responsibility Guarded discovery pipeline entrypoint for production scanner/recommendation paths.
 *
 * ADR-0168/PR-546 wiring rule:
 * master unusable must return/throw SCAN_ABORTED before expensive scanner work begins.
 */

import type { MacroState } from '../persistence/macroStateRepo.js';
import type { RegimeLevel } from '../../src/types/core.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  assertProductionMasterUsable,
  formatProductionMasterBlockedMessage,
} from '../dataQuality/productionMasterGuard.js';
import { runFullDiscoveryPipeline } from './universeScanner.js';

export interface GuardedDiscoveryResult {
  ok: boolean;
  status: 'OK' | 'SCAN_ABORTED';
  reason?: string;
}

export async function runGuardedFullDiscoveryPipeline(
  regime: RegimeLevel,
  macroState: MacroState | null,
): Promise<GuardedDiscoveryResult> {
  try {
    assertProductionMasterUsable('SCANNER');
  } catch (err) {
    const reason = formatProductionMasterBlockedMessage(err);
    console.error(`[Pipeline] ${reason}`);
    await sendTelegramAlert(
      `🚨 <b>[AI 파이프라인] Scan aborted</b>\n` +
      `${reason}\n` +
      `Action:\n` +
      `- /kmr 강제 갱신\n` +
      `- /kms master total/TTL 확인\n` +
      `- /health KRX Master 상태 확인`,
      { priority: 'HIGH', dedupeKey: 'scan_aborted_master_unusable', cooldownMs: 10 * 60 * 1000 },
    ).catch(console.error);
    return { ok: false, status: 'SCAN_ABORTED', reason };
  }

  await runFullDiscoveryPipeline(regime, macroState);
  return { ok: true, status: 'OK' };
}
