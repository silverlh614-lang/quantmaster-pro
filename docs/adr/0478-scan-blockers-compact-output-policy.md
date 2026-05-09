# ADR-0478 scan_blockers Compact Output Policy SSOT

Status: Accepted / Documentation-only (wiring 후속 PR 분리)

## Context

`/scan_blockers` 텔레그램 명령 (`server/telegram/commands/system/scanBlockers.cmd.ts`) 는 운영자가 직전 스캔의 매수 차단 사유를 한 번에 확인하는 *진단 SSOT* 다. 시간이 지나면서 14+ 개의 옵셔널 섹션이 누적됐다 — baseMessage / TECHNICAL_PROVIDER_DEGRADED / supplyProvider warmup / counterfactualShadow summary / promotion / counterfactualUniverse / kisWsSubscription / sectorEnergy phase2 / sanity / coverageRecovery / executionImpact / nearMissOutcome / nearMissAnalytics / liveness / runtimeAudit. 모두 `parts.push` 순서로 단일 string 으로 concat 되어 `reply` 호출된다.

Audit 결과 4 결함 식별:

1. **길이 제한 SSOT 부재** — Telegram 메시지 4096 char 한도 명시 정책 0건. 모든 섹션이 최대 길이 출력 시 truncation 위험 + Telegram API 가 응답을 거부하면 운영자는 *진단 자체를 못 받음*.
2. **섹션 priority registry 부재** — `parts.push(...)` 호출 순서가 사실상 priority 지만 명시 SSOT 가 없어 신규 섹션 추가 시 drift 위험. 어떤 섹션이 *반드시 노출* / *옵셔널 압축 가능* 인지 정책 0건.
3. **섹션 metadata 노출 0건** — 각 섹션이 *언제 산출됐는지* / *어느 SSOT 가 산출 source 인지* / *결정 트리 trace id* 가 운영자에게 보이지 않음. 운영자가 stale 진단을 fresh 진단으로 오해할 위험.
4. **섹션 ENV gate drift** — 섹션마다 별도 ENV (예: `EMPTY_SCAN_LIVENESS_POLICY_DISABLED` / `SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED` / 14+) 가 호출자 측 inline 검사로 분산 — SSOT 위임 패턴 (ADR-0185~0189) 일부 적용됐지만 신규 섹션 추가 시 정책 강제 부재.

## Decision

`/scan_blockers` 출력 정책을 단일 SSOT 로 정착한다. wiring 본 ADR 의 *문서화* scope 외 — 별도 후속 PR 에서 점진 적용 (회귀 위험 격리, ADR-0146 §"단일 책임" + ADR-0148 §"PR 분할 정책" 정합).

### 1. Length Limit SSOT (절대 변경 금지)

```
SCAN_BLOCKERS_MAX_TELEGRAM_LENGTH = 4096   // Telegram API 한도
SCAN_BLOCKERS_RESERVED_OVERHEAD = 96       // header / footer / hash / safe margin
SCAN_BLOCKERS_BUDGET = 4000                // = 4096 - 96
```

`finalMessage.length > SCAN_BLOCKERS_BUDGET` 시 *낮은 priority 섹션부터 압축 / 제거* + *truncation marker `… (N개 섹션 압축, /scan_blockers_detail 참조)`* 명시 — 운영자가 압축 발생을 즉시 인지.

### 2. Section Priority Registry SSOT

신규 SSOT `server/telegram/commands/system/scanBlockersSectionRegistry.ts` (예정) — 각 섹션의 priority / required-or-optional / 압축 정책을 단일 매트릭스로 정의:

| sectionId | priority | required | 압축 정책 |
|---|---|---|---|
| baseMessage | 1000 | true | 압축 불가 (운영자 핵심 진단) |
| degradedSection (ADR-0118+0411) | 900 | false | summarize-to-1-line |
| sectorEnergyExecutionImpact (ADR-0448) | 850 | false | full |
| livenessSection (ADR-0451) | 800 | false | full |
| runtimeAuditSection (ADR-0461) | 750 | false | full |
| supplyProviderSection (ADR-0473) | 700 | false | summarize-to-1-line |
| supplyProviderWarmupSection | 650 | false | summarize-to-1-line |
| counterfactualLine (ADR-0431) | 600 | false | 1-line (이미 compact) |
| promotionLine (ADR-0432) | 550 | false | 1-line |
| universeSection (ADR-0433) | 500 | false | 1-line |
| kisWsSubscriptionSection (ADR-0442) | 450 | false | summarize |
| phase2Line (ADR-0446) | 400 | false | 1-line |
| sanityLine (ADR-0446) | 380 | false | 1-line |
| sectorEnergyCoverageRecoverySection (ADR-0447+) | 350 | false | summarize |
| nearMissOutcomeLine (ADR-454b) | 300 | false | 1-line |
| nearMissAnalyticsLine (ADR-455) | 280 | false | 1-line |

priority 높을수록 *budget 압박 시 더 늦게 압축* — baseMessage / 거시 게이트 / executionImpact 는 절대 압축 0.

### 3. Section Metadata SSOT

각 섹션이 본 ADR 의 metadata schema 를 *옵셔널 후방호환* 으로 노출:

```typescript
interface ScanBlockerSectionMeta {
  sectionId: string;          // priority registry key
  sourceAdr: string;           // 'ADR-0431' / 'ADR-0448' 등
  sourceSsotPath?: string;     // 'server/learning/.../...ts' (선택, debug 용)
  computedAt: string;          // ISO timestamp
  inputHash?: string;          // sha256 first 8 chars (선택, identity)
  truncated?: boolean;         // 본 ADR 의 압축 정책에 의해 잘렸는지
}
```

운영자 별도 진단 명령 (`/scan_blockers_detail`, ADR-0479 scope) 에서만 노출 — `/scan_blockers` 본 메시지에는 *압축 fallback 으로만* 사용 (예: `… (5개 섹션 압축, /scan_blockers_detail 참조)`).

### 4. Section Render SSOT (경유 의무)

신규 섹션 추가 시 *반드시* 본 priority registry 에 등록 + `renderScanBlockerSection(sectionId, payload)` SSOT 함수 경유. 호출자 측 inline `parts.push(formattedString)` 영구 차단 (정적 grep 가드 별도 후속 PR scope — `scripts/check_scan_blockers_section_registry.js` 예정).

## Policy

ADR-0478 은 *문서 SSOT 정착* 단계. wiring 은 별도 후속 PR 분리:

- **본 ADR (PR scope)**: ADR-0478 markdown 문서 + ADR-0479 markdown 문서 + INDEX.md 갱신만.
- **후속 PR-0478-Wiring-1**: `scanBlockersSectionRegistry.ts` SSOT 신설 + length budget compress 알고리즘 + 회귀 테스트 (≥30 케이스).
- **후속 PR-0478-Wiring-2**: 14+ 호출자 site 전수 마이그레이션 (priority registry 경유) + 정적 grep 가드.
- **후속 PR-0478-Wiring-3**: section metadata 영속 + `/scan_blockers_detail` 명령 (ADR-0479 scope 와 통합).

모든 wiring 의 출력은 다음을 보존:

- `executionImpact = NONE` (read-only 진단)
- `liveExecutionAllowed = false` (UI / 운영자 정보 only)
- `policyPromotionMode = SHADOW_ONLY` (자동 매매 결정 무관)
- KIS 주문 함수 5종 import 0건
- autoTradeEngine·orderExecutor·trancheExecutor import 0건
- Gate threshold + condition weight + STRONG_BUY 조건 0 변경
- 외부 API 신규 호출 0건 (영속 + 메모리 read-only)

## Invariants (절대 변경 금지)

1. `/scan_blockers` 응답 길이 ≤ 4096 (Telegram API 한도)
2. baseMessage 압축 0건 (priority 1000 절대 가드)
3. 거시 게이트 / executionImpact / livenessSection 압축 시 *진단 메시지 자체 무효* — priority ≥800 보존 의무
4. 압축 발생 시 truncation marker 의무 노출 (운영자가 *원본 메시지가 아님* 즉시 인지)
5. 섹션 metadata raw payload 영속 0 (sanitized — sourceAdr / computedAt / sectionId / inputHash 만)
6. KIS 주문 함수 5종 import 0건 / autoTradeEngine·orderExecutor·trancheExecutor import 0건
7. `/scan_blockers` 호출이 외부 API 추가 호출 0 (KIS / KRX / Yahoo / Naver / DART)
8. 신규 섹션 추가 시 priority registry 등재 의무 (정적 grep 가드, 후속 PR scope)
9. 호출자 측 inline `parts.push(formattedString)` 영구 차단 (renderScanBlockerSection SSOT 경유 의무)
10. ENV gate (각 섹션별 DISABLED) 호출자 측 inline 검사 0건 (SSOT 위임 의무, ADR-0185~0189 정합)
11. ENV 정확 비교 의무 (`=== 'true'`, ADR-0157 정합)
12. 본 ADR wiring 시 LIVE 매매 본체 0줄 변경

## 잘못된 해결 방법 (영구 차단)

- **Telegram 메시지 강제 분할 (multi-message reply)** — 운영자 cognitive load 폭증 + 메시지 순서 보장 불가 → 단일 메시지 + 압축 정책이 올바름.
- **priority 결정을 호출자 측 `parts.push` 순서로 위임** — drift 위험 + 신규 섹션 추가 시 정책 강제 부재.
- **section metadata 를 본 메시지에 노출** — 운영자 cognitive load 격증 + Telegram budget 낭비 → 별도 detail 명령 (ADR-0479) 으로 분리.
- **압축 정책을 ENV gate 로 회피 (`SCAN_BLOCKERS_LENGTH_LIMIT_DISABLED`)** — Telegram API 한도는 *절대 정책*, ENV 우회 불가.
- **truncation marker 생략** — 운영자가 압축 발생 인지 불가 → marker 의무.
- **본 ADR 발급 시점에 wiring 통합** — 회귀 위험 격리 (ADR-0146 §"단일 책임" 위반) → 별도 PR 분리.

## 후속 PR 후보 (scope 외)

- PR-0478-Wiring-1: `scanBlockersSectionRegistry.ts` SSOT + length budget compress 알고리즘
- PR-0478-Wiring-2: 14+ 호출자 site 전수 마이그레이션 + 정적 grep 가드
- PR-0478-Wiring-3: section metadata 영속 + `/scan_blockers_detail` 명령 (ADR-0479 통합)
- PR-0478-Wiring-4: section ENV gate SSOT 위임 통일 + drift 차단 정적 grep 가드

## Cross-References

- ADR-0118 — `/scan_blockers` diagnostic infrastructure (본 ADR 의 직접 base)
- ADR-0146 — PR 자가 review 5 카테고리 (본 ADR scope 정책)
- ADR-0148 — INDEX SSOT (본 ADR 발급 정합)
- ADR-0157 — ENV 정확 비교 의무
- ADR-0159 — ADR 별칭 정책 (충돌 ADR 인용 시 별칭 사용)
- ADR-0185~0189 — ENV 헬퍼 SSOT 위임 패턴
- ADR-0479 — scan_blockers detail trace registry (본 ADR 의 짝 ADR, `/scan_blockers_detail` 명령)
