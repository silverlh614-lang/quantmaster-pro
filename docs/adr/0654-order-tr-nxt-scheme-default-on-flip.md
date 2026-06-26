# ADR-0654 — 주문 TR 신스킴 default-ON flip + 프록시 차단목록 동반 완성

> 상태: **Accepted (운영자 silverlh614 "기본값 default on, 환경변수로 off" 승인).**
> 정식 발급 번호 `0654` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0654" (2026-06-26, 마지막 발급 0653).
> 작성: 2026-06-26 / architect
> 계보: ADR-0653(신스킴 도입·flag-gated default OFF)·ADR-0157(default-ON `!== 'false'` 거울)·
> ADR-0146(LIVE 안전성)·절대 규칙 #4(클라이언트 실주문 금지).

---

## Context

ADR-0653 이 국내 주문 TR_ID 신스킴(KRX+NXT 통합)을 `KIS_ORDER_TR_NXT_SCHEME_ENABLED`
**default OFF**(byte-equivalent)로 도입했다. 운영자가 신스킴을 기본 동작으로 승격하고
ENV 로만 끄는 kill-switch 형태를 요청했다("기본값 default on 으로 하고 환경변수로 off").

추가로, ADR-0653 검토 중 **프록시 차단목록(`kisProxyPolicy.FORBIDDEN_TR_IDS`)이 구 스킴
주문 TR(TTTC0802U/0801U/0803U)만 차단**하고 신 스킴 TR 은 누락한 갭이 발견됐다. 신스킴이
기본 활성이면 클라이언트가 신 주문 TR(TTTC0012U/0011U/0013U)을 read-only 경로에 끼워
프록시 우회 주문을 시도할 때 안전망(2겹 차단의 TR 블랙리스트)이 비어 통과할 수 있다.

---

## Decision

### (a) default-ON flip

`constants.ts` 의 flag 해석을 `=== 'true'`(default OFF) → **`!== 'false'`(default ON)** 로 전환.
- 미설정/임의값 = 신스킴 활성. **kill-switch: `KIS_ORDER_TR_NXT_SCHEME_ENABLED=false` 1줄**로 구 스킴 롤백.
- 매핑·swap 함정 동결·신규 param 주입 로직은 ADR-0653 그대로(본체 0줄, default 해석만 전환).

### (b) 프록시 차단목록 동반 완성 (절대 규칙 #4 안전망 정합)

`kisProxyPolicy.FORBIDDEN_TR_IDS` 에 신 스킴 주문 TR 6종 추가:
`TTTC0012U/VTTC0012U`(매수)·`TTTC0011U/VTTC0011U`(매도)·`TTTC0013U/VTTC0013U`(정정취소).
체결조회(`TTTC0081R`)는 read-only(allowed path)라 차단 대상 아님.

### (c) 안전 근거 (default-ON 이 즉시 실거래를 의미하지 않음)

- 현 engineMode=**SHADOW_ONLY** → `liveEntryAllowed=false` → flag ON 이어도 live 신규 주문 0
  (불변식 #8). default-ON 효과는 향후 live 승격 시점부터 신스킴 적용.
- 프록시 경로 차단(FORBIDDEN_PROXY_PATHS: order-cash/order-rvsecncl 403) + TR 블랙리스트(본 ADR
  로 신 TR 포함) 2겹 — 클라이언트 우회 주문 불가.
- 거래소 구분 `EXCG_ID_DVSN_CD` 기본 `KRX`(보수적) — NXT/통합(`UN`) 확대는 별도 ADR.

---

## Consequences

- **executionImpact**: flag ON(default)=주문 TR·param 신스킴(실거래 경로·현 SHADOW_ONLY 라 live 0)
  / `=false`=구 스킴 byte-identical 롤백.
- **byte-equivalent**: `=false` kill-switch 시 ADR-0653 OFF 상태와 동일(회귀 입증).
- **9대 불변식**: #4(클라이언트 실주문 금지) 안전망 정합 강화 / #2(kisClient 단일통로) 보존 / #8(차단 분리).
- **검증**: kisClient+oco+proxy 회귀 **402/402** + 신규 default-ON/kill-switch/프록시 신TR 차단 가드.
  실거래(KIS_IS_REAL=true) 전 VTS(모의) 매수→매수 TR(VTTC0012U) 라우팅 회귀 권장.
- **롤백**: `KIS_ORDER_TR_NXT_SCHEME_ENABLED=false` 1줄(즉시 구 스킴).
- **미해결/후속**: NXT/통합 거래소 라우팅(`EXCG_ID_DVSN_CD=NXT/SOR`) 확대·`inquireDailyCcld`
  연속조회 `CTSC9215R` 페이지네이션은 KRX 검증 후 별도 ADR.
