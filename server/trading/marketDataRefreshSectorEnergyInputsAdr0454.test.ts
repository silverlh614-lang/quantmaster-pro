// @responsibility ADR-0454 SilentDegradation MacroState.sectorEnergyInputsUpdatedAt writer wiring 회귀 가드.
/**
 * ADR-0454 — SilentDegradation `MacroState.sectorEnergyInputsUpdatedAt` writer wiring.
 *
 * 결함 (origin/main 사전 baseline) — `MacroState.sectorEnergyInputsUpdatedAt` 와
 * `MacroState.sectorEnergyInputs` 두 필드 모두 reader 만 있고 writer 0건 →
 * ADR-0343 L3 CACHE fallback 분기 (`sectorEnergyProvider.ts:1065`) 가 영구 dead
 * code. cached?.sectorEnergyInputs && cached.sectorEnergyInputsUpdatedAt 조건이
 * 항상 false → cache lookup 영구 skip.
 *
 * 본 PR 수정: `marketDataRefresh.ts` 의 saveMacroState merge 분기에 두 필드 영속
 * 추가. meta.inputs.length>0 사이클에만 영속 (실패 시 이전 cache 보존).
 *
 * 본 회귀 테스트: 정적 grep 가드 (writer wiring 본체 + 변수 선언 + meta.inputs
 * 영속 분기) 만으로 충분 — 실제 영속 동작 회귀는 marketDataRefresh 본체 회귀가
 * 따로 존재.
 */
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MARKET_DATA_REFRESH_PATH = resolve(REPO_ROOT, 'server', 'trading', 'marketDataRefresh.ts');

const readSource = (): string => readFileSync(MARKET_DATA_REFRESH_PATH, 'utf-8');

describe('ADR-0454 — sectorEnergyInputs writer wiring (정적 grep 가드)', () => {
  it('sectorEnergyInputsResolved 변수 선언 존재 (saveMacroState scope 까지 노출)', () => {
    const src = readSource();
    expect(src).toMatch(/let sectorEnergyInputsResolved/);
  });

  it('변수 타입은 buildSectorEnergyInputsWithMeta 의 inputs 필드 (drift 차단)', () => {
    const src = readSource();
    expect(src).toMatch(
      /sectorEnergyInputsResolved.*Awaited<ReturnType<typeof buildSectorEnergyInputsWithMeta>>\['inputs'\]/,
    );
  });

  it('meta.inputs.length>0 분기에서 sectorEnergyInputsResolved = meta.inputs 채움', () => {
    const src = readSource();
    expect(src).toMatch(/sectorEnergyInputsResolved = meta\.inputs/);
  });

  it('saveMacroState merge 분기에 sectorEnergyInputs 영속 spread 존재', () => {
    const src = readSource();
    expect(src).toMatch(/sectorEnergyInputs:\s*sectorEnergyInputsResolved/);
    expect(src).toMatch(/sectorEnergyInputsUpdatedAt:\s*sectorEnergyUpdatedAt/);
  });

  it('영속 spread 가 sectorEnergyInputsResolved && sectorEnergyUpdatedAt 가드 안에 있음 (실패 시 이전 cache 보존)', () => {
    const src = readSource();
    // 두 변수 동시 truthy 시에만 영속하는 ternary spread 확인
    expect(src).toMatch(
      /\.\.\.\(sectorEnergyInputsResolved\s*&&\s*sectorEnergyUpdatedAt[\s\S]*?sectorEnergyInputs:\s*sectorEnergyInputsResolved/,
    );
  });

  it('ADR-0454 추적 주석 — saveMacroState merge 위치 명시', () => {
    const src = readSource();
    expect(src).toMatch(/ADR-0454.*sectorEnergyInputs writer wiring/);
  });

  it('LIVE 매매 본체 영향 0 — 변경은 marketDataRefresh.ts 한 파일만', () => {
    // ADR-0454 변경 파일 = marketDataRefresh.ts 만 (회귀 테스트 + ADR + INDEX/CLAUDE 외)
    // 본 케이스는 LIVE 매매 본체 (signalScanner / entryEngine / exitEngine / kisClient/** /
    // orchestrator/** / autoTradeEngine* / trancheExecutor) 0줄 변경을 정적 가드.
    // marketDataRefresh.ts 도 wiring 추가만 (4 LoC), 외부 호출 빈도/주문 함수 호출 0 변경.
    const src = readSource();
    // KIS 주문 함수 5종 import 0건 (ADR-0454 안 wiring)
    expect(src).not.toMatch(/import.*placeKisMarketOrder/);
    expect(src).not.toMatch(/import.*placeKisSellOrder/);
    expect(src).not.toMatch(/import.*placeKisStopLossOrder/);
    expect(src).not.toMatch(/import.*placeKisTakeProfitOrder/);
    expect(src).not.toMatch(/import.*cancelKisOrder/);
  });
});

describe('ADR-0454 — SilentDegradation baseline 회복 검증', () => {
  it('check_silent_degradation.js EXIT=0 (sectorEnergyInputsUpdatedAt writer 0건 → 1건)', () => {
    // check_silent_degradation.js 는 5 schema * 144 옵셔널 필드 * 전체 source walk 로
    // 단독 실행 ~25s 소요. full-suite 병렬 실행 시 CPU 경합으로 30s 한계를 넘기면
    // execSync 가 ETIMEDOUT/STACK_TRACE 로 던져 flaky 실패가 난다. cwd 고정 +
    // execSync timeout(120s) + vitest test timeout(180s) 으로 경합 환경에서도
    // 결정적으로 완주하도록 격리한다 (테스트 강도 무변 — 동일 assertion).
    const result = execSync(
      'node scripts/check_silent_degradation.js',
      { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
    );
    expect(result).toMatch(/OK/);
    expect(result).not.toMatch(/sectorEnergyInputsUpdatedAt.*writer=0/);
  }, 180_000);
});
