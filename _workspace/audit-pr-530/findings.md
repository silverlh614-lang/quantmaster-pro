# PR-Audit-530 — audit-PR-520 후속 4 PR 검증 + 9 closed PR 정리

@responsibility ADR-0146 §"강제 트리거 시점" 사용자 명시 요청 — audit-PR-520 (#524) 이후 main 머지 4 PR + 9 closed PR audit.

## 검증 항목

### 트리거 충족

ADR-0146 §"강제 트리거 시점" 3 트리거 중 *사용자 명시 요청* 트리거 (두 번째) 충족. 본 audit 은 **mini-audit** 성격 (4 PR 누적, N0 boundary 10 PR 미달). 다음 N0 boundary = PR #534 예정.

### audit 범위 (5 카테고리)

audit-PR-520 후속 main 머지 PR 4건:

| PR | ADR | 머지 commit | 의도 |
|----|------|-------------|------|
| #525 | 0167 | `f99e1a7` | currentEquityExposureAmount 정확 산출 SSOT (M1 수리) |
| #526 | 0168 | `a021958` | Kelly Clamp 수치 정책 SSOT (M3 수리) |
| #527 | 0169 | `82b1777` | trancheExecutor 추매 진입점 노출 예산 cap wiring (M2 수리) |
| #528 | 0170 | `22ac39a` | 매크로 신호 R1_DEFENSIVE 자동 격상 (M4 수리) |

**누적 변경량**: 22 files / +1,726 / -25 LoC. 신규 ADR 4건 + 신규 회귀 테스트 5 파일.

추가 검증: 9 closed PR 정리 (audit 결과 outdated / 대체 PR 채택 / main 흡수 확정).

## 발견

### A. LIVE 매매 안전성 ✅ Pass

| 검증 | 결과 |
|------|------|
| KIS/KRX 자동매매 quota 침범 | **0건** — `signalScanner.ts` 만 -3/+6 LoC 변경 (ADR-0168 Kelly clamp inline 제거 — 의도된 SSOT 통합), kisClient/orchestrator/autoTradeEngine 본체 무수정 |
| ENV 롤백 매트릭스 | **3종 default OFF** (`POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED` ADR-0167 / `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED` ADR-0166 / `EXPOSURE_REGIME_AUTO_MAPPING_DISABLED` ADR-0170) — 운영자 명시 활성화 의무 |
| 보호층 누적 | ADR-0162 4 보호층 + ADR-0166 1 + ADR-0167 1 + ADR-0170 3 = **5+ 보호층** |
| AUTO_TRADE_ENABLED + emergencyStop | wiring 변경 부재 (기존 가드 보존) |

### B. wiring 완료 vs 인프라만 ✅ Pass

| 항목 | 결과 |
|------|------|
| PENDING_WIRING B9 정합 | `0166+0167+0169+0170 RegimeExposureBudget` PARTIAL — audit-PR-520 §M1+§M2+§M4 수리 완료 명시 |
| 잔여 P2 2건 | currentPriceMap (KIS 시가 평가) + UI 출력 — 별도 후속 PR 분리 |
| audit-PR-520 §"Medium 4건" 모두 수리 완료 | M1 ✅ M3 ✅ M2 ✅ M4 ✅ |

### C. ADR 발급 무결성 ✅ Pass

| 항목 | 결과 |
|------|------|
| INDEX.md 다음 발급 | `0171` 정합 (ADR-0170 마지막 발급) |
| ADR 파일 시스템 | 177 파일 — 신규 4 (0167~0170) 정상 |
| 충돌 그룹 | 8 그룹 17 ADR (별칭 정책 ADR-0159 적용 그대로) |
| 누락 | 6건 (0062/0063/0089/0105/0106/0143) — 변동 없음 |

### D. 회귀 테스트 적정성 ✅ Pass

| 신규 테스트 파일 | 케이스 수 | LoC 비율 (heuristic ≥5/100 LoC) |
|------------------|-----------|--------------------------------|
| `currentEquityExposure.test.ts` | 21 | ✅ 충분 |
| `kellyClamp.test.ts` | 29 | ✅ 충분 |
| `trancheExecutorAdr0166Wiring.test.ts` | 18 | ✅ 충분 |
| `regimeExposureMacroMapping.test.ts` | 26 | ✅ 충분 |
| `applyExposureBudgetCapAdr0170.test.ts` | 20 | ✅ 충분 |
| **총** | **114 케이스** | ✅ |

### E. 정책 위반 ✅ Pass

`npm run validate:all` 16종 — baseline 무회귀:
- ACMA / SDS / PRES / Responsibility / SymbolBoundary / ChannelBoundary / SensitiveAlerts / MarketOverviewBoundary / YahooRange / UILanguage / DataTrust / SilentDegradation / ADRIndex / PendingWiring / PrPaceAudit / Gemini

## 분류

- **Critical (P0)**: **0건** ✅
- **High (P1)**: **0건** ✅
- **Medium (P2)**: **1건** — PENDING_WIRING B9 잔여 2 후속 PR (currentPriceMap KIS 시가 평가 + UI 출력) 운영 데이터 누적 후 진행
- **Pass**: **4건** (LIVE 안전성 / wiring 정합 / ADR 무결성 / 회귀 테스트)

audit-PR-520 §"Medium 4건" → 본 audit §"Medium 1건" 으로 *감소* — audit → 수리 사이클 4건 모두 정합 완료.

## 부수 정리 — 9 closed PR (audit 결과 outdated)

본 audit 사이클 동안 사용자 결정으로 9 PR 일괄 closed (이유: main 흡수 / 대체 PR 채택 / outdated):

| PR | ADR / 의도 | 닫기 사유 |
|----|------------|----------|
| #382 | Gemini token 한도 | main 흡수, diff=0 |
| #419 | Watchlist/빈스캔 noise | main 흡수, diff=0 |
| #431 | Post-FOMC 4 항목 (ADR-0105) | ADR-0105 PR-Reflection-Routing-Retrofit 으로 재할당 |
| #433 | Suggest 메시지 정정 | main 흡수, diff=0 |
| #453 | JobMetrics 영속 | main 흡수, diff=0 |
| #464 | entryConditionScores (ADR-0006) | PR-Phase0-MappingFix #508 + PR-A3-Audit #507 대체 |
| #465 | emitFullCloseAttribution SSOT | PR-A3-Audit #507 = 100% wired 확정 (불필요) |
| #477 | KRX 세션 쿠키 LOGOUT | PR #478 KRX OpenAPI 마이그레이션 대체 |
| #491 | FSS status 메시지 정정 | main 의 fssStatus 가 더 정확한 메시지 보유 |

**부수 효과** — open PR 카운트 18 → 9 (50% 감소). 잔여 10 open PR 모두 본 audit scope 외 (자기학습 시리즈 #372/#373 + Copilot WIP draft 8건).

## 결정

- **즉시 수리 (P0/P1) 0건** — LIVE 매매 안전성 결함 부재
- **후속 PR 분리 (P2 1건)** — PENDING_WIRING B9 잔여 (currentPriceMap + UI), 운영 데이터 누적 후 진행
- **DECIDED_NOT_WIRING 0건**
- **백로그 정정 0건**

## 후속 조치

### 단기 (1~2주)
- 운영자 ENV 활성화 — Stage A SHADOW APPLY → Stage B EXPOSURE BUDGET (ADR-0166 §7) → Stage B-2 ACCURATE EXPOSURE (ADR-0167) → Stage C (ADR-0170 R1_DEFENSIVE 자동 격상)
- SHADOW 1주 검증 후 LIVE 전환 결정

### 중기 (1개월)
- PR-ExposureBudget-CurrentPriceMap (KIS 시가 매핑 SSOT) — ADR-0167 §2.2 후속
- PR-ExposureBudget-UI (사용자 §6 노출 예산 가시화 카드)

### 장기 (3개월+)
- 다음 N0 boundary audit (PR #534 예정) 시 본 audit 의 Medium 1건 *수리 완료 / 미완료* 추적

## 거버넌스

- ADR-0146 §"강제 트리거 시점" *사용자 명시 요청* 트리거 충족
- audit-only PR (코드 변경 0줄, ADR-0146 §"Anti-Patterns" 정합)
- _workspace/audit-template.md 표준 형식 준수
- audit findings 영속 — 다음 audit (PR #534) 시 *Critical 0 / High 0 / Medium 1* 추적 가능

## audit 학습 데이터 (ADR-0146)

본 audit 의 핵심 발견 패턴:
- **audit → 수리 사이클 정합** — audit-PR-520 §"Medium 4건" 모두 4 PR 으로 수리 완료 (M1: #525 / M3: #526 / M2: #527 / M4: #528) — *사이클 종결 사례 첫 번째*
- **PR 정리 사이클** — 9 closed PR 패턴 (main 흡수 / 대체 PR / outdated 메시지) — open PR 50% 감소

다음 audit (PR #534) 시 본 audit 의 *Medium 1건* (B9 currentPriceMap + UI) 추적 + 신규 발견 분류.

## 부록 A: audit 패턴 카탈로그

본 audit 에서 식별된 새 패턴 — 향후 audit 에서 동일 검증:

1. **audit-PR-520 §"Medium 4건" 수리 완료 검증** — 4 PR 머지 commit 확인 + ADR 파일 존재 + wiring 정합
2. **9 closed PR diff=0 검증** — main 흡수 vs 대체 PR vs outdated 메시지 분류
3. **신규 ENV 매트릭스** — 3종 default OFF + 운영자 명시 활성화 절차 문서화
4. **회귀 테스트 LoC 비율** — heuristic ≥5/100 LoC 5 신규 파일 모두 충족

## 부록 B: audit findings 가 학습 데이터

본 audit 자체가 다음 audit (PR #534) 의 학습 데이터 — *사이클 종결 사례* + *PR 정리 패턴* 두 신규 카테고리 등록.
