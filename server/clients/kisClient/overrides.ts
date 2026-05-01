/**
 * @responsibility VTS 모드 데이터 조회 mock 오버라이드 SSOT — 파이프라인 테스트 지원
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 mock 격리.
 * VTS 모드에서 실 API 호출 없이 전체 파이프라인을 테스트할 수 있도록
 * 데이터 조회 함수들을 오버라이드 가능하게 한다.
 * 주문 함수 (placeKisSellOrder 등) 는 이미 Shadow 모드에서 실주문을 건너뛰므로 제외.
 */

import type { KisClientOverrides } from './types.js';

let _overrides: KisClientOverrides = {};

/**
 * KIS 클라이언트 데이터 조회 함수를 mock으로 교체한다.
 * VTS 모드에서 실 API 호출 없이 전체 파이프라인을 작동시키는 핵심.
 */
export function setKisClientOverrides(overrides: KisClientOverrides): void {
  _overrides = overrides;
  console.log(`[KIS] 클라이언트 오버라이드 설정 완료: ${Object.keys(overrides).join(', ')}`);
}

/** 현재 오버라이드 설정 여부 */
export function hasKisClientOverrides(): boolean {
  return Object.keys(_overrides).length > 0;
}

/**
 * 내부 모듈에서 오버라이드 객체에 접근할 때 사용 — 객체 참조를 노출하지 않고
 * 항상 최신 상태를 반환한다 (setKisClientOverrides 가 _overrides 를 통째로 교체하므로
 * caller 가 직접 보관한 참조는 stale 가능).
 */
export function getKisOverrides(): KisClientOverrides {
  return _overrides;
}
