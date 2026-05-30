// @responsibility ADR-0544 SectorEnergy 세션 표시 헬퍼 — KIS auth/skip 분리 + Health 블록 렌더. 게이팅 무관, executionImpact=NONE.

import type { OfficialSectorIndexMasterCoverageResult } from '../../../sector/SectorIndexVerifier.js';
import type { SectorEnergyCanonicalState } from '../../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';

/**
 * ADR-0544: KisIndexQuoteClientStatus 표시를 session-skip vs 실제 auth-fail 로 분리한다 (표시 전용).
 * 휴일/비장중(SECTOR_INDEX_MARKET_CLOSED) verify-skip 시 clientStatus 가 undefined 라서 기본
 * enabled=false/authReady=false 가 인증장애처럼 보이던 표시 과장을 정정한다. 게이팅 무관.
 *  - session-closed → sessionCallable=false skipReason=SESSION_CLOSED_OR_HOLIDAY
 *    authReady/tokenPresent=NOT_REQUIRED_FOR_SKIPPED_VERIFY providerIssue=false (불변식 6: providerIssue≠bearish)
 *  - 실제 인증장애(verify 시도했으나 clientStatus.authReady=false) → skipReason=AUTH_NOT_READY providerIssue=true
 *  - 정상/그 외 → 기존 clientStatus 필드 그대로 표시
 */
export function renderKisIndexQuoteClientStatusLineAdr0544(
  master: OfficialSectorIndexMasterCoverageResult,
  prefix: string,
): string {
  const sessionClosed = (master.reasonCodes ?? []).includes('SECTOR_INDEX_MARKET_CLOSED');
  const cs = master.kisIndexQuoteClientStatus;
  if (sessionClosed && !cs) {
    return (
      `${prefix} sessionCallable=false skipReason=SESSION_CLOSED_OR_HOLIDAY ` +
      `enabled=NOT_REQUIRED_FOR_SKIPPED_VERIFY verifyMode=SESSION_SKIPPED livePromotionFromVerify=false ` +
      `authReady=NOT_REQUIRED_FOR_SKIPPED_VERIFY tokenPresent=NOT_REQUIRED_FOR_SKIPPED_VERIFY ` +
      `apiPath=${master.verifyApiPath} trId=${master.verifyTrId} ` +
      `providerIssue=false executionImpact=NONE`
    );
  }
  const sessionCallable = true;
  const authReady = cs?.authReady === true;
  const realAuthFailure = sessionCallable && cs !== undefined && !authReady;
  const skipReason = realAuthFailure ? 'AUTH_NOT_READY' : 'NONE';
  const providerIssue = realAuthFailure ? true : false;
  return (
    `${prefix} sessionCallable=${sessionCallable} skipReason=${skipReason} ` +
    `enabled=${cs?.enabled === true} verifyMode=${cs?.verifyMode ?? 'OBSERVE'} ` +
    `livePromotionFromVerify=${cs?.livePromotionFromVerify ?? false} ` +
    `authReady=${authReady} tokenPresent=${cs?.tokenPresent === true} ` +
    `tokenExpiresInSec=${cs?.tokenExpiresInSec ?? 'NONE'} ` +
    `tokenProvider=${cs?.tokenProvider ?? 'KIS_SHARED_TOKEN_PROVIDER'} ` +
    `baseUrlKind=${cs?.baseUrlKind ?? 'UNKNOWN'} ` +
    `apiPath=${cs?.apiPath ?? master.verifyApiPath} method=${cs?.method ?? 'GET'} ` +
    `trId=${cs?.trId ?? master.verifyTrId} canCall=${cs?.canCall === true} ` +
    `disabledReason=${cs?.disabledReason ?? 'NONE'} ` +
    `lastExceptionClass=${cs?.lastExceptionClass ?? 'NONE'} ` +
    `lastExceptionMessageSanitized=${cs?.lastExceptionMessageSanitized ?? 'NONE'} ` +
    `providerIssue=${providerIssue} executionImpact=NONE`
  );
}

/**
 * ADR-0544: Bottleneck Truth Summary 용 SectorEnergy Health 블록 (표시 전용).
 * 휴일/비장중 verify-skip 을 소스 결함이 아닌 세션 닫힘으로 정직하게 보고한다.
 * promotion 게이팅(canonical.promotionAllowed)은 그대로 읽기만 한다 — 무변경.
 */
export function renderSectorEnergyHealthBlockAdr0544(
  canonical: SectorEnergyCanonicalState,
): string {
  const sessionClosed = canonical.sectorIndexVerifyMode === 'VERIFY_SKIPPED_SESSION_CLOSED';
  const liveIndexVerify = sessionClosed ? 'SKIPPED_SESSION_CLOSED' : 'LIVE_VERIFY';
  const promotionLabel = canonical.promotionAllowed
    ? 'ENABLED'
    : sessionClosed
      ? 'DISABLED_FOR_SESSION'
      : 'DISABLED';
  const operatorMessage = sessionClosed
    ? 'Observe SectorEnergy verify on next trading session; no live action required during HOLIDAY.'
    : canonical.promotionAllowed
      ? 'SectorEnergy coverage verified; promotion eligible.'
      : 'Repair SectorEnergy index master before promotion.';
  return [
    'SectorEnergy Health:',
    '  Official sector master: LOADED',
    `  Live index verify: ${liveIndexVerify}`,
    `  Promotion: ${promotionLabel}`,
    `  Shadow evidence: ${canonical.shadowLeadershipAllowed ? 'ALLOWED' : 'BLOCKED'}`,
    `  ExecutionImpact: ${canonical.executionImpact}`,
    `  OperatorMessage: ${operatorMessage}`,
  ].join('\n');
}
