# ADR-0561 — KIS(L1) Primary 절대불변식: KIS-capable 레이어에서 Yahoo(L3)-first 금지

> 상태: Accepted (문서/ADR/CLAUDE.md/charter/가드사양 전용 — 런타임 `.ts` 0줄, ENV flag 변경 0).
> 정식 발급 번호 `0561` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0561" (2026-06-03, 마지막 발급 0560).
> 작성: 2026-06-03 / architect
> 동반 산출물: `_workspace/2026-06-03_factory-activation/architect/` 메모.
> 위반 탐지 가드 구현은 후속 engine-dev(본 ADR는 가드 *사양*만 정의).

---

## Context

사용자가 데이터 신뢰 등급(CLAUDE.md §2.3)의 **엄격·절대 형태**를 절대불변식으로 선언했다:

> **KIS(L1)가 공급 가능한 레이어에서는 Yahoo(L3)를 우선(primary)으로 쓸 수 없다.
> Yahoo는 KIS로 대체 불가능한 경우에만 fallback으로 차용한다.**

즉 "KIS-capable 레이어에서 Yahoo-first = 금지". 이는 §2.3 데이터 신뢰 위계
(L1 KIS·KRX = 매수·매도 / L3 Yahoo = fallback)의 *약한 권고*를 *강제 불변식*으로 격상한다.

### 위반의 산 증거 — 메인 Gate quote가 Yahoo(L3) primary

`_workspace/2026-06-03_factory-activation/engine-dev/MEMO-yahoo-to-kis-gate-quote-migration-feasibility.md`
가 전수 확인한 현실:

1. **메인 풀스캔 Gate 입력이 Yahoo-first.** `stockScreener.ts:577`(메인 풀스캔), `buyPipeline.ts:111`,
   `dryRunScanner.ts:224`, `trancheExecutor.ts:286`, `preBreakoutAccumulation.ts:36`,
   `kisIntradayCorrection.ts:50`, `intradayScanner.ts:273/380`, `shadowDataGate.ts:70`,
   `stockPickReporter.ts`, `reportGenerator.ts` 등 **~10곳**이 `fetchYahooQuoteByCode(code, fetchYahooQuote)`
   를 직접 호출 → MA/RSI/MACD/ATR/BB폭/일목/MTAS/return5d·20d 등 **매수·매도 결정에 들어가는 시계열
   파생지표가 L3(Yahoo) primary에서 산출**된다. → §2.3 위반 (L1-capable인데 L3-first).

2. **KIS 공급 가능(자산 완비).** ADR-0547이 KIS-first 빌더(`buildExtendedFromKisDaily`)·라우터
   (`fetchTechnicalQuote`)·정식 MTAS 보강(`enrichQuoteWithKisMTAS`)·공용 산식 SSOT(`_indicators.ts`)·
   ENV 롤백 스위치를 **이미 설계·구현**. KIS 공식 `FHKST03010100`(D/W/M, 1콜=최대 100건)이 A-1 전
   파생지표 원천 OHLCV를 종목당 period별 1콜로 전량 공급. **Yahoo 고유 계산불가 필드 = 0**
   (유일 갭 = `trailingPE`(per) 1개, Gate 결정 비핵심·fundamentals — 단 KIS finance 재무 endpoint 보강 가능성 재검토 대상).

3. **ADR-0547 §8과의 충돌.** ADR-0547 §8은 **quota 압박 회피 목적으로 "스캔 단계(universeScanner
   풀스캔)는 Yahoo 우선 유지"**를 정책으로 채택했다. 이는 KIS-capable 레이어에서 Yahoo-first를
   *quota 사정으로 정당화*하는 것 — **본 절대불변식과 정면 충돌**한다. 본 ADR이 그 §8을 개정한다.

### 제약 (불변식 정합)

- 본 ADR은 **문서/정책 선언**이며 런타임 동작을 바꾸지 않는다(executionImpact=NONE).
  메인 Gate quote 마이그레이션 실제 구현은 byte-equal 불가(수정주가 괴리·per 강등)이므로
  shadow A/B 허용오차 확정 후 **별도 실행 ADR/패치**로 분리한다.
- 9대 불변식(§2.1) VERBATIM은 건드리지 않는다 — 본 불변식은 **데이터 신뢰 절대규칙(§2.3 확장)**으로 등재.
- 현재가(price) fallback 라우터 SSOT(`KIS_QUOTE > KIS_CACHED > KRX > YAHOO > CONFIDENCE_LOW`,
  05-provider-policy "절대 변경 금지")는 이미 KIS-first이며 본 불변식과 정합(직교 변경 0).

## Decision

### D1 — 절대불변식 채택 (KIS Primary Absolute Invariant)

> **KIS(L1)가 공급 가능한 레이어에서는 Yahoo(L3)를 primary로 사용할 수 없다.
> Yahoo는 KIS로 대체 불가능한 경우에만 최후 fallback으로 차용한다.**

운영 정의:
- **KIS-capable 레이어** = KIS 공식 API(현재가 `FHKST01010100`, 기간시세 `FHKST03010100` D/W/M 등)로
  동일 정보(또는 동일 파생지표 원천 OHLCV)를 조달할 수 있는 데이터 경로.
- **금지** = KIS-capable 레이어에서 Yahoo를 *1차(primary) 출처*로 호출하는 것
  (`fetchYahooQuoteByCode(...)`를 Gate 입력 primary로 직접 호출하는 현 ~10곳이 대표 위반).
- **허용** = (a) KIS primary 실패/봉수부족 시 **fallback**으로의 Yahoo, (b) 아래 D3의 진짜 대체불가 케이스.

### D2 — quota는 Yahoo-first 회피 사유가 아니다 (엔지니어링으로 해결)

KIS quota·TR throttle 물리 한계는 **인정**하되, 그 해법은 "Yahoo-first 유지"가 아니라 **엔지니어링**이다:
- KIS 일봉 6h + 휴장 인지 TTL 캐시(`technicalQuoteRouter` `_mtasCache` 패턴 — 휴장 중 동일 마지막거래일 0콜 재사용),
- 배치/throttle(`setTimeout 100ms`, `__kisPurpose:'DISCOVERY'` 버킷),
- cooldown 인프라(`isKisChartCooldownActive('DISCOVERY')`),
- 1콜=최대 100건 특성 활용(종목당 period별 1콜로 전 일봉 지표 충족).

**ADR-0547 §8 개정:** ADR-0547 §8의 "스캔 단계(universeScanner 풀스캔) = Yahoo 우선 유지(기본)"
정책을 **폐기**한다. 스캔 단계도 본 불변식 적용 대상이며, quota 압박은 위 캐시·배치·rate 관리
엔지니어링으로 해소한다(quota를 이유로 Yahoo-first를 유지하지 않는다). ADR-0547 §8 외 본체
(KIS-first 본체·라우터·빌더·ENV 스위치·일봉 100건 분석)는 **계승·강화**한다(무효화 아님).

### D3 — Yahoo 허용 = 진짜 대체불가 케이스만 (정당경계, ADR-0558 패턴)

Yahoo 완전 금지가 아니다. KIS로 **대체 불가능**한 정보에 한해 Yahoo를 명시 허용한다.
현재 후보(MEMO B/C 전수 분석 기준):

| 케이스 | KIS 대체 가능성 | 판정 |
|--------|----------------|------|
| `trailingPE`(per) | KIS 빌더 `per:0` 고정. 단 KIS finance 재무 endpoint(또는 현재가 PER 필드) 보강 가능성 **재검토 대상** | **잠정 허용**(재검토 후 KIS 가능 시 burn-down) |
| A-1 전 시계열 파생지표(ma/rsi/macd/atr/bbWidth/일목/MTAS/return/recent10d) | KIS `FHKST03010100` D/W/M 전량 공급 | **Yahoo-first 금지**(마이그레이션 대상) |
| raw 시세(price/changePercent/volume 등) | 이미 KIS intraday 보정 | 이미 KIS primary |

원칙: 잠정 허용 케이스도 KIS 보강이 확인되면 정당경계에서 제외(burn-down). 신규 Yahoo-first 도입은
"진짜 대체불가" 입증 없이는 차단(D4 가드).

### D4 — 위반 탐지 가드 사양 (engine-dev 후속 구현)

§"위반 탐지 가드 사양" 절에 별도 기술. 신규 정적 가드(`check_kis_primary_invariant.js`)가
KIS-capable 레이어의 신규 Yahoo-first 도입을 커밋타임 차단하고, 현존 ~10곳은
grandfather→burn-down(마이그레이션 진행에 따라 allowlist 축소).

## Consequences

긍정:
- 매수·매도 결정 입력의 시계열 파생지표 출처 L3 → L1 승격(데이터 신뢰 위계 절대 정합).
- 휴장/주말 Yahoo 차단 취약점 제거(KIS는 마지막 거래일 OHLCV 정상 반환).
- "quota 때문에 L3-first"라는 회피 논리를 구조적으로 차단 → 엔지니어링 해법 강제.
- 신규 Yahoo-first 도입을 커밋타임에 차단(가드)하여 drift 영구 예방.

부정/리스크:
- **Gate quote 마이그레이션 의무화** — 현존 ~10곳 Yahoo-first 진입점의 KIS-first 재배선 필요.
  byte-equal 불가(수정주가 괴리·per 강등)이므로 **shadow A/B로 허용오차 확정 후 별도 실행 ADR/패치**.
- **quota 엔지니어링 필요** — 풀스캔 KIS-first 전환 시 캐시·배치·휴장 TTL·cooldown 완비가 전제.
  미비 상태로 무차별 전환하면 일일 quota 압박(불변식 #1 위협). 단계적 ON + 계측 동반 필수.
- **per 강등 가능성** — KIS 빌더 per=0 → per evaluator DATA_UNAVAILABLE 강등 → Gate score 소폭 하락.
  KIS finance 보강 또는 의도적 강등 수용 결정 필요(D3).

중립:
- 본 ADR executionImpact=NONE(런타임 0줄, ENV 0건). 현재가 라우터 SSOT 0줄 변경(이미 KIS-first).
- 9대 불변식 VERBATIM 0줄 변경(데이터 신뢰 절대규칙으로 §2.3에 추가).

## Alternatives Considered

1. **현상 유지(ADR-0547 §8 = 스캔 Yahoo-first 존치)** — quota는 회피되나 사용자 절대불변식·§2.3
   데이터 신뢰 위계 위반 지속. 기각(사용자 명시 선언과 충돌).
2. **Yahoo 전면 금지(D3 예외 없음)** — per 등 진짜 대체불가 케이스까지 막아 Gate score 손실 또는
   미보강 강제. 정당경계(ADR-0558 패턴) 원칙 위배. 기각.
3. **9대 불변식 목록에 10번째로 추가** — 9대 불변식은 VERBATIM·헌법으로 동결(§2.1 "절대 삭제·변경 금지").
   데이터 신뢰는 §2.3 도메인이므로 §2.3 확장이 정합. 기각(charter 00 정합).
4. **본 ADR에서 마이그레이션까지 구현** — byte-equal 불가·shadow A/B 선행 필요·Patch Scope Guard
   3도메인 한계. 문서/정책과 실행을 분리(별도 실행 ADR). 기각(범위 분리가 안전).
5. **즉시 전면 ENV ON(`KIS_OHLCV_PRIMARY_ENABLED=true` + 전 경로)** — quota 폭증·byte-equal 불가
   회귀 위험. 기각(단계적 + shadow A/B 게이트).

## 위반 탐지 가드 사양 (engine-dev 인수인계)

신규 정적 가드 `scripts/check_kis_primary_invariant.js` (구현 = 후속 engine-dev). 본 ADR은 *사양*만 정의.

**목표:** "KIS-capable 레이어에서 Yahoo-first" 신규 도입을 커밋타임 EXIT 1 로 차단.
기존 baseline(현 Yahoo-first 잔존 ~10곳)은 grandfather → 마이그레이션 진행에 따라 burn-down.

**탐지 방법 (텍스트 정규식, AST 미사용 — `check_ssot_drift_registry.js`/`check_ssot_single_funnel.js` 패턴 재사용):**
1. **Yahoo-primary 직접 호출처 grep** — `server/`(+`src/`, `.test.ts`/`.d.ts` 제외)에서
   라인 단위로 `fetchYahooQuoteByCode(` · `fetchYahooQuote(` (Gate/매매 경로 진입 primary 호출) 탐지.
   주석(`//`,`*`,`/*`)·`import`·`import type` 제외.
2. **owner/fallback 화이트리스트** — 정당 호출만 통과:
   - `technicalQuoteRouter.ts` 내부의 **fallback** 위치 Yahoo 호출(KIS primary 실패 후 차용 = 합법),
   - `yahooSymbolResolver.ts`(SSOT 위임 본체),
   - D3 진짜 대체불가 케이스(per 등) 전용 경로.
3. **GRANDFATHER_ALLOWLIST** — 현존 위반 ~10곳(`stockScreener.ts:577`, `buyPipeline.ts:111`,
   `dryRunScanner.ts:224`, `trancheExecutor.ts:286`, `preBreakoutAccumulation.ts:36`,
   `kisIntradayCorrection.ts:50`, `intradayScanner.ts:273/380`, `shadowDataGate.ts:70`,
   `stockPickReporter.ts`, `reportGenerator.ts`)을 사유 `MIGRATION_PENDING_ADR0561`로 등재 →
   통과(grandfather). **마이그레이션 PR마다 해당 줄을 allowlist에서 제거(burn-down)** → 가드 자동 강화.
   allowlist 외 신규 Yahoo-first 직접 호출 = EXIT 1.
4. **에러 메시지 필수 포맷** — 위반 파일·라인·심볼 + "KIS-capable 레이어 Yahoo-first 금지(ADR-0561).
   KIS primary(`fetchTechnicalQuote`/`fetchKisQuoteFallback`)로 전환하거나 진짜 대체불가 입증 후
   allowlist 등재" 안내.
5. **등재 위치** — `validate:all` 끝 + `precommit`에 `check_ssot_drift_registry` 인접 등재
   (`package.json`). `checkFile`/`GRANDFATHER_ALLOWLIST`/화이트리스트 export → `*.test.ts` 잠금.

**입력 계약 요약:** YAHOO_PRIMARY_CALL_SYMBOLS(`fetchYahooQuoteByCode`/`fetchYahooQuote`) +
LEGIT_FALLBACK_PATHS(router fallback·resolver·per 전용) + GRANDFATHER_ALLOWLIST(파일:라인, 사유).
가드 executionImpact=NONE(정적 텍스트 검사, 매매경로 무접촉, KIS/KRX quota 0, ENV 0,
신규 위반=커밋차단 마찰만). 롤백=`package.json` 가드 1줄 제거 byte-equivalent.

## References

- ADR-0547 (`docs/adr/0547-technical-ohlcv-kis-primary.md`) — KIS-first 본체 설계(계승), **§8 개정 대상**.
- ADR-0548 — KIS chk-holiday(CTCA0903R) 휴장 권위(휴장 인지 TTL 캐시 정합).
- ADR-0558 — 정당경계(LEGITIMATE non-funnel) 패턴(D3 Yahoo 허용 케이스 명시 근거).
- ADR-0560 — SSOT drift-prevention registry + 정적 가드(D4 가드 패턴 재사용).
- engine-dev MEMO: `_workspace/2026-06-03_factory-activation/engine-dev/MEMO-yahoo-to-kis-gate-quote-migration-feasibility.md`
  (KIS 자산 완비, 갭=per 1개, Yahoo-first 잔존 ~10곳).
- CLAUDE.md §2.1(9대 불변식 — VERBATIM 무변경) · §2.3(데이터 신뢰 등급 — 본 불변식 등재).
- `docs/ai/00-project-charter.md`(불변식·데이터 신뢰 SSOT) · `docs/ai/05-provider-policy.md`(provider 정책).
- 진입점/자산: `server/screener/adapters/technicalQuoteRouter.ts`(KIS-first 라우터),
  `kisQuoteAdapter.ts`(`buildExtendedFromKisDaily`/`fetchKisQuoteFallback`/`enrichQuoteWithKisMTAS`),
  `_indicators.ts`(공용 산식 SSOT), `yahooSymbolResolver.ts`(`fetchYahooQuoteByCode` SSOT 위임).
- KIS 공식: TR `FHKST03010100`(기간시세 D/W/M, 1콜=최대 100건) · `FHKST01010100`(현재가).
