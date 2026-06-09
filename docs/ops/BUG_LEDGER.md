# BUG / DEFECT LEDGER — QuantMaster Pro

## 책임 선언

이 문서는 QuantMaster Pro의 결함 생애주기 SSOT다.

ADR이 의사결정 기록이라면, BUG_LEDGER는 결함의 발생, 영향, 원인, 해결, 검증, 재발 감시를 기록한다.

ADR과 BUG_LEDGER는 중복이 아니라 직교 관계다.

- ADR = "왜 이렇게 결정했는가" (의사결정 아카이브)
- BUG_LEDGER = "어떤 결함이 언제 발생했고, 어떻게 해결됐고, 재발했는가" (결함 생애주기 아카이브)

운영자는 다음 질문에 본 문서로 즉시 답할 수 있어야 한다.

- 현재 열려 있는 P0 결함은 무엇인가?
- 어떤 종류의 결함이 반복되는가?
- 패치 후 재발 감시 중인 결함은 무엇인가?
- 어떤 영역이 결함 빈발 지역인가?

## 상태 정의

| 상태 | 의미 |
|------|------|
| `OPEN` | 원인 미확정 또는 수정 전 |
| `PATCHED` | 수정 PR이 병합되었으나 운영 검증 전 |
| `VERIFIED` | 테스트 및 운영 로그로 해결 확인 |
| `WATCHING` | 재발 감시 기간 |
| `CLOSED` | 감시 기간 종료 후 재발 없음 |
| `WONTFIX` | 명시적으로 수정하지 않기로 결정 |

## 상태 전이 규칙

- `OPEN → PATCHED`: 수정 PR merge + 해결 방법 기록
- `PATCHED → VERIFIED`: 테스트 통과 + 운영 로그 확인
- `VERIFIED → WATCHING`: 영역별 감시 기간 시작
- `WATCHING → CLOSED`: 감시 기간 동안 재발 없음
- `WATCHING → OPEN`: 재발 감지 시 기존 BUG ID 유지, `recurrence_count` 증가
- `ANY → WONTFIX`: 운영자 명시 결정 필요

`WATCHING → OPEN` 재발 규칙은 본 장부의 핵심이다. 같은 결함이 다시 발생할 경우 새 BUG ID 를 발급하지 않고, 기존 BUG ID 의 `recurrence_count` 를 증가시킨다. 이로써 "같은 패턴의 결함이 N 번 재발했다" 라는 정량적 증거가 누적된다.

## Severity 기준

### P0 Critical

다음 중 하나라도 해당하면 P0다.

- 자금 손실 가능성
- 잘못된 주문
- 손절 실패
- 가짜 STRONG_BUY
- 시스템 전체 정지
- 데이터 진실성 붕괴
- 휴장일/장중/장마감 기준일 혼합으로 가짜 Confluence 발생 가능

처리 기준: 즉시 Hotfix.

### P1 High

- 의사결정 정확도 저하
- 단일 핵심 모듈 장애
- 가짜 차단 또는 가짜 신호 가능성

처리 기준: 7일 내 패치.

### P2 Medium

- 진단, 알림, 로그 정확도 저하
- 운영자 판단을 어렵게 만드는 표시 문제

처리 기준: 30일 내 패치.

### P3 Low

- UI/UX 불편
- 라벨 오류
- 가독성 문제

처리 기준: 분기별 묶음 처리.

## BUG frontmatter 표준

각 BUG 항목은 다음 YAML frontmatter 로 시작해야 한다.

```yaml
---
id: BUG-YYYY-MM-DD-NNN
status: OPEN
severity: P0
area: Market Truth Layer
discovered: YYYY-MM-DD
resolved: null
related_adrs: []
related_bugs: []
keywords: []
recurrence_count: 0
---
```

필드 설명:

- `id`: `BUG-YYYY-MM-DD-NNN` 형식. 동일 일자 내 발견 순서대로 NNN 증가. 발급 후 영구 불변.
- `status`: 위 상태 정의 6 값 중 하나.
- `severity`: P0 / P1 / P2 / P3 중 하나.
- `area`: `docs/ops/BUG_AREAS.md` 의 영역 이름과 정확히 일치.
- `discovered`: 결함이 처음 관측된 KST 날짜.
- `resolved`: 해결 PR 머지 KST 날짜. 미해결 시 `null`.
- `related_adrs`: 관련 ADR 번호 리스트 (예: `[ADR-0412, ADR-0414]`).
- `related_bugs`: 같은 패턴 또는 인접 결함의 BUG ID 리스트.
- `keywords`: 검색용 키워드 리스트.
- `recurrence_count`: 재발 횟수. 초기값 0.

## BUG로 등록하는 것 / 등록하지 않는 것

### BUG로 등록

- 명세된 동작과 다르게 작동하는 경우
- 데이터, 로직, 통합의 결함
- 회귀
- 운영 중 실제 위험을 만든 결함
- 잘못된 매수/매도/손절/학습/진단 가능성

### BUG로 등록하지 않음

다음 항목은 BUG 가 아니므로 본 장부에 등록하지 않는다.

- 새 기능 요청
- 단순 UX 개선 의견
- 전략 아이디어
- 임계값 실험
- 리팩토링 희망 사항
- ADR 토론 주제

위 항목은 필요 시 별도 문서 (예: `_workspace/PENDING_WIRING.md`, ADR 초안, 별도 RFC) 로 분리한다.

## BUG 항목

---
id: BUG-2026-05-07-001
status: OPEN
severity: P0
area: Market Truth Layer
discovered: 2026-05-07
resolved: null
related_adrs: [ADR-0412, ADR-0414, ADR-0591]
related_bugs: []
keywords: [holiday, base-date, trading-context, sector-energy, scanner, watchlist, shadow-learning]
recurrence_count: 0
---

### BUG-2026-05-07-001 — 휴장일 기준일 혼합 위험

#### 증상 (What)

휴장일, 장중, 장마감 후 기준일이 모듈별로 다르게 계산될 수 있다.

예를 들어 기술지표는 A일, 수급은 B일, 섹터에너지는 C일 데이터를 기준으로 계산되는데, 최종 판단에서는 하나의 Confluence처럼 합쳐질 수 있다.

#### 영향 (Impact)

- 가짜 Confluence 발생 가능
- 가짜 STRONG_BUY 발생 가능
- 휴장일 워치리스트 갱신 오판 가능
- Shadow 학습과 신규 신호 생성의 권한 혼동 가능
- SectorEnergy stale 데이터가 정상처럼 보일 가능성
- 학습 데이터 오염 가능

이 결함은 자금 손실 가능성과 직접 연결될 수 있으므로 P0로 분류한다.

#### 재현 (Reproduction)

다음 조건에서 scanner, watchlist, sectorEnergy, learning 로그의 기준일을 비교한다.

1. KRX 휴장일
2. 주말
3. 장중
4. 장마감 직후
5. 전일 데이터 확정 전후

각 모듈이 동일한 `effectiveTradingDate`, `previousTradingDate`, `dataMode`, `permissions`를 사용하는지 확인한다.

#### 근본 원인 (Root Cause)

- Why 1: 각 모듈이 자체적으로 `new Date()` 또는 `Date.now()`를 호출할 수 있다.
- Why 2: TradingContext가 모든 실행 경로에 강제 주입되지 않았다.
- Why 3: 휴장일, 장중, 장마감 후 기준일 정책이 런타임 SSOT로 강제되지 않았다.
- Why 4: 신호 생성, 워치리스트 갱신, Shadow 학습, 백필 권한이 동일한 Market Truth Layer에서 판정되지 않을 수 있다.
- Why 5: Market Truth Layer가 문서/ADR 수준을 넘어 실제 런타임 전역 의존성으로 완전히 격상되지 않았다.

#### 기대 동작 (Expected)

모든 모듈은 자체 날짜 계산을 하지 않고, 단일 TradingContext에서 제공하는 값을 사용해야 한다.

- `effectiveTradingDate`
- `previousTradingDate`
- `nextTradingDate`
- `dataMode`
- `permissions.allowSignalGeneration`
- `permissions.allowWatchlistRefresh`
- `permissions.allowShadowLearning`
- `permissions.allowBackfill`
- `permissions.allowFutureReturnResolve`

휴장일에는 신규 신호 생성과 워치리스트 갱신을 차단하되, Shadow 학습과 백필은 허용할 수 있다.

#### 해결 (Resolution)

- 진행 (2026-06-09, ADR-0591) — **기반 구축 + 신호경로 우선 착수** (status OPEN 유지):
  - 날짜 SSOT 신규 `server/calendar/tradingContext.ts` `resolveTradingContext()` (effectiveTradingDate/
    previousTradingDate/nextTradingDate, KRX 거래일 달력 위). 단위 테스트 6종.
  - 신호생성 shadow lane 3건(counterfactual ×2 / provisional ×1)의 scanId ad-hoc UTC 날짜 →
    effectiveTradingDate(KST 거래일) 주입. 장전 scanId 전날 박힘 + 동일 스캔 두 scanId 불일치 해소(SHADOW 한정).
  - 정적 가드 `scripts/check_trading_date_ssot.js` (signalScanner ad-hoc 기준일 baseline 0 강제, validate:all/precommit 통합).
  - 잔여: 기술지표/수급/섹터에너지/SourceSnapshot 전면 주입(~1,600곳)은 후속 ADR 시리즈로 점진 마이그레이션.
- 수정 PR:
- 관련 ADR: ADR-0412, ADR-0414, ADR-0591
- 검증 방법:
  - 휴장일 기준일 일치 테스트
  - 장중 기준일 일치 테스트
  - 장마감 후 기준일 일치 테스트
  - scanner/watchlist/sectorEnergy/learning 로그 비교
- 회귀 테스트:
  - 휴장일에는 `allowSignalGeneration=false`
  - 휴장일에는 `allowWatchlistRefresh=false`
  - 휴장일에는 `allowShadowLearning=true`
  - 모든 모듈의 기준일이 TradingContext와 일치

#### 재발 감시 (Watch)

- 감시 기간: 60일
- 재발 감지 신호:
  - 기준일 mismatch 로그
  - holiday watchlist refresh
  - sectorEnergy stale 정상 표시
  - 장중 previousTradingDate 불일치
  - 휴장일 신규 STRONG_BUY 발생
- 재발 횟수: 0
