# ADR-0643 — Gate1 Flag Burn-Down Activation (4-Flag Flip: 0611·0627·0613·0640)

> **상태:** Accepted (engine-dev 구현 완료 — ENV 반전·테스트 갱신·레지스트리/문서 동기화).
> **유형:** ADR (신규 정책 — flip 결정 + 거버넌스 SHADOW_OFF→ON 전환).
> **결정일:** 2026-06-21 (운영자 승인). **flip 적용일:** 2026-06-22. **도메인:** trading / gate1-scoring.

## Context

ADR-0641 이 "플래그 무덤" 안티패턴(default-OFF flag 가 영원히 OFF 로 쌓여 flip 단계가 제도화되지 않음)을
해소하기 위해 reviewBy 만료 + flip 강제 거버넌스를 도입했다. 5개 OFF flag 가 `reviewBy=2026-09-19`로
등재됐고, burn-down 감사로 분류됐다(flip 후보 0611/0627 · 데이터 의존 0640/0546 · 관측 더 필요 0613).

운영자가 **reviewBy(2026-09-19) 대기를 명시적으로 기각**하고 즉시 flip 을 승인했다("shadow 실험성 강함 ·
flip 필요하면 바로 실행"). 본 ADR 은 ADR-0641 이 정의한 *flip 단계*를 처음으로 집행하는 burn-down
activation 이다. **4개를 ON 으로 flip 하고, 0546(GATE1_REGIME_AWARE_REQUIRED)은 고위험 임계 calibration
이라 SHADOW_OFF 유지(무접촉)한다.**

| flag | ADR | 분류 | flip 근거 |
|------|-----|------|-----------|
| `GATE1_SECTOR_RS_COMPONENT_ENABLED` | 0611 | flip 후보(낮음) | additive capacity 복원(maxScore 0→8), requiredScore 무변경 |
| `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | 0627 | flip 후보(낮음) | 정보손실 버그픽스(step→continuous), maxScore/weight 무변경 |
| `GATE1_POSITIVE_CEILING_WIRING_ENABLED` | 0613 | 관측 더 필요(중간) | RS/breakout 입력배선+양수천장 정규화 3종, requiredScore 무변경 |
| `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` | 0640 | 데이터 의존(중간~높음) | 결손 분모 제외 비례 완화(0.7× 하한 clamp) |
| ~~`GATE1_REGIME_AWARE_REQUIRED`~~ | 0546 | 데이터 의존(높음) | **제외 — SHADOW_OFF 유지** |

## Decision

### D1. flip 메커니즘 — default 반전 `=== 'true'` → `!== 'false'` (ADR-0157/0578 선례)

4개 flag reader 의 ENV 비교를 default-ON 으로 반전한다. `GATE1_TECHNICAL_INDICATOR_INJECTION_ENABLED`
(ADR-0578)가 동일 `!== 'false'` 패턴으로 이미 코드 승격된 확립된 선례다.

- ENV 미설정(unset) → ON(신규 동작) · `=false`(정확) → OFF(baseline byte-identical, **즉시 1줄 롤백**).
- reader 거주지 2곳: `gateConfig.ts`(0613/0627/0640) + `minimumSignalScoreTrace.ts:68`(0611, env 파라미터).
- 부수 정합: `persistScanResultsMidBlocks.ts` 의 0611 shadow-evidence `flagActive` 인라인 검사도 라이브
  reader 와 동일 `!== 'false'` 의미로 동기화(관측 전용·executionImpact=NONE).

### D2. OFF 분기 보존 — D4(죽은 분기 정리)는 후속 sunset 단계로 명시 연기

ADR-0641 D4 는 status ON 전환 시 OFF 분기·ENV 게이트 정리를 의무화한다. 그러나 운영자가 "실험성 강함·
바로 롤백 가능"을 flip 근거로 제시했으므로, OFF 분기·ENV 게이트를 **보존**하고 default 만 반전한다.
D4 의 *코드 정리*는 충분한 LIVE ON 관측 성숙 후 별도 cleanup 패치로 수행한다.

**거버넌스 정합(충돌 아님):** D4 본문(ADR-0641:67)이 "정리 작업은 해당 도메인 ADR/패치로 engine-dev 가
수행 — 본 ADR 은 *의무*만 규정"이라 명시해 flip 과 동시 수행을 강제하지 않는다. ADR-0641 의 핵심 목적은
stasis 봉인(flip 강제)이며, 본 ADR 이 status SHADOW_OFF→ON 으로 정확히 그 stasis 를 깬다. D4 cleanup 은
`gate_flag_lifecycle.json` nextAction 에 후속 추적 등재되므로 침묵 드리프트(D3 금지 대상)가 아니다 —
관리된 부채로 전환된다. 운영자 명시 의사(ENV 1줄 롤백 안전망)가 D4 즉시 집행보다 우선한다.

### D3. 거버넌스 레지스트리 전환

`scripts/gate_flag_lifecycle.json` 4개 flag: `status` SHADOW_OFF→ON, `nextAction` → "LIVE ON 관측 성숙 후
D4 sunset cleanup(OFF 분기 제거) 별도 패치", `notes` 에 flip 일·근거·롤백 보존 기록. **0546 무변경**
(SHADOW_OFF/reviewBy 2026-09-19 유지). `check_flag_lifecycle.js` status enum 이 ON 허용 + PAST_DUE 검사가
SHADOW_OFF 한정이라 ON 전환은 validate:flagLifecycle 통과. shadow-evidence 전사표(`gate1FlagShadowEvidenceAdr0642.ts`
`FLAG_LIFECYCLE`)도 자체 "flip 시 본 표 + lifecycle JSON 동시 갱신" 계약에 따라 4개 status ON 동기화.

## Consequences

### executionImpact

**gate1-scoring (NOT NONE)** — LIVE `buildMinimumSignalScoreTrace` 산출 변경. ADR-0146 byte-equivalent 는
"flag=false 시 baseline byte-identical"로 충족.

flag 별 LIVE 영향(정직):
- **0611:** SECTOR_RS maxScore 0→8 복원 → 섹터 강세 종목 Gate1 통과↑(additive).
- **0627:** RS step→연속 → p<50 종목 0→실값 복원(버그픽스), 중하위 RS 종목 통과↑. 천장 무변.
- **0613:** RS/breakout 결손 채움 + positive 100 정규화 3종 → 결손 메워진 종목 통과↑. 단 (c) 정규화
  단독은 survivors↓ 가능(묶음 순효과는 입력 커버리지 의존, 관측 ledger 측정).
- **0640:** 결손 maxScore 분모 제외 + effectiveRequiredScore 비례 축소(절대 인상 0, 0.7× 하한 clamp=49)
  → 수급/투자자 결손 종목 실효 문턱↓·통과↑. **데이터 만성 결손 시 게이트 완화 부작용**(최대 위험).

순방향: 결손이 메워지거나 분모 제외된 종목의 Gate1 통과 증가가 지배적(0613(c) 정규화는 반대 가능).

### 9대 불변식

- #1 Trading Engine: 무위반(채점 seam 만, 엔진 경로 무정지). #2 Shadow: 무위반(0642 hypothetical 계측 연속).
- #3/#9 SourceSnapshot/provider 직접조회: 무위반(flag reader 순수 ENV, provider/fetch 0).
- #6 provider 장애≠signal: 무관. #7 L4 live 금지: 무위반(매매 결정 경로 무접촉).
- #8 실거래≠Shadow 차단: 무위반(flip 은 채점 입력/문턱, 실거래 차단 무관).

### 데이터 의존(0640) 안전장치

`available>=configured` → 무변경(인상 0). 0.7× 하한 clamp(effectiveRequiredScore ≥ 49) → 게이트 무력화
차단(ON 에서 binding 확인). 운영 안전망(코드 외): 수급/투자자 결손률 모니터 + incident-playbook 진단
분기("통과율 급증+결손률 상승 → 0640 먼저 =false"). 본체 0줄(byte-equivalent 유지).

### 비용/위험

- 4개 동시 ON 으로 Gate1 통과 분포 변동(특히 0613 묶음·0640 데이터 의존). flip 직후 1~2세션 집중 관측 권고.
- 기존 OFF-assertion 테스트가 default 반전으로 깨짐 → `delete`(unset)→명시 `=false` 갱신(engine-dev 완료).
- D4 코드 정리 연기로 죽은 OFF 분기 잔존(관리된 부채, nextAction 추적).

## Rollback

flag 별 독립 `GATE1_X_ENABLED=false` 1줄 → 해당 flag baseline byte-identical 복귀(다른 flag 무영향).
전체 복귀 `=false`×4. 우선순위 0640→0613→0627/0611. KIS/KRX quota 0 침범·LIVE 본체 0줄·재배포 불필요.

## Alternatives Considered

1. **reviewBy(2026-09-19)까지 대기** — 기각. 운영자가 명시적으로 대기를 기각하고 즉시 flip 승인.
2. **4개 분리 ADR** — 기각. 동일 메커니즘·도메인·롤백·거버넌스 전환 공유, 단일 거버넌스 액션. 분리는
   ADR 4건+patch 4줄 비용만 증가. 각 flag 도메인 정책은 원 ADR(0611/0613/0627/0640)이 SSOT.
3. **D4 즉시 집행(OFF 분기 제거)** — 기각. ENV 1줄 롤백 능력 소실 → 운영자 "바로 롤백 가능" 안전망과
   충돌. D4 본문이 분리 수행 허용. 충분한 ON 관측 후 별도 cleanup 으로 연기.
4. **0546 포함(5개 전체 flip)** — 기각. 0546 은 requiredScore=70 calibration SSOT 를 바꾸는 고위험 임계
   변경 — 무차별 완화 위험. legacy vs regime pass-rate 델타 검증+운영자 별도 승인 필요. SHADOW_OFF 유지.
5. **`=== 'true'` 유지 + ENV 명시 set=true 배포** — 기각. ENV 설정 누락 시 silent OFF 로 회귀(망각 재발).
   default 반전이 "ON by default, =false 롤백"으로 명시적이며 ADR-0578 선례 정합.

## References

- ADR-0641(gate-flag-lifecycle-governance — flip 단계 정의·D4) · ADR-0146(byte-equivalent·OFF 출하 안전) ·
  ADR-0157(ENV 정확 비교) · ADR-0578(`!== 'false'` default-ON 선례) · ADR-0530(Patch Scope Guard).
- 원 flag ADR: 0611(SECTOR_RS)·0627(RS continuous)·0613(positive-ceiling wiring)·0640(denominator norm)·0642(shadow 증거 하네스).
- reader SSOT: `gateConfig.ts`(0613/0627/0640) · `minimumSignalScoreTrace.ts:68`(0611).
- 레지스트리: `scripts/gate_flag_lifecycle.json` · 해설 `docs/ai/gate-flag-lifecycle.md` · 전사표 `gate1FlagShadowEvidenceAdr0642.ts`.
- 산출물: `_workspace/2026-06-21_gate1-flag-flip-activation/`(architect·engine-dev).
