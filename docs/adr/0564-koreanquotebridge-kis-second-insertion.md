# ADR-0564 — koreanQuoteBridge KIS(L1) 2차 삽입 (Yahoo 최후 fallback 강등, 잔존 burn-down #1)

> 상태: Accepted (flag-gated 런타임 — flag OFF default = byte-equal, flag ON = KIS 2차).
> 정식 발급 번호 `0564` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0564" (2026-06-03, 마지막 발급 0563).
> 작성: 2026-06-03 / architect+engine
> 계승: ADR-0561(KIS Primary 절대불변식)·0562(경계 잠금)·0563(실행경로 완료+잔존 동결).
> ADR-0563 §D4 "재활성 = shape 별 deliberate ADR" 의 첫 실행 ADR.

---

## Context

ADR-0563 은 실행경로 Yahoo burn-down 완료를 선언하고 잔존 13 hit/7파일(비실행)을 동결했다.
사용자가 잔존 진행을 지시(deliberate 경로 개시) — ADR-0563 §D4 에 따라 **shape 별 별도 실행 ADR**
로 burn-down 한다. 본 ADR 은 그 첫 번째: 잔존 중 **유일하게 quote 를 서빙하는** `koreanQuoteBridge`.

**현황** — `server/clients/koreanQuoteBridge.ts:fetchKoreanDailyQuote(code)`:
1. KRX OpenAPI healthy → `fetchFromKrx` (L1 1차).
2. 실패/미설정/서킷 OPEN → `fetchFromYahoo` (raw `query1/2.finance.yahoo.com` `.KS`/`.KQ`, L3 폴백).
3. 전부 실패 → emptyQuote.

소비처는 `server/routes/krxRouter.ts` (REST `/krx/quote/:code`) **단 한 곳** — Gate/매매/screener
경로 무유입(비실행, ADR-0563 분류 재확인). 그러나 ADR-0561 절대불변식상 **KIS(L1)로 대체 가능한
국내 일봉 quote 인데 KRX 실패 시 곧바로 Yahoo(L3)로 강등**되는 것은 "KIS 대체불가 시에만 Yahoo"
원칙에 어긋난다. KIS 일봉(`fetchKisDailyCandles`, FHKST03010100, full OHLCV)이 대체 자산이다.

## Decision

### D1 — KIS(L1) 2차 삽입 (KRX → **KIS** → Yahoo)
`fetchKoreanDailyQuote` 의 KRX 와 Yahoo 사이에 KIS 일봉 경로를 삽입한다. 신규 `fetchFromKis(code)` —
`fetchKisDailyCandles(code, ~12 calendarDays)` 최신 캔들(과거→최신 정렬, closeSeriesProvider 동형)로
`KoreanDailyQuote`(close/open/high/low/volume = 최신 캔들, prevClose = 직전 캔들, change/changePct =
`safePctChange`, source `'kis'`, baseDate = 캔들 date, name = '')를 구성. 캔들 0개/close≤0 → null.

### D2 — flag-gate (KIS_OHLCV_PRIMARY_ENABLED 재사용, default OFF)
KIS 2차 블록은 `process.env.KIS_OHLCV_PRIMARY_ENABLED === 'true'` 일 때만 실행.
- flag OFF(default): KIS 블록 **완전 skip** → 기존 KRX→Yahoo 경로 그대로(**byte-equal** — 호출 순서·
  반환형·source 값 불변, krxRouter 응답 0 변화). `fetchKisDailyCandles` 는 `fetchFromKis` 내부
  **lazy `await import`** 로 로드 → flag OFF 는 screener kisChartDataFetcher 그래프를 eager 로드조차
  하지 않아 **import 그래프까지 byte-equal**(clients→screener 상향 의존·잠재 cycle 회피).
- flag ON: KRX 실패 시 KIS 일봉 시도, KIS 실패 시에만 Yahoo. → Yahoo 가 **진짜 최후 fallback**.
R1(ADR-0547)·closeSeriesProvider(ADR-0561) 와 동일 flag(동일 도메인: 국내 OHLCV). 신규 ENV 0.

### D3 — Yahoo = 최후 fallback 강등 → GRANDFATHER → WHITELIST 승격
KIS 2차 삽입 후 `fetchFromYahoo` 는 KRX·KIS 두 L1 소스 실패 시에만 도달하는 **합법 최후 fallback**
(ADR-0561 "KIS 대체불가 시에만 Yahoo" 충족 — 이중 L1 우선, 장애 흡수 불변식 #6). 따라서
`koreanQuoteBridge` 를 가드 GRANDFATHER_ALLOWLIST(13 hit)에서 제거하고 WHITELIST(KRX+KIS primary +
Yahoo 최후 fallback 브릿지, closeSeriesProvider 동형 처리)로 승격. grandfather 13 → 12.

### D4 — shadow A/B 미적용 (비실행)
ADR-0563 §D4 의 "shadow A/B" 요구는 **실행경로(Gate score 괴리)** 전제였다. koreanQuoteBridge 는
krxRouter REST 단일 소비(비실행) → score 괴리 위험 0. flag-gated byte-equiv(flag OFF) + KIS 경로
단위테스트로 충분. 활성화(flag ON)는 운영자 판단(실행경로 KIS_OHLCV_PRIMARY_ENABLED flip 과 동반).

## 제약 (불변식 정합)

- flag OFF default = byte-equal(krxRouter 응답·source·호출 순서 불변). 활성화는 본 PR 아님.
- 9대 불변식 VERBATIM 0줄. KIS 장애(빈 캔들/throw) → null → Yahoo graceful(불변식 #6, 약세신호 변환 0).
- ADR-0561/0562/0563 계승(무효화 0). 실행경로 무접촉(koreanQuoteBridge 비소비).
- `sourceSnapshotImpact`/`executionImpact`/`shadowLearningImpact`/`telegramImpact`: NONE.
  `providerImpact`: flag ON 시 KRX 실패 경로에서 KIS 일봉 1콜 추가(quota — krxRouter 호출 빈도 bound).

## Patch Scope Guard (ADR-530)

- `targetDomain`: provider/client(koreanQuoteBridge) + 가드 분류.
- `allowedFiles`: `server/clients/koreanQuoteBridge.ts`(fetchFromKis 추가 + 삽입 + 'kis' source) ·
  `scripts/check_kis_primary_invariant.js`(grandfather→whitelist) · `docs/adr/0564-*.md` · `INDEX.md` ·
  `docs/ai/10-patch-history-index.md` · (test) `koreanQuoteBridge` 관련.
- `forbiddenFiles`: 실행경로 `server/trading/**`·`server/screener/**` 매매 본체 · ENV 변경 · Gate.
- `testsRequired`: 가드 EXIT 0(grandfather 11) + 가드 test + lint + koreanQuoteBridge flag-OFF byte-equiv.
- `rollbackPlan`: fetchFromKis 삽입 revert + 가드 whitelist→grandfather 복원(byte-equivalent).

## 결과

- KRX → KIS → Yahoo 3단(flag ON). flag OFF byte-equal. Yahoo = 합법 최후 fallback.
- grandfather 13 → 12(koreanQuoteBridge → WHITELIST 승격). 신규 Yahoo-first 차단 불변.
- 잔존 burn-down #1 완료. 다음 shape: lateWinEvaluator(OHLCV 학습)·국내 FX/지수/섹터 별도 ADR.
- INDEX 0564 → 0565 갱신.
