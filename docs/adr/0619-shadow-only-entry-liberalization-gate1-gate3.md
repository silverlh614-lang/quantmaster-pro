# ADR-0619 — Shadow-Only Entry Liberalization (Gate1 점수 + Gate3 타이밍 이중 개방)

**Status:** Proposed (Phase 0 — 경계·타입·ADR. flag default OFF byte-identical. 구현은 engine-dev 인계.)
**Date:** 2026-06-16
**계보:** 0608 / 0449 / 0426 / 0427 / 0430 / 0614 / 0157 / 0117 / 0146
**불변식:** #1(엔진 무중단) · #2(shadow 무정지) · #4(R6/SELL_ONLY 무관) · #7(L1 점수·L4 0) · #8(실거래 차단 ↔ shadow 차단 **분리 복원**)

---

## Context

코스피 상승장(2026-06-16)인데 shadow paper-fill 0건. 정밀 audit 결과 근본 원인은
shadow 진입이 live 와 **이중 게이트(Gate1 점수 + Gate3 타이밍)** 를 공유하는 것이다.
불변식 #8("실거래 차단과 shadow 판단 차단은 분리한다")의 의도 — shadow 는 더 자유롭게
관측·학습해야 한다 — 가 진입 경로에서 무력화돼 있었다.

차단 단일 지점은 `entryEngine.ts:370`:

```ts
if (input.quoteSignalType === 'SKIP' || (input.quoteGateScore ?? minGate) < minGate) {
  reasons.push(`Gate 재검증 미달 ...`);  // → !ok → buyListLoop continue → buildBuyTrade 미도달
}
```

이 한 줄이 두 개의 독립 차단을 OR 로 묶는다:

- **뒤 절(Gate1 점수)**: `quoteGateScore < minGate`. ADR-0608 이 이미 seam 을 깔았다 —
  `resolveEntryMinGateScore({regime, isShadow})` 가 `GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED`
  ON && isShadow 일 때 regime-aware 임계(R3_EARLY ×10 [40,70) 의 40)를 주입하고,
  `entryRevalidationStep.ts:100` 가 REGIME_AWARE_SHADOW 한정으로 floor-5 를 우회한다.
  **이 seam 은 머지 완료 상태이나 ENV default OFF 라 비활성**(shadow minGate = live).
- **앞 절(Gate3 타이밍)**: `quoteSignalType === 'SKIP'`. shadow 우회 분기가 **전무**하다.
  PRE_BREAKOUT_WAIT/MTAS 약세/regime band 미달 등으로 `signalType='SKIP'` 이면
  점수가 충분해도 shadow 가 똑같이 차단된다. 이것이 상승장에서 shadow-fill 을 0 으로
  만든 **미해결 핵심**이다.

`signalType='SKIP'` 발생원은 `quantFilter.ts:990-1038` 단일 지점이며 4종으로 분류된다:

| # | 사유 | details 텍스트 | 본 ADR 완화 대상 |
|---|------|----------------|------------------|
| (i) | regime band 점수 미달 (score < band.normal) | `레짐(...) 밴드 S?/N?` | **완화** (pre-breakout/점수대기 — 학습 가치) |
| (ii) | MTAS ≤ 3 (구조 약세/데이터 부족) | `MTAS x/10 진입금지` | **완화** (구조 미성숙 — 관측 표본) |
| (iii) | VIX 보수모드 | `VIX 보수모드 — 신규 진입 일시 중단` | **유지 차단** (매크로 리스크 게이트) |
| (iv) | 실시간 연속손절 홀드 (isTradingHeld) | `실시간 연속손절 홀드 ...` | **유지 차단** (리스크 룰) |

추가로 `entryEngine.ts:385` 의 **DATA_HOLD**(ADR-0117 sanity 위반: extensionPct 박제값
괴리) 와 `:334` 의 **SKIPPED_POLICY_BLOCK**(`liveEntryAllowed=false` 정책 차단) 은
**절대 완화 금지** — 데이터 무결성·정책 차단이며 타이밍 대기가 아니다.

shadow paper-fill 은 실돈·가상계좌와 무관(별도 `shadow-trades.json`)이라 live 와 동일
점수+타이밍을 요구할 이유가 없다. 운영자가 Gate1·Gate3 **둘 다 개방**을 승인했다.

---

## Decision

shadow paper-fill 전용으로 Gate1 점수·Gate3 타이밍을 완화한다. **live(stockShadowMode=false)·
실주문·KIS 경로는 byte-identical 0 영향.** flag default OFF.

### D1 — Gate1 완화: 기존 ADR-0608 seam 재사용 (두 번째 임계식 신설 금지)

신규 Gate1 임계 로직을 만들지 않는다. ADR-0608 의 `resolveEntryMinGateScore` +
`GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED` + REGIME_AWARE_SHADOW floor-5 우회가 이미
완성된 seam 이다. 본 ADR 은 이 flag 의 **활성화를 처방**하고(운영자 ENV flip),
그 결과 [40,70) 구간 shadow 진입이 열린다. 코드 변경 0 — 기존 경로 재사용.

> engine-dev 확인 의무: Phase 2 floor 우회가 실제 적용되는지 회귀 테스트로 입증
> (`entryThresholdMode === 'REGIME_AWARE_SHADOW' → minGate = minGateBase`(floor 무시)).
> 이미 머지됐으므로 신규 구현 아님 — **검증만**.

### D2 — Gate3 완화 (신규 핵심): `quoteSignalType === 'SKIP'` shadow 우회

`entryEngine.ts:370` 의 OR 조건을 **live byte-identical** 을 보장하는 방식으로 재구조화한다.

**설계 원칙 — 앞 절만 분기, 뒤 절·하류 무변경:**

```
기존:  signalType==='SKIP'  ||  score < minGate
신규:  (signalType==='SKIP' && !shadowTimingBypass) || score < minGate
```

`shadowTimingBypass` 는 **모든 다음 조건이 참일 때만** true:

1. `SHADOW_PREBREAKOUT_ENTRY_ENABLED === 'true'` (신규 ENV, ADR-0157 정확비교, default OFF)
2. `input.isShadow === true` (live 경로면 절대 false)
3. SKIP 사유가 **완화 가능 종류** — (i) regime band 미달 또는 (ii) MTAS≤3 한정.
   (iii) VIX·(iv) 연속손절홀드·DATA_HOLD·SKIPPED_POLICY_BLOCK 은 bypass 불가.

**SKIP 사유 식별 seam:** `evaluateEntryRevalidation` 은 현재 `quoteSignalType` 만 받고
원인을 모른다. evaluateServerGate 결과의 `details[]` 가 사유를 담는다(VIX/연속손절/MTAS/
band 텍스트). engine-dev 는 **사유를 enum 으로 정규화한 입력**(예 `skipCause?: 'BAND_MISS' |
'MTAS_WEAK' | 'VIX_CONSERVATIVE' | 'TRADING_HELD' | 'UNKNOWN'`)을 entryRevalidationStep →
evaluateEntryRevalidation 로 carry 하도록 추가한다. **details 문자열 파싱은 fragile —
quantFilter 가 signalType 산출 시점에 cause enum 을 같이 반환**하는 방식 권장(두 번째
분류 로직 0). `skipCause` 미전달/UNKNOWN → bypass 불가(보수 — 미상 사유는 차단 유지,
불변식 #6).

**불변식 #8 핵심 — bypass 후에도 뒤 절·하류 무변경:**
shadowTimingBypass=true 면 앞 절(타이밍 SKIP)만 통과시키고, 뒤 절 `score < minGate` 는
**그대로 평가**한다. 즉 Gate3 완화는 "타이밍 대기를 면제"할 뿐, Gate1 점수는 D1(ADR-0608)
경로로 별도 통제된다(두 완화 독립). DATA_HOLD(:385)·dropFromOpen·openGap·volume sanity
체크(:404-447)도 **전부 그대로 적용** — 데이터 무결성은 shadow 도 면제 없음.

**live byte-identical 보장:** `input.isShadow` 가 false 거나 ENV OFF 면 `shadowTimingBypass`
는 항상 false → `(SKIP && !false)` = `SKIP` → 기존 OR 식과 **연산 결과 동일**. live 경로는
`isShadow` 를 절대 true 로 받지 않으므로(buyListLoop stockShadowMode) live = byte-identical.

### D3 — flag default OFF = byte-identical

- 신규 ENV `SHADOW_PREBREAKOUT_ENTRY_ENABLED` (Gate3 타이밍 전용) === 'true', default OFF.
- 기존 ENV `GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED` (Gate1 점수, ADR-0608) === 'true', default OFF.
- **두 flag 독립** — Gate1만/Gate3만/둘다 개방을 운영자가 조합 가능. 각각 ENV 1줄 롤백.
- 둘 다 OFF → `entryEngine.ts:370` 현행 동작·live 경로 0 변경 byte-identical.
- `.env.example` 신규 1줄(주석 + `# SHADOW_PREBREAKOUT_ENTRY_ENABLED=false`).

### D4 — 레인/라벨 격리 (학습 표본 계층화)

완화로 생성된 shadow 진입을 nightlyReflection 이 격리 학습하도록 `entryThresholdMode`
유니언을 확장한다(ADR-0608 ServerShadowTrade.entryThresholdMode 재사용·additive):

```
'LEGACY'                  // 기존(live 전부 + 양 flag OFF + 정상 통과)
'REGIME_AWARE_SHADOW'     // ADR-0608 Gate1 점수 완화로 진입 (기존)
'PREBREAKOUT_SHADOW'      // ADR-0619 Gate3 타이밍 완화로 진입 (신규)
```

- 한 진입이 Gate1+Gate3 둘 다 완화로 들어오면 우선순위 **PREBREAKOUT_SHADOW**(더 약한
  타이밍 신호가 표본 리스크 상한 — nightlyReflection 가장 보수적으로 층화). engine-dev
  가 carry 우선순위를 단일 SSOT(resolveEntryMinGateScore 인접 헬퍼)에 고정.
- 라벨은 **학습 표본 분리 전용** — 청산 규칙·사이징·LIVE 판정 영향 0(ADR-0608 동일 원칙·
  불변식 #8). counterfactual(ADR-0426/0427)·provisional shadow lane(ADR-0430)과 구분
  (그 레인들은 진입가 미도달 관측 — 본 라벨은 실제 paper-fill 된 진입).
- 클라이언트 미러 타입(`src/types/`·autoTradeClient) additive optional 동기.

### D5 — 관측 ledger (운영자 효과 실측)

ADR-0614 패턴(atomic tmp→rename + rolling FIFO + 손상 fallback + scanDateKey upsert)으로
스캔당 1행 집계 ledger 신설(관측 전용·executionImpact:NONE·observationOnly:true):

```
ShadowEntryLiberalizationLedgerRow {
  scanDateKey
  liberalizedEntryCount        // 완화로 추가된 shadow 진입 총수
  gate1LiberalizedCount        // REGIME_AWARE_SHADOW 로 추가 (점수 완화분)
  gate3LiberalizedCount        // PREBREAKOUT_SHADOW 로 추가 (타이밍 완화분)
  skipCauseDist {              // bypass 가능 SKIP 사유 분포
    bandMiss, mtasWeak,
    vixBlocked, tradingHeld,   // 유지 차단된 건수 (관측만 — bypass 안 됨)
    unknown,
  }
  executionImpact: 'NONE'
  observationOnly: true
}
```

- `paths.ts SHADOW_ENTRY_LIBERALIZATION_LEDGER_FILE` 1줄(0614/0616 물리 분리 ADR-0445).
- stamp 지점: buyListLoop 스캔 종료 직후 1회 aggregate(per-stock 아님), try/catch 격리
  (불변식 #1). append 는 flag 무관 산출 가능(OFF 시 전건 0 관측 — 효과 baseline).
- ScanSummary additive optional 1필드로 /scan_blockers 운영자 가시화(Gate 미소비).

---

## Consequences

**긍정:**
- 상승장 [40,70) 점수대·pre-breakout 종목이 shadow paper-fill → 학습 표본 고갈 해소.
- 불변식 #8 의도(shadow 는 더 자유) 진입 경로에서 복원.
- live·실주문·KIS quota 0 영향(default OFF + isShadow gate + live byte-identical).
- 두 flag 독립 + ENV 1줄 롤백 → 운영자 점진 활성·즉시 롤백.
- 라벨 격리로 완화 진입 성과를 정상 진입과 분리 학습(표본 오염 방지).

**부정/리스크:**
- shadow 진입량 증가 → KIS-WS 슬롯 점유·shadow-trades.json 증가(엔지니어링 — 슬롯 캡·
  FIFO 로 흡수, ADR-0437/0449 priority routing 재사용).
- 완화 진입 성과가 정상 진입보다 나쁠 수 있음 → 라벨 격리 + ledger 로 운영자 실측 후
  Gate score 승격은 **별도 후속 ADR**(본 ADR 은 진입 개방 + 관측까지).
- SKIP 사유 분류가 부정확하면 VIX/연속손절 완화 누출 위험 → cause enum 정규화 + UNKNOWN
  보수 차단으로 방어(details 문자열 파싱 금지).

**executionImpact:**
- 양 flag OFF = NONE byte-identical (KIS/KRX quota 0).
- ON = shadow paper-fill 확대(의도) — autoTradeEngine·kisClient·buyPipeline 실주문·
  SourceSnapshot·live minGate 본문 0줄. shadowLearningImpact = 확대(의도).

---

## Alternatives Considered

(a) **`entryEngine.ts:370` 에 신규 Gate1 임계식 추가** — 기각. ADR-0608 resolveEntryMinGateScore
   seam 이 이미 존재 → 두 번째 임계 로직은 SSOT 위반. flag 활성만 처방.
(b) **모든 SKIP 사유 일괄 완화** — 기각. VIX 보수모드·연속손절 홀드·DATA_HOLD 는 리스크/
   데이터 무결성 게이트라 shadow 도 면제 불가(불변식 #4·#7). 타이밍 대기(band/MTAS)만 완화.
(c) **details 문자열 파싱으로 SKIP 사유 식별** — 기각. fragile(텍스트 변경 시 깨짐).
   quantFilter signalType 산출 시점에 cause enum 동시 반환(정규화 seam) 채택.
(d) **단일 통합 flag(SHADOW_ENTRY_LIBERALIZATION_ENABLED)로 Gate1+Gate3 묶음** — 기각.
   Gate1(점수)·Gate3(타이밍)은 독립 리스크 — 운영자가 각각 점진 활성·롤백할 수 있어야
   함. 기존 ADR-0608 flag 재사용(Gate1) + 신규 flag(Gate3) 2-flag 독립 채택.
(e) **bypass 후 뒤 절(score) 도 면제** — 기각. Gate3 완화는 타이밍만 — 점수는 D1 경로로
   별도 통제. 두 완화 직교 유지(불변식 #8 — 분리 복원이 목적이지 무차별 개방 아님).
(f) **counterfactual/provisional lane 재사용** — 기각. 그 레인은 진입가 미도달 *관측*
   (paper-fill 아님). 본 ADR 은 실제 shadow paper-fill 진입 → 라벨 격리로 구분.
(g) **patch type** — 기각. 신규 flag·신규 라벨·신규 ledger·진입 정책 변경 = ADR 의무.
(h) **default ON** — 기각. opt-in(불변식 #8 byte-identical 출하 안전, 운영자 flip).

---

## References

- ADR-0608 — shadow-only regime-aware gate1 entry threshold (Gate1 seam 재사용 SSOT)
- ADR-0449 — pre-breakout WAIT liveness policy (SKIP 타이밍 의미 SSOT)
- ADR-0426/0427/0430 — provisional/counterfactual shadow lane (관측 레인 구분)
- ADR-0614 — consecutive netbuy observation ledger (관측 ledger 패턴)
- ADR-0117 — DATA_HOLD sanity (완화 금지 데이터 무결성 게이트)
- ADR-0157 — ENV 정확비교(=== 'true') default OFF
- ADR-0445 — ledger 물리 분리 / ADR-0146 — PR 자가 review 5 카테고리

## Patch Scope Guard (ADR-530)

- **targetDomain:** entry/shadow (server/trading entry + shadow learning) — 2 도메인.
- **allowedFiles:** `entryEngine.ts`(line370 앞 절 shadow bypass 재구조화 + skipCause 입력),
  `entryRevalidationStep.ts`(skipCause/isShadow carry + PREBREAKOUT_SHADOW 라벨),
  `entryRevalidationGate.ts`(stockShadowMode→bypass 배선 + 라벨 carry),
  `quantFilter.ts`(signalType 산출 시 skipCause enum 동시 반환 — 점수 산식 본문 무변경),
  신규 `shadowEntryLiberalizationLedgerAdr0619.ts`(관측 ledger),
  `gate1ShadowEntryThreshold.ts`(EntryThresholdMode 유니언 확장 + carry 우선순위 헬퍼),
  `paths.ts`(ledger 파일 1줄), `shadowTradeRepo.ts`/`types.ts`(entryThresholdMode 유니언),
  `src/types/`·`autoTradeClient.ts`(클라 미러 additive), `.env.example`(1줄), `*.test.ts`.
- **forbiddenFiles:** autoTradeEngine, kisClient(raw), buyPipeline 실주문 본문,
  SourceSnapshot, getMinGateScore live 분기 본문, getEffectiveGateThreshold,
  Gate score 산식(calcStage1Score·componentScorers·requiredScore=70).
- **expectedBehaviorChange:** flag ON 시 shadow paper-fill 진입 확대([40,70)·pre-breakout).
- **sourceSnapshotImpact:** NONE (불변식 #3/#9 — 우회 0).
- **executionImpact:** live NONE byte-identical / shadow 확대(의도).
- **shadowLearningImpact:** 확대(의도) + 라벨 격리 표본 계층화.
- **telegramImpact:** /scan_blockers ScanSummary additive 1필드(관측 가시화) — 채널 라우팅 무변경.
- **providerImpact:** 신규 fetch 0(이미 fetch 된 quote/gate 재사용·KIS/KRX/Yahoo quota 0).
- **testsRequired:** (1) 양 flag OFF → :370 byte-identical(live+shadow 현행 SKIP)
  (2) `SHADOW_PREBREAKOUT_ENTRY_ENABLED` ON + isShadow + band/MTAS SKIP → 진입 허용
  (3) ON + isShadow + VIX/연속손절/DATA_HOLD/SKIPPED_POLICY_BLOCK → **여전히 SKIP**
  (4) ON + **live**(isShadow=false) + SKIP → 여전히 SKIP(byte-identical)
  (5) bypass 후 `score < minGate` 여전히 평가(두 완화 직교)
  (6) skipCause UNKNOWN/미전달 → bypass 불가(보수 차단)
  (7) PREBREAKOUT_SHADOW 라벨 스탬프 + Gate1+Gate3 동시 완화 시 우선순위
  (8) ledger append(flag ON)·OFF baseline 0·atomic/FIFO/upsert.
- **rollbackPlan:** ENV 1줄(`SHADOW_PREBREAKOUT_ENTRY_ENABLED` 제거 또는 false) →
  Gate3 즉시 현행. `GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED` 제거 → Gate1 현행. 독립 롤백.
- **complexity:** entryEngine 572줄(+~25 예상, 1,500 여유) · entryRevalidationStep 157 ·
  gate1ShadowEntryThreshold 81 — 전부 한계 미만.
