# ADR-0646 — Gate1 VOLUME_LIQUIDITY 배선 수리 (canonical avgVolume20d/volumeRatio 입력 복원) — flag-gated, default OFF

@responsibility Gate1 minimum-signal scorer 의 VOLUME_LIQUIDITY 컴포넌트(`componentScorers.ts` volumeLiquidityScore)가 평균거래량을 plain `avgVolume` 경로에서만 읽어 시스템 카논 필드(`avgVolume20d`/`volumeRatio`)로 hydrate 된 production 종목이 전부 fallback(weightedScore 0 = RAW_AVAILABLE_SCORE_NOT_PROMOTED)으로 떨어지는 순수 배선 갭을, 이미 존재하는 raw volume 필드를 기존 ratio 곡선식(maxScore 12)으로 소비해 점수를 복원하는 경계·정책 ADR (default OFF byte-identical, shadow 상시 관측).

- **Status:** Proposed (Phase 0 — architect: 경계·정책·ENV 계약·ADR·INDEX·flag-lifecycle 레지스트리·문서. scorer 입력 경로·신규 순수 모듈·shadow 산출 구현은 engine-dev **완료**. default OFF byte-identical.)
- **Date:** 2026-06-22
- **Branch:** claude/gate1-volume-liquidity-wiring
- **Supersedes / Extends:** ADR-0640(Gate1 분모 정합 OFF=byte-identical 패턴)·ADR-0613(Gate1 positive-ceiling wiring OFF-by-default 승격 패턴)·ADR-0645(Gate1 SECTOR_RS additive capacity 복원·결손 graceful 선례)·ADR-0475(positive source wiring dry-run 재사용 철학)·ADR-0467(positive component 회계)·ADR-0471(live curve FREEZE)·ADR-0641(Gate flag 수명주기 거버넌스 — D1 레지스트리 등재 의무)·ADR-0157(ENV 정확 비교 `=== 'true'`)·ADR-0146(byte-equivalent·wiring vs 인프라)·ADR-0530(Patch Scope Guard)
- **Patch vs ADR:** ADR (신규 경계/정책 — ENV flag·입력 배선 복원 경로). INDEX.md 0646→0647 갱신 의무.

---

## Context — "곡선은 멀쩡한데 입력 경로가 끊겼다"

Gate1 minimum-signal scorer 의 VOLUME_LIQUIDITY 컴포넌트(`server/trading/signalScanner/componentScorers.ts` `volumeLiquidityScore`)의 산술:

- 평균거래량을 plain `avgVolume` 경로에서만 읽는다 — `avgVolume` / `quote.avgVolume` / `quoteFeatures.avgVolume`.
- 점수 분기 진입 조건이 `avgVolume > 0 && currentVolume !== undefined`.
- 분기 진입 시 거래량비(currentVolume/avgVolume) 기반 ratio 곡선식(maxScore 12)으로 채점.

문제의 산술 — **카논 필드 불일치:**

- 시스템 카논 평균거래량 필드는 `avgVolume20d` / `volumeRatio` 다 — coverage 판정도, gate3 materializer 도 모두 이 기준으로 hydrate 한다.
- production 종목은 plain `avgVolume` 이 비어 있다(`avgVolume20d`/`volumeRatio` 로만 채워짐).
- 따라서 `avgVolume > 0 && currentVolume !== undefined` 분기가 **미진입** → fallback → **전 종목 weightedScore 0.**
- 이는 점수가 진짜 0 인 게 아니라 raw 입력이 존재하는데도 채점에 승격되지 못한 상태 = **`RAW_AVAILABLE_SCORE_NOT_PROMOTED`.**

곡선식·maxScore 12·requiredScore 70 은 전부 정상이다. **끊긴 것은 입력 경로(plain avgVolume vs 카논 avgVolume20d) 하나뿐인 순수 배선 갭**이다. ADR-0613 이 천장 배선(positive-ceiling)을, ADR-0645 가 SECTOR_RS capacity 를 복원한 것과 정확히 같은 종류의 "곡선은 멀쩡한데 입력이 안 닿는" 갭이 VOLUME_LIQUIDITY 컴포넌트에 잔존한 것이다.

---

## Decision

### D1. ENV flag 계약

| 항목 | 값 |
|------|-----|
| **flag 이름** | `GATE1_VOLUME_LIQUIDITY_WIRING_ENABLED` |
| **default** | OFF (미설정/`!== 'true'` = OFF) |
| **정확 비교** | `=== 'true'` (ADR-0157 — `'1'`/`'TRUE'`/`'yes'` 거부) |
| **SSOT 함수** | `isGate1VolumeLiquidityWiringEnabled()` (`server/trading/gateConfig.ts`) |
| **소유** | gateConfig.ts (live scorer 가 import) — 호출자 inline ENV 검사 금지 |
| **OFF 동작** | byte-identical — VOLUME_LIQUIDITY 가 현행 plain `avgVolume` 경로만 소비(미진입 fallback 0 그대로) |
| **롤백** | flag 1줄 OFF/삭제 = 즉시 baseline |

ADR-0640 `isGate1DenominatorNormalizationEnabled()`·ADR-0613 `isGate1PositiveCeilingWiringEnabled()` 가 동일 파일에 거주하므로 같은 모듈에 배치(Gate1 ENV 게이트 단일 거주지).

### D2. ON 동작 — canonical raw volume 입력 재사용 (신규 fetch 0·신규 공식 0)

신규 순수 모듈 `server/trading/signalScanner/gate1VolumeLiquidityWiringAdr.ts` (provider/store/now/fetch 직접 호출 0) 에 두 함수를 집약한다:

- `applyVolumeLiquidityWiring` — flag ON 시에만 **이미 존재하는** raw volume 필드(`avgVolume20d`/`volumeRatio` 등)를 VOLUME_LIQUIDITY 의 입력으로 배선해, **기존 ratio 곡선식(maxScore 12)** 으로 점수를 복원한다. 두 번째 점수 공식 신설 0 — 동일 곡선에 입력만 닿게 한다.
- `computeVolumeLiquidityWiringHypothetical` — flag 무관 force-ON 가정으로 hypothetical 점수를 산출(shadow 관측, D4).

배선은 **컴포넌트의 입력 경로만 복원**할 뿐 `requiredScore = 70`·maxScore 12·곡선식·`passed = actualScore >= requiredScore` 판정 라인은 무변경. 카논 raw 필드(`avgVolume20d`/`volumeRatio`)도 부재한 **진짜 결손 종목은 0 graceful**(weightedScore 0 유지 — 결손을 페널티/bearish 로 승격하지 않음, 불변식 #6). 즉 ON 효과는 "raw 가 있는데 plain 경로가 못 읽어 0 이던 종목"의 점수 복원에 한정된다.

### D3. ADR-0471 freeze 정합

- ADR-0471 freeze rule: live Gate1 minimum-signal scoring **curve** 는 FROZEN. 본 패치는 곡선(ratio 곡선식·maxScore 12·weight)을 바꾸지 않는다 — 끊긴 **입력 경로** 복원만.
- flag OFF = byte-identical. flag ON 은 곡선 교체가 아니라 카논 raw 입력이 기존 곡선에 닿게 하는 배선 복원(ADR-0613/0645 "천장은 열되 데이터가 채움" 문구 계승).

### D4. shadow 관측 (force-ON·flag 무관·격리)

`computeVolumeLiquidityWiringHypothetical` 은 **flag 무관하게 항상 force-ON 가정으로** stamp 한다(flag OFF 여도 "ON 이면 어땠을지" 누적, ADR-0476/0613/0640 ledger 철학). actualScore/passed 본체에 영향 0, try/catch 격리(불변식 #1 — 관측 실패가 scorer/엔진 정지 유발 금지). 목적: flag OFF 상태에서도 "ON 이면 어떤 종목이 통과했을지" forward-outcome 을 누적 → 운영자가 default-ON 승격(별건 PR)을 데이터 기반으로 판단.

### D5. 단계적 활성화 (ADR-0613/0640 phased 선례)

- **Phase 0(현재):** flag OFF, shadow hypothetical 상시 관측. LIVE byte-identical.
- **Phase 1:** raw volume coverage 충분 확인 + N세션 shadow hypothetical 델타 누적 관측.
- **Phase 2(별건 PR):** forward-outcome 성숙 + raw coverage 확인 후 ENV ON 또는 default-ON flip. **본 PR 범위 아님** — 운영자/후속 ADR 몫.

---

## Consequences

### 긍정
- VOLUME_LIQUIDITY 가 카논 raw 필드(`avgVolume20d`/`volumeRatio`)를 소비해, plain `avgVolume` 미존재로 전 종목 0(`RAW_AVAILABLE_SCORE_NOT_PROMOTED`)이던 순수 배선 갭을 봉인 — maxScore 12 capacity 가 실제로 도달 가능해진다.
- 신규 fetch 0·신규 공식 0 — 이미 hydrate 된 입력을 기존 곡선에 닿게 하는 저위험 additive 입력 복원. requiredScore 70 무변경.
- 진짜 결손 종목은 0 graceful(불변식 #6) — 결손을 점수로 승격하지 않음.
- shadow hypothetical 이 flag OFF 상태에서도 누적 → default-ON 승격 판단 데이터 성숙.

### 비용 / 위험
- flag ON 시 raw volume 이 존재하던 종목의 VOLUME_LIQUIDITY 점수가 0→복원되어 Gate1 통과 분포가 상승할 수 있음 — 그래서 default OFF + 관측 + 별건 flip. LIVE 채점 분포 변화라 관측·롤백 경로가 필요(이것이 scorer 직접 수정 대신 flag-gated 를 택한 이유, Alternatives 참조).

### executionImpact
- flag OFF: **NONE** (LIVE 매매 본체 0줄 의미변경, KIS/KRX quota 0 침범, byte-identical. requiredScore 70 무변경).
- flag ON: gate1-scoring-adjacent (LIVE Gate1 VOLUME_LIQUIDITY 점수 복원 — 현 engineMode=SHADOW_ONLY 라 live 주문 0줄·autoTradeEngine/kisClient/order path/SourceSnapshot 생성기 0줄·weightedScore 곡선·maxScore 12·requiredScore 70 무변경).

### 9대 불변식 영향
- **#1 (Trading Engine 항상 살아 있음):** 위반 없음 — scorer 정지 0. shadow hypothetical try/catch 격리.
- **#2 (Shadow Learning 멈춤 없음):** 위반 없음 — Shadow 정지 0. shadow 관측은 additive·force-ON·격리.
- **#3 / #9 (단일 SourceSnapshot · provider 직접 조회 금지):** 위반 없음 — 본 모듈은 trace 입력(이미 hydrate 된 avgVolume20d/volumeRatio)만 소비, provider/store/now/fetch 직접 호출 0, SourceSnapshot 우회·Gate 내부 provider 직접 조회 0.
- **#6 (provider 장애 ≠ market signal):** 위반 없음 — 카논 raw 도 부재한 진짜 결손 종목은 0 graceful, 결손을 bearish/페널티로 승격하지 않음.
- **#7 (AI_ESTIMATED(L4) live 매매 금지):** 위반 없음 — `avgVolume20d`/`volumeRatio` 는 KIS/KRX 파생 거래량(L1), L4 추정 미사용.
- **#8 (실거래 차단 ≠ Shadow 차단):** 위반 없음 — flag OFF=byte-identical, shadow hypothetical 은 flag 무관 force-ON 산출. 현 engineMode=SHADOW_ONLY live 주문 0 안전창.

---

## Rollback

ENV 1줄 (`GATE1_VOLUME_LIQUIDITY_WIRING_ENABLED=false`/삭제) — VOLUME_LIQUIDITY 즉시 baseline(plain `avgVolume` 경로만·미진입 fallback 0) 복원. shadow hypothetical 은 관측 전용이라 잔존 무해(소비처 없음). byte-equivalent 원칙(ADR-0146) 충족 — LIVE 매매 본체 0줄 + ENV 1줄 즉시 롤백 + 회귀 테스트(신규 12) + KIS/KRX quota 0 침범.

---

## ADR-0146 PR 자가 review (5 카테고리)

1. **LIVE 매매 안전성** — flag default OFF=byte-identical. KIS/KRX quota 0 침범(신규 fetch 0·이미 hydrate 된 입력 재사용). ENV 1줄 즉시 롤백. 신규 12 회귀 테스트(flag OFF byte-identical·ON 복원·결손 0 graceful·shadow force-ON·곡선 무변경 등). 현 engineMode=SHADOW_ONLY 라 ON 이어도 live 주문 0.
2. **wiring 완료 vs 인프라만** — wiring 완료. scorer 입력 경로·SSOT reader·신규 순수 모듈·shadow stamp 가 LIVE 경로에 배선되어 ENV 1줄로 활성 가능(인프라만 두지 않음).
3. **ADR 발급 무결성** — INDEX 다음 발급 0646→0647 갱신·전체 인덱스 행 추가·최대/다음 갱신. 번호 충돌 0.
4. **회귀 테스트 적정성** — 신규 12(componentScorers/모듈 ON·OFF·결손·shadow) + signalScanner 2722 무회귀·lint OK.
5. **정책 위반 baseline 무회귀** — Yahoo-first 0(입력은 KIS/KRX L1 파생)·requiredScore 70 SSOT 무변경·weighted curve FREEZE(ADR-0471) 무변경·복잡도 baseline 무증가.

---

## Patch Scope Guard (ADR-530)

- **targetDomain** — gate1-scoring (1)
- **allowedFiles** — `componentScorers.ts`(volumeLiquidityScore 입력 경로)·`gate1VolumeLiquidityWiringAdr.ts`(신규 순수 모듈)·`gateConfig.ts`(isGate1VolumeLiquidityWiringEnabled SSOT)·`*.test.ts`(신규 12)·본 ADR·INDEX 0646→0647·`scripts/gate_flag_lifecycle.json`(신규 1행)·`docs/ai/gate-flag-lifecycle.md`·`.env.example`(신규 flag 주석)·`docs/ai/10-patch-history-index.md`(1줄)
- **forbiddenFiles** — autoTradeEngine·buyPipeline·kisClient·SourceSnapshot 생성기·requiredScore=70 calibration SSOT·weightedScore 곡선/maxScore 12·다른 컴포넌트 scorer·minimumSignalScoreTrace 판정 라인·`isGate1PositiveMaxNormalizationEnabled`(OFF 유지)·src/**
- **expectedBehaviorChange** — flag OFF=무변경(byte-identical). flag ON=VOLUME_LIQUIDITY 가 카논 raw 입력으로 점수 복원(0→ratio 곡선 산출).
- **sourceSnapshotImpact** — NONE (trace 입력만 소비·SourceSnapshot 생성/우회 0).
- **executionImpact** — flag OFF=NONE byte-identical / ON=gate1-scoring-adjacent(현 SHADOW_ONLY live 0줄).
- **shadowLearningImpact** — additive force-ON hypothetical stamp(try/catch 격리·본체 0).
- **telegramImpact** — NONE.
- **providerImpact** — NONE (신규 fetch 0·이미 hydrate 된 avgVolume20d/volumeRatio 재사용·KIS/KRX quota 0).
- **testsRequired** — 신규 12(flag OFF byte-identical·ON 복원·결손 0 graceful·shadow force-ON·곡선/maxScore 무변경) + signalScanner 2722 무회귀.
- **rollbackPlan** — ENV `GATE1_VOLUME_LIQUIDITY_WIRING_ENABLED=false`/삭제 1줄 = 즉시 baseline.

---

## Alternatives Considered

1. **scorer(`volumeLiquidityScore`)에 `avgVolume20d`/`volumeRatio` 입력 경로만 직접 추가(flag 없이 무조건)** — 기각. 입력 경로 한 줄로 보이지만 production 전 종목이 0→복원되어 **LIVE Gate1 채점 분포가 즉시 변한다**(통과율 상승). ADR-0471 freeze + 검증 안 된 분포 변경이라 관측·롤백 경로가 없는 무조건 적용은 위험. default OFF + shadow 관측 + 별건 flip 으로 분포 변화를 통제·되돌릴 수 있어야 한다 — 그래서 flag-gated 모듈을 택함.
2. **flag ON default 로 즉시 활성** — 기각. ADR-0471 freeze 위반 + forward-outcome 미성숙. default-ON 승격은 본 PR 범위 아님(별건).
3. **requiredScore 70 을 동시 하향** — 기각(절대 보존, ADR-0467/0546/0640). 입력 배선 복원과 임계 완화는 독립 레버.
4. **신규 두 번째 volume 점수 공식 작성** — 기각(단일 통로 위반). 기존 ratio 곡선(maxScore 12)에 카논 입력만 닿게 한다 — 곡선·공식 무변경.
5. **카논 필드(`avgVolume20d`)를 plain `avgVolume` 로 별도 backfill** — 기각. 동일 도메인 필드 이중화·SRP 침해. 컴포넌트가 카논 필드를 직접 소비하는 게 정도(coverage/gate3 materializer 와 동일 기준).

---

## References

- 진단: Gate1 VOLUME_LIQUIDITY 컴포넌트(`componentScorers.ts` volumeLiquidityScore) plain avgVolume 경로 미진입 → 전 종목 weightedScore 0 (`RAW_AVAILABLE_SCORE_NOT_PROMOTED`)·카논 필드 avgVolume20d/volumeRatio 불일치
- 코드 seam: `volumeLiquidityScore` (`server/trading/signalScanner/componentScorers.ts`) 입력 경로 + 신규 `server/trading/signalScanner/gate1VolumeLiquidityWiringAdr.ts`(applyVolumeLiquidityWiring·computeVolumeLiquidityWiringHypothetical) + `server/trading/gateConfig.ts`(isGate1VolumeLiquidityWiringEnabled)
- ADR-0640(Gate1 분모 정합 OFF=byte-identical)·0613(positive-ceiling wiring OFF-by-default 승격)·0645(SECTOR_RS additive capacity 복원·결손 graceful)·0475(positive source wiring dry-run 재사용)·0467(positive 회계)·0471(live curve FREEZE)·0641(Gate flag 수명주기 거버넌스 D1 레지스트리 등재 의무)·0157(ENV 정확 비교 `=== 'true'`)·0146(byte-equivalent·wiring vs 인프라)·0530(Patch Scope Guard)
- 불변식 #6 (provider 장애 ≠ market signal) · #8 (실거래 차단 ≠ Shadow 차단) — `docs/ai/00-project-charter.md`
