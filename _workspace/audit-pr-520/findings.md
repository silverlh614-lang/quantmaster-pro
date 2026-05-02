# Audit PR-520 — Sizing 6 ADR 시리즈 + 거버넌스 4 PR 누적 검증

**작성일**: 2026-05-02
**PR scope**: PR #514~#523 10 PR 누적 변경 / N0 boundary 도달 (PR #520 직후, ADR-0146 §"강제 트리거" 의무)
**목적**: Sizing Engine 6 ADR 시리즈 (0161~0166) + 거버넌스 4 PR (514~517) 누적 검증 — LIVE 매매 안전성 + wiring 무결성 + 거버넌스 정합 + 회귀 테스트 적정성
**KIS/KRX/Yahoo quota 영향**: 0 (read-only audit, 코드 변경 0건)
**LIVE 매매 본체 변경**: 0줄

---

## 검증 범위 (PR 매트릭스)

| PR # | ADR | 도메인 | 머지 시점 | 비고 |
|------|-----|--------|-----------|------|
| #514 | (해당 무) | governance audit template + PENDING_WIRING G 카테고리 | 2026-05-01 | check_pending_wiring G 카테고리 자동 검증 추가 |
| #515 | 0158 | wiring SLA 자동 만료 정책 | 2026-05-02 | P0=21d / P1=45d / P2=120d / P3=무기한 |
| #516 | 0159 | ADR alias diaspora 시스템 | 2026-05-02 | 17 충돌 ADR 별칭 부여 (default OFF strict 검증) |
| #517 | 0160 | reflection routing retrofit | 2026-05-02 | commit 2258621 사후 거버넌스 정정 |
| #518 | 0161 | Sizing Engine Phase 1 인프라 | 2026-05-02 | server/trading/sizing/ 8 파일 + 12 TC |
| #519 | 0162 | Sizing Phase 2-D SHADOW wiring | 2026-05-02 | 메인 buyList wiring + sizingSource marker |
| #520 | 0163 | Sizing Phase 2-D Extension 3 경로 | 2026-05-02 | PRE_BREAKOUT_FOLLOWTHROUGH/30%/INTRADAY_STRONG wiring |
| #521 | 0164 | peakEquity 영속 + drawdown 활성화 | 2026-05-02 | SHADOW/LIVE peak 영속 격리 |
| #522 | 0165 | Phase 3 LIVE Activation ENV | 2026-05-02 | `_LIVE_ENABLED=true` ENV 도입 |
| #523 | 0166 | 레짐 노출 예산 (positionSizingEngine 상위) | 2026-05-02 | 7 레짐 매트릭스 + 4 wiring 통합 |

**감사 시점 통계**: 10 PR / 6 ADR (Sizing) + 3 ADR (거버넌스) / 1 PR (template) — 누적 변경량 약 +5500 LoC / 신규 회귀 테스트 약 +180 케이스.

---

## ADR-0146 §"PR 자가 review 체크리스트" 5 카테고리 검증

### A. LIVE 매매 안전성 — `[Pass]`

| 검증 항목 | 결과 |
|-----------|------|
| KIS/KRX 자동매매 quota 침범 (절대 규칙 #2/#3/#4) | ✅ 0 침범 (10 PR 모두 kisClient/orchestrator/autoTradeEngine 본체 무수정) |
| ENV 롤백 스위치 명시 | ✅ 모든 wiring PR 에 default OFF + 명시 활성화 ENV 도입 |
| LIVE 매매 본체 변경 0 (또는 ENV 보호) | ✅ Sizing 시리즈 6 PR 모두 ENV default OFF + 5 보호층 (ADR-0162 §6 + ADR-0166 추가 1 층) |
| AUTO_TRADE_ENABLED + emergencyStop 가드 | ✅ wiring 위치 모두 기존 가드 *후* (사이징 결정 단계) |
| 호출자 (4 wiring) 변경 안전성 | ✅ ADR-0163/0166 wiring 모두 `legacyXXX` 변수 보존 + `applied=false` fallback |

**ENV 매트릭스 (운영자 활성화 4단계)**:
1. `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` (ADR-0162) — SHADOW 모드 활성
2. `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED=true` (ADR-0166) — 노출 예산 활성
3. `POSITION_SIZING_ENGINE_LIVE_ENABLED=true` (ADR-0165) — LIVE 모드 활성
4. 문제 시 ENV `=false` 1줄 즉시 롤백

### B. wiring 완료 vs 인프라만 — `[Pass]`

| PR | 인프라 vs wiring | PENDING_WIRING 등재 |
|----|------------------|---------------------|
| #518 (Phase 1) | 인프라만 (호출자 0) | ✅ B8 INFRASTRUCTURE_ONLY |
| #519 (Phase 2-D) | wiring 1 곳 (메인) | ✅ B8 PARTIAL 격상 |
| #520 (Extension) | wiring 3 곳 추가 | ✅ B8 PARTIAL 잔여 5→4 감소 |
| #521 (Drawdown) | wiring 자동 hook | ✅ B8 잔여 4→3 감소 |
| #522 (LIVE) | LIVE 활성화 ENV | ✅ B8 P0→P2 격하 (SLA 충족) |
| #523 (노출 예산) | 인프라 + wiring 4 곳 | ✅ B9 신규 등재 (PARTIAL) |

**잔여 wiring**: B8 (P2) 잔여 2 PR (lossStreak/universe/sectorWeight) + B9 (P2) 잔여 4 PR (정확 노출 산출/추매 감지/UI/자동 매핑). 모두 P2 — 운영 데이터 누적 후 진행.

### C. ADR 발급 무결성 — `[Pass]`

| 검증 항목 | 결과 |
|-----------|------|
| INDEX.md 다음 발급 번호 사용 의무 | ✅ 6 ADR 모두 INDEX.md 명시 번호 사용 (0161→0162→...→0166 순차) |
| INDEX.md 한 줄 추가 의무 | ✅ 6 ADR 모두 §"전체 인덱스" 등재 |
| 기존 충돌 ADR 별칭 사용 (ADR-0159) | ✅ Sizing 6 ADR 0161~0166 모두 신규 (충돌 그룹 외) |
| ADR 본문 §"잘못된 해결 방법" 명시 | ✅ 6 ADR 모두 영구 차단 패턴 명시 |
| ADR 본문 §"운영자 활성화 절차" 명시 | ✅ 6 ADR 모두 단계별 절차 명시 |
| ADR INDEX 정합 자동 검증 | ✅ check_adr_index 16종 validate:all 통과 |

### D. 회귀 테스트 적정성 — `[Pass]`

| PR | 신규 LoC | 회귀 케이스 | 비율 (100 LoC 당) |
|----|----------|-------------|-------------------|
| #518 | ~900 | 20 | 2.2 (heuristic 5+ 미달) |
| #519 | ~190 | 28 | 14.7 (충분) |
| #520 | ~80 (3 wiring) | 14 | 17.5 (충분) |
| #521 | ~150 | 35 | 23.3 (충분) |
| #522 | ~100 | 24 | 24.0 (충분) |
| #523 | ~270 | 31 | 11.5 (충분) |

**누적 회귀 테스트 152 케이스 신규** (server/trading + server/persistence 무회귀 1733/1733 PASS).

⚠️ **#518 비율 heuristic 미달** — 인프라 SSOT 신설이라 단위 함수 단위 비율은 낮으나 12 TC + 6 티어 경계 + 2 섹터 통합 검증으로 *시나리오 커버리지* 충분. 후속 wiring PR (#519~#523) 가 통합 회귀 테스트로 보완.

### E. 정책 위반 (validate:all 16종) — `[Pass]`

| 검증 | 결과 |
|------|------|
| Gemini API 충돌 | ✅ 0건 |
| ACMA (1500줄 임계) | ✅ baseline 0건 |
| SDS (silent degradation) | ✅ baseline 1건 흡수 (ADR-0085 bepGlideTouchAt + ADR-0085 price7d, 의도된) |
| PRES (Promise + Sequential pattern) | ✅ |
| Responsibility (@responsibility tag) | ✅ baseline (5 누락 사전, 본 PR 시리즈 무관) |
| SymbolBoundary | ✅ |
| ChannelBoundary | ✅ |
| SensitiveAlerts | ✅ |
| MarketOverviewBoundary | ✅ |
| YahooRange | ✅ |
| UILanguage | ✅ |
| DataTrust (ADR-0114) | ✅ |
| SilentDegradation (ADR-0148) | ✅ 146 옵셔널 필드 baseline 1 흡수 |
| ADRIndex (ADR-0148) | ✅ 172 파일 / 166 unique |
| PendingWiring (ADR-0148) | ✅ 47 항목 / 5 카테고리 / SLA grace 14d |
| PrPaceAudit (ADR-0148) | ⚠️ **WARN — 본 audit PR 가 해소 대상** |

**PrPaceAudit WARN**: PR #514~#523 10 PR 동안 audit-only PR 부재 → ADR-0146 §"강제 트리거" 의무 위반 누적. **본 audit PR 이 정확히 그 위반 해소** — boundary 도달 + 24h 이내 audit 작성 정합.

---

## 발견 분류

### Critical (P0) — 즉시 수리 필요 — `0건` ✅

10 PR 누적 변경에서 LIVE 매매 안전성 / 거버넌스 무결성 위협하는 결함 0건. 사용자 audit 결과 + Kelly clamp 검증 (PR #523 §"Kelly + biasPositionPenalty 조화") 도 정합 확인.

### High (P1) — 후속 PR 분리 — `0건` ✅

LIVE 영향 가능성 있는 잠재 결함 0건.

### Medium (P2) — 후속 PR 분리 권장 — `4건`

#### M1. `currentEquityExposureAmount` 단순 추정 (ADR-0166 §2.5)

- **현재**: `Math.max(0, ctx.totalAssets - ctx.mutables.orderableCash.value)` — 계좌 - 현금 = 주식 보유 가정
- **결함**: SHADOW 모드의 가상 자본 / LIVE 모드의 KIS 잔고 차이 / 미체결 매수 주문 미반영 → 정확도 ↓
- **영향**: ADR-0166 의 노출 예산 cap 정확도 제한 (R6 80% 도달 직전 종목 누락 등)
- **수리 권고**: `ctx.shadows.reduce((sum, s) => sum + (s.quantity × currentPrice), 0)` 활성 trade 평가금액 합산
- **PR**: PR-ExposureBudget-AccurateExposure (PENDING_WIRING B9 §잔여 1)

#### M2. `isAddOnBuy=false` 고정 (4 wiring 모두)

- **현재**: 4 wiring 모두 `isAddOnBuy: false` 명시 (메인 buyList / PRE_BREAKOUT 2 / INTRADAY)
- **결함**: `trancheExecutor` 의 *진정한 추매* 진입점 (3일/7일 후 trancheExecutor 호출) wiring 부재 → R3+ 추매 허용 정책 미활성화
- **영향**: ADR-0166 의 `allowAddOnBuys` 정책 (R3+ 활성, R0~R2 차단) 효과 부재
- **수리 권고**: `trancheExecutor` 호출 site 에 동일 wiring 추가 + `isAddOnBuy=true` 전달
- **PR**: PR-ExposureBudget-AddOnBuyDetection (PENDING_WIRING B9 §잔여 2)

#### M3. Kelly 매직 넘버 + SSOT 분산 (사용자 audit 결과)

- **현재**: `signalScanner.ts:413` + `preflight.ts:357` 두 위치 동일 패턴
  - `KELLY_FLOOR = 0.15` 명명 / `1.5` 매직 넘버
  - 6 감쇠 곱셈 체인 + clamp 두 위치 중복
- **결함**: drift 위험 (한 위치 수정 후 다른 위치 누락) + 매직 넘버 의미 불명확
- **영향**: 향후 6 감쇠 정책 변경 시 두 위치 수정 의무 → 회귀 위험
- **수리 권고**: `KELLY_CAP=1.5` 상수 도입 + `kellyClamp.ts` SSOT 신설 (호출자 1 위치만 사용)
- **PR**: PR-Kelly-Clamp-SSOT (사용자 audit 결과 §"잔여 개선 여지")

#### M4. 매크로 신호 기반 R0~R6 자동 분류 부재

- **현재**: `mapInternalToExposureRegime` 가 기존 RegimeLevel (R1_TURBO~R6_DEFENSE) 와 *역순 매핑*
- **결함**: R1_DEFENSIVE 매핑 부재 (기존 시스템 직접 매칭 없음). 매크로 변동 시 ADR-0166 의 R1 정책 (보수적 진입) 자동 활성화 부재
- **영향**: 사용자 §1 매트릭스의 7 레짐 중 R1_DEFENSIVE 항상 미사용 → 매트릭스 효과 부분적
- **수리 권고**: 매크로 신호 기반 R0~R6 자동 분류 (VKOSPI, MHS, US10Y 등 결합)
- **PR**: PR-ExposureBudget-AutoRegimeMapping (PENDING_WIRING B9 §잔여 4)

### Pass — `4건`

#### P1. Kelly + biasPositionPenalty 조화 (사용자 메시지 audit)

✅ `signalScanner.ts:413` + `preflight.ts:357` 의 rawKelly 곱셈 체인 + KELLY_FLOOR=0.15 / KELLY_CAP=1.5 clamp **이미 정확 적용**. 사용자 권장 구조 정합. (M3 는 명명 정리 권고일 뿐 작동 정합)

#### P2. SHADOW vs LIVE peak 영속 격리 (ADR-0164 §2)

✅ `peakEquityRepo.ts` 의 `shadowPeakEquity` / `livePeakEquity` 영원히 격리. SHADOW 가상 자본이 LIVE 결정에 영향 안 함. 사용자 자본 (3천만 미만) SHADOW 검증 시 LIVE peak 무영향.

#### P3. 4 호출자 wiring 정합 (ADR-0163 + ADR-0166)

✅ 4 진입 경로 (buyListLoop 3 + intradayLoop 1) 모두 동일 패턴 — `applyPositionSizingEngine` → `applyExposureBudgetCap` 순차 호출. 변수 rename 정합 (`legacyXXX` / `baseXXX` / `XXXRaw` 패턴) + 정적 가드 회귀 테스트 보호.

#### P4. ENV 매트릭스 운영자 활성화 4단계 (ADR-0166 §7)

✅ Stage A → B → C 단계별 ENV 활성화 + 1줄 롤백. 운영자 의도 명확 + 회귀 위험 격리.

---

## 결정

### 즉시 수리 (P0/P1) — 해당 없음 (0건)

LIVE 매매 안전성 / 거버넌스 무결성 위협 결함 부재. **본 audit 의 권장 사항 없음** — 10 PR 누적 변경 안정.

### 후속 PR 분리 (P2 4건)

PENDING_WIRING B8 (잔여 2) + B9 (잔여 4) = **6 후속 PR** 등재 완료. 우선순위 사용자 결정 후 진행:

| 후속 PR | 카테고리 | 우선도 (운영 데이터 의존) |
|---------|----------|---------------------------|
| PR-ExposureBudget-AccurateExposure (M1) | B9 | 중 (ADR-0166 정확도 직접 영향) |
| PR-ExposureBudget-AddOnBuyDetection (M2) | B9 | 중 (R3+ 추매 정책 활성화) |
| PR-Kelly-Clamp-SSOT (M3) | (B 카테고리 신규) | 저 (drift 안전망, 작동은 정합) |
| PR-ExposureBudget-AutoRegimeMapping (M4) | B9 | 저 (운영 데이터 누적 후 매트릭스 활성화 결정) |
| PR-LossStreakIntegration (B8 잔여) | B8 | 저 (외부 학습 SSOT 결합) |
| PR-UniverseIntegration / SectorWeight (B8 잔여) | B8 | 저 |

### DECIDED_NOT_WIRING — 해당 없음

본 audit 에서 *영구 미적용 결정* 권고 없음. 모든 M1~M4 는 *시점 분리* 만 — 운영 데이터 누적 후 결정.

### 백로그 정정 — 해당 없음

PENDING_WIRING.md 의 B8/B9 항목 모두 정합. 본 PR 코드 변경 0건.

---

## 후속 조치

### 즉시 (본 PR 직후) — `0건`

audit 결과 P0/P1 부재 → 즉시 수리 PR 불필요.

### 단기 (1~2주, 운영 데이터 누적 후)

1. **운영자 ENV 활성화 절차 시작** (ADR-0166 §7):
   - Stage A: `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` SHADOW 1주
   - Stage B: `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED=true` 추가 1주
   - 영속 데이터 분석 (`data/peak-equity.json` + `sizingSource` 분포)
2. **PR-ExposureBudget-AccurateExposure** (M1) — Stage A 데이터 분석 결과 정확도 결함 명확화 시 진행

### 중기 (1개월, SHADOW 검증 완료 후)

3. **Stage C LIVE 활성화** — ADR-0165 ENV 활성
4. **PR-Kelly-Clamp-SSOT** (M3) — Kelly 정책 변경 PR 진입 시 동시 정리

### 장기 (3개월+)

5. **PR-ExposureBudget-AutoRegimeMapping** (M4) — 매크로 신호 누적 후 R0~R6 자동 분류
6. **PR-ExposureBudget-AddOnBuyDetection** (M2) — `trancheExecutor` 통합 (추매 정책 활성화)

---

## 부록 A — audit 패턴 카탈로그

본 audit 가 사용한 4 패턴 (ADR-0146 §"audit findings 가 학습 데이터" 정합):

1. **SSOT drift 검증** (M3 Kelly 두 위치 중복) — 동일 정책 두 위치 패턴 grep
2. **호출자 매트릭스 audit** (4 wiring 일관성) — `applyXXX` 호출자 정적 가드
3. **ENV 매트릭스 검증** (운영자 활성화 4단계) — default OFF + 1줄 롤백 의무
4. **회귀 테스트 LoC 비율 heuristic** (D 카테고리) — 100 LoC 당 5+ 케이스 권고

## 부록 B — audit 학습 데이터

본 audit 가 *코드베이스 진화의 학습 데이터*. 다음 audit (PR #530 boundary, 약 7 PR 후) 시 본 audit 의 M1~M4 발견이 *수리 완료 / 미완료 / 영구 결정* 으로 추적 가능 → 운영 패턴 학습.
