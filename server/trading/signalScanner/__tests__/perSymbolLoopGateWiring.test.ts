/**
 * @responsibility ADR-0080 PR-S1 wiring 회귀 가드 — 루프 게이트 자본 가중 SSOT 사용 강제
 *
 * perSymbolEvaluation.ts 의 루프 첫 진입 게이트(라인 283 부근)가 단순 카운트
 * (`shadows.filter(...).length`) 로 회귀하면 사용자 시나리오 "만재 4 + 30% 잔존 4"
 * 가 다시 break 차단되는 결함이 부활. 본 테스트는 sed/regex 가드로 drift 방지.
 *
 * PR-S2 (sizing 분모 자본 가중화) 까지 currentActive=rawCount 사용은 유지 — 분할
 * 비율 영향 격리. shadow mode 1주 검증 후 후속 PR.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PER_SYMBOL_PATH = resolve(__dirname, '../perSymbolEvaluation.ts');

describe('perSymbolEvaluation — ADR-0080 PR-S1 루프 게이트 wiring', () => {
  const src = readFileSync(PER_SYMBOL_PATH, 'utf-8');

  it('computeSlotConsumption import 존재', () => {
    expect(src).toContain("import { computeSlotConsumption } from '../slotAccounting.js'");
  });

  it('루프 게이트가 slotResult.consumed (자본 가중) 사용', () => {
    // ADR-0080 PR-S1: totalCommitted 산출 시 slotResult.consumed 사용 강제.
    // 단순 카운트(currentActive 단독) 로 회귀하면 본 단언이 fail.
    expect(src).toMatch(
      /const\s+totalCommitted\s*=\s*slotResult\.consumed\s*\+\s*ctx\.mutables\.reservedSlots\.value/,
    );
  });

  it('루프 게이트의 console.log 가 자본 가중 표기 (slotResult.consumed.toFixed)', () => {
    // 진단 로그가 단순 카운트(`currentActive`) 만 표기하면 운영자가 자본 가중 효과
    // 인지 불가. 자본 가중 표기 + raw 카운트 동반 표기 강제.
    expect(src).toMatch(
      /\[AutoTrade\] 최대 포지션 도달[^]*?slotResult\.consumed\.toFixed/,
    );
    expect(src).toMatch(
      /\[AutoTrade\] 최대 포지션 도달[^]*?raw=\$\{slotResult\.rawCount\}/,
    );
  });

  it('PR-S2 까지 currentActive=rawCount 보존 (sizing 분모 분리)', () => {
    // sizing 분모(remainingSlots, line ~902) 는 본 PR scope 외 — currentActive
    // 변수가 여전히 rawCount 로 정의되어 라인 902 의 분할 비율 산출 그대로 유지.
    expect(src).toMatch(/const\s+currentActive\s*=\s*slotResult\.rawCount/);
    expect(src).toMatch(
      /const\s+remainingSlots\s*=\s*Math\.max\([^]*?ctx\.effectiveMaxPositions\s*-\s*currentActive/,
    );
  });

  it('단순 카운트 패턴 회귀 차단 — shadows.filter(...).length 직접 사용 불가', () => {
    // 라인 283 직후의 `shadows.filter((s) => isOpenShadowStatus(...).length` 패턴이
    // 다시 등장하면 PR-S1 회귀. 본 단언은 *완벽한 차단* 이 아니라 *기존 패턴* 만
    // 검사 — 다른 위치(line 363/372/396/665 등)는 다른 목적이라 보존.
    const loopGateRegion = src.slice(
      src.indexOf('// 아이디어 7: 루프 내에서도 포지션 수 재확인'),
      src.indexOf('// MOMENTUM Shadow 는 LIVE 슬롯 한도에 귀속되지 않으므로'),
    );
    expect(loopGateRegion).not.toMatch(
      /const\s+currentActive\s*=\s*ctx\.shadows\.filter\(/,
    );
  });
});
