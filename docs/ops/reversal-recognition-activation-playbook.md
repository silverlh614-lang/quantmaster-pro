# Reversal Recognition — 활성화 플레이북 (운영자 SSOT)

> **목적:** "폭락 다음날 강반등을 시스템이 못 잡는" 구조적 맹점의 4겹 처방(ADR-0592/0593/0594 + 0550)을
> **안전한 순서로 활성화**하기 위한 단일 운영 런북. 모든 처방은 default OFF 로 머지돼 있고, 본 문서는
> 켜는 순서·검증 게이트·튜닝값·롤백을 SSOT 로 모은다.
>
> 배경 진단: `docs/gate1-score-threshold-analysis-20260608.md` · 각 ADR 본문 · 본 런북 §1.

---

## 1. 병의 정체 — "오늘의 상승을 안 보는" 4겹

폭락은 즉시 인식(R6 −5% 한 줄)하지만, 강반등은 4겹 모두 **다일 집계/신고가 기준**이라 당일 인식 실패:

| 겹 | 결함 | 처방 | 상태 |
|----|------|------|------|
| ① R6 회복 | latch TTL 시간 후행, intraday 미반영 | **ADR-0592** (D2/D3) | 구현됨, OFF |
| ② 레짐 분류 | `classifyRegime` 가 오늘 상승 미사용(다일 집계만) | **ADR-0593** | 구현·머지, OFF |
| ③ 주도주 유입 | risk-on 아니면 멜트업 리더 배제 | **ADR-0550** | 기존, ON이나 ①②에 의존 |
| ④ Gate1 점수 | `PRICE_MOMENTUM`(max 20)이 return5d/20d 만, 오늘 강세 미입력 | **ADR-0594** | 구현·머지, OFF |

**핵심 연결:** ②③④ 가 ADR-0593 의 `RISK_ON_REGIMES` 게이트를 공유 → 레짐이 반전을 인식한 *그 순간에만*
주도주 유입(0550)과 Gate1 반전 강세 가산(0594)이 동시 발동. 단일 데이터(D2)에서 4겹이 함께 작동.

---

## 2. 의존성 체인 — 활성화 순서 (절대 준수)

```
D2 (R6_KOSPI_INTRADAY_QUOTE_ENABLED)  ← 모든 관측의 단일 출발점
  ├─ intraday KOSPI 수익률  → R6 회복(0592) · 레짐 fast-upgrade(0593)
  └─ 등락종목수 breadth       → 레짐 fast-upgrade(0593)
        ↓
ADR-0593 (레짐 R4→R3_EARLY)  +  ADR-0594 (Gate1 점수 ↑)   ← 짝으로 활성화
        ↓
55~70 점수 밴드에 표본 유입  ← 0594 없이는 이 밴드 영원히 비어있음(아래 §4 라이브 증거)
        ↓
ADR-0546 (Gate1 임계 70→50) verdict 성숙  ← 0594 의 *결과물*에 의존. 0546 은 0594 의 후행.
```

> **⚠️ 가장 중요한 교훈 (라이브 데이터로 확증, §4):** **ADR-0594 는 ADR-0546 의 선행조건**이다.
> score starvation 으로 모든 후보가 below55 에 몰려 `[50,70)` 밴드가 비어 있어, ADR-0546 의 검증 머신은
> *영원히 채워지지 않을 밴드*를 기다린다. 0594(반전 리더 점수 상향)가 그 밴드를 채워야 0546 이 판정 가능.
> **0546 을 0594 없이 무차별로 낮추면 below55(avgD5 −8.97%, correctBlock 81%)의 손실 후보를 admit 한다.**

---

## 3. 운영자 활성화 단계

### Phase 0 — 관측 시작 (지금 가능, LIVE 영향 0)
```
R6_KOSPI_INTRADAY_QUOTE_ENABLED=true
```
- 효과: intraday 수익률 + breadth 수집 시작. 승급/회복/가산은 **미발동**(관측 로그만).
- 로그: `[R6_INTRADAY_REBOUND_OBSERVE]` · `[REGIME_RISK_ON_FAST_UPGRADE_OBSERVE]`
- executionImpact: **NONE**.

### Phase 1 — N영업일 관측·검증 (폭락→반등 1회 이상 포함 권장 10~15영업일)
- 매일 로그에서 "켰다면 발동했을지" 3중 AND 수기 대입 (§5 판정).
- **false-upgrade = 0** (가짜 반등에 안 풀림) 확인이 GO 기준.

### Phase 2 — 짝 활성화 (검증 통과 후, operator 승인)
```
R6_INTRADAY_REBOUND_RELEASE_ENABLED=true      # ADR-0592 D3 — R6 회복에 intraday 기여
REGIME_RISK_ON_FAST_UPGRADE_ENABLED=true      # ADR-0593 — 레짐 R3 승급
GATE1_REVERSAL_MOMENTUM_ENABLED=true          # ADR-0594 — Gate1 반전 강세 가산
```
- 효과: 강반등일 → 레짐 R3 + 주도주 유입(0550 자동) + Gate1 점수 ↑ → 55~70 밴드 유입 시작.
- AUTO_TRADE 노출이 부담되면 첫 며칠 `AUTO_TRADE_ENABLED=false` 로 shadow 관측(권장).

### Phase 3 — ADR-0546 판정 (55~70 밴드 데이터 성숙 후)
- `/gate1_threshold_evidence` 의 `regimeAwareWindow.verdict` 가 `INSUFFICIENT_SAMPLE` → `COMPARABLE`/`OUTPERFORMS_70PLUS` 로 바뀌면:
```
GATE1_REGIME_AWARE_REQUIRED=true              # 70→레짐 인식값(R4=50), operator 승인 필수
```
- `UNDERPERFORMS_70PLUS` 면 70 유지 확정.

---

## 4. 라이브 증거 (2026-06-09 `/gate1_threshold_evidence`)

```
70+:    n=0    matureD5=0
65~70:  n=0
60~65:  n=0
55~60:  n=0
below55: n=196 matureD5=16 avgD5=-8.97% win=19% correctBlock=81% missed=0%
```
- **모든 196 표본이 below55** — 55~70 밴드 전부 n=0 (score starvation, observed max≈52.6).
- below55 −8.97%/81% correctBlock/0% missed → **저점수 차단은 옳다**(무차별 완화 금지 근거).
- 결론: ADR-0546 verdict 는 **시간이 아니라 0594 의 점수 상향**으로만 풀린다.

---

## 5. 검증 — 발동 판정 + 데이터 성숙 읽기

### Fast-upgrade 발동 판정 (Phase 1 수기 대입, ADR-0593/0594 게이트)
| 조건 | 기준(default) | ENV |
|------|---------------|-----|
| ① 오늘 강반등 | `kospiIntradayReturn ≥ 3.5%` | `REGIME_RISK_ON_FAST_UPGRADE_THRESHOLD_PCT` |
| ② VKOSPI 진정 | `vkospiDayChange ≤ 0` | — |
| ③ breadth 우위 | `advanceRatio ≥ 0.6` | `REGIME_RISK_ON_FAST_UPGRADE_BREADTH_MIN_RATIO` |
- 3중 AND 충족일에 이후 1~3일 추적 → 추가 상승=정확 / 반락=false-upgrade.

### ADR-0594 Gate1 가산 (risk-on 국면에서만)
| 파라미터 | default | ENV |
|----------|---------|-----|
| 가산 시작 임계 | +3.0% | `GATE1_REVERSAL_MOMENTUM_T_MIN_PCT` |
| 과급등 cap | +12.0% | `GATE1_REVERSAL_MOMENTUM_T_CAP_PCT` |
| 최대 가산 | 8 (PRICE_MOMENTUM max 20 내) | `GATE1_REVERSAL_MOMENTUM_MAX_BONUS` |

### 데이터 성숙 경로 (참고 — 토글 불필요, default ON)
- ADR-0546 Gate1 ledger 성숙 = `unifiedForwardOutcomeLabeler`(16:36 KST, `UNIFIED_FORWARD_OUTCOME_LABELER_ENABLED` default ON) 가 담당.
- `FUTURE_RETURN_RESOLVER_ENABLED` 는 **ShadowLearningOnlySignal 용 — ADR-0546 과 무관**(혼동 주의).

---

## 6. 롤백 (각 1줄, 즉시 byte-equivalent 복원)

```
GATE1_REGIME_AWARE_REQUIRED=false
GATE1_REVERSAL_MOMENTUM_ENABLED=false
REGIME_RISK_ON_FAST_UPGRADE_ENABLED=false
R6_INTRADAY_REBOUND_RELEASE_ENABLED=false
R6_KOSPI_INTRADAY_QUOTE_ENABLED=false
```
모든 flag OFF = 현 baseline byte-equivalent (ADR-0146). executionImpact=NONE.

---

## 7. 한 줄 원칙

> **D2 한 토글이 4겹 관측의 출발점. 0594 는 0546 의 선행. 무차별 임계 완화 금지 — 반전 리더만 선별해
> 점수를 올리고, 검증 데이터가 말할 때 바를 조정한다.**
