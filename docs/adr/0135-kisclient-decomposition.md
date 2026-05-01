# ADR-0135 — `server/clients/kisClient.ts` 분해 (PR-Refactor-3, P1-3)

**Status**: Accepted
**Date**: 2026-05-01
**Context**: PR-Refactor-3 (P1-3, ADR-0014 retry safety + PR-21/24 회로·블랙리스트 후속)

## Context

`server/clients/kisClient.ts` (1382 LoC) 는 CLAUDE.md 절대 규칙 #2 ("kisClient 단일 통로")
의 SSOT 다. 51개 파일이 import 하며, KIS API 의 모든 호출 경로가 본 파일을 경유한다.
1500줄 절대 규칙 한계는 안 넘었으나 사용자 명시 우선순위 — *"회복탄력성 코드(circuit
breaker, blacklist, retry safety)가 한곳에 응축돼 변경 시 영향 반경이 너무 큼"*.

### 현재 구조 (1382 LoC, 함수/심볼 50+)

| 영역 | 라인 | 내용 |
|------|------|------|
| 상수 + re-export | L1-29 | KIS_BASE / TR_ID / KIS_IS_REAL / kisRateLimiter / kisModeGuard re-export |
| **토큰 관리 (auth)** | L31-194 | refreshKisToken / refreshRealDataToken / get*RemainingHours / invalidateKisToken / forceRefreshKisTokens / sanitizeTokenErrorInfo |
| HTTP 헬퍼 + ADR-0014 | L196-241 | KisPostOptions / KisPostIdempotency 타입 + jitter 헬퍼 |
| **회로 차단기 (resilience)** | L243-426 | CIRCUIT 상수 / CircuitState / _circuitByTrId / _isCircuitOpen / _recordCircuit* / __testOnly / getCircuitBreakerStats / resetKisCircuits |
| **HTTP raw + rate-limited (http)** | L428-627 | _rawKisGet / _rawKisPost / kisGet / kisPost / _alertUnsafeWriteFailure |
| realDataKisGet | L629-691 | 실계좌 GET (HTTP 와 동일 책임) |
| Mock 오버라이드 | L693-732 | KisClientOverrides / setKisClientOverrides / hasKisClientOverrides |
| **데이터 조회 (query)** | L734-942 | fetchKisInvestorFlow / fetchKisMarketSupply / fetchCurrentPrice / fetchKisPrevClose / fetchStockName |
| **잔고 조회 (holdings)** | L944-1081 | isKisBalanceQueryAllowed / fetchAccountBalance / fetchKisHoldings |
| **주문 발송 (orders)** | L1083-1382 | placeKisMarketBuyOrder / placeKisSellOrder / placeKisStopLossLimitOrder / placeKisTakeProfitLimitOrder / cancelKisOrder |

### 외부 importer

51개 파일 (`server/` + `src/` 전수 grep 결과). 모두 `from '...kisClient.js'` 경로 사용.
회귀 테스트 별도: `kisRetrySafety` / `kisCircuit404` / `kisCircuitBlacklist` (ADR-0014/PR-21/PR-24
의 핵심 회귀 가드).

### 책임 분해 가능성

저수준(http) / 회복탄력성(resilience) / 인증(auth) / 도메인 호출(query/holdings/orders) /
구성(constants/overrides/types) 레이어 분리 가능. 각 레이어는 단방향 의존:
**constants ← auth ← resilience ← overrides ← http ← {query, holdings, orders}**.

## Decision

### 분해 후 구조 (10 파일, kisClient/ 디렉토리)

```
server/clients/
├── kisClient.ts                   # ~30 LoC barrel re-export (외부 호환)
└── kisClient/
    ├── index.ts                   # ~50 LoC barrel
    ├── types.ts                   # ~70 LoC — 도메인 타입 SSOT
    ├── constants.ts               # ~40 LoC — KIS_BASE / TR_ID / KIS_IS_REAL / HAS_REAL_DATA_CLIENT
    ├── auth.ts                    # ~180 LoC — 토큰 캐시 + refresh*Token + invalidateKisToken
    ├── resilience.ts              # ~290 LoC — 회로차단 + ADR-0014 jitter + __testOnly + _alert*
    ├── overrides.ts               # ~70 LoC — KisClientOverrides + set/has/getOverrides
    ├── http.ts                    # ~250 LoC — _rawKisGet/_rawKisPost + kisGet/kisPost + realDataKisGet
    ├── query.ts                   # ~220 LoC — fetch{InvestorFlow,MarketSupply,CurrentPrice,PrevClose,StockName}
    ├── holdings.ts                # ~130 LoC — isKisBalanceQueryAllowed + fetchAccountBalance + fetchKisHoldings
    └── orders.ts                  # ~330 LoC — place{Market,Sell,StopLoss,TakeProfit}Order + cancelKisOrder
```

각 파일 @responsibility (25 단어 이내):

- **types.ts**: "KIS 클라이언트 도메인 타입 SSOT — 옵션·flow·holding·order 결과 인터페이스"
- **constants.ts**: "KIS API 엔드포인트·TR_ID·실계좌 client 가용성 상수 SSOT"
- **auth.ts**: "KIS 주·실계좌 OAuth 토큰 단일 통로 — 캐시·single-flight·강제 갱신"
- **resilience.ts**: "KIS 회로 차단기 + ADR-0014 jitter 백오프 + __testOnly 진입점"
- **overrides.ts**: "VTS 모드 데이터 조회 mock 오버라이드 SSOT — 파이프라인 테스트 지원"
- **http.ts**: "KIS REST 저수준 호출 — raw GET/POST + rate-limited 래퍼 + 실계좌 GET"
- **query.ts**: "KIS 시세 조회 — 현재가·전일종가·종목명·투자자수급·시장수급"
- **holdings.ts**: "KIS 실계좌 잔고 조회 — 점검시간 가드 + 주문가능현금·보유 종목"
- **orders.ts**: "KIS 실주문 발송 — 시장가/지정가 매수·매도·손절·익절·취소"
- **index.ts**: "kisClient 디렉토리 barrel — 분해된 9 모듈 단일 진입점"

### 외부 API 보존 원칙

`server/clients/kisClient.ts` 자체는 **얇은 barrel re-export 만 유지**. 51개 외부 importer
+ 회귀 테스트 import 경로 변경 0건. 모든 export 가 새 위치에서 그대로 re-export.

```ts
// server/clients/kisClient.ts (분해 후 barrel)
export * from './kisClient/index.js';
```

### byte-equivalent 보존 원칙

본 PR 은 **파일 분리만, 함수 본체 0줄 변경**. 회로차단·재시도 정책·주문 멱등성·토큰 갱신
single-flight 모두 byte-equivalent 보존. LIVE 매매 회귀 위험 격리.

### 의존성 그래프 (단방향, 순환 없음)

```
constants  ←  auth
              ↑
overrides    resilience
   ↑          ↑
   └── http ──┘
        ↑
   ┌────┼────┐
   │    │    │
 query holdings orders
```

- `auth` 가 `constants` 의 `KIS_BASE` / `REAL_DATA_BASE` / `HAS_REAL_DATA_CLIENT` 사용
- `http` 가 `auth.refreshKisToken` / `auth.refreshRealDataToken` / `auth.invalidateKisToken` / `auth.cachedRealDataToken` reset 호출 + `resilience.{_isCircuitOpen, _recordCircuit*, _kis*Delay, _alertUnsafeWriteFailure}` + `overrides.getOverrides()` 사용
- `query` / `holdings` / `orders` 가 `http.{kisGet, kisPost, realDataKisGet}` + `overrides.getOverrides()` 사용
- `orders` 가 `constants.KIS_IS_REAL` + `state.getTradingMode` 사용 (isLiveOrderAllowed)

`auth` 의 `invalidateKisToken` 이 `cachedRealDataToken` 도 reset 해야 하므로 두 토큰 캐시는
**같은 모듈 (auth.ts)** 안에 함께 위치.

## Consequences

### Positive

- 1382 LoC 단일 파일 → 10 파일 (각 < 350 LoC) 책임 단위 분리
- 절대 규칙 #2 SSOT 의 *내부 구조* 시각화 (auth / resilience / http / domain 4 레이어)
- 회로차단·재시도·주문 멱등성 코드가 `resilience.ts` + `http.ts` 단일 진입점으로 격리 → 변경 시 영향 반경 ↓
- 단위 테스트 추가 용이 (각 도메인 별 mock 가능)
- `kisClient/` 디렉토리 패턴이 ADR-0028 (exitEngine), ADR-0029 (stockScreener), ADR-0134 (perSymbolEvaluation) 와 정합

### Negative

- 신규 디렉토리 1개 + 신규 파일 9개 — 구조적 복잡도 일시 증가
- TypeScript ESM 환경에서 *순환 import* 가능성 — 의존 그래프 단방향 강제로 차단

### Neutral

- 외부 importer (51 파일) 무수정 — barrel re-export 호환
- 회귀 테스트 무수정 — 패턴 검사가 export signature 만 검증
- LIVE 매매 본체 0줄 변경 — byte-equivalent 분해

## Migration Plan

1. **Phase 2 (스캐폴딩)**: `kisClient/` 디렉토리 + 10 파일 placeholder
2. **Phase 3-A (types.ts)**: 7개 도메인 타입 이동 (의존 0)
3. **Phase 3-B (constants.ts)**: KIS_BASE / TR_ID / HAS_REAL_DATA_CLIENT 이동 (의존 0)
4. **Phase 3-C (auth.ts)**: 토큰 캐시 + refresh*Token 이동 (constants 의존)
5. **Phase 3-D (resilience.ts)**: 회로차단 + ADR-0014 헬퍼 이동 (의존 거의 0, telegramClient/blacklist만)
6. **Phase 3-E (overrides.ts)**: KisClientOverrides + state 이동 (types 의존)
7. **Phase 3-F (http.ts)**: _rawKisGet/Post + kisGet/Post + realDataKisGet 이동 (auth/resilience/overrides 의존)
8. **Phase 3-G (query.ts)**: fetch* 5개 이동 (http/overrides 의존)
9. **Phase 3-H (holdings.ts)**: 잔고 조회 3 함수 이동 (http/overrides 의존)
10. **Phase 3-I (orders.ts)**: 주문 6 함수 이동 (http/constants/state 의존)
11. **Phase 4**: `kisClient.ts` → barrel re-export 만, `kisClient/index.ts` barrel
12. **Phase 5**: vitest server/clients + 51 importer 영역 회귀 + lint + validate:all + precommit
13. **Phase 6**: CLAUDE.md / ARCHITECTURE.md 갱신

각 단계 후 `npm run lint` 통과 보장 — 회귀 즉시 감지.

## Alternatives Considered

### A. 더 큰 단위 (3 파일: auth + http + business)

장점: 파일 수 감소. 단점: business (query+holdings+orders) 가 670+ LoC 로 god file 부활. 거부.

### B. 더 작은 단위 (각 함수마다 파일)

장점: 단일 함수 SSOT. 단점: 50+ 파일 폭발, 의존성 그래프 복잡, barrel 비대화. 거부.

### C. 기존 위치 유지 + 함수 재배치만

장점: 디렉토리 변경 없음. 단점: 1382 LoC 그대로 — 분해 효과 없음. 거부.

### D. signalScanner/ 패턴과 다르게 평탄 (kisClient/{auth,http,...}.ts 동일)

본 ADR 채택. 디렉토리 분리 + barrel 패턴이 PR-Refactor-2 (perSymbolEvaluation/) 와 정합.

## Rollback

비상 시 `git revert` — byte-equivalent 분해라 revert 시 동작 즉시 복원. ENV 우회 미도입
(분해는 ENV 토글 영역 아님).

## Follow-up

- **PR-Refactor-3-B** (선택): http.ts 의 `_rawKisGet` / `_rawKisPost` 가 ~75 LoC 중복 (재시도 정책 동일) — 공통 retry policy 추출 가능. 운영 데이터 누적 후 진행.
- **PR-Refactor-4**: `dartPoller.ts` (962 LoC) 분해 — 후속.
- **PR-Refactor-5**: `shadowTradeRepo.ts` (939 LoC) 분해 — 후속.

## References

- ADR-0014 — KIS retry safety policy (jitter + idempotency)
- ADR-0133 — file-complexity-gate-integrity
- ADR-0134 — perSymbolEvaluation 분해 (직전 PR-Refactor-2)
- CLAUDE.md 절대 규칙 #2 — kisClient 단일 통로
- PR-21 — 회로 차단 하드/소프트 분리 (404 완화)
- PR-24 — 24h endpoint blacklist
- PR-34 — retry safety + jitter + idempotency
