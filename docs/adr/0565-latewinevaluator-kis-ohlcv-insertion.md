# ADR-0565 — lateWinEvaluator KIS(L1) 일봉 OHLCV 1차 삽입 (Yahoo fallback 강등, 잔존 burn-down #2)

> 상태: Accepted (flag-gated 런타임 — flag OFF default = byte-equal, flag ON = KIS 1차).
> 정식 발급 번호 `0565` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0565" (2026-06-03, 마지막 발급 0564).
> 작성: 2026-06-03 / architect+engine
> 계승: ADR-0561(KIS Primary 절대불변식)·0563(잔존 동결 + §D4 shape별 deliberate ADR)·0564(burn-down #1).
> ADR-0563 §D4 의 "OHLCV" shape (koreanQuoteBridge 의 "KIS-quote 어댑터" shape 와 구분) 두 번째 실행.

---

## Context

ADR-0564 가 잔존 burn-down #1(koreanQuoteBridge, full-quote shape)을 완료했다. 본 ADR 은 #2 —
ADR-0563 §D4 가 별도 shape 로 명시한 **OHLCV 시계열**: `server/learning/lateWinEvaluator.ts`.

**현황** — `fetchOHLCV(code, from, to)` 는 raw `query2/query1.finance.yahoo.com/v8/.../chart` 직접 URL
(`.KS`/`.KQ`)로 `OHLCVDay[]`(date/high/low/close, 과거→최신)를 조회한다. `reEvaluateExpired()` 가
EXPIRED 추천을 60/90일 시점으로 재평가(high ≥ targetPrice → lateWin, 60/90일 종가 수익률)하는 데 쓴다.
소비처는 `learningOrchestrator` (학습 전용, **비실행** — 매매/Gate 무유입, ADR-0563 분류).

KIS 일봉(`fetchKisChartData(code,'D',start,end)`, FHKST03010100)이 동일 from/to 범위·동일 시장·
과거→최신 정렬·full OHLCV 를 제공하는 대체 자산이다(closeSeriesProvider·ADR-0564 동일 소스 계열).

## Decision

### D1 — KIS(L1) 1차 삽입 (KIS → Yahoo)
`fetchOHLCV` 진입부에 KIS 경로를 1차로 삽입. 신규 `fetchOHLCVFromKis(code, from, to)` —
`fetchKisChartData(code,'D', formatYmdCompact(from), formatYmdCompact(to))` 캔들을 `OHLCVDay` 로 매핑
(`date 'YYYYMMDD'→'YYYY-MM-DD'` 변환 — 하류 `Date.parse(hitDay.date)` 보존, high/low/close 그대로,
close≤0/비유한 제외). 빈 배열 → `[]` → 하류가 Yahoo 로 graceful(불변식 #6).

**거래일 인덱스 정합:** 동일 from/to 를 KIS·Yahoo 에 전달 → 동일 시장의 동일 거래일 집합·동일 과거→
최신 순서 → `ohlcv[59]`(60일)·`ohlcv[89]`(90일) 인덱스 의미 보존. KIS 1콜 ~100봉 한계 > 윈도(~95
캘린더일 ≈ 65거래일) → 단일 콜.

### D2 — flag-gate (KIS_OHLCV_PRIMARY_ENABLED 재사용, default OFF)
- flag OFF(default): KIS 블록 skip → 기존 Yahoo raw URL 경로 그대로(**byte-equal**). `fetchKisChartData`
  는 `fetchOHLCVFromKis` 내부 **lazy `await import`** → flag OFF 는 screener 그래프 eager 로드 0
  (import 그래프까지 byte-equal). ADR-0564 와 동일 lazy 패턴.
- flag ON: KIS 일봉 1차, 빈 배열 시에만 Yahoo. → Yahoo = fallback 강등.

### D3 — Yahoo fallback 강등 → GRANDFATHER → WHITELIST 승격
KIS 1차 삽입 후 Yahoo 는 KIS 실패 시에만 도달하는 합법 fallback(ADR-0561 충족). 가드
`lateWinEvaluator` 를 GRANDFATHER → WHITELIST(KIS-first + Yahoo fallback, flag OFF byte-equal) 승격.
grandfather 12 → 10(lateWinEvaluator 2 hit 제거).

### D4 — shadow A/B·전용 테스트 미적용 (비실행 + 무테스트 모듈)
비실행(learningOrchestrator) → score 괴리 0 → shadow A/B 불요(ADR-0563 §D4 실행경로 전제).
`fetchOHLCV` 는 private(미export)·lateWinEvaluator 는 기존 전용 테스트 부재 → flag-OFF byte-equivalence
는 **구조적 보장**(flag guarded `if` + lazy import). 회귀는 가드 EXIT 0 + lint(tsc) + 패턴 선례(ADR-0564
koreanQuoteBridge 7 테스트)로 커버. 활성화(flag ON)는 운영자 판단(공통 flag flip 동반).

## 제약 (불변식 정합)

- flag OFF default = byte-equal(Yahoo 경로·반환형 OHLCVDay[]·인덱스 의미 불변). 활성화는 본 PR 아님.
- 9대 불변식 VERBATIM 0줄. KIS 빈 배열/throw → `[]` → Yahoo graceful(불변식 #6). 실행경로 무접촉.
- `sourceSnapshotImpact`/`executionImpact`/`shadowLearningImpact`/`telegramImpact`: NONE.
  `providerImpact`: flag ON 시 재평가 루프에서 KIS 일봉 1콜/레코드(주간 cron·rate limit 150ms bound).

## Patch Scope Guard (ADR-530)

- `targetDomain`: learning(lateWinEvaluator) + 가드 분류.
- `allowedFiles`: `server/learning/lateWinEvaluator.ts`(fetchOHLCVFromKis+formatYmdCompact 추가 + 삽입) ·
  `scripts/check_kis_primary_invariant.js`(grandfather→whitelist) · `scripts/...test.js` · `docs/adr/0565-*.md` ·
  `INDEX.md` · `docs/ai/10-patch-history-index.md`.
- `forbiddenFiles`: 실행경로 `server/trading/**`·`server/screener/**` 매매 본체 · ENV · Shadow Learning 정지.
- `testsRequired`: 가드 EXIT 0(grandfather 10) + 가드 test + lint(tsc 양 tsconfig).
- `rollbackPlan`: fetchOHLCVFromKis 삽입 revert + 가드 whitelist→grandfather 복원(byte-equivalent).

## 결과

- KIS → Yahoo(flag ON). flag OFF byte-equal(import 그래프 포함). Yahoo = 합법 fallback.
- grandfather 12 → 10. 신규 Yahoo-first 차단 불변. 가드 test (d4) #2 확장.
- 잔존 burn-down #2 완료. 다음: historicalClosePrice(이미 KIS-first → WHITELIST 정리) 또는 #5~#7(신규 라우터).
- INDEX 0565 → 0566 갱신.
