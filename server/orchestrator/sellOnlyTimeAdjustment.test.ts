/**
 * @responsibility ALWAYS-ON 시간대 정책 회귀 테스트 (구 ADR-0122 SELL_ONLY 시간조정 대체)
 *
 * 사용자 5/27: always-on — 장중 전 시간 매수 허용. 시간대(시초가/점심/마감) 기반 SELL_ONLY 제거,
 * 볼륨클록은 가/감점 전용. decideScan 의 시간 구간은 스캔 *빈도* 만 조정하고 매매를 차단하지 않는다.
 * 안전 SELL_ONLY(R6 방어/긴급정지/수동/VKOSPI 급등)는 유지 (별도 분기).
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('ALWAYS-ON 시간대 정책 — decideScan 시간대 기반 SELL_ONLY 제거', () => {
  const sourcePath = path.resolve(__dirname, 'adaptiveScanScheduler.base.ts');
  const source = fs.readFileSync(sourcePath, 'utf-8');

  it('시간대 기반 forceSellOnly = true 가 존재하지 않는다', () => {
    expect(source).not.toMatch(/forceSellOnly = true/);
  });

  it('시간대 phase 라벨에 SELL_ONLY 가 없다 (시초가/점심/마감)', () => {
    expect(source).not.toMatch(/시초가\(SELL_ONLY/);
    expect(source).not.toMatch(/점심\(SELL_ONLY\)/);
    expect(source).not.toMatch(/마감\(SELL_ONLY\)/);
  });

  it('always-on phase 라벨 적용 (점심 저빈도 관찰 / 마감 관찰 / 시초가 변동성 회피)', () => {
    expect(source).toMatch(/점심\(저빈도 관찰\)/);
    expect(source).toMatch(/마감\(관찰\)/);
    expect(source).toMatch(/시초가\(변동성 회피\)/);
  });

  it('REMOVED_POLICY_INPUT_IGNORED 시간대 SELL_ONLY 중화 블록이 제거됨', () => {
    // 시간대 SELL_ONLY 자체가 없으므로 중화/롤백 표시 블록도 불필요 — 제거 정합.
    expect(source).not.toMatch(/REMOVED_POLICY_INPUT_IGNORED/);
    expect(source).not.toMatch(/ROLLBACK_DISABLED/);
  });

  it('점심 구간 스캔 빈도(baseInterval=10) + lastLunchBlockSeenAt 재개 로직 보존', () => {
    expect(source).toMatch(/baseInterval = 10/);
    expect(source).toMatch(/lastLunchBlockSeenAt = now/);
  });

  it('안전 SELL_ONLY 경로(R6/VKOSPI) 는 유지 (시간대 제거가 안전장치를 건드리지 않음)', () => {
    // VKOSPI 급등·R6_DEFENSE 분기는 decideScan 상단에서 그대로 유지된다.
    expect(source).toMatch(/VKOSPI/);
    expect(source).toMatch(/R6_DEFENSE/);
  });
});
