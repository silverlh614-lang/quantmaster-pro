// @responsibility PATCH-010 §"/sizing_debug" — 사이징 룰 read-only 진단 명령 (프로파일 매트릭스 + ENV + minNotional 설정)
/**
 * PATCH-010 §"/sizing_debug" 텔레그램 명령.
 *
 * Shadow/LIVE 레짐 노출 프로파일 매트릭스 + floor/정확노출 ENV 상태 +
 * minNotional 보정 설정을 단일 화면으로 노출하는 read-only 진단 명령.
 *
 * 절대 규칙:
 *   - read-only — 영속 read / KIS·KRX·Yahoo·Naver outbound 0건 (정적 config 조회만).
 *   - LIVE 매매 본체 무관 — 진단 표시 전용.
 *   - formatSizingDebugMessage 는 ENV 를 인자로 받는 순수 함수 (단위 테스트 가능).
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  SHADOW_REGIME_EXPOSURE_PROFILE,
  LIVE_REGIME_EXPOSURE_PROFILE,
  isShadowBullExposureFloorEnabled,
  MIN_CANDIDATE_SHARES,
  MIN_NOTIONAL_PRICE_CEILING_RATIO,
  type RegimeExposureProfile,
} from '../../../trading/sizing/shadowBullExposureProfile.js';
import { isAccurateExposureEnabled } from '../../../trading/sizing/currentEquityExposure.js';

export interface SizingDebugInputs {
  /** SHADOW_BULL_EXPOSURE_FLOOR_ENABLED ENV 상태 */
  readonly floorEnabled: boolean;
  /** POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED ENV 상태 */
  readonly accurateExposureEnabled: boolean;
}

/** exposure 레짐을 강세→약세 순으로 고정 노출 (Object key 순서 의존 차단). */
const REGIME_ORDER = [
  'R6_STRONG_BULL',
  'R5_BULL',
  'R4_RECOVERY',
  'R3_NEUTRAL',
  'R2_WEAK',
  'R1_DEFENSIVE',
  'R0_CRISIS',
] as const;

function formatProfileLine(p: RegimeExposureProfile): string {
  const target = `${(p.accountTargetExposurePct * 100).toFixed(0)}%`;
  const floor = `${(p.candidateFloorPct * 100).toFixed(2)}%`;
  return `  ${p.regime.padEnd(15)} target ${target.padStart(4)} · floor ${floor}`;
}

/** 메시지 빌더 SSOT — ENV 인자 주입 (process.env 직접 read 없음 — 단위 테스트 가능). */
export function formatSizingDebugMessage(input: SizingDebugInputs): string {
  const shadowLines = REGIME_ORDER.map((r) => formatProfileLine(SHADOW_REGIME_EXPOSURE_PROFILE[r])).join('\n');
  const liveLines = REGIME_ORDER.map((r) => formatProfileLine(LIVE_REGIME_EXPOSURE_PROFILE[r])).join('\n');

  return (
    `🧮 <b>Sizing Debug</b>\n\n` +
    `ENV:\n` +
    `  SHADOW_BULL_EXPOSURE_FLOOR_ENABLED: ${input.floorEnabled}\n` +
    `  POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED: ${input.accurateExposureEnabled}\n\n` +
    `SHADOW 프로파일 (aggressive):\n${shadowLines}\n\n` +
    `LIVE 프로파일 (conservative — floor 전면 0):\n${liveLines}\n\n` +
    `minNotional 보정 설정:\n` +
    `  MIN_CANDIDATE_SHARES: ${MIN_CANDIDATE_SHARES}\n` +
    `  MIN_NOTIONAL_PRICE_CEILING_RATIO: ${(MIN_NOTIONAL_PRICE_CEILING_RATIO * 100).toFixed(0)}%\n\n` +
    `ℹ️ 진단 전용 — 사이징 경로 wiring 은 후속 PR scope`
  );
}

const sizingDebug: TelegramCommand = {
  name: '/sizing_debug',
  aliases: ['/sd'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '사이징 룰 진단 — Shadow/LIVE 노출 프로파일 + ENV + minNotional 설정',
  async execute({ reply }) {
    const message = formatSizingDebugMessage({
      floorEnabled: isShadowBullExposureFloorEnabled(),
      accurateExposureEnabled: isAccurateExposureEnabled(),
    });
    await reply(message);
  },
};

commandRegistry.register(sizingDebug);

export default sizingDebug;
