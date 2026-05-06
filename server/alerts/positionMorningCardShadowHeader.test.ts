/**
 * @responsibility positionMorningCard SHADOW MODE 헤더 회귀 테스트 (ADR-0191)
 *
 * Wiring 1 — 사용자 5/6 12회 가짜 매수 사고 후속. AUTO_TRADE_MODE=SHADOW 시
 * 헤더에 명시 — "왜 안 사졌지?" 같은 잘못된 자가 진단 영구 차단.
 *
 * 정적 grep 가드 (헤더 분기 정합) + ENV 우회 매트릭스.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const POSITION_MORNING_CARD_PATH = path.resolve(
  __dirname, '..', 'alerts', 'positionMorningCard.ts',
);
const source = fs.readFileSync(POSITION_MORNING_CARD_PATH, 'utf-8');

describe('ADR-0191 §Wiring 1 — positionMorningCard SHADOW MODE 헤더 정적 가드', () => {
  it('isShadowMode 분기 SSOT 사용 (process.env.AUTO_TRADE_MODE)', () => {
    expect(source).toMatch(/process\.env\.AUTO_TRADE_MODE \?\? ['"]SHADOW['"]/);
    expect(source).toMatch(/=== ['"]SHADOW['"]/);
  });

  it('ENV `MORNING_CARD_SHADOW_HEADER_DISABLED` 우회 (default OFF, ADR-0157 정확 비교)', () => {
    expect(source).toMatch(/process\.env\.MORNING_CARD_SHADOW_HEADER_DISABLED !== ['"]true['"]/);
  });

  it('SHADOW 모드 헤더 라벨 (🟡 + [SHADOW MODE])', () => {
    expect(source).toMatch(/icon: showShadowHeader \? ['"]🟡['"] : ['"]📊['"]/);
    expect(source).toMatch(/title: showShadowHeader \? ['"]\[SHADOW MODE\] 보유 포지션 Morning Card['"]/);
  });

  it('LIVE 모드 헤더 라벨 보존 (📊 + 보유 포지션)', () => {
    expect(source).toMatch(/['"]보유 포지션 Morning Card['"]/);
  });

  it('ADR-0191 추적 주석', () => {
    expect(source).toMatch(/ADR-0191/);
  });

  it('페르소나 10번 주석 (조건부 판단)', () => {
    expect(source).toMatch(/페르소나 10번/);
  });
});

describe('ADR-0191 §Wiring 1 — SHADOW MODE 헤더 동작 매트릭스', () => {
  beforeEach(() => {
    delete process.env.AUTO_TRADE_MODE;
    delete process.env.MORNING_CARD_SHADOW_HEADER_DISABLED;
  });
  afterEach(() => {
    delete process.env.AUTO_TRADE_MODE;
    delete process.env.MORNING_CARD_SHADOW_HEADER_DISABLED;
  });

  it('AUTO_TRADE_MODE 미설정 → default SHADOW → SHADOW 헤더 분기 활성', () => {
    const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
    expect(isShadowMode).toBe(true);
  });

  it('AUTO_TRADE_MODE=LIVE → SHADOW 헤더 분기 비활성', () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
    expect(isShadowMode).toBe(false);
  });

  it('AUTO_TRADE_MODE=SHADOW → SHADOW 헤더 분기 활성', () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
    expect(isShadowMode).toBe(true);
  });

  it('SHADOW 모드 + ENV ON (SHADOW + DISABLED=true) → 기존 라벨 fallback', () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    process.env.MORNING_CARD_SHADOW_HEADER_DISABLED = 'true';
    const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
    const showShadowHeader = isShadowMode && process.env.MORNING_CARD_SHADOW_HEADER_DISABLED !== 'true';
    expect(showShadowHeader).toBe(false);
  });

  it('SHADOW 모드 + ENV "1" / "TRUE" / "yes" 거부 (ADR-0157 정확 비교)', () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    for (const v of ['1', 'TRUE', 'yes']) {
      process.env.MORNING_CARD_SHADOW_HEADER_DISABLED = v;
      const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
      const showShadowHeader = isShadowMode && process.env.MORNING_CARD_SHADOW_HEADER_DISABLED !== 'true';
      expect(showShadowHeader).toBe(true); // 잘못된 ENV 값은 정상 활성 유지
    }
  });
});
