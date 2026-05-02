# ADR-0158 — Wiring SLA 자동 만료 정책

@responsibility PENDING_WIRING.md 항목의 자동 만료 SLA SSOT — 인프라만 머지된 wiring 미완 PR 이 영원히 dead code 로 남는 결함 영구 차단.

**일자**: 2026-05-02
**관련 PR**: PR-Governance-3-SLA
**도메인**: governance / 거버넌스 자동화

## 배경

ADR-0148 (PR-Governance-Followup-2 #503) 가 4 거버넌스 자동화 SSOT (ADR INDEX / PENDING_WIRING / silent degradation / PR pace audit) 를 구축했지만, *wiring 미완 항목이 우선순위만 있고 *기한 부재* 라 영구 dead code 위험은 여전*. 사용자 audit 결과 PENDING_WIRING.md 47+ 항목이 INFRASTRUCTURE_ONLY/PARTIAL/BLOCKED 상태로 누적, P0 라벨도 *언제까지 wiring 의무인지* 불분명.

PR-A3-Audit (2026-04-30) 에서 발견된 결함 — A3 emitFullCloseAttribution 항목이 6개월간 INFRASTRUCTURE_ONLY 상태 stale 로 방치 → 실제로는 100% wired 됐지만 백로그 갱신 누락이라는 결함이 *기한 부재* 의 직접 결과. ADR-0148 의 카테고리 G (audit 추적성) 는 *결정 시점 정합* 만 검증, *wiring 진행 시점 강제* 는 부재.

## 결정

PENDING_WIRING.md 7번째 컬럼으로 *등재일* 을 추가하고, 우선순위별 SLA 를 도입한다. SLA 초과 시 빌드 경고, grace 14일 추가 초과 시 빌드 실패. 면제 정책으로 *외부 의존성 / 운영 데이터 누적* 명시 BLOCKED 항목은 SLA 면제.

### SLA 매트릭스

| 우선순위 | SLA | 의도 | grace 후 강제 |
|----------|-----|------|----------------|
| **P0** | **21일** | LIVE 매매·자기학습 결함 즉시 수리 | grace 14일 후 빌드 FAIL |
| **P1** | **45일** | UI 가시성·진단 정합 1.5 PR 사이클 | grace 14일 후 빌드 FAIL |
| **P2** | **120일** | 운영 데이터 누적 후 (4개월) | grace 14일 후 빌드 FAIL |
| **P3** | **무기한** | 외부 의존성 변경 후 (불확정) | SLA 무관 |

P0=21일은 1 PR 사이클 (5~7일) + 검증 시간 (5~7일) + 마무리 (5~7일) 안전 마진. *"즉시 수리 권장" 의도와 정합화. 이전 명시 "1~2주 권장" 보다 보수적*.

P1=45일은 ADR-0146 (10-PR audit 룰) 의 "1~2주 내" 권장과 정합. 운영 환경에서 1.5 audit 사이클 (10~15 PR) 진행 시간.

P2=120일 (4개월) 은 운영 데이터 누적 정상 윈도우 — A4 walkForwardFramework / A5 conditionLifecyclePolicy / B6 evaluateBuyList 같은 항목이 6개월 누적 권장 시 1.5x 마진.

P3=무기한 — 외부 API 인증·정책·6개월 audit 같은 *불확정 외부 의존성*. SLA 면제는 P3 라벨 자체로 자동 적용.

### 면제 정책 (SLA 면제 사유 명시 의무)

BLOCKED 상태 항목은 reason 컬럼에 *외부 의존성 / 운영 데이터 누적 / 사용자 결정 대기* 중 하나를 명시한 경우 SLA 면제. 그 외 BLOCKED 는 SLA 적용 (방치 결함 차단).

면제 사유 패턴 SSOT (`SLA_EXEMPTION_RE`):
- `외부 의존성` / `외부 API` / `운영자 결정` / `사용자 결정`
- `데이터 누적` / `운영 데이터 누적` / `데이터 가용` / `데이터 기반`
- `ADR-\d{4} 정책` (정책 SSOT 명시 인용)
- `검증 후` / `1~2주` / `N개월 후` (시간 의존성 명시)

SLA 적용 + 면제 사유 부재 → BLOCKED 항목도 grace 후 FAIL.

### 등재일 schema

PENDING_WIRING.md 백로그 표 7 컬럼:

```
| ID | ADR | 모듈 | 등재일 | 상태 | 우선순위 | 사유 |
```

등재일 형식: `YYYY-MM-DD` (KST 기준). 신규 PR 머지 시 *해당 PR 머지일* 로 명시. 기존 47 항목 baseline = `2026-05-02` (본 PR 머지일) 일괄 부여.

DECIDED_NOT_WIRING 항목은 등재일 의미 없음 — `—` 또는 결정 PR 머지일 둘 다 허용 (SLA 미적용).

### ENV 우회

- `WIRING_SLA_GRACE_DAYS=N` (기본 14, 운영자 명시 0~30일 범위 조정 가능). 0 시 grace 비활성 (즉시 FAIL).
- `WIRING_SLA_DISABLED=true` (긴급 운영 우회 — 정책 즉시 비활성, ADR-0148 baseline 무회귀 동작 복원).

ENV 우회 시 진단 로그에 `[PendingWiring] SLA disabled (ENV)` 명시.

## 적용

### 1. PENDING_WIRING.md schema 변경

기존 6 컬럼 → 7 컬럼. 모듈 다음 / 상태 이전 위치에 `등재일` 컬럼 삽입. 47 항목 모두 baseline `2026-05-02` 일괄 부여.

DECIDED_NOT_WIRING 항목은 *결정 PR 머지일* 명시 권장 (예: PR-Phase5 머지일 `2026-05-01`) — SLA 미적용이라 의미는 audit 추적성만.

### 2. SLA 정책 섹션 추가

PENDING_WIRING.md 새 섹션 `## SLA 자동 만료 정책` — SLA 매트릭스 + 면제 정책 + ENV 우회 + 본 ADR-0158 인용.

### 3. PR 템플릿 강제 필드

`.github/pull_request_template.md` "🔌 wiring 완료 vs 인프라만" 섹션에 신규 의무 필드 추가:

> - [ ] INFRASTRUCTURE_ONLY 등재 시 *wiring 약속 PR 번호* 또는 *SLA 만기일* 둘 중 하나 명시 (PENDING_WIRING.md reason 컬럼).

운영자가 "이 항목 언제 wiring 할지" 명시 없이는 머지 불가. 사용자 명시 *"머지 시점부터 wiring 약속 PR 번호 또는 SLA 만기일 둘 중 하나"* 정합.

### 4. check_pending_wiring.js 카테고리 H 추가

신규 4 sub-카테고리 (G 7번째 카테고리 다음에):

- **H1** SLA 초과 (WARN, EXIT=0) — `now - 등재일 > SLA_DAYS[priority]`. P3/DECIDED_NOT_WIRING 면제. BLOCKED + 면제 사유 명시 면제.
- **H2** SLA + grace 초과 (FAIL, EXIT=1) — `now - 등재일 > SLA_DAYS[priority] + GRACE_DAYS`. WIRING_SLA_DISABLED ENV 우회 가능.
- **H3** 등재일 형식 정합 — `YYYY-MM-DD` 또는 `—` 외 차단. 잘못된 형식 (예: `2026-5-2` / `26-05-02` / `2026/05/02`) FAIL.
- **H4** BLOCKED 면제 사유 명시 — BLOCKED 상태 + reason 에 면제 사유 패턴 부재 + SLA 초과 시 H1/H2 그대로 적용.

### 5. now injection (테스트 격리)

`validate(parsed, knownAdrs, options)` 시그니처에 `options.now: Date` 옵셔널 추가 (ADR-0157 패턴 차용). 미전달 시 `new Date()`. 테스트는 명시 `now` inject 로 시간 의존 회귀 차단.

## 결과

- **즉시 효과** — 본 PR 머지 직후 47 baseline 항목 모두 `2026-05-02` 등재일 부여 → SLA 시계 시작. P0 3건 (A3/B1/C7) 은 *현재 모두 DECIDED_NOT_WIRING* 또는 *완료* 상태라 SLA 무관. P1 12건은 SLA=45일 → 6/16 까지 wiring 완료 또는 BLOCKED 격상 의무. P2 21건은 SLA=120일 → 8/30 까지 처리 의무.
- **stale 결함 영구 차단** — A3 같은 6개월 stale 결함 정적 검증으로 자동 검출. P1 항목이 45일 + grace 14일 = 59일 후 빌드 FAIL → 운영자 의도적 *기한 인지*.
- **PR 머지 강제력** — PR 템플릿 자가 review 가 *언제 wiring 할지* 명시 의무화 → 무기한 dead code 등재 차단.
- **회귀 위험 격리** — ENV 2종 (`WIRING_SLA_GRACE_DAYS` / `WIRING_SLA_DISABLED`) 우회 + grace 14일 윈도우 + BLOCKED 면제 정책 3중 안전망.

## 잔여 후속 PR (scope 밖)

- `_workspace/audit-pr-510/findings.md` 첫 audit 시 본 SLA 정책 *실 운영 효과* 검증 (47 baseline 의 P1 12건 중 SLA 도달 시점 정합).
- SLA 임계값 운영 데이터 기반 재조정 — 본 ADR 매트릭스가 SSOT 라 변경 시 본 ADR 갱신 + 회귀 테스트 자동 fail 로 drift 차단.
- 면제 사유 패턴 확장 (예: `사용자 명시 보류` / `LIVE 검증 1주 후`) — 운영자 패턴 누적 후 별도 PR.

## 참고

- ADR-0148 거버넌스 자동화 (#503) — PENDING_WIRING.md 정합 검증 (카테고리 G) 4 자동화 SSOT.
- ADR-0146 PR pace audit 룰 — 10-PR boundary audit-only PR 강제.
- ADR-0157 feedback-loop now injection — 테스트 시간 격리 패턴 차용.
- 사용자 4-항목 거버넌스 추천 (#1 audit 룰 / #2 silent degradation / #3 ADR INDEX / #4 PENDING_WIRING) → ADR-0148 자동화 100% 완주 + 본 ADR-0158 *시간 강제력* 추가.
