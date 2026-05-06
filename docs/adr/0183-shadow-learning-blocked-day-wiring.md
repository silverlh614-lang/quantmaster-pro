# ADR-0183 — Shadow Learning Blocked-Day Data Collection Wiring (Phase 3 Stage A)

**상태**: Accepted (Phase 3 Stage A — signalScanner 4 early-return wiring, ENV default OFF)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase3-StageA
**의존성**:
- ADR-0173 (Shadow Learning Persistence Phase 1) — `runShadowLearningOnlyScan` SSOT + 안전 invariant 5종 + ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED`
- ADR-0174 (Phase 2a 분석 SSOT) — SafetyGateAttribution + ShadowVsLiveDelta 의 *입력 데이터 소스*
- ADR-0177~0182 (Phase 4-A/B 진단 인프라) — Dashboard 6 카드의 *데이터 입력 소스*

## 1. 문제

ADR-0173 Phase 1 머지 후 `runShadowLearningOnlyScan` SSOT 가 *호출자 0건 dead code* 상태로 영속. 결과적으로 Phase 2a 분석 SSOT (SafetyGateAttribution + ShadowVsLiveDelta) + Phase 4-B Dashboard 6 카드의 영속 데이터가 영원히 빈 상태 — 모든 진단 인프라가 *데이터 부재* placeholder 만 노출.

`signalScanner.ts` 의 5 early-return site (SELL_ONLY:304 / R6_DEFENSE:321 / VIX:345 / FOMC:376 / Data Degradation:396) 는 매크로 게이트 차단 시점 — *바로 이 시점이 학습 데이터 수집 대상*. 차단된 날에 *Shadow 가 매수했더라면* 의 사후 수익률 추적이 ADR-0173 의 핵심 목적.

## 2. 결정

### 2.1 4 site wiring (5 → 4 — 데이터 빈곤 site 제외)

| Site | Line | early-return 사유 | wiring reason |
|------|------|----------------|---------------|
| SELL_ONLY | 304 | 운영자 수동 또는 macro 트리거 | `MANUAL_BLOCK` |
| R6_DEFENSE | 321 | 시스템 내부 risk-off 분기 | `RISK_OFF_REGIME` |
| VIX 게이팅 | 345 | VIX 급등 매크로 차단 | `VIX_SPIKE` |
| FOMC 게이팅 | 376 | FOMC DAY 차단 | `FOMC_BLOCK` |
| ~~Data Degradation~~ | ~~396~~ | ~~데이터 신뢰성 부재~~ | **wiring 제외** |

**데이터 빈곤 site 제외 사유** (ADR-0173 §"안전 invariant 5" 정합) — 데이터 품질/가격 sanity 우회 금지. Data degradation 은 *입력 자체가 신뢰 불가* 상태라 Shadow learning 표본도 의미 없음.

### 2.2 Phase 3 분할 정책 (Stage A 본 PR / Stage B/C 후속)

| Stage | scope | 회귀 위험 |
|-------|-------|----------|
| **Stage A (본 PR)** | 4 early-return wiring + ENV default OFF + try/catch 격리 | 낮음 |
| Stage B (별도 PR) | `replayMissedLearningJobs` dispatcher (jobName → 실제 함수 매핑) | 중간 |
| Stage C (별도 PR) | ReflectionInjectionBus 신설 + 학습 결과 → Gate/Kelly 자동 보정 | 높음 |

각 Stage 단일 PR 분할 — 회귀 위험 격리. 본 PR 은 *데이터 수집 채널 활성화* 만, *학습 보정 wiring* 은 Stage C 후속.

### 2.3 SSOT 헬퍼 신설

`server/trading/signalScanner.ts` 모듈 로컬 헬퍼 `recordBlockedDayShadowScan(reason)` 추가 — 4 site 동일 패턴 SSOT 통합으로 drift 차단:

```typescript
async function recordBlockedDayShadowScan(
  reason: ShadowLearningOnlyScanReason,
): Promise<void> {
  if (!isShadowLearningOnBlockedDaysEnabled()) return;  // ENV default OFF
  try {
    const kstScanDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    await runShadowLearningOnlyScan({
      allowRealOrder: false,           // 안전 invariant — literal type + runtime throw
      bypassMacroEntryBlock: true,     // 의도 명시 — 차단된 날 우회
      reason,
      scanDate: kstScanDate,
    });
  } catch (e) {
    console.warn(`[ShadowLearningOnly] scan 실패 (${reason}):`, e);
  }
}
```

각 4 early-return site 의 `await updateShadowResults(...)` *직전* 에 1줄 호출 추가:
```typescript
await recordBlockedDayShadowScan('VIX_SPIKE');  // 또는 site 별 reason
await updateShadowResults(shadows, regime);
saveShadowTrades(shadows);
return {};
```

## 3. 안전 invariant (Phase 3 Stage A 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 (의사결정 흐름) | early-return 분기 자체 무수정 — 호출 추가만 |
| 2 | KIS 주문 함수 import 0건 | runShadowLearningOnlyScan 의 안전 invariant (Phase 1) 자동 상속 |
| 3 | ENV default OFF | `isShadowLearningOnBlockedDaysEnabled()` 미활성 시 즉시 return |
| 4 | try/catch 격리 | scan throw 가 매매 흐름 차단 안 함 |
| 5 | 데이터 빈곤 site 제외 | 데이터 신뢰성 부재 시 Shadow learning 부적합 (ADR-0173 §5) |
| 6 | allowRealOrder=false 절대 강제 | runShadowLearningOnlyScan 진입부 literal type + runtime throw 2중 강제 (Phase 1) |
| 7 | bypassMacroEntryBlock=true 명시 | 호출자 의도 명시 — *차단된 날 우회* 명문화 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **Data Degradation site (라인 396) wiring** — 데이터 신뢰성 부재 시 Shadow learning 표본 오염 (ADR-0173 §5)
2. ❌ **early-return 자체 변경** — 매매 흐름 무수정, 호출 추가만 (회귀 위험 격리)
3. ❌ **ENV default ON** — 운영자 명시 활성화 의무 (ADR-0173 §3 정합)
4. ❌ **try/catch 부재** — scan throw 시 매매 흐름 차단 위험 (cron 흐름 보존)
5. ❌ **Stage B/C wiring 본 PR 통합** — `replayMissedLearningJobs` dispatcher / ReflectionInjectionBus 별도 PR (회귀 위험 격리)
6. ❌ **호출자 측 ENV 검사 인라인** — SSOT 헬퍼 안 single point check (drift 차단)

## 5. 운영자 활성화 절차

1. **PR 머지** — wiring 활성화 (ENV default OFF 상태 유지, 동작 변경 0)
2. **ENV 활성화** — `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED=true` 운영 환경 설정
3. **검증** (1주일 누적):
   - `data/shadow-learning-only-signal.json` 영속 누적 확인
   - Phase 4-B Dashboard `/api/learning/safety-gate-attribution` 응답 데이터 확인 (이전엔 빈 배열)
   - `/api/learning/shadow-vs-live-delta` 응답 데이터 확인
4. **Phase 2b-1 ENV 동시 활성화** — `FUTURE_RETURN_RESOLVER_ENABLED=true` (1d/3d/5d/20d 사후 수익률 자동 갱신)
5. **만족 시 Stage B/C 후속 PR 진입 결정**

## 6. 후속 PR

### Phase 3 Stage B — replayMissedLearningJobs dispatcher
- `replayMissedLearningJobs` 의 jobName → 실제 함수 매핑 dispatcher 신설
- ADR-0176 Phase 2b-2 의 cron wiring 위에 실제 replay 흐름 활성화

### Phase 3 Stage C — ReflectionInjectionBus + 학습 보정 자동 wiring
- 학습 결과 (counterfactual / SafetyGateAttribution / ShadowVsLiveDelta) → Gate/Kelly/임계 자동 보정
- LIVE 매매 본체 결합 — 가장 큰 회귀 위험, 운영 데이터 충분 누적 후 진행

### Phase 4-B-2-c — Phase 3 결합 지표 UI
- reflection injection rate (Phase 3 Stage C wiring 후)
- learning freshness score (Phase 3 Stage C wiring 후)

## 7. 운영 효과 (Phase 3 Stage A 머지 후 + ENV 활성화 후)

- **Phase 1~4-B 인프라 가동률 0% → 데이터 누적 시작** — Phase 1 (#532) ~ Phase 4-B-2-b3 (#542) 까지의 모든 인프라가 *진단/가시화* 만 가능했지만, 본 PR + ENV 활성화 시 *실제 데이터 흐름* 활성
- 차단된 날 (휴장일 / R6_DEFENSE / VIX panic / FOMC DAY / SELL_ONLY) Shadow learning 표본 자동 누적 → 학습 freeze 영구 차단
- Phase 4-B Dashboard 6 카드 placeholder → 실제 데이터 노출
- Phase 3 Stage B/C 진입 전제 조건 충족

## PR-P0-Activation (2026-05-06) — default OFF → ON

### 배경

ADR-0183 (PR #543, 2026-05-03) 에서 signalScanner 4 early-return wiring 완료. ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED=true` 명시 시에만 활성. 운영자 명시 결정 대기 패턴.

PR-A (#665) 머지 후 사용자 명시 *"P0 패치 후 머지 실시"* — 본 PR 으로 **default ON 전환**. PENDING_WIRING B11 (P0 SLA 만기 2026-05-24) 즉시 충족.

### 변경

`isShadowLearningOnBlockedDaysEnabled()` SSOT 정확 비교 패턴 격상:

- **이전**: `process.env.SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED === 'true'` (default OFF)
- **신규**: `process.env.SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED !== 'false'` (default ON, ADR-0157 정확 비교 의무)

회귀 발견 시 ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED=false` 1줄 즉시 롤백 → ADR-0183 default OFF 동작 byte-equivalent 복원.

### 회귀 테스트 정합 정정

- `describe('ENV 분기 (default OFF)')` → `describe('ENV 분기 (default ON, PR-P0-Activation 2026-05-06)')`
- `ENV 미설정 → skipped` → `ENV 미설정 → 활성 (default ON)` (skipped:false)
- `ENV='false' 정확 비교 → ENV_DISABLED` 신규 케이스 (운영자 명시 비활성)
- `ENV 임의 truthy → 모두 skipped` → `default ON, ADR-0157 정확 비교` (비활성은 'false' 정확 매치만)

### LIVE 매매 안전성

ADR-0183 §"안전 invariant 7종" 그대로 보존:

- `allowRealOrder: false` literal type + runtime throw 2중 강제 (LIVE 주문 격리)
- KIS 주문 함수 import 0건 (정적 grep 가드)
- 데이터 빈곤 site 제외 (ADR-0173 §5)
- `bypassMacroEntryBlock` boolean 명시 의무
- 데이터 품질/가격 sanity 우회 금지

본 default 변경은 *데이터 수집 활성화* 만 — LIVE 매매 본체 영향 0 (SHADOW only 격리).

### 운영 효과 (즉시)

차단된 날 (R6_DEFENSE / VIX panic / FOMC DAY / SELL_ONLY) Shadow learning 표본 자동 누적 시작 → Phase 4-B Dashboard 6 카드 placeholder → 실제 데이터 노출. PENDING_WIRING B11 P0 즉시 충족.
