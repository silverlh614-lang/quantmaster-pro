// @responsibility LIVE 모드 SHADOW 메시지 CH4(JOURNAL) 격리 라우팅 SSOT (ADR-0607, ENV 게이트, default OFF byte-equivalent).
import { ChannelSemantic } from './alertCategories.js';
import { getExecutionMode } from '../state.js';
import type { TelegramEventRoute } from './telegramEventRouter.js';

/**
 * LIVE 모드 SHADOW 격리 게이트 (ADR-0607).
 *
 * `LIVE_SHADOW_QUIET_ENABLED === 'true'` 일 때만 활성. default(미설정/그 외)=OFF →
 * 본 모듈 적용 지점은 전부 byte-equivalent(기존 라우팅 유지). 정확 비교(=== 'true')만 활성화.
 */
export function isLiveShadowQuietEnabled(): boolean {
  return process.env.LIVE_SHADOW_QUIET_ENABLED === 'true';
}

/**
 * SHADOW 메시지의 채널 의미(route)를 LIVE 모드에서만 CH4(JOURNAL)로 격리한다 (ADR-0607).
 *
 * 격리 조건 3중 AND:
 *   1. ENV 게이트 ON (`isLiveShadowQuietEnabled()`)
 *   2. 현재 실행 모드 === 'LIVE' (`getExecutionMode()`)
 *   3. 해당 메시지가 SHADOW(`isShadow === true`)
 *
 * 위 셋이 모두 참이면 `ChannelSemantic.JOURNAL`(CH4)로 격리 — CH1(EXECUTION)/CH2(SIGNAL)을
 * LIVE 체결·신호 전용으로 비운다. 그 외 모든 경우 `intendedRoute` 를 그대로 반환(byte-equivalent).
 *
 * 격리는 "채널 *의미*(route)" 만 바꾼다 — severity/dedup/HTML 정제 등 06-telegram-policy 는 호출측에서 보존.
 * SHADOW→CH4 는 정책 상태(학습 layer 격리)이지 *장애* 가 아니다 (9대 불변식 #6 정합 — providerIssue ≠ marketSignal).
 *
 * @param intendedRoute 원래 의도된 채널 의미 (예: ChannelSemantic.SIGNAL)
 * @param isShadow 해당 메시지가 SHADOW(가상/학습) 인지 여부
 * @returns 격리 적용 시 JOURNAL, 아니면 intendedRoute 그대로
 */
export function resolveShadowChannelRoute<T extends TelegramEventRoute>(
  intendedRoute: T,
  isShadow: boolean,
): T | typeof ChannelSemantic.JOURNAL {
  if (isShadow && isLiveShadowQuietEnabled() && getExecutionMode() === 'LIVE') {
    return ChannelSemantic.JOURNAL;
  }
  return intendedRoute;
}
