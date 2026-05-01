# ADR-0134 — `perSymbolEvaluation.ts` 분해 (PR-Refactor-2, ADR-0001 Phase B 완주)

**Status**: Accepted
**Date**: 2026-05-01
**Context**: PR-Refactor-2 (P0-1, ADR-0133 BASELINE 후속)

## Context

`server/trading/signalScanner/perSymbolEvaluation.ts` (1617줄) 는 ADR-0001
(signalScanner-decomposition) Phase B 의 잔재로, ADR-0133 도입 시점에서 코드베이스의
**유일한 1500줄 절대 규칙 위반 파일** 이다. 분해 작업이 차단되지 않도록 BASELINE 카탈로그에
일시 등록되어 있고, 본 PR 이 분해 후 카탈로그에서 제거할 의무를 진다.

### 현재 구조 (1617 LoC)

| 영역 | 라인 범위 | 내용 |
|------|----------|------|
| imports + 헤더 | L1-128 | 외부 모듈 + ADR 주석 |
| `getPrice()` | L129-135 | 실시간 가격 조회 헬퍼 |
| `SymbolExitContext` | L137-152 | 종목별 익절 컨텍스트 인터페이스 |
| `getAdaptiveProfitTargets()` | L154-223 | macro+symbol overlay 익절 계산 |
| `BuyListLoop*` 인터페이스 | L225-275 | evaluateBuyList ctx + mutables |
| **`evaluateBuyList()`** | **L281-1383** | **메인 buyList 루프 (1087 LoC, cc=244)** |
| `IntradayLoopContext` | L1385-1402 | evaluateIntradayList ctx |
| **`evaluateIntradayList()`** | **L1404-1616** | **장중 루프 (213 LoC, cc=44)** |

### 외부 importer

유일한 외부 importer 는 `server/trading/signalScanner.ts` (라인 16-23) — 6 export 사용:
- `getPrice` / `FAILURE_BLOCK_THRESHOLD_PCT` / `SymbolExitContext` (type)
- `getAdaptiveProfitTargets` / `evaluateBuyList` / `evaluateIntradayList`

회귀 테스트 35건 (`server/trading/signalScanner/__tests__/` + `server/trading/signalScanner/*.test.ts`)
의 import 경로도 동일.

## Decision

### 분해 후 구조

`signalScanner/perSymbol/` 디렉토리 신설 + 5 파일로 책임 단위 분리. `perSymbolEvaluation.ts`
자체는 **얇은 barrel re-export** 로 축소 (외부 import 경로 변경 0건).

```
server/trading/signalScanner/
├── perSymbolEvaluation.ts          # ~30 LoC — barrel re-export
└── perSymbol/                      # 신규 디렉토리
    ├── index.ts                    # ~20 LoC — barrel
    ├── types.ts                    # ~100 LoC — Context + Mutables 4 인터페이스
    ├── helpers.ts                  # ~150 LoC — getPrice + SymbolExitContext + getAdaptiveProfitTargets + FAILURE_BLOCK_THRESHOLD_PCT
    ├── buyListLoop.ts              # ~1200 LoC — evaluateBuyList (1500 미만)
    └── intradayLoop.ts             # ~280 LoC — evaluateIntradayList
```

각 파일 @responsibility (25 단어 이내):

- **`types.ts`**: "evaluateBuyList/evaluateIntradayList 의 read-only 입력 + mutable 출력 인터페이스 SSOT"
- **`helpers.ts`**: "종목 단위 진입 평가 공용 헬퍼 — 실시간 가격 조회·종목별 익절 컨텍스트·적응형 익절 계산"
- **`buyListLoop.ts`**: "메인 buyList 루프 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가"
- **`intradayLoop.ts`**: "장중 watchlist 루프 — intradayReady 종목 진입 시도 + 슬롯·손절·트레일링 분기"
- **`index.ts`**: "perSymbol 모듈 barrel — buyListLoop·intradayLoop·helpers·types 단일 진입점"

### byte-equivalent 보존 원칙

본 PR 은 **파일 분리만, 함수 본체 0줄 변경**. evaluateBuyList 본체 추가 분해 (인라인 데이터
페치 / 진단 메시지 빌드 / Gate revalidation 호출 wrapping 등) 는 **후속 PR (PR-Refactor-2-B)**
로 분리 — LIVE 매매 회귀 위험 격리.

### 외부 API 유지 원칙

`signalScanner/perSymbolEvaluation.ts` 가 6 export 모두 그대로 re-export → `signalScanner.ts`
+ 35 회귀 테스트 무수정. 외부 import 경로 변경 0건.

```ts
// server/trading/signalScanner/perSymbolEvaluation.ts (분해 후 barrel)
export { getPrice, FAILURE_BLOCK_THRESHOLD_PCT, getAdaptiveProfitTargets } from './perSymbol/helpers.js';
export type { SymbolExitContext } from './perSymbol/helpers.js';
export { evaluateBuyList } from './perSymbol/buyListLoop.js';
export { evaluateIntradayList } from './perSymbol/intradayLoop.js';
export type {
  BuyListLoopContext, BuyListLoopMutables,
  IntradayLoopContext, IntradayLoopMutables,
} from './perSymbol/types.js';
```

## Consequences

### Positive

- ADR-0133 BASELINE_TECHNICAL_DEBT 카탈로그에서 `perSymbolEvaluation.ts` 제거 가능
- 1500줄 절대 규칙 위반 코드베이스 0건 → 신규 거대 파일 추가 시 즉시 차단
- buyListLoop.ts (~1200) / intradayLoop.ts (~280) 가 책임 단위로 분리되어 후속 분해 (B 단계) 진입점 마련
- 헬퍼·타입이 별도 파일이라 단위 테스트 추가 용이
- `signalScanner/perSymbol/` 디렉토리 패턴이 ADR-0028 (exitEngine), ADR-0029 (stockScreener), ADR-0031 (revalidationSteps/sizingDeciders) 패턴과 정합

### Negative

- 신규 디렉토리 1개 + 신규 파일 5개 — 구조적 복잡도 일시 증가 (그러나 god function 무한 누적 차단 효과가 우월)
- buyListLoop.ts 가 여전히 ~1200 LoC + cc=244 god function 보유 — 후속 PR 의무

### Neutral

- 외부 importer 무수정 (signalScanner.ts + 35 회귀 테스트) — 회귀 위험 0
- evaluateBuyList / evaluateIntradayList 본체 byte-equivalent 보존 — LIVE 매매 0줄 변경

## Migration Plan

1. **Phase 2 (스캐폴딩)**: `signalScanner/perSymbol/` 디렉토리 + 5 빈 파일 + @responsibility 태그
2. **Phase 3-1 (types.ts 이주)**: 4 인터페이스 (BuyListLoopContext, BuyListLoopMutables, IntradayLoopContext, IntradayLoopMutables) 이동
3. **Phase 3-2 (helpers.ts 이주)**: getPrice + SymbolExitContext + getAdaptiveProfitTargets + FAILURE_BLOCK_THRESHOLD_PCT 이동
4. **Phase 3-3 (intradayLoop.ts 이주)**: evaluateIntradayList 본체 이동 (작은 함수부터 — 회귀 위험 격리)
5. **Phase 3-4 (buyListLoop.ts 이주)**: evaluateBuyList 본체 이동 (가장 큰 함수)
6. **Phase 3-5 (index.ts barrel)**: 5 export 합성
7. **Phase 4 (perSymbolEvaluation.ts barrel 축소)**: 1617 LoC → ~30 LoC barrel re-export
8. **Phase 5 (검증)**: vitest 35 회귀 + lint + validate:all + precommit
9. **Phase 6 (BASELINE 제거)**: scripts/check_complexity.js BASELINE_TECHNICAL_DEBT 카탈로그에서 perSymbolEvaluation.ts 제거

각 단계 후 `npm run lint` 통과 보장 — 회귀 즉시 감지.

## Alternatives Considered

### A. evaluateBuyList 본체 함수 추출 (인라인 단계 분리)

evaluateBuyList 안의 큰 블록 (데이터 페치 / Gate revalidation / 사이징 결정 / 큐 등록) 을
별도 함수로 추출. 단점: function signature 가 복잡 (ctx 변수 다수 전달), byte-equivalent 보장
어려움, LIVE 매매 회귀 위험. **본 PR scope 외**, 후속 PR-Refactor-2-B 로 분리.

### B. 디렉토리 분해 없이 형제 파일 추가

`signalScanner/buyListLoop.ts` + `signalScanner/intradayLoop.ts` + `signalScanner/perSymbolHelpers.ts`
형태. 단점: signalScanner/ 디렉토리에 파일 17개+ 누적되어 가독성 ↓. 디렉토리 분리가
exitEngine/screener 패턴과 정합.

### C. perSymbolEvaluation.ts 직접 삭제 + import 경로 모두 갱신

`signalScanner/perSymbol/index.ts` 만 남기고 signalScanner.ts + 35 테스트 import 경로 갱신.
단점: 회귀 위험 ↑ (35 파일 수정), barrel 패턴 (ADR-0029 stockScreener 와 정합) 포기. 본 PR 은
barrel 유지로 회귀 위험 격리.

## Rollback

비상 시 `git revert` 가능 — 본 PR 은 byte-equivalent 분해라 revert 시 동작 복원 즉시.
ENV 우회는 미도입 (분해는 ENV 토글 가능 영역 아님).

## Follow-up

- **PR-Refactor-2-B** (선택): `evaluateBuyList` 본체 god function (cc=244) 추가 분해 — 인라인 데이터 페치 / Gate revalidation wrapping / 진단 메시지 빌더 등을 별도 함수로 추출. 운영 데이터 누적 후 진행 검토.
- **PR-Refactor-3**: `kisClient.ts` (1382 LoC) 분해 — 본 PR scope 외.
- **PR-Refactor-4/5**: `dartPoller.ts` / `shadowTradeRepo.ts` 분해 — 후속.

## References

- ADR-0001 — signalScanner-decomposition (5→7 모듈 개정, Phase A 완료)
- ADR-0133 — file-complexity-gate-integrity (BASELINE 등록 SSOT)
- CLAUDE.md 절대 규칙 #6 — 파일당 1500줄
