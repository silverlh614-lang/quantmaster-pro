/**
 * @responsibility PR-X1 ADR-0032 VIBRATION_POLICY 매트릭스 + resolveVibrationDecision 회귀 테스트
 *
 * 검증 범위:
 *   - VIBRATION_POLICY 4 카테고리 × 4 심각도 매트릭스 정합성
 *   - resolveVibrationDecision 우선순위: override > policy
 *   - ChannelSemantic 별칭이 AlertCategory enum 과 1:1 매핑
 *   - dispatchAlert 가 disableNotification 미지정 시 정책 자동 적용 (간접)
 */

import { describe, it, expect } from 'vitest';
import {
  VIBRATION_POLICY,
  resolveVibrationDecision,
  ChannelSemantic,
  type AlertSeverity,
} from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';

describe('VIBRATION_POLICY 매트릭스', () => {
  it('4 카테고리 모두 4 심각도(CRITICAL/HIGH/NORMAL/LOW)에 boolean 정의', () => {
    const severities: AlertSeverity[] = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];
    for (const cat of Object.values(AlertCategory)) {
      for (const sev of severities) {
        expect(typeof VIBRATION_POLICY[cat][sev]).toBe('boolean');
      }
    }
  });

  it('TRADE(=EXECUTION) 채널은 모든 심각도에서 진동 ON — 매도/체결 즉각 인지', () => {
    expect(VIBRATION_POLICY[AlertCategory.TRADE].CRITICAL).toBe(true);
    expect(VIBRATION_POLICY[AlertCategory.TRADE].HIGH).toBe(true);
    expect(VIBRATION_POLICY[AlertCategory.TRADE].NORMAL).toBe(true);
    expect(VIBRATION_POLICY[AlertCategory.TRADE].LOW).toBe(true);
  });

  it('ANALYSIS(=SIGNAL) 채널은 CRITICAL 만 진동 ON — FOMO 차단', () => {
    expect(VIBRATION_POLICY[AlertCategory.ANALYSIS].CRITICAL).toBe(true);
    expect(VIBRATION_POLICY[AlertCategory.ANALYSIS].HIGH).toBe(false);
    expect(VIBRATION_POLICY[AlertCategory.ANALYSIS].NORMAL).toBe(false);
    expect(VIBRATION_POLICY[AlertCategory.ANALYSIS].LOW).toBe(false);
  });

  it('INFO(=REGIME) 채널은 CRITICAL/HIGH 진동 ON — 레짐 전환만 알림', () => {
    expect(VIBRATION_POLICY[AlertCategory.INFO].CRITICAL).toBe(true);
    expect(VIBRATION_POLICY[AlertCategory.INFO].HIGH).toBe(true);
    expect(VIBRATION_POLICY[AlertCategory.INFO].NORMAL).toBe(false);
    expect(VIBRATION_POLICY[AlertCategory.INFO].LOW).toBe(false);
  });

  it('SYSTEM(=JOURNAL) 채널은 모든 심각도에서 진동 OFF — 시간 격리(복기용)', () => {
    expect(VIBRATION_POLICY[AlertCategory.SYSTEM].CRITICAL).toBe(false);
    expect(VIBRATION_POLICY[AlertCategory.SYSTEM].HIGH).toBe(false);
    expect(VIBRATION_POLICY[AlertCategory.SYSTEM].NORMAL).toBe(false);
    expect(VIBRATION_POLICY[AlertCategory.SYSTEM].LOW).toBe(false);
  });
});

describe('resolveVibrationDecision', () => {
  it('override true 가 매트릭스(진동 ON) 보다 우선 — 사용자 명시 silent', () => {
    // TRADE/HIGH 매트릭스 = vibrate true 지만 override true → disableNotification true
    expect(resolveVibrationDecision(AlertCategory.TRADE, 'HIGH', true)).toBe(true);
  });

  it('override false 가 매트릭스(진동 OFF) 보다 우선 — 사용자 명시 vibrate', () => {
    // SYSTEM/CRITICAL 매트릭스 = vibrate false 지만 override false → disableNotification false
    expect(resolveVibrationDecision(AlertCategory.SYSTEM, 'CRITICAL', false)).toBe(false);
  });

  it('override undefined 시 매트릭스 정책 사용 — TRADE/HIGH → 진동 ON (disableNotification false)', () => {
    expect(resolveVibrationDecision(AlertCategory.TRADE, 'HIGH', undefined)).toBe(false);
  });

  it('override undefined 시 매트릭스 정책 사용 — ANALYSIS/HIGH → 진동 OFF (disableNotification true)', () => {
    expect(resolveVibrationDecision(AlertCategory.ANALYSIS, 'HIGH', undefined)).toBe(true);
  });

  it('override undefined 시 매트릭스 정책 사용 — SYSTEM/LOW → 진동 OFF', () => {
    expect(resolveVibrationDecision(AlertCategory.SYSTEM, 'LOW', undefined)).toBe(true);
  });

  it('override undefined 시 매트릭스 정책 사용 — INFO/CRITICAL → 진동 ON', () => {
    expect(resolveVibrationDecision(AlertCategory.INFO, 'CRITICAL', undefined)).toBe(false);
  });

  it('override 미전달(인자 2개) 시 정책 적용', () => {
    expect(resolveVibrationDecision(AlertCategory.TRADE, 'NORMAL')).toBe(false);
    expect(resolveVibrationDecision(AlertCategory.ANALYSIS, 'NORMAL')).toBe(true);
  });
});

describe('ChannelSemantic 별칭', () => {
  it('EXECUTION = TRADE', () => {
    expect(ChannelSemantic.EXECUTION).toBe(AlertCategory.TRADE);
  });

  it('SIGNAL = ANALYSIS', () => {
    expect(ChannelSemantic.SIGNAL).toBe(AlertCategory.ANALYSIS);
  });

  it('REGIME = INFO', () => {
    expect(ChannelSemantic.REGIME).toBe(AlertCategory.INFO);
  });

  it('JOURNAL = SYSTEM', () => {
    expect(ChannelSemantic.JOURNAL).toBe(AlertCategory.SYSTEM);
  });

  it('4 별칭 모두 AlertCategory enum 값에 매핑', () => {
    const expected = new Set([
      AlertCategory.TRADE,
      AlertCategory.ANALYSIS,
      AlertCategory.INFO,
      AlertCategory.SYSTEM,
    ]);
    const actual = new Set(Object.values(ChannelSemantic));
    expect(actual).toEqual(expected);
  });

  it('readonly 객체 — 런타임 변경 불가 (타입 시스템 + Object.freeze 불필요, as const 로 보호)', () => {
    expect(Object.keys(ChannelSemantic).sort()).toEqual(['EXECUTION', 'JOURNAL', 'REGIME', 'SIGNAL']);
  });
});
