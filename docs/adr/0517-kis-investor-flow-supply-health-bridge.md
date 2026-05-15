# ADR-0517 — KIS Investor Flow → Gate1 Forensic 입력 단절 차단 SSOT

@responsibility Patch ADR-P0-SUPPLY-WIRE — `fetchKisInvestorTradeByStockDaily` 의 `actualInvestorFlowRowCarrier` 를 `buyPipeline.fetchGateData` → `applySupplyProviderHealthFromKisFlow` → `signalScanner/index.ts` snapshot → forensic collector 까지 무손실 carry.

## 컨텍스트

운영 환경 `/scan_blockers full` 진단 결과 — `semanticAvailable: 0/42` + `forensicInputCarriesSemanticRow: 0/42` 가 누적되고 R2_BULL 40 후보 0 entries. `selectedCandidateCarriesActualRow: true` + `selectedActualRowFieldKeys: frgn_ntby_qty, orgn_ntby_qty, prsn_ntby_qty` 가 *adapter 단계까지는* 도달했지만 Gate1 forensic 평가 입력에는 0건 도달. 진단 메시지: `supplyRouterForensicConflict=true` + `reason=ROUTER_VERIFIED_BUT_SEMANTIC_FIELDS_MISSING`.

코드 audit 결과 결함 진원지 — `fetchKisInvestorTradeByStockDaily(code)` 가 이미 `actualInvestorFlowRowCarrier` (KIS_API + actualRows + 6 field-key 분류 — `rawFieldKeys` / `numberFieldKeys` / `numericStringFieldKeys` / `placeholderFieldKeys` / `rowSourcePath` / `actualRows`) 를 채워 반환하지만, `buyPipeline.fetchGateData` 가 반환 schema `{quote, gate}` 에서 kisFlow 를 *드롭* 한다. 결과적으로 `mergeSupplyProviderHealth(w, context)` 의 fallback `w.supplyProviderHealth` 가 buyListLoop 내부에서 절대 set 되지 않아 영원히 undefined → forensic 의 `actualInvestorFlowCarried=false` / `semanticAvailable=0/N` / `forensicInputCarriesSemanticRow=0/N` → 전 후보 `supplyUnknownPenalty` 누적.

사용자 명시 옵션 1 "진단 기반 최소 수술 (권장)" — 기존 `KisInvestorFlowActualRowCarrier` 인프라 재사용 + 신규 타입 0건 + byte-equivalent except 의도된 carrier 전파. 옵션 2 (ADR-0019 buyListLoop 분해) 와 독립적으로 적용 가능.

## 결정

### 결정 1 — `investorFlowSupplyHealthBridge.ts` SSOT 신설 (`server/clients/kisClient/`)

순수 매핑 함수 + ENV 헬퍼만. 외부 의존성 0건. ~164 LoC.

**3 export + 1 type:**

| 식별자 | 종류 | 목적 |
|---|---|---|
| `SupplyProviderHealthFromKisFlow` | type | `mergeSupplyProviderHealth` 정합 forensic-relevant 필드 shape (모든 필드 옵셔널 — Object.assign 으로 merge 가능) |
| `isKisForensicFlowWiringDisabled()` | function | ENV `KIS_FORENSIC_FLOW_WIRING_DISABLED=true` 정확 비교 SSOT (ADR-0157) — 1줄 즉시 ADR-P0-SUPPLY-WIRE 이전 동작 byte-equivalent 복원 |
| `buildSupplyProviderHealthFromKisFlow(kisFlow)` | function | 결정 트리 (4 단계) — null/undefined → null / carrier 부재 → semantic-only / carrier 존재 → 16-field metadata + selectedCandidate 풀 매핑 |
| `applySupplyProviderHealthFromKisFlow(stock, kisFlow)` | function | mutate 헬퍼 — 호출자 측 중복 차단. 기존 `stock.supplyProviderHealth` 와 spread merge (ADR-0421 fallback 데이터 보존) |

### 결정 2 — `buyPipeline.GateData` schema 확장

```ts
export interface GateData {
  quote: ServerQuoteShape | null;
  gate: ServerGateResult | null;
  /** ADR-0517 — KIS investor flow row carrier 를 forensic/semantic 입력으로 propagate */
  kisFlow: KisInvestorTradeByStockDaily | null;
}
```

`fetchGateData` 의 early return + 정상 return 양쪽에서 `kisFlow` 영속. 호출자 (4 callsite) 가 `gateData.kisFlow` 를 `applySupplyProviderHealthFromKisFlow(stock, gateData.kisFlow)` 로 전달.

### 결정 3 — 4 매수 경로 wiring

| 경로 | 파일 | 위치 |
|---|---|---|
| PRE_BREAKOUT_FOLLOWTHROUGH | `buyListLoop.ts` | 라인 643 |
| PRE_BREAKOUT 30% | `buyListLoop.ts` | 라인 945+ |
| 메인 buyList | `buyListLoop.ts` | 라인 1586+ |
| INTRADAY | `intradayLoop.ts` | 라인 242 |

각 callsite 가 `applySupplyProviderHealthFromKisFlow(stock, gateData.kisFlow)` 호출 → `stock.supplyProviderHealth` mutate → `mergeSupplyProviderHealth` fallback `w.supplyProviderHealth` 가 처음으로 채워진 값 수신.

### 결정 4 — `signalScanner/index.ts` snapshot map propagate (2 위치)

buyList snapshot map (라인 173) + intradayList snapshot map (라인 229) 모두 객체 literal 최상단에 `supplyProviderHealth: w.supplyProviderHealth` 필드 추가 (후속 필드 override 가능 — 위치 정합 의도). ADR-0517 4-line 설명 주석.

### 결정 5 — carrier.actualRows[0] reference-equality 보존

raw KIS row (한글 alias `frgn_ntby_qty`/`orgn_ntby_qty`/`prsn_ntby_qty` 등) 그대로 보존 — 의도된 mutate 0 패턴. 회귀 테스트 `toBe` 단언으로 reference-equality 검증. forensic 의 `hasActualInvestorNumericRow` (ADR-0421) 가 16-key SSOT (`foreignNetBuy`/`institutionalNetBuy` core + KIS raw alias 14 field keys) 매칭으로 검증.

### 결정 6 — ENV gate `KIS_FORENSIC_FLOW_WIRING_DISABLED=true`

default OFF (ADR-0157 정확 비교 — `=== 'true'`, `'1'`/`'TRUE'`/`'yes'`/빈값 모두 거부). 1줄 즉시 ADR-P0-SUPPLY-WIRE 이전 동작 byte-equivalent 복원 (`buildSupplyProviderHealthFromKisFlow` → null 반환 / `applySupplyProviderHealthFromKisFlow` → no-op).

## 불변식

8 invariants (사용자 명시 절대 변경 금지):

1. **Live 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/auth.ts` / `kisClient/orders.ts` / `kisClient/holdings.ts` / `kisClient/query.ts` / `kisClient/resilience.ts` / `kisClient/types.ts` / `kisClient/constants.ts` / `kisClient/overrides.ts` / `kisClient/http.ts` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` 모두 0줄.
2. **KIS 주문 함수 5종 import 0건** — `placeKisMarket` / `placeKisSell` / `placeKisStop` / `placeKisTakeProfit` / `cancelKisOrder` 모두 본 SSOT 미import (정적 grep 가드).
3. **autoTradeEngine / orderExecutor / trancheExecutor import 0건** (정적 grep 가드).
4. **외부 API 신규 호출 0건** — `fetchKisInvestorTradeByStockDaily` 는 이미 호출되던 데이터를 propagate 만, 신규 outbound 0.
5. **`executionImpact: 'NONE'`** — supplyProviderHealth 매핑은 forensic 진단 입력만, 매매 결정 무관.
6. **ENV `KIS_FORENSIC_FLOW_WIRING_DISABLED=true`** (default OFF, ADR-0157 정확 비교) 1줄 즉시 ADR-P0-SUPPLY-WIRE 이전 동작 byte-equivalent 복원.
7. **호출자 측 inline ENV 검사 0건** — `isKisForensicFlowWiringDisabled()` SSOT 위임 의무.
8. **carrier.actualRows[0] 가 ADR-0421 hasActualInvestorNumericRow 통과 의무** — hasCoreField (foreignNetBuy / institutionalNetBuy) 또는 KIS raw alias 에 finite numeric 보유.

## 잘못된 해결 방법 영구 차단

- ❌ Live 주문 함수 호출 (KIS 주문 함수 5종 import 0건 정적 grep 가드)
- ❌ KIS 신규 호출 (이미 호출되던 데이터 propagate 만 — 신규 outbound 0건 의무)
- ❌ Gate threshold 변경 / requiredScore 변경 / UNKNOWN penalty 변경
- ❌ 호출자 측 inline ENV 검사 (`isKisForensicFlowWiringDisabled()` SSOT 위임 의무)
- ❌ `mergeSupplyProviderHealth` 본체 수정 (consumer 무수정, fallback `w.supplyProviderHealth` SSOT 그대로 활용)
- ❌ carrier.actualRows[0] mutation (raw KIS row reference-equality 보존 의무 — `hasActualInvestorNumericRow` 16-key SSOT 매칭 정합)
- ❌ 신규 타입 정의 (기존 `KisInvestorFlowActualRowCarrier` 재사용 의무 — 사용자 옵션 1 "진단 기반 최소 수술")

## 회귀 테스트

`server/clients/kisClient/investorFlowSupplyHealthBridge.test.ts` — 28 케이스 / 7 그룹.

| Group | 영역 | 케이스 수 |
|---|---|---|
| A | ENV gate (default OFF / "true" → true / `'1'`/`'TRUE'`/`'yes'` distinct rejection per ADR-0157) | 4 |
| B | null/undefined 입력 (kisFlow null / undefined / 빈 object) | 3 |
| C | carrier 부재 → semantic-only 매핑 (foreignNetBuy/institutionalNetBuy 보존) | 2 |
| D | carrier 존재 → 16-field metadata + selectedCandidate 풀 매핑 + actualRows reference-equality 보존 | 4 |
| E | `applySupplyProviderHealthFromKisFlow` mutation (정상 + spread merge 기존 필드 보존 + null kisFlow no-op + ENV disabled no-op) | 4 |
| F | SSOT 정적 grep 가드 (KIS 주문 함수 / autoTradeEngine / 외부 API / ENV 정확 비교 / barrel re-export / ADR trace — block + line 주석 strip 후 검사) | 6 |
| G | caller wiring 정적 grep 가드 (buyListLoop 3 callsite + intradayLoop 1 callsite + signalScanner snapshot map 2 위치 + buyPipeline GateData + 호출자 측 inline ENV 검사 0건) | 5 |

**검증 결과**: 28/28 PASS (277ms).

**인접 무회귀**:
- `server/trading/signalScanner/perSymbol/` 138/138 PASS
- `server/clients/kisClient/` + `server/trading/buyPipeline.ts` 317/318 (1 fail = 사전 baseline `kisChartCooldownPublicApi.test.ts:A5` — `git stash --include-untracked` 동일 재현 본 PR 무관 확정)

## 운영 효과 (배포 직후)

`fetchKisInvestorTradeByStockDaily` 가 이미 채운 actual investor row 가:

```
fetchKisInvestorTradeByStockDaily
  → buyPipeline.fetchGateData (kisFlow propagate)
  → buyListLoop/intradayLoop (4 callsite wiring)
    → applySupplyProviderHealthFromKisFlow(stock, kisFlow)
      → stock.supplyProviderHealth mutate
        → signalScanner/index.ts snapshot map (2 위치)
          → forensic collector
            → mergeSupplyProviderHealth (fallback w.supplyProviderHealth 처음으로 채워진 값)
              → forensic input
                → actualInvestorFlowCarried=true / semanticAvailable=N/N / forensicInputCarriesSemanticRow=N/N
                  → 전 후보 supplyUnknownPenalty 영구 차단
                    → R2_BULL 40 후보 0 entries 결함 영구 종결
```

ENV `KIS_FORENSIC_FLOW_WIRING_DISABLED=true` 1줄 즉시 ADR-P0-SUPPLY-WIRE 이전 동작 100% 복원.

## ADR 정합

- **ADR-0421** — `hasActualInvestorNumericRow` 16-key SSOT (foreignNetBuy / institutionalNetBuy core + KIS raw alias 14 field keys) — carrier.actualRows[0] 가 본 매칭 통과 의무.
- **ADR-0019** — buyListLoop 분해와 독립 — 본 ADR 은 SSOT 모듈 + 4 callsite wiring + snapshot map 2 위치만 변경, buyListLoop 본체 무분해.
- **ADR-0157** — ENV 정확 비교 (`=== 'true'`, `'1'`/`'TRUE'`/`'yes'` 모두 거부) 의무.
- **ADR-0146** — PR 자가 review 5 카테고리 모두 PASS.
