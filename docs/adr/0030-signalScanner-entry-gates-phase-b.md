# ADR-0030 — signalScanner Phase B: evaluateBuyList Entry Gate Chain (proof of concept)

- **Status**: Accepted (2026-04-26, scope: 3 simple gates only)
- **Owner**: server-refactor-orchestrator (engine-dev)
- **Continues**: ADR-0001 (signalScanner Phase A — preflight/candidateSelect/perSymbolEvaluation/scanDiagnostics)

## Context

PR-40 Phase A 가 `signalScanner.ts` 1,820 → 614 줄로 분해했지만 메인 per-stock 루프(`evaluateBuyList` 940 줄) 가 `signalScanner/perSymbolEvaluation.ts` 로 이동한 것뿐 — 함수 자체의 복잡도는 그대로다. 이 한 함수 안에 9 개 진입 게이트가 직렬 if-블록으로 박혀 있어:

1. **단위 테스트 불가능** — 한 게이트만 검증하려면 940줄 함수 + 12+ 외부 모킹 필요
2. **순서 변경/추가** — 새 게이트 추가는 거대 함수 안에 if-블록을 끼워 넣는 작업
3. **차단율 통계 부재** — 어느 게이트가 가장 많이 cutoff 하는지 운영 가시성 없음

사용자 원안 (아이디어 4): EntryGate Chain of Responsibility — 9 게이트를 배열로 명시 + 순회.

## Decision (PR-57 본 PR scope)

**최소 위험 proof-of-concept**: **9 게이트 중 가장 단순한 3 개만** 추출. 나머지 6 개는 후속 PR.

추출 대상 (라인 631-657, 약 25 줄):
1. `blacklistGate` — Cascade -30% 진입 금지 목록 (isBlacklisted)
2. `addBuyBlockGate` — Cascade -7% 후 추가 매수 차단
3. `rrrGate` — RRR 최소 임계값 미달 (RRR_MIN_THRESHOLD)

선택 사유:
- **순수 동기 체크** — KIS / 텔레그램 / portfolio risk API 호출 없음
- **외부 의존성 최소** — `isBlacklisted` (인메모리 set), `calcRRR` (순수 함수), shadows 배열 검색
- **부수효과 단일** — `console.log` + 선택적 `scanCounters.rrrMisses++` + `stageLog.rrr = '...'` + `pushTrace()`

후속 PR scope (잔여 6 게이트):
- `cooldownGate` (Regret Asymmetry, 라인 609-628)
- `sectorConcentrationGate` (라인 659-680, 텔레그램 알림 포함)
- `sectorPreGuardGate` (라인 682-707, checkSectorExposureBefore)
- `portfolioRiskGate` (라인 709-723, async evaluatePortfolioRisk)
- `liveGateRevalidationGate` (라인 728~)
- `kellyBudgetGate` (라인 961~)

## EntryGate signature (types.ts)

```typescript
export interface EntryGateContext {
  stock: WatchlistEntry;
  shadows: ServerShadowTrade[];
  scanCounters: ScanCounters;
  // 후속 PR 에서 sector/portfolio gate 가 필요로 하는 추가 필드 점진 확장
}

export type EntryGateResult =
  | { pass: true }
  | {
      pass: false;
      logMessage: string;     // console.log emitted before continue
      stageLog?: { key: string; value: string };  // pushTrace 시 stageLog 갱신
      counter?: keyof ScanCounters;                 // 증가시킬 ScanCounters 키
      pushTrace?: boolean;                          // pushTrace() 호출 여부
    };

export type EntryGate = (ctx: EntryGateContext) => EntryGateResult;
```

본 PR 의 3 게이트는 모두 동기 함수. 후속 PR 에서 `Promise<EntryGateResult>` 반환하는 async 게이트 추가 시 시그니처를 union 으로 확장한다.

## Wiring (perSymbolEvaluation.ts)

orchestrator 루프 내부에서 chain 형태로 평가:

```typescript
import { ENTRY_GATES_PHASE_B_POC } from './entryGates/index.js';

// ... per-symbol loop
for (const gate of ENTRY_GATES_PHASE_B_POC) {
  const r = gate({ stock, shadows: ctx.shadows, scanCounters: ctx.scanCounters });
  if (!r.pass) {
    console.log(r.logMessage);
    if (r.counter) ctx.scanCounters[r.counter]++;
    if (r.stageLog) stageLog[r.stageLog.key] = r.stageLog.value;
    if (r.pushTrace) pushTrace();
    continue outerLoop;  // labeled continue, or set flag + break
  }
}
```

기존 라인 631-657 의 3 if-블록은 위 chain 호출로 교체. 행동은 byte-equivalent — 같은 console.log 메시지 / 같은 scanCounters 증가 / 같은 stageLog 갱신.

## Consequences

- **외부 importer 무수정**: 본 PR 은 `perSymbolEvaluation.ts` 내부 변경만. signalScanner.ts barrel 의 export 시그니처 변화 0.
- **단위 테스트**: 각 게이트 ~6 케이스 = 18 케이스 신규. mock 필요 없음 (인메모리 함수).
- **byte-equivalent 보장**: console.log 문자열 / scanCounters 증가 / stageLog 키 / pushTrace 호출 시점 모두 원본 동일.
- **차단율 통계 인프라**: 본 PR 은 통계 수집 미포함 — `scanCounters` 가 이미 rrrMisses 추적 중. 후속 PR 에서 게이트 별 카운터 일반화.

## Alternatives Considered

1. **9 게이트 한 번에 추출** — 거부. async 게이트 (portfolio risk, KIS realtime 보정), 텔레그램 부수효과, Kelly 사이징 같은 복잡 로직이 섞여 있어 위험 高. 단계별 PR 로 분리.
2. **async 게이트도 같이 추출** — 거부. 본 PR 은 동기 게이트만 다뤄 시그니처를 단순하게 유지. 후속 PR 에서 union 확장.
3. **분해 안 함** — 거부. evaluateBuyList 940 줄이 이미 1,500 임계의 60% 점유. Phase B 진행 전제는 PR-40 가 이미 명시.

## Migration Plan

1. **Phase 1** (본 PR): ADR-0030 + types.ts.
2. **Phase 2** (본 PR): blacklistGate.ts / addBuyBlockGate.ts / rrrGate.ts + 각 ~6 단위 테스트.
3. **Phase 3** (본 PR): perSymbolEvaluation.ts 의 라인 631-657 3 if-블록을 ENTRY_GATES_PHASE_B_POC 순회로 교체.
4. **Phase 4** (본 PR): 회귀 검증 (vitest + lint + precommit). 외부 importer 무영향 확인.
5. **Phase 5+ (후속 PR)**: cooldown / sectorConcentration / sectorPreGuard / portfolioRisk / liveGateRevalidation / kellyBudget 6 게이트 추출. async 시그니처 도입.

## Boundary Rules

- **gate 간 import 금지**: 게이트는 독립적이어야 한다. blacklistGate 가 rrrGate 를 import 하지 않는다.
- **부수효과 단일**: 게이트 함수 본체에서 `sendTelegramAlert` / `placeKisSellOrder` 호출 금지. 결과 객체로 메시지/카운터를 반환하고 orchestrator 가 일괄 실행.
- **순서 SSOT**: `ENTRY_GATES_PHASE_B_POC` 배열 순서는 원본 evaluateBuyList 의 if-블록 순서와 1:1 정합. 순서 변경은 LIVE 회귀 위험이므로 단독 PR + 후속 ADR.
- **byte-equivalent**: console.log 문자열·stageLog 값·counter 키 변경은 별도 PR (운영자 알림 형식 변경 분리).
