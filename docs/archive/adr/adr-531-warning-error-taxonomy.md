# ADR-531 — Warning/Error Taxonomy & Diagnostic Severity Normalization

**Read this file only when working on:**
- diagnostic / logging severity 분류 (ERROR/WARN/INFO/DIAGNOSTIC/DEBUG/SUPPRESSED)
- providerIssue ↔ marketSignal 의 로그/표시 레벨 분리
- 정책 상태(SELL_ONLY/R6/HOLIDAY/SHADOW_ONLY) 가 장애로 표시되는지 점검
- P3/P4 진단 budget / suppression 의 severity 매핑
- Telegram 사용자-facing severity 노출 정규화

**Do not read this file for:**
- 일반 코딩 (본 문서는 diagnostics/severity 도메인 전용 reference) → 평소 로드 금지
- Telegram 채널 라우팅 일반 정책 → `docs/ai/06-telegram-policy.md`
- SourceSnapshot/providerIssue 데이터 원칙 → `docs/ai/03-source-snapshot-ssot.md`

> **Status:** ADR-531 1차 증분 = **문서 SSOT 전용** (코드 0줄, runtime byte-equivalent).
> 본 문서는 분산된 기존 severity 인프라를 단일 taxonomy 로 **성문화(normative reference)** 한다.
> enum 통합·ad-hoc emit 사이트 리팩토링·telegram severity↔executionImpact 연결 등 **코드 변경은
> 후속 ADR(532+)로 분리** (ADR-530 Patch Scope Guard: 3개 도메인 초과 → 분리).
> 핵심 원칙: **경고를 없애는 게 아니라 경고의 의미를 분류한다.**

---

## 1. Severity Taxonomy (normative)

| Severity | 의미 | 예 |
|----------|------|----|
| **ERROR** | 실제 시스템 기능 실패 | engine loop crash · 기대된 order path 실패 · position/ledger mutation 실패 · SourceSnapshot 생성 실패(안전 fallback 없음) · user command handler crash(미응답) |
| **WARN** | 조치가 필요한 비정상 상태 | 예상치 못한 live execution 차단 · execution-critical(P0/P1/P2) stale/누락이 실행 권한에 영향 · provider fallback 전부 실패(실행 중요 데이터) · shadow lifecycle 전이 실패 · 사용자-facing 중복 알림 유발 idempotency 위반 |
| **INFO** | 정상 운영/정책 상태 | SELL_ONLY · R6 · HOLIDAY · PRE_MARKET/POST_CLOSE · SHADOW_ONLY · 정책상 live buy 차단 · shadow 계속 활성 · **providerIssue 격리(executionImpact=NONE)** |
| **DIAGNOSTIC** | 분석/추적용 (비차단) | Gate 평가 상세 · scan_blockers · candidate snapshot 분석 · P3/P4 budget exceeded · diagnostic skipped · telemetry unavailable · non-blocking provider empty |
| **DEBUG** | 개발자 내부 추적 | raw provider payload shape · 내부 router 분기 · correlationId trace · verbose telegram fallback |
| **SUPPRESSED** | 의도적으로 숨긴 반복 로그 | 중복 로그 dedup · cooldown-hit alert · TTL-dedup provider 로그 |

---

## 2. 기존 인프라 매핑 (Rosetta — 허구 아님)

ADR-531 taxonomy 는 **신규 enum 을 만들지 않는다.** 분산된 기존 타입을 본 6-레벨로 해석한다.

| 기존 타입 (SSOT 파일) | ADR-531 매핑 |
|----------------------|--------------|
| `WarnPriority` P0/P1/P2 (`observability/operationalWarnTypes.ts`) | ERROR 또는 WARN (executionImpact 에 따라) |
| `WarnPriority` P3/P4/P5 | DIAGNOSTIC (비차단) / SUPPRESSED |
| `ExecutionImpact` 13값 (`observability/executionImpact.ts`) | severity 결정 입력 (아래 §3) |
| `LogLevel` trace/debug/info/warn/error (`utils/logger.ts`) | DEBUG/INFO/WARN/ERROR 직접 대응 |
| `LogVisibility` ALWAYS/SUMMARY/DIAGNOSTIC/TRACE/SILENT_BY_DEFAULT | 표시 채널 결정 (아래 §6) |
| `DispatchPriority` CRITICAL/HIGH/NORMAL/LOW (`alerts/alertRouter.ts`) | Telegram severity (CRITICAL≈ERROR, HIGH≈WARN, NORMAL/LOW≈INFO/DIAGNOSTIC) |
| `HealthProbeSeverity` OK/WARN/CRITICAL (`health/diagnostics.ts`) | INFO/WARN/ERROR |

> **현재 이미 구현된 동작 (성문화만):**
> - `classifyOperationalWarnLogLevel()` (`operationalWarn.ts`) 가 `providerIssue=true marketSignal=false`
>   를 **이미 INFO 로 강등**한다.
> - P3 진단은 `diagnosticSuppressor.ts`/`p3WarnSummary.ts` 로 **이미 dataVacuum/error 승격 없이**
>   dedup+10분 summary 처리된다.
> - 4채널 라우팅·`DEFAULT_SEVERITY`·`VIBRATION_POLICY`·cooldown 은 `telegramEventRouter.ts`/
>   `alertRouter.ts` 에 이미 결정적으로 존재한다.

---

## 3. Severity 결정 규칙 (executionImpact 기반)

- `executionImpact === 'NONE'` → 기본 **INFO** 또는 **DIAGNOSTIC** (절대 ERROR/WARN 아님).
- `executionImpact ∈ {LIVE_ORDER_BLOCKED, LIVE_SELL_BLOCKED, EXIT_MONITOR_DEGRADED, POSITION_QUERY_DEGRADED}` → **WARN/ERROR** 가능.
- `executionImpact === 'NEW_BUY_BLOCKED_ONLY'` 가 **정책(SELL_ONLY/R6)** 에 의한 것 → **INFO**.
- `executionImpact === 'NEW_BUY_BLOCKED_ONLY'` 가 **예상치 못한 차단** → **WARN**.
- `executionImpact ∈ {SHADOW_*_DEGRADED, SHADOW_POSITION_AT_RISK}` → **WARN/ERROR** (Shadow 불멈춤 불변식 #2 보호).

---

## 4. providerIssue ↔ marketSignal 분리 (불변식 #6)

```
providerIssue=true  ⇏  marketSignal=true
providerIssue=true  ⇏  bearish
providerIssue=true  ⇏  R6
providerIssue=true + executionImpact=NONE  ⇒  사용자-facing 경고 금지 (DIAGNOSTIC/INFO)
```

후속 코드 증분이 severity 매핑에 가드를 추가할 경우 (예시 — 미구현):
```ts
if (event.category === 'PROVIDER_HEALTH' && event.executionImpact === 'NONE') return 'DIAGNOSTIC';
```
(현재는 `operationalWarn.ts` 의 reason 기반 INFO 강등으로 동등 효과 달성 — §2 참조.)

---

## 5. 정책 상태 ≠ 장애 (불변식 #1·#4·#5)

다음은 **정상 정책 상태** — 기본 INFO/POLICY_STATE, ERROR/WARN 금지:
`SELL_ONLY` · `R6_DEFENSE` · `R6_RECOVERY_WATCH` · `SHADOW_ONLY` · `OBSERVE_ONLY` ·
`HOLIDAY` · `PRE_MARKET` · `POST_CLOSE` · `LUNCH_BREAK`.

**정책 상태 + 실제 장애가 결합될 때만** WARN/ERROR:

| 상황 | severity |
|------|----------|
| R6 active + Shadow Learning running | INFO |
| R6 active + **Shadow Learning stopped** | **ERROR** (불변식 #2 위반) |
| SELL_ONLY + live buy blocked | INFO |
| SELL_ONLY + **position exit 잘못 차단** | **WARN/ERROR** |
| HOLIDAY + observe/counterfactual running | INFO |
| HOLIDAY + **engine loop crashed** | **ERROR** (불변식 #1 위반) |

---

## 6. P3/P4 진단 budget & Telegram 표시 정규화

**P3/P4 는 ERROR/WARN 로 승격하지 않는다:** `P3_SCAN_DIAGNOSTIC budget exceeded` ·
`P4_TELEMETRY_VERBOSE budget exceeded` · `diagnostic materialize skipped` · `verbose telemetry suppressed`
→ `severity=DIAGNOSTIC` · `executionImpact=NONE` · `dataVacuum=false` · `blocking=false`.
**P0/P1/P2 execution-critical data gap 만** data vacuum 후보.

**Telegram 사용자-facing 노출 매트릭스:**

| Severity | 노출 위치 |
|----------|-----------|
| ERROR | 사용자-facing 가능 |
| WARN | 사용자 행동 필요 시만 사용자-facing |
| INFO | 요약 카드 표시 가능 |
| DIAGNOSTIC | debug/admin 채널 또는 `/debug` 명령만 |
| DEBUG | Railway/log only |
| SUPPRESSED | Railway/log only |

예: `providerIssue 격리/executionImpact=NONE` → signal 채널 경고 금지(debug/admin만) ·
`SELL_ONLY live buy blocked` → "정책상 신규 매수 차단"(장애 표시 금지) ·
`Shadow duplicate suppressed` → Telegram 반복 발송 금지(Railway SUPPRESSED).

---

## 7. 후속 ADR (코드 증분 — 본 ADR 범위 외)

본 문서는 normative SSOT 만 확정한다. 아래는 코드 변경이 필요해 별도 ADR 로 분리:

- **ADR-532 — Telegram Noise Reduction & Channel Severity Filter:** DIAGNOSTIC/DEBUG/SUPPRESSED 가
  사용자 채널에 노출되지 않도록 필터 + executionImpact↔telegram severity 추론 연결.
- **ADR-533 — Typecheck Baseline & No-Regression Guard.**
- **ADR-534 — Warning Backlog Burn-down:** ad-hoc `console.warn`(R6/regime/trading 사이트)을
  `emitOperationalWarn()` SSOT 로 funnel + 4 severity enum harmonization.

각 후속 ADR 은 `docs/ai/templates/patch-plan-template.md` 형식으로 Patch Plan 먼저 작성 (ADR-530).

---

## 8. 검증 기준 (코드 증분 적용 시)

후속 코드 ADR 에서 추가할 taxonomy 테스트 케이스 (현재는 normative 명세):

1. providerIssue=true, marketSignal=false, executionImpact=NONE → severity ∈ {INFO, DIAGNOSTIC} (ERROR/WARN 아님).
2. SELL_ONLY + live buy blocked → INFO/POLICY_STATE.
3. R6 active + shadowAllowed=true → ERROR 아님.
4. P3 budget exceeded → DIAGNOSTIC, dataVacuum=false.
5. P0 execution-critical provider missing → WARN 또는 ERROR 가능.
6. Telegram signal 채널에 DIAGNOSTIC/DEBUG/SUPPRESSED 직접 노출 안 됨.
7. Shadow lifecycle failure → WARN/ERROR 유지.

검증 파이프라인·패치 유형별 최소 검증 → `docs/ai/08-testing-checklist.md` ·
Patch Scope Guard(warning cleanup ≠ behavior change) → `docs/ai/09-refactor-rules.md`.
