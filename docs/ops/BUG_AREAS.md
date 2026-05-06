# BUG AREAS — QuantMaster Pro

이 문서는 BUG_LEDGER의 area 필드 SSOT다.

`docs/ops/BUG_LEDGER.md` 의 각 BUG 항목은 frontmatter 의 `area` 필드에 본 문서에서 정의된 영역 이름을 정확히 동일한 문자열로 사용해야 한다. 표기 흔들림 (예: "Market Data Layer" vs "Market Truth Layer") 은 영역별 결함 빈도 집계를 무력화하므로 영구 차단한다.

## 영역 정의

### Market Truth Layer

시장 데이터가 실제 시장의 진실을 정확히 표현하는지 담당한다.

포함:

- 거래일
- 휴장일
- 장중/장마감 상태
- 기준일
- 가격
- 거래량
- 시세 신선도
- SectorEnergy
- stale/frozen quote
- price integrity

대표 결함:

- 휴장일 기준일 혼합
- frozen quote
- stale sector energy
- 잘못된 이전 종가
- sourceTier 오판

### Order Execution Layer

주문 생성, 주문 전 검증, 주문 전송, 체결, 취소, 슬리피지를 담당한다.

포함:

- KIS 주문
- 시장가/지정가
- 주문 수량
- 체결 확인
- 주문 실패
- 중복 주문

### Risk Layer

자금 손실 방지와 포지션 생존성을 담당한다.

포함:

- 손절
- 익절
- position sizing
- Kelly clamp
- exposure budget
- circuit breaker
- STRONG_BUY 강등
- RRR

### Learning Layer

학습 루프와 사후 검증을 담당한다.

포함:

- Shadow learning
- attribution
- counterfactual
- missed learning
- future return resolver
- threshold learning

### Persistence Layer

데이터 저장과 SSOT 정합성을 담당한다.

포함:

- snapshot
- repository
- JSON persistence
- 중복 기록
- 누락 기록
- stale persistence

### Diagnostics Layer

운영자가 시스템 상태를 인지할 수 있도록 돕는 진단 계층이다.

포함:

- Telegram command
- health check
- logs
- diagnostic report
- alert
- sanity command

### UI/UX Layer

사용자의 인지와 판단을 담당한다.

포함:

- badge
- card
- dashboard
- Korean label
- data quality display
- AI estimated vs computed 표시

### Infrastructure Layer

실행 환경과 외부 의존성을 담당한다.

포함:

- cron
- ENV
- API rate limit
- KRX/KIS/Yahoo 연결
- deployment
- CI
- test guard

## 영역 명명 규칙

1. 새로운 area 를 추가하기 전 반드시 기존 area 로 표현 가능한지 확인한다.
2. 유사 이름을 만들지 않는다.
   - 예: "Market Data Layer", "Quote Layer", "Data Truth Layer" 를 새로 만들지 말고 **Market Truth Layer** 로 통합한다.
   - 예: "Order Layer", "Execution Layer" 를 새로 만들지 말고 **Order Execution Layer** 로 통합한다.
   - 예: "Telegram Layer", "Alert Layer", "Health Layer" 를 새로 만들지 말고 **Diagnostics Layer** 로 통합한다.
3. area 이름은 BUG_LEDGER frontmatter 와 정확히 일치해야 한다 (대소문자 / 공백 / 슬래시 포함 byte-equivalent).
4. 신규 area 추가가 필요한 경우 본 문서에 추가 정의 후 첫 BUG 등록 시점에 frontmatter 와 동시에 사용한다.
