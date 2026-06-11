# Gate1 점수 산정방식 구조 리뷰 (2026-06-11)

> **type: 분석 문서 (docs-only).** 소스 코드 변경 0건 · ADR 발급 0건 · executionImpact=NONE.
> 근거: scan-eval-20260611122413 (41/41 평가, pass 6, avg 53.6/req 70) + `/counterfactual_gate1`
> (below55 n=238 matureD5=76 avgD5=-9.89% correctBlock=88%, **55~70·70+ 전 밴드 n=0**) +
> 현행 루브릭 코드 실측 (`minimumSignalScoreTrace.ts` + `minimumSignalScoreTrace/componentScorers.ts`).
> 선행 문서: `gate1-score-threshold-analysis-20260608.md` (배선 정상 판정) ·
> `docs/ops/reversal-recognition-activation-playbook.md` (활성화 런북) · ADR-0546/0594.
> 목적: "약세장 감안해도 점수가 이상하다"는 운영자 의문을 루브릭 산술로 분해하고,
> 6/8 결론("정직한 약세 반영, 패치 불필요")이 **어디까지 유효하고 어디부터 구조 문제인지** 경계를 긋는다.

---

## 0. 결론 (TL;DR)

1. **avg 53.6 은 이상치가 아니라 루브릭의 산술적 필연이다.** 점수의 ~28점(절반)은 종목 신호와
   무관한 "상수 블록"이고, 시장 신호 블록(구성 76점)은 조정장에서 평균 ~27점에 갇힌다.
   28+27≈55 — 6/8 (54.8)·6/11 (53.6) 관측과 일치. 배선 회귀 아님 (6/8 판정 유지).
2. **그러나 "정직한 약세 반영"이라는 6/8 결론은 절반만 유효하다.** requiredScore 70 도달은
   시장 블록이 관측 천장(~50)의 84%+ 에 도달해야 가능하며, 그 상승원(BREAKOUT+VOLUME+momentum)이
   상관 덩어리로 동시 발화한다 → 점수 분포가 양극(통과 ≥70 vs 군집 <55)으로 갈라지고
   **55~70 은 구조적 데드존**이다. Gate1 은 약세장에서 사실상 "거래량 동반 신고가 돌파" 이진
   검출기로 퇴화하고, 27조건의 변별 뉘앙스가 점수에 반영될 공간이 없다.
3. **증거 머신이 자기 잠금 상태다 (기지 사실의 재확인 + 신규 정황 1건).** ADR-0546 완화는
   [60,70) 창 D5 성숙 ≥30 을 요구하나 데드존 때문에 표본이 영원히 안 모인다 (6/9 플레이북 기지).
   **신규 정황:** 70+ 통과자가 매 스캔 존재(6/11 6건, 6/8 13건 SHADOW_ONLY)하고 관측 V2 행이
   top-10(통과자 포함)을 기록하도록 설계되어 있음에도 보드 70+ 밴드가 n=0 — **starvation 으로
   설명되지 않는 기록/제외 결함 의심.** §4 런타임 확인 1건 필요.
4. 권고: 임계 70 무변경(절대 보존 + below55 차단 정당성 88% 재확인). 처방 우선순위는
   (a) 보드 70+/UNSCORED 결함 런타임 확인 → (b) 관측 범위 확장(top-N 제한 해제) +
   ADR-0546 증거 게이트 재설계 → (c) 중기: 상수 블록 분리 + 횡단면 보조점수 shadow 도입.

---

## 1. 루브릭 실측 — 점수는 무엇의 합인가

`buildMinimumSignalScoreTrace` 컴포넌트 (현행 코드, 양수 max 합산 = **108**):

| 블록 | 컴포넌트 | max | 약세장 실측 평균 (6/8 n=49) | 성격 |
|------|----------|-----|------------------------------|------|
| 시장 신호 (76) | PRICE_MOMENTUM | 20 | +8.2 | return5d/20d 다일집계 (절대 수익률) |
| | TECHNICAL_TREND | 14 | +12.4 | 가격/MA/RSI/ATR |
| | VOLUME_LIQUIDITY | 12 | +0.3 | 거래량/평균 비율 |
| | RELATIVE_STRENGTH | 10 | +4.3 | 20일 KOSPI 대비 (유일한 횡단면) |
| | WATCHLIST_UPSTREAM_SCORE | 10 | +1.6 | 업스트림 스크리너 점수 |
| | BREAKOUT_STRUCTURE | 10 | +0.1 | turtle-high 근접 요구 |
| 상수/맥락 (32) | WATCHLIST_PRIORITY | 8 | +8 (심볼 존재 시 **무조건**) | 상수 |
| | INVESTOR_FLOW | 8 | +8 (provider VERIFIED 시) | 데이터 가용성, 신호 아님 |
| | SUPPLY_CONFLUENCE | 8 | +4~8 (NEUTRAL 4) | 종목별이나 조악(3단) |
| | MARKET_REGIME | 6 | +6 (emergencyStop 외 상수) | 시장 전체 동일 |
| | SECTOR_ENERGY | 2 | +2 | 진단 플래그 |
| 페널티 | RISK/SOFT_FAIL/세션 등 | 0 | 실효 -6.3 | 감점 전용 |

검증: 6/8 rawPositiveAvg 27.1 = 시장 블록 합(8.2+12.4+4.3+1.6+0.3+0.1=26.9)과 일치.
finalScoreAvg 54.8 − 27.1 ≈ **27.7 = 상수/맥락 블록** — 평균 점수의 51%가 종목 신호와 무관.

> 부수 발견: 6/8 문서의 `configuredPositiveMax=116` vs 현행 코드 합산 108 (차이 8).
> 6/8 §2.2 "누락: VCP 49" 와 합치면 config 카탈로그에는 VCP(추정 max 8)가 있으나 루브릭이
> 채점하지 않는 drift 가능성 — 표시 전용이므로 본 리뷰 범위 밖, 확인만 권고.

### 1.1 약세장 산술 — 53.6 은 필연

조정장 전형 후보: 상수 블록 ~28 (SUPPLY NEUTRAL 가정) + TECH ~12 (MA 하회·RSI 35~45) +
PM ~5 (r5 -3% → 정규화 ~13/100) + RS ~5 (시장 동행 = 50/100) + WUS ~2 + VOL ~0 (거래량 위축) +
BREAKOUT 0 (신고가 미근접) = **~52**. 관측 avg 53.6/54.8 과 일치.
**즉 "왜 53점대인가"의 답은 시장이 아니라 루브릭 구조다 — 어떤 약세장이든 군집 중심은 ~52±3 에 온다.**
이 점수대는 종목 간 차이를 거의 담지 않는다 (상수 28 + 전 종목 동조 하락한 모멘텀 항).

### 1.2 70 도달의 실효 의미 — 데드존의 기원

70 통과에는 시장 블록 42+/76 가 필요하다 (관측 천장 50.6 의 84%+). 부족분 +17 의 공급원:

- BREAKOUT +10 (turtle-high — 6/8 에 46/49 가 zero)
- VOLUME +5~12 (거래량 서지)
- PM 상단 +10↑ (r5≥+10% & r20≥+20%)

이 셋은 독립이 아니라 **"거래량 동반 돌파" 단일 셋업에서 동시 발화**한다. 발화 시 점수가
+20~25 점프 → 55 군집에서 75 로 건너뛴다. 따라서 55~70 은 통과 경로상 머무는 곳이 아니라
**건너뛰는 곳**이다. 6/11 카운터팩추얼 238건 중 55~70 이 0건인 1차 원인 (2차 의심은 §4).

### 1.3 레짐 4중 계상

약세장에서 점수/통과율을 누르는 레짐 채널이 4겹이다:

1. Gate0 매크로 게이트 (R6/SELL_ONLY/VIX — preflight 차단)
2. MARKET_REGIME 컴포넌트 + RISK_PENALTY (점수 직접)
3. 모든 모멘텀 정규화 창이 절대 수익률 기반 — 시장 전체 하락이 전 종목 점수를 동조 하락
4. 임계 70 이 절대값 — 분포가 통째로 내려가면 통과율이 비선형 붕괴

횡단면(시장 대비) 요소는 RS 10/108 (9%) 뿐. "약세장에서 덜 사는 것"은 Gate0/사이징의 일이고
설계 의도이나, Gate1 까지 같은 레짐 신호를 3번 더 소비하는 것은 중복 계상이다.
ADR-0594 가 이 비대칭의 반전 국면판을 수리했으나 risk-on 레짐 한정이라 **지속 조정장(현재)에는
작동하지 않는다** — 현 국면의 처방은 ADR-0546 인데, 그 활성화 증거가 §3 잠금 상태다.

---

## 2. 6/8 결론과의 경계 정리

| 6/8 판정 | 본 리뷰 판정 |
|----------|--------------|
| 배선 회귀 아님 (wiring 정상) | **유지** — 입력은 정직하다 |
| 점수 미달 = 약한 신호의 정직한 표현 | **부분 유지** — 레벨은 정직하나, 분포(양극화·데드존·상수 블록 51%)는 루브릭 구조의 산물이며 "시장 상태"가 아니다 |
| 스케일 불일치(116 vs 50.6)는 cosmetic | **유지** + VCP config drift 확인 권고 |
| 임계 변경 근거 미달 (D5 표본 미성숙) | **강화** — 미성숙이 아니라 **구조적 수집 불능** (§3). "3영업일 성숙 대기"로는 영원히 해소 안 됨 |

---

## 3. 증거 머신 자기 잠금 (catch-22) — 현황 업데이트

- ADR-0546 verdict 는 [regimeAwareRequired(60), 70) 창 D5 성숙 ≥30 + 70+ 대조군 ≥30 요구
  (`gate1RegimeAwareWindowAdr0546.ts:127`).
- 6/9 플레이북 시점: 196표본 전부 below55. **6/11 현재: 238건 전부 below55 — 42건 증가分도
  전부 below55.** below55 만 성숙 중 (matureD5 76, avgD5 -9.89%, correctBlock 88%).
- below55 차단은 데이터가 정당화한다 (KEEP_BLOCK 동의). 그러나 **의사결정에 필요한 바로 그 구간
  (55~70)의 forward 데이터가 0건이고, 현 수집 구조에서는 0건이 유지된다.**
- ADR-0594(점수 상향)가 0546 의 선행조건이라는 플레이북 인과는 유효하나, 0594 는 risk-on 한정이라
  **지속 약세장에서는 [60,70) 표본을 만들어주지 못한다.** 즉 현 국면에서는 선행조건 충족 경로 자체가 없다.

## 4. 신규 정황 — 70+ 밴드 0건은 starvation 으로 설명 불가

- `buildGate1ScoreObservationV2Rows` (`gate1DryRunObservationLedgerAdr0476.ts:450`)는
  gateScore 내림차순 **top-10** 을 기록한다 — 통과자(≥70) 포함이 설계 의도
  (`dryRunDecision: gap>=0 → WOULD_PASS_DRY_RUN`).
- 매 스캔 통과자가 존재했다 (6/11 pass 6 · 6/8 70+ 밴드 13건 SHADOW_ONLY). 따라서 ledger 에는
  70+ 행이 누적되어 있어야 하고, rowType `GATE1_DRY_RUN`·lane `GATE1` 은 보드 포함 집합이다
  (`counterfactualOutcomeBoard.ts:304-305`).
- 그럼에도 보드 70+ n=0. 게다가 below55 n=238 은 스캔당 ~5행(=`buildCounterfactualUniverseRows`
  top-5) 누적 패턴과 근사 — **COUNTERFACTUAL_UNIVERSE lane 만 보드에 도달하고 V2/NEAR_MISS lane 이
  탈락 중일 가능성.** 의심 지점: per-row 제외 필터 (`exclusionReasonFor`:937-955 —
  scanId/sourceSnapshotId/candidateSetId/referencePrice/blocker) 또는 기록 시점에
  `snapshot.gateScore` 미채움 → 밴드 `UNSCORED` (텔레그램 출력에 미표시 → 비가시 탈락).

**확인 방법 (코드 변경 0, 서버에서 1회):** `data/gate1-dry-run-observation-ledger.json` 에서
`source=GATE1_SCORE_OBSERVATION_V2` 행 수와 `dryRunScore>=55` 행 수 집계.
- ledger 에 있는데 보드 0건 → 보드 제외/매핑 결함 (excludedReason 분포로 특정)
- ledger 에도 없음 → 기록 진입점 결함 (`persistScanResultsMidBlocks` 의 snapshots 가
  scoring 이전 상태이거나 gateScore 미탑재)
어느 쪽이든 **55~70 증거 수집의 전제가 깨져 있으므로 ADR-0546 대기 전략이 무의미해진다** — 수리 필요.

---

## 5. 권고 (우선순위순 · 전부 운영자 승인 대상)

1. **[진단, 즉시, 코드 0] §4 런타임 확인** — ledger 점수 분포 vs 보드 밴드 대조. 결함 확정 시
   진단 가시화 patch (UNSCORED/excluded 밴드를 `/counterfactual_gate1` 출력에 노출 + 결함 수리).
2. **[증거 수집 재설계, patch/ADR]** (a) 관측 top-N 제한(10/5) 해제 또는 확대 ENV — 평가된 41건
   전부 forward outcome 기록 (quota 0, 디스크만). (b) ADR-0546 verdict 의 in-window ≥30 요구를
   "below55 vs 70+ 대조 + would-pass(60~70) 가상 진입 forward 추적"으로 대체/보완 — 6/8 §4.2 의
   `regimeAwareWouldPass=7/30` 추적이 이미 존재하므로 그 ledger 를 성숙 게이트의 1차 증거로 승급.
3. **[루브릭 구조, 중기 ADR]** 상수/맥락 블록(32점)을 점수에서 분리해 적격성(eligibility)
   게이트로 이동하고, 시장 신호 76점만으로 점수화 + 횡단면 percentile 보조점수(현재 시장 내
   상대 상위 N%) shadow 병행. requiredScore=70·기존 가중치는 절대 보존 — 신규 지표는
   shadow 관측 전용으로 시작 (ADR-0581 phased 선례).
4. **무변경 확정:** requiredScore 70 (절대 보존 + below55 correctBlock 88%), 기존 condition
   weight, BREAKOUT turtle-high 의미 (ADR-0594 §A6 기각 사유 유지).

---

## 부록 — 무결성

- 9대 불변식 무위반: 분석 전용, SourceSnapshot 단일(scan-eval-20260611122413 인용),
  providerIssue≠bearish 정합 (INVESTOR_FLOW/SUPPLY UNKNOWN 처리 코드 재확인 — 불변식 #6 준수 확인됨).
- 소스/테스트/ENV 0줄 변경 · ADR 발급 0건 (docs-only patch type) · executionImpact=NONE.
- 코드 근거: `server/trading/signalScanner/minimumSignalScoreTrace.ts:109-435` (컴포넌트 구성) ·
  `minimumSignalScoreTrace/componentScorers.ts` (정규화 공식) ·
  `gate1DryRunObservationLedgerAdr0476.ts:450-525` (관측 기록) ·
  `server/learning/counterfactualOutcomeBoard.ts:469-476,662,937-955` (밴드·제외 필터) ·
  `gate1RegimeAwareWindowAdr0546.ts:112-144` (증거 게이트).
