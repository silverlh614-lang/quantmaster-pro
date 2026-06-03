# ADR-0566 — newsSupplyLogger 국내 종가 KIS(L1) 분리 (EWY 글로벌 Yahoo 유지, 잔존 burn-down #3)

> 상태: Accepted (flag-gated 런타임 — flag OFF default = byte-equal, flag ON = 국내 KIS).
> 정식 발급 번호 `0566` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0566" (2026-06-03, 마지막 발급 0565).
> 작성: 2026-06-03 / architect+engine
> 계승: ADR-0561(KIS Primary)·0562(B4 EWY 글로벌 영구 Yahoo)·0563(§D4)·0564/0565(KIS 삽입 패턴).
> ADR-0563 §D4 "OHLCV/종가 series" shape 세 번째 — **혼합 callsite 심볼 분리** 결정 포함.

---

## Context

ADR-0564(#1)·0565(#2)·#4(patch) 후 잔존 8. 본 ADR 은 #3 — `server/learning/newsSupplyLogger.ts`.

`fetchNDayChange(symbol, n)` 가 `fetchCloses(symbol, range)`(Yahoo)로 N거래일 변화율을 계산하며,
**두 종류 심볼이 한 callsite 를 공유**한다:
- `'EWY'` (T+1·T+3 외국인 수급 프록시, L157·L166) — iShares MSCI Korea ETF, **미국 상장 글로벌 ETF**.
  KIS overseas 미커버 → ADR-0562 **B4 영구 Yahoo**(KIS 대체불가).
- `code` (T+5 국내 종목 변화율, L177) — `r.koreanStockCodes` = `.KS`/`.KQ` Yahoo 심볼(예 `012450.KS`).
  국내 일봉 → KIS(L1, FHKST03010100) **대체 가능**.

소비처는 alerts/scheduler(뉴스-수급 학습 귀인, **비실행** — 매매/Gate 무유입). 단일 `fetchNDayChange`
가 글로벌·국내를 섞어 처리해 국내만 KIS 로 분리하려면 **callsite 심볼 분리**가 필요하다.

## Decision

### D1 — 국내 전용 `fetchNDayChangeDomestic(yahooSymbol, n)` 분리
신규 함수: `.KS`/`.KQ` → 6자리 code 추출(`/^\d{6}$/` 검증) → KIS 일봉 종가로 동일 idx 산식
(`fetchNDayChange` 와 동일 `calDays`·`idx = len-1-n`)로 변화율 계산. 비국내/code 비매칭/KIS 부족 →
`fetchNDayChange`(Yahoo) 위임. T+5 국내 루프(L177)만 본 함수 호출로 교체.
**EWY(L157·L166)는 `fetchNDayChange` 그대로 유지** — 글로벌은 분리 대상 아님(B4).

### D2 — flag-gate (KIS_OHLCV_PRIMARY_ENABLED 재사용, default OFF)
- flag OFF(default): `fetchNDayChangeDomestic` 가 즉시 `fetchNDayChange` 로 위임 → **byte-equal**
  (idx 산식·반환·기존 Yahoo fetchCloses 경로 불변). `fetchKisDailyCandles` 는 함수 내부
  **lazy `await import`** → flag OFF 는 screener 그래프 미로드(import 그래프 byte-equal, ADR-0564/0565 동일).
- flag ON: 국내 code 는 KIS 일봉 종가 1차, 부족 시 Yahoo 위임(불변식 #6).

### D3 — 잔존 `fetchCloses(var)` = EWY 전용 → GRANDFATHER → WHITELIST 승격
국내 분리 후 `fetchNDayChange` 의 `fetchCloses(var)` 는 **EWY 글로벌(B4) + 국내 fallback** 전용.
EWY 는 KIS 미커버 영구 Yahoo(ADR-0562) → globalScanAgent 동형 합법. 가드 newsSupplyLogger 를
GRANDFATHER → WHITELIST(EWY 글로벌 + 국내 KIS-first 분리) 승격. grandfather 8 → 7.

### D4 — shadow A/B 미적용 (비실행)
비실행(학습 귀인) → score 괴리 0. flag-OFF byte-equiv(위임) + 구조적 보장(guarded if + lazy import).
활성화(flag ON)는 운영자 판단(공통 flag flip 동반).

## 제약 (불변식 정합)

- flag OFF default = byte-equal(EWY·국내 모두 기존 Yahoo 경로, idx 산식 불변). 활성화는 본 PR 아님.
- 9대 불변식 VERBATIM 0줄. KIS 부족 → Yahoo 위임(불변식 #6). 실행경로·Shadow Learning 정지 무접촉.
- ADR-0562 B4(EWY 영구 Yahoo) 계승 — 글로벌 심볼은 분리하지 않는다(KIS 대체불가).
- `sourceSnapshotImpact`/`executionImpact`/`shadowLearningImpact`/`telegramImpact`: NONE.
  `providerImpact`: flag ON 시 T+5 국내 종목당 KIS 일봉 1콜(주간 결산·종목수 bound).

## Patch Scope Guard (ADR-530)

- `targetDomain`: learning(newsSupplyLogger) + 가드 분류.
- `allowedFiles`: `server/learning/newsSupplyLogger.ts`(fetchNDayChangeDomestic 추가 + L177 교체) ·
  `scripts/check_kis_primary_invariant.js`(grandfather→whitelist + 헤더 주석) · `scripts/...test.js` ·
  `docs/adr/0566-*.md` · `INDEX.md` · `docs/ai/10-patch-history-index.md`.
- `forbiddenFiles`: 실행경로 매매 본체 · ENV · EWY 글로벌 경로(B4 유지) · Shadow Learning 정지.
- `testsRequired`: 가드 EXIT 0(grandfather 7) + 가드 test + lint(tsc).
- `rollbackPlan`: L177 호출 fetchNDayChange 복원 + fetchNDayChangeDomestic 제거 + 가드 whitelist→grandfather(byte-equivalent).

## 결과

- 국내 → KIS(flag ON) / EWY → Yahoo(B4 유지). flag OFF byte-equal(import 그래프 포함).
- grandfather 8 → 7. 신규 Yahoo-first 차단 불변. 가드 test (d4) #3 확장.
- 잔존 burn-down #3 완료. 남은 5(전부 신규 라우터 필요): #5 sectorSources·#6 reportGenerator·#7 marketDataRefresh.
- INDEX 0566 → 0567 갱신.
