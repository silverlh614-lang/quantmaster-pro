# ADR-0445 — KRX Investor Flow Parser Empty Rows Hardening

## 1. 배경

2026-05-08 운영 로그 `/scan_blockers` 에서 다음 상태가 반복 보고:

```
Supply Provider Health:
- KRX: DATA_UNAVAILABLE / PARSER_EMPTY_ROWS
- NAVER: NOT_WIRED
- Semantic NetBuy: NOT_WIRED
- CACHE: CACHE_EMPTY
- supply_confluence: DATA_UNAVAILABLE, not failed
- liveStrongBuyAllowed: false
- shadowObservableAllowed: true
```

ADR-0435 가 `PARSER_EMPTY_ROWS` status 자체는 도입했지만 *empty rows 의 진짜 원인*
(KRX 가 200 OK 반환했는데 row 배열이 비었는지 / 응답 schema 가 바뀌었는지 / 다른
candidate path 에 데이터가 있는지) 을 분해하지 않아 운영자가 root cause 추적
불가능. 그 결과 PARSER_EMPTY_ROWS 가 며칠/몇 주 silent degradation 으로 누적됨.

본 ADR 의 목적은 *Gate 완화가 아니라* KRX 수급 empty rows 의 원인을 관측 가능하게
만들고, 가능한 cache/last-good fallback 을 안전하게 연결하는 것이다.

## 2. 결정

KRX investor-flow parser 의 empty rows 분류를 보강한다:

1. raw response shape 의 *sanitized metadata* 를 영속한다 (token/secret/full body
   금지).
2. `expectedPaths` (parser 가 시도한 path) + `detectedCandidatePaths` (실제 발견된
   array path:length) 분리 기록한다.
3. `lastSuccessAtKst` / `lastSuccessRowCount` / `lastFailureAtKst` /
   `lastFailureReason` 를 provider health 에 노출한다.
4. cache 또는 last-good sample 이 있으면 `CACHE_HIT` (fresh) vs `LAST_GOOD_STALE`
   (14일 이상) 분리 status 로 전달한다.
5. `/supply_health` 와 `/scan_blockers` 에 KRX investor-flow 최근 성공/실패
   상태를 한 줄로 노출한다.

## 3. status union (사용자 §C 정합)

```ts
type KrxInvestorFlowParserStatus =
  | 'OK'
  | 'PARSER_EMPTY_ROWS'
  | 'PARSER_SHAPE_MISMATCH'
  | 'HTTP_400'
  | 'HTTP_403'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'MARKET_CLOSED'
  | 'NON_TRADING_DAY'
  | 'CACHE_EMPTY'
  | 'CACHE_HIT'
  | 'LAST_GOOD_STALE'
  | 'UNKNOWN_ERROR';
```

기존 `InvestorFlowProviderStatus` 와 *별도 union* — parser-specific 진단 정보를
호출자가 조립할 때 사용. ProviderHealth 의 status 는 그대로 유지 (ADR-0435 정합).

## 4. KrxInvestorFlowParserDiagnostic schema

```ts
interface KrxInvestorFlowParserDiagnostic {
  provider: 'KRX';
  status: KrxInvestorFlowParserStatus;
  available: boolean;          // dataAvailable
  semanticAvailable: boolean;  // foreignNetBuy + institutionalNetBuy 모두 finite
  rowCount: number;
  expectedPaths: string[];     // ['output', 'output1', 'data', 'rows']
  detectedCandidatePaths: string[]; // ['response.body.items[0]:len=0']
  sanitizedSampleKeys: string[];    // 첫 row 의 key 목록 (값 절대 저장 X)
  lastSuccessAtKst?: string;
  lastSuccessRowCount?: number;
  lastFailureAtKst?: string;
  lastFailureReason?: string;
  cacheStatus?: 'CACHE_EMPTY' | 'CACHE_HIT' | 'LAST_GOOD_STALE';
  note?: string;
}
```

## 5. Sanitized sample 정책

영속 ledger 가 저장하는 정보:
- top-level keys (string[], 값 X)
- 후보 array path 별 `${path}:len=N` 라벨 (path 자체가 KRX 공개 schema 의 일부라
  민감 X)
- 첫 row 의 key 목록 (값 X)
- HTTP status code (number)
- content-type (단순 라벨)
- response size bucket (`<1KB|1-10KB|10-100KB|>100KB`)
- timestamp (ISO KST)

영구 금지:
- access token / appkey / secret / password / token / auth / credential / cookie
- account / accountNo / 계좌 / 개인정보
- full raw body / 대용량 HTML
- private header (Authorization, Cookie)

정적 grep 가드로 회귀 차단.

## 6. Row path 후보 탐색

`probeRowArrayCandidates(payload)` SSOT — payload 의 직접 자식 중 array 인 후보를
`path:length` 페어로 반환. 본 ADR 에서는 *진단 정보만 영속*. parser 자체가
candidate path 로 자동 전환하지 *않는다* — 검증된 path 만 parser 에 연결.
candidate 발견은 후속 PR 에서 검증된 후 parser 에 추가하기 위한 입력.

## 7. Cache / Last-good fallback (사용자 §I)

| 상태 | semanticAvailable | liveStrongBuyAllowed |
|------|---------------------|----------------------|
| `OK` (fresh KRX) | true | downstream 결정 |
| `CACHE_HIT` (fresh cache) | true | downstream 결정 |
| `LAST_GOOD_STALE` (14일 이상) | true (참고용) | **false 강제** |
| `CACHE_EMPTY` | false | false |

`LAST_GOOD_STALE` 은 본 ADR 의 *진단 status* 로 표시되지만, evaluator 측에서는
ADR-0421 의 `evaluateInvestorFlowSemanticAvailability` SSOT 가 `available` 만
판단 — stale cache 를 OK 로 승격하지 *않는다*. liveStrongBuyAllowed=false 강제는
호출자 (`composite` health 의 `dataAvailable=false` 설정) 측 정합.

## 8. supply_confluence 영향

ADR-0421 supplyConfluence evaluator 의 의미론은 *전혀* 변경하지 않는다:

- semantic 둘 다 양수 → FIRED (positive confluence)
- 둘 다 음수 → THRESHOLD_NOT_MET (true negative)
- semantic 부재 / parser empty / cache empty → DATA_UNAVAILABLE
- DATA_UNAVAILABLE 은 failed 가 아님 (ADR-0416 정합)

본 ADR 은 진단 layer — supply_confluence weight, Gate threshold, STRONG_BUY 조건
0 변경.

## 9. ENV 우회

```
KRX_PARSER_DIAGNOSTIC_DISABLED=true   # default OFF, 'true' 정확 비교
```

활성 시 diagnostic 빌더 자체 skip. ADR-0157 정확 비교 의무 (`'1'` / `'TRUE'` /
`'yes'` 거부). 회귀 발견 시 1줄 즉시 ADR-0435 동작 100% 복원.

## 10. 영속 ledger

- 파일: `data/krx-investor-flow-parser-diagnostics.json`
- atomic write (tmp → rename)
- FIFO trim 200건
- 손상 JSON → 빈 배열 fallback
- 외부 의존성 0 (fs + persistence/paths SSOT 만)

기존 `data/investor-flow-cache.json` (`investorFlowCacheRepo`) 와 *물리 분리*:
- cache: successful sample 영속 (provider 정상 동작 시)
- diagnostic ledger: parser 실패의 원인 분해 영속 (PARSER_EMPTY_ROWS 시점)

두 ledger 절대 합치지 않음.

## 11. 호출자 wiring 매트릭스

| 위치 | 변경 |
|------|------|
| `investorFlowRouter.fetchKrxInvestorFlow` | empty rows 감지 시 진단 SSOT 호출 + ledger 영속 |
| `investorFlowProviderHealth.makeInvestorFlowProviderHealth` | lastSuccess/lastFailure 옵셔널 propagate |
| `investorFlowProviderHealth.summarizeInvestorFlowProviderHealth` | KRX 라인 확장 (compact format) |
| `supplyHealth.cmd diagnoseInvestorFlow` | parser diagnostic 라인 추가 |
| `scanBlockers.cmd` | 기존 supplyProviderSection 자연 격상 |
| **LIVE 매매 본체** | **0줄 변경** |

## 12. 운영 출력 기대값

`/scan_blockers` 패치 후:

```
KRX: DATA_UNAVAILABLE / PARSER_EMPTY_ROWS
  lastOK: 09:02 KST rows=12
  lastFail: 09:34 KST
  expected: output1
  detected: response.body.items[0]:len=0
  cache: CACHE_EMPTY
- NAVER: NOT_WIRED
- Semantic NetBuy: NOT_WIRED
- CACHE: CACHE_EMPTY
- supply_confluence: DATA_UNAVAILABLE, not failed
- liveStrongBuyAllowed: false
- shadowObservableAllowed: true
```

## 13. 절대 불변식

1. LIVE 매매 본체 0줄 변경 (signalScanner / entryEngine / exitEngine / kisClient
   / orchestrator / autoTradeEngine / trancheExecutor 모두)
2. KIS 주문 함수 5종 (`placeKisMarketOrder` / `placeKisSellOrder` / `cancelKisOrder`
   / `placeKisStopLossOrder` / `placeKisTakeProfitOrder`) import 0건
3. `autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건
4. Gate threshold + condition weight + STRONG_BUY 조건 + SectorEnergy 조건 +
   SELL_ONLY 0 변경
5. PARSER_EMPTY_ROWS 는 DATA_UNAVAILABLE 이지 failed 아님 (ADR-0416 정합)
6. DATA_UNAVAILABLE 은 NEUTRAL 아님 (ADR-0421 정합)
7. STALE / CACHE / LAST_GOOD 는 OK 아님
8. raw payload 무제한 저장 금지 (sanitized metadata 만)
9. token-like key 영속 금지 (정적 grep 가드)
10. supply_confluence evaluator 의 의미론 변경 0 (ADR-0421 의 결정 트리 보존)
11. KRX/Naver/KIS outbound 빈도 0 변경 (진단은 기존 호출 결과만 분석)
12. ENV `KRX_PARSER_DIAGNOSTIC_DISABLED=true` 1줄로 ADR-0435 동작 100% 복원

## 14. 잘못된 해결 방법 영구 차단

- raw KRX response body 전체 영속 (token/cookie 노출 위험)
- candidate path 발견 시 parser 자동 전환 (검증되지 않은 schema 적용 위험)
- LAST_GOOD_STALE 을 OK 로 승격 (사용자 §10 명시 금지)
- DATA_UNAVAILABLE 을 NEUTRAL 처리 (ADR-0421 §F 명시 금지)
- DATA_UNAVAILABLE 을 failed 처리 (ADR-0416 명시 금지)
- supply_confluence weight 또는 Gate threshold 변경 (사용자 §"절대 금지")
- 신규 KRX/Yahoo/Naver outbound 추가 (cache/diagnostic 만 추가, 기존 호출 결과
  분석)
- 진단 ledger 와 cache ledger 통합 (책임 분리 위반)
- ENV default ON (ADR-0157 정확 비교 + default OFF 의무)
- 호출자 측 inline ENV 검사 (`isKrxParserDiagnosticDisabled()` SSOT 위임 의무)

## 15. 회귀 테스트 매트릭스

목표 30+ 케이스 (`server/supply/krxInvestorFlowParserDiagnosticAdr0445.test.ts`).

상세 매트릭스는 `_workspace/2026-05-08_adr0445-krx-parser-empty-rows-hardening/
architect/plan.md` 참조.

## 16. 잔여 후속 PR (scope 외)

- candidate path 가 안정적으로 발견된 경우 parser auto-switch 정책 (별도 ADR
  의무, 검증된 path 만)
- NAVER investor-flow collector wiring (현재 NOT_WIRED, 별도 PR scope)
- semantic field alias 확장 (multi-provider 통합 시점, ADR-0421 §field aliases
  정합)
- LAST_GOOD_STALE 임계 (현재 14일) ENV 화 (운영 데이터 누적 후 재조정 가능)
