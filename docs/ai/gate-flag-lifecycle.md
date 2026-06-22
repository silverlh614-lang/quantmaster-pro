# Gate Flag 수명주기 거버넌스 & burn-down 감사 (ADR-0641)

@responsibility Gate flag-gated 기능의 default-OFF 누적("플래그 무덤") 안티패턴을 막기 위한 사람용 거버넌스 해설 + 5개 기존 OFF 플래그 burn-down 분류표. 기계가독 SSOT 는 `scripts/gate_flag_lifecycle.json`, 본 문서는 그 해설.

> **SSOT 주의:** 레지스트리 SSOT 는 `scripts/gate_flag_lifecycle.json`(스키마 v1) 이다. `validate:flagLifecycle`
> (engine-dev 담당 `scripts/check_flag_lifecycle.js`)이 그 JSON 을 읽어 `reviewBy` 만료를 검사한다.
> 본 md 는 사람이 읽는 해설·분류일 뿐 — 필드 값이 충돌하면 **JSON 이 우선**한다.

> **라우터 정합:** 본 파일은 `docs/ai/00`~`10` 번호 라우터와 충돌하지 않는 별도 파일이다. 번호 라우터에
> 신규 항목을 끼우지 않는다(메타 거버넌스 1회성 해설이라 SRP 경계를 침범하지 않음). flag 별 도메인 정책은
> 여전히 `04-gate-system.md`(Gate 채점)·해당 ADR 본문이 SSOT.

---

## 1. 왜 거버넌스가 필요한가 — "플래그 무덤" 안티패턴

Gate1 에 default-OFF 플래그가 5개 영원히 OFF 로 쌓여 shadow 관측만 하고 아무것도 flip 되지 않는
상태가 됐다. 원래 의도는 안전했다 — "**OFF 로 출하(byte-identical) → 운영자가 forward-outcome
데이터로 검증 → 승인 후 flip**". 문제는 그 사이클에서 **flip 단계가 제도화되지 않았다**는 것이다.

- 출하 안전장치(`ENV OFF = byte-identical`, ADR-0146)는 잘 작동했다.
- 그러나 "언제까지 관측하고 언제 결정하는가"에 만료/강제 장치가 없어, 안전장치가 **정체(stasis)**로
  변질됐다. shadow 필드는 계속 쌓이는데 운영자 결정은 무기한 미뤄진다.
- 결과: 검증을 위해 만든 capacity 복원·버그픽스가 영구 잠금 상태로 남는다(예: ADR-0627 은 정보
  손실 *버그픽스*인데도 OFF).

## 2. 해결 — reviewBy 만료 + 활성화 기준 의무화

각 OFF 플래그는 레지스트리(`scripts/gate_flag_lifecycle.json`)에 다음을 의무 등재한다:

- `reviewBy` (YYYY-MM-DD) — 검토 만료일. `introduced + reviewWindowDays`(90일).
- `activationCriteria` — flip 을 정당화할 구체 기준(어떤 shadow 델타·커버리지·승인).
- `nextAction` — 다음에 할 한 가지.
- `status` — `SHADOW_OFF` | `ON` | `SUNSET`.

`reviewBy` 가 경과한 `SHADOW_OFF` 플래그가 있으면 `validate:flagLifecycle`(engine-dev `scripts/check_flag_lifecycle.js`)
가 **하드 실패**한다. 그러면 운영자/팀은 셋 중 하나를 강제로 선택한다:

1. **flip** — 검증 충족 → `status: "ON"` 으로 전환(+ 죽은 OFF 분기 코드 정리, ADR-0641 D4).
2. **sunset** — 폐기 결정 → `status: "SUNSET"`(+ flag-gated 코드 제거).
3. **연장(extend)** — `reviewBy` 를 명시 갱신 + 사유 기록(침묵 드리프트 금지, ADR-0641 D3).

이로써 "OFF 출하" 안전 규칙은 폐기되지 않고 *완결*된다 — 출하는 여전히 안전하되 flip 결정이 강제된다.

> **오늘(2026-06-21) 검사 상태:** 5개 전부 `reviewBy = 2026-09-19`(거버넌스 시작일 + 90일)로 설정 →
> 미경과라 `validate:flagLifecycle` 통과. 2026-09-19 경과 후엔 flip/sunset/연장 중 하나가 강제된다.

---

## 3. burn-down 감사 — 5개 기존 OFF 플래그 분류

| envFlag | ADR | status | reviewBy | 위험도 | 권장 다음 액션 | 분류 |
|---------|-----|--------|----------|--------|----------------|------|
| `GATE1_REGIME_AWARE_REQUIRED` | 0546 | SHADOW_OFF | 2026-09-19 | 높음(임계 측·calibration 의존) | legacy vs regime pass-rate 델타 + 운영자 승인 | 데이터 의존 |
| `GATE1_SECTOR_RS_COMPONENT_ENABLED` | 0611 | SHADOW_OFF | 2026-09-19 | 낮음(additive capacity) | 섹터상대 입력 커버리지 확인 후 flip | **flip 후보** |
| `GATE1_POSITIVE_CEILING_WIRING_ENABLED` | 0613 | SHADOW_OFF | 2026-09-19 | 중간(3종 묶음 효과) | ceilingWiring hypothetical + OHLCV/RS hydration 커버리지 관측 | 관측 더 필요 |
| `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | 0627 | SHADOW_OFF | 2026-09-19 | 낮음(손실 복원 버그픽스) | rsContinuous hypothetical 델타 확인 후 flip | **flip 후보** |
| `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` | 0640 | SHADOW_OFF | 2026-09-19 | 중간~높음(데이터 파이프 의존) | 데이터 파이프 건강 + shadow denomNorm 델타 관측 | 데이터 의존 |

### 솔직한 분류 해설

- **저위험 · flip 후보 (0611 / 0627):**
  - **0611(Sector RS)** — ADR-0467 advisory-only 주차의 의도치 않은 side effect(활성 maxScore 합 < requiredScore
    calibrate 분모)로 상위 8점이 영구 도달 불가가 된 것을 복원한다. additive capacity 복원이라 결손 시
    weightedScore 0(graceful)·requiredScore 무변경. 입력 커버리지만 확인되면 flip 안전.
  - **0627(RS Percentile Continuous)** — 5단 step 양자화가 p<50 percentile 을 전부 0 으로 붕괴시킨 **정보 손실
    버그픽스**다. maxScore/weight 무변경(천장 p=100 동일 10), weight 인상이 아닌 손실 복원. flip 후보.
- **데이터 의존 (0640 / 0546):**
  - **0640(Denominator Normalization)** — 수급/투자자 데이터 결손이 분모에 남아 실효 문턱을 올리는 갭을
    교정한다. 데이터 만성 결손 환경에서 게이트 완화 부작용 위험이 있어 **데이터 파이프 건강**에 의존. shadow
    denomNorm 4필드 델타 + 0.7× 하한 clamp binding 빈도 관측 필요.
  - **0546(Regime-Aware Required)** — requiredScore=70 calibration SSOT(ADR-0467) 를 레짐 인식값으로 바꾸는
    **임계 측** 변경이라 무차별 완화 위험. legacy vs regime pass-rate 델타 검증 + 운영자 승인 필수.
- **관측 더 필요 (0613):**
  - **0613(Positive-Ceiling Wiring)** — RS percentile 입력·BREAKOUT_STRUCTURE OHLCV·positive max→100 정규화
    3종 묶음이라 단일 효과 분리가 어렵다. ceilingWiring hypothetical 델타 + OHLCV/RS hydration 커버리지가
    성숙해야 효과 크기를 판단할 수 있어 관측 더 필요.

---

## 4. 새 Gate flag 도입 시 의무

ADR-0641 D1 에 따라 **모든 신규 Gate flag-gated 기능**은 도입 시 `scripts/gate_flag_lifecycle.json` 에
한 행을 등재해야 한다(`reviewBy = introduced + reviewWindowDays`). 등재하지 않으면 거버넌스 사각이
생긴다 — 본 거버넌스의 목적은 "OFF 출하"를 막는 게 아니라 "OFF 망각"을 막는 것이다.
