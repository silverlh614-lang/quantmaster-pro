# ADR-0532: KIS Finance Fundamentals Migration

@responsibility gate2 — KIS Finance Fundamentals Migration

## Status

Proposed (design only — no runtime behavior change in this ADR; phased implementation behind env flag).

## Context

Gate2 펀더멘털(earnings_quality/roe/opm/icr/per)은 현재 **DART Open API** 단일 의존이다. 운영 진단(`/scan_blockers`, `/gate_full`)과 코드 추적으로 다음 문제가 확인됐다:

1. **이원화된 DART read 경로 (불일치).** read 진입점 `getGate2DartFinancialsForEvaluation`(gate2ExternalDataProvider.ts)는 cache HIT 시 full `QmpDartFinancials`(icr 포함)를 주지만, **cache MISS 시 legacy `getDartFinancials`(dartFinancialClient.ts)로 fallback** 한다. legacy client는 `interestExpense`를 안 가져오고 반환 타입이 `DartFinancials`(roe/opm/debtRatio/ocfRatio 4개)뿐이라 **icr 영구 null** + ocfRatio 정의 불일치(legacy=영업CF/매출 vs normalizer=영업CF/순이익).
2. **corp_code 마스터 취약성.** DART는 6자리 종목코드 → DART 8자리 corp_code 매핑(CORPCODE.xml 다운로드/파싱 캐시)이 선행돼야 한다. 부팅 시 silent bootstrap 실패 시 키가 있어도 전 종목 MISSING.
3. **데이터 신뢰등급.** DART = L2. KIS 공식 = L1.
4. **아키텍처 방향.** 프로젝트는 `KIS_FIRST_REBUILD_MODE` / `KIS_ONLY_REBUILD` 로 KIS 단일소스 재구축 중(KRX investor-flow quarantine, executionGate KIS_ONLY_REBUILD 분기). 펀더멘털만 외부 의존(DART)으로 남아 있다.

**KIS Open Trading API 실측 검증** (공식 `open-trading-api-main` repo):

| 엔드포인트 | tr_id | 핵심 필드 |
|---|---|---|
| `/uapi/domestic-stock/v1/finance/financial-ratio` | FHKST66430300 | `roe_val`(ROE), `eps`, `bps`, `sps`, `lblt_rate`(부채비율), `grs`/`bsop_prfi_inrt`/`ntin_inrt`(성장률), `rsrv_rate` |
| `/uapi/domestic-stock/v1/finance/income-statement` | FHKST66430200 | `sale_account`(매출), `op_prfi`(영업이익), `thtr_ntin`(순이익) → OPM = op_prfi/sale_account |
| `/uapi/domestic-stock/v1/finance/profit-ratio` | FHKST66430400 | `sale_ntin_rate`(순이익률), `sale_totl_rate`(매출총이익률), `self_cptl_ntin_inrt`(≈ROE) |
| `/uapi/domestic-stock/v1/finance/stability-ratio` | FHKST66430600 | `lblt_rate`, `crnt_rate`(유동), `quck_rate`(당좌), `bram_depn`(차입금의존도) |
| `/uapi/domestic-stock/v1/finance/other-major-ratios` | — | `ebitda`, `ev_ebitda`, `payout_rate`(배당성향) |
| `/uapi/domestic-stock/v1/quotations/inquire-price` | FHKST01010100 | **`per`, `pbr`, `eps`, `bps`** |

요청 파라미터는 **`FID_INPUT_ISCD` = 6자리 종목코드 직접** + `FID_COND_MRKT_DIV_CODE=J` + `FID_DIV_CLS_CODE`(0=년/1=분기). **corp_code 마스터 불필요** — DART의 #2 취약성이 원천 제거된다.

**KIS가 못 주는 2개**: **ICR(이자보상배율)** — KIS는 이자비용을 분리 제공하지 않음(`bsop_non_expn`=영업외비용에 혼재). **OCF(현금흐름)** — KIS 표준 재무 엔드포인트에 현금흐름표 없음.

## Decision

Gate2 펀더멘털의 1차 소스를 **DART → KIS(공식, L1)** 로 이전하되, KIS가 못 주는 ICR/OCF만 DART를 보조로 유지하는 **하이브리드**로 간다. 모든 KIS 호출은 `kisClient` 단일 통로(§2.2-2)를 경유한다.

### 1. 필드 매핑 (KIS 1차 / DART 보조)
- **KIS 1차**: ROE(`roe_val`), OPM(income-statement `op_prfi/sale_account`), 부채비율(`lblt_rate`), 순이익률/매출총이익률(profit-ratio), 유동/당좌비율(stability-ratio), EPS/BPS(financial-ratio), **PER/PBR(inquire-price)**, EBITDA/EV-EBITDA/배당성향(other-major-ratios).
- **DART 보조(유지)**: **ICR**(full 경로 `fetchDartFinancialsForGate2`의 interestExpense 기반), **OCF/ocfRatio**(현금흐름). KIS 미가용분만 채운다.
- `per`는 inquire-price에 항상 포함 → 현재 `perStatus=UNAVAILABLE`을 가장 적은 비용으로 복구.

### 2. 단일 통로·정규화 계약
- 신규 `server/clients/kisFinanceClient.ts`(또는 `kisClient/finance.ts`) — kisClient 인증·서킷·재시도 인프라 재사용. raw KIS REST 직접 호출 금지(§2.2-2 준수).
- 출력은 기존 `QmpDartFinancials` 호환 형태로 정규화 → **gate2 소비처(gate2ConfluenceScore 등) 무변경** (계약 byte-equivalent). ICR/OCF는 DART 보조에서 머지.

### 3. ENV 게이트 (default-off, 1줄 롤백)
- `KIS_FINANCE_PRIMARY_ENABLED`(default false). false = 현행 DART 경로 100% 유지(회귀 0). true = KIS 1차 + DART 보조(ICR/OCF). ADR-0157 정확 비교(`=== 'true'`).

### 4. 데이터 신뢰·캐시·쿼터
- KIS 펀더멘털 = L1. 분기 데이터이므로 long TTL 캐시(≥24h, DART와 동형) — cache-first 단일 통로. 19종목 × 분기 ≈ KIS 5건/초 한도 무영향. 신규 quota 침범 최소.

### 5. 단계적 롤아웃 (각 단계 executionImpact=NONE, shadow 무중단)
- **Phase 1**: `kisFinanceClient` fetch + `QmpDartFinancials` 정규화 매핑 (소비처 미연결, flag-off, 진단 노출만).
- **Phase 2 (ROI 최고)**: **PER 복구** — inquire-price `per`를 valuation/per 조건에 wiring (현재 UNAVAILABLE → 채움). 작고 즉효.
- **Phase 3**: gate2 read 경로(`getGate2DartFinancialsForEvaluation`)를 flag-on 시 KIS 1차로 전환, ICR/OCF는 DART 보조 머지. legacy `getDartFinancials` fallback 제거(이원화 해소).
- **Phase 4**: 3영업일 관찰(ADR-0466/0471 dry-run 비교) 후 운영자 승인 시 default flip.

## Consequences

**Pros**
- corp_code 마스터 취약성 원천 제거(6자리 코드 직접). 신뢰등급 L2→L1. KIS-first 재구축 정합, `kisClient` 단일통로.
- DART보다 풍부(EBITDA/EV-EBITDA/순이익률/매출총이익률/유동·당좌비율/성장률) + **현재 깨진 per/icr 중 per 즉시 복구**.
- read 경로 이원화(legacy fallback) 해소 → ocfRatio 정의 일관.

**Cons / 한계**
- **ICR·OCF는 KIS 미가용** → DART 보조 유지 필수(완전 제거 불가). DART 의존이 2개 축으로 축소될 뿐 0은 아님.
- 신규 KIS finance wiring 표면(엔드포인트 5종 + inquire-price). 작업량 적지 않음 → 단계적.
- ⚠ **트레이딩 unblock 아님.** Gate2 펀더멘털은 `entryHardBlockImpact=NO` — 매수 후보는 안 늘고 high-conviction 승격 정확도·진단 일관성만 개선. 현 후보 약세 원인은 pre-breakout(Gate3)이지 펀더멘털 아님.

**Invariants (ADR-0146 5-카테고리 자가 review)**
1. LIVE 매매 안전성: 모든 단계 flag default-off + ENV 1줄 롤백 + executionImpact=NONE. live order 본체 0줄. KIS quota 분기캐시로 0 침범.
2. wiring 완료 vs 인프라: Phase별 명시. Phase 1은 인프라(미연결), Phase 2~3에서 실연결.
3. ADR 무결성: 본 ADR-0532 발급(INDEX 0533으로 bump). 신규 정책(소스 이전)이므로 ADR-type 정당.
4. 회귀 테스트: 각 Phase에 kisFinanceClient 정규화 단위테스트 + gate2 소비처 byte-equivalent(flag-off) 회귀.
5. 정책 위반 baseline 무회귀: §2.2 kisClient 단일통로 준수, 불변식 #1/#2/#7 보존.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated. (KIS 호출은 `kisClient` 단일 통로·진단/Gate 입력 한정, 주문 경로 무관.)
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated. (flag-off 시 byte-equivalent.)
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated until Phase 3 flag-on.
- No data promotion behavior change unless explicitly stated.
