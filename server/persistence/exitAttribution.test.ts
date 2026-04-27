/**
 * @responsibility buildExitAttribution 헬퍼 + ExitAttribution 타입 회귀 테스트 — PR-S (아이디어 7)
 */
import { describe, it, expect } from 'vitest';
import { buildExitAttribution, type ExitAttribution } from './shadowTradeRepo';

describe('buildExitAttribution — PR-S 아이디어 7', () => {
  it('정상 입력 → ruleId/contributingConditions/regime/attachedAt 모두 채움', () => {
    const a = buildExitAttribution('R6_EMERGENCY_EXIT', ['regime_r6_defense'], 'R6_DEFENSE');
    expect(a.ruleId).toBe('R6_EMERGENCY_EXIT');
    expect(a.contributingConditions).toEqual(['regime_r6_defense']);
    expect(a.regime).toBe('R6_DEFENSE');
    expect(a.attachedAt).toBeDefined();
    expect(typeof a.attachedAt).toBe('string');
  });

  it('빈 contributingConditions 배열 → ruleId 소문자 fallback', () => {
    const a = buildExitAttribution('HIT_TARGET' as never, [], 'R2_BULL');
    expect(a.contributingConditions).toEqual(['hit_target']);
  });

  it('여러 contributingConditions 정확 보존', () => {
    const a = buildExitAttribution(
      'CASCADE_FINAL' as never,
      ['stopLoss_breach', 'macd_dead_cross', 'volume_drop'],
      'R5_CAUTION',
    );
    expect(a.contributingConditions).toEqual([
      'stopLoss_breach', 'macd_dead_cross', 'volume_drop',
    ]);
  });

  it('attachedAt ISO 형식 + 호출 시각 근사', () => {
    const before = Date.now();
    const a = buildExitAttribution('TARGET_EXIT' as never, ['target_reached'], 'R2_BULL');
    const after = Date.now();
    const ts = Date.parse(a.attachedAt!);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('타입 contract — 빈 객체 거부 (compile 시점 강제)', () => {
    // 본 테스트는 *런타임* 검증이지만 contract 의도를 문서화
    const valid: ExitAttribution = {
      ruleId: 'R6_EMERGENCY_EXIT',
      contributingConditions: ['x'],
      regime: 'R6_DEFENSE',
    };
    expect(valid.ruleId).toBe('R6_EMERGENCY_EXIT');
  });
});
