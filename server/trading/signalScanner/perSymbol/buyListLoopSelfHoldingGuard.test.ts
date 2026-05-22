/**
 * @responsibility sizingTierDecider 자기 보유 가드 정적 회귀 가드 (ADR-0191)
 *
 * Wiring 2 — 사용자 5/6 12회 가짜 매수 사고 후속. corrGate 통과 후 PositionState
 * SSOT 기반 belt-and-suspenders 2중 안전망. 동일 종목 12회 매수 (물타기) 차단.
 *
 * 정적 grep 가드 (drift 차단) — 추출된 step 의 wiring 위치·인자·로그 형식 보존.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SIZING_TIER_DECIDER_PATH = path.resolve(
  __dirname, '..', 'perSymbol', 'steps', 'sizingTierDecider.ts',
);
const BUY_LIST_LOOP_PATH = path.resolve(__dirname, '..', 'perSymbol', 'buyListLoop.ts');
const source = fs.readFileSync(SIZING_TIER_DECIDER_PATH, 'utf-8');
const buyListLoopSource = fs.readFileSync(BUY_LIST_LOOP_PATH, 'utf-8');

describe('ADR-0191 §Wiring 2 — sizingTierDecider 자기 보유 가드 정적 가드', () => {
  it('PositionStateResolver SSOT hasOpenPosition import', () => {
    expect(source).toMatch(/hasOpenPosition/);
    expect(source).toMatch(/positionStateResolver\.js/);
  });

  it('ADR-0191 추적 주석 (import + wiring)', () => {
    const adr0191Count = (source.match(/ADR-0191/g) ?? []).length;
    expect(adr0191Count).toBeGreaterThanOrEqual(2);
  });

  it('ENV `BUY_LIST_SELF_HOLDING_GUARD_DISABLED` 우회 (ADR-0157 정확 비교)', () => {
    expect(source).toMatch(/process\.env\.BUY_LIST_SELF_HOLDING_GUARD_DISABLED !== ['"]true['"]/);
  });

  it('hasOpenPosition(stockCode, SHADOW_FIRST) 매핑', () => {
    expect(source).toMatch(/hasOpenPosition\(stock\.code,\s*['"]SHADOW_FIRST['"]/);
    expect(source).not.toMatch(/dedupOpenCount/);
  });

  it('alreadyHeld 시 shouldSkip 반환 (매매 흐름 차단)', () => {
    // 가드 본문 추출 — `if (alreadyHeld) {` 부터 `shouldSkip: true` 까지.
    const guardBlock = source.match(/if \(alreadyHeld\)[\s\S]+?shouldSkip: true/);
    expect(guardBlock).not.toBeNull();
    expect(guardBlock?.[0]).toMatch(/shouldSkip: true/);
  });

  it('appendShadowLog BLOCKED_SELF_HOLDING (학습 영속 + 진단)', () => {
    expect(source).toMatch(/event: ['"]BLOCKED_SELF_HOLDING['"]/);
  });

  it('진단 로그 형식 — [AutoTrade/SelfHoldingGuard]', () => {
    expect(source).toMatch(/\[AutoTrade\/SelfHoldingGuard\]/);
    expect(source).toMatch(/이미 보유 중 — 물타기 차단/);
  });

  it('isMomentumShadow=false 시에만 적용 (Shadow 학습 경로 통과)', () => {
    // corrGate 와 동일 if (!isMomentumShadow) 블록 안에 위치 — 정적 grep 검증.
    // corrGate 다음에 self-holding 가드가 같은 블록 안에 있는지 검증.
    const ifBlock = source.match(/if \(!params\.isMomentumShadow\) \{[\s\S]+?BLOCKED_SELF_HOLDING[\s\S]+?\}\s+\}/);
    expect(ifBlock).not.toBeNull();
  });

  it('corrGate 통과 후 위치 정합 (corrGate continue 다음에 self-holding 위치)', () => {
    const corrGateIdx = source.indexOf('BLOCKED_CORRELATION');
    const selfHoldingIdx = source.indexOf('BLOCKED_SELF_HOLDING');
    expect(corrGateIdx).toBeGreaterThan(0);
    expect(selfHoldingIdx).toBeGreaterThan(corrGateIdx);
  });

  it('belt-and-suspenders 패턴 — L921 alreadyTraded 가드 보존', () => {
    // L921 의 기존 가드 (alreadyTraded with isOpenShadowStatus + signalTime.startsWith) 유지.
    expect(buyListLoopSource).toMatch(/const alreadyTraded = ctx\.shadows\.some\(/);
  });

  it('페르소나 9번 (보유 효과 경계) 정반대 차단 명문화', () => {
    expect(source).toMatch(/페르소나 9번|보유 효과/);
  });
});
