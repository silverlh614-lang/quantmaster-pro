# ADR-0161 — Tier-Based Position Sizing Engine 도입 (인프라만, wiring 분리)

**상태**: Accepted (Phase 1 — 인프라 신설 + LIVE 매매 본체 0줄 변경)
**날짜**: 2026-05-02
**관련 PR**: PR-Sizing-Engine-Phase1 (`server/trading/sizing/` 8 파일 신설)
**SLA**: P0 21일 (Phase 2 wiring, 2026-05-23 만료)
**의존성**: ADR-0008 (Kelly Time Decay) / ADR-0036 (BudgetPolicy) / ADR-0080 (Capital-Weighted Slot Accounting) / ADR-0085 (Two-Bar + Slot Sizing)

## 1. 문제

기존 사이징 SSOT 가 *축 단위 분산* — `accountRiskBudget` (Kelly 1축) + `kellyHalfLife` (시간 감쇠) + `slotAccounting`/`slotSizing` (슬롯 점유) + `budgetPolicy` (BudgetPolicy override) + `sectorScoreBoost` (섹터 가산점) + `sizingTier` (신뢰도 티어) 등 *6+ 모듈* 이 각각 부분 결정. **계좌 규모별 (티어 6단계) × 7축 통합 결정 SSOT 부재**:

- 7축 = 신호등급 × 계좌규모 × 시장레짐 × 손절폭 × 드로우다운 × 유동성 × 포트폴리오집중도
- 사용자 사이징 정책 *MICRO 28% / SMALL 24% / GROWTH 18% / BALANCED 14% / DEFENSIVE 10% / CAPITAL_PRESERVATION 7%* 가 분산된 코드 흐름에서 *추적 불가능*
- 신규 진입 결정의 *최종 매수금액 단일 함수* 부재 — 호출자가 6+ 모듈 결과 합산을 직접 수행 (drift 위험 + 회귀 테스트 분산)

## 2. 결정 (Phase 1: 인프라만)

`server/trading/sizing/` 디렉토리 신설 + 8 파일 (accountSizeTiers / drawdownAdapter / coolingOffEngine / liquidityAndSectorGuard / tierMigrationDetector / positionSizingEngine / index + test). 단일 진입점 `computeFinalPosition(input): PositionSizingResult` — 7축 통합 + 11 단계 순서 (Universe → Drawdown → LossStreak → Liquidity → Sector → 곱셈 결합 → SignalBased → RiskBased → MaxCap → 신호 우선권 → 손절 손실 안전망).

**6 티어 × 신호등급 매트릭스 (사용자 정책 SSOT)**:
| 티어 | 자본 | BUY | STRONG_BUY | CONFIRMED | maxPos | maxStopLoss |
|------|------|-----|------------|-----------|--------|-------------|
| MICRO | 0~500만 | 12% | 20% | 28% | 30% | 2.0% |
| SMALL | 500만~1000만 | 10% | 17% | 24% | 25% | 1.7% |
| GROWTH | 1000만~3000만 | 8% | 12% | 18% | 20% | 1.5% |
| BALANCED | 3000만~1억 | 6% | 10% | 14% | 15% | 1.2% |
| DEFENSIVE | 1억~3억 | 4% | 7% | 10% | 12% | 1.0% |
| CAPITAL_PRESERVATION | 3억+ | 3% | 5% | 7% | 8% | 0.7% |

## 3. 기존 SSOT 와 책임 분리

본 모듈은 *기존 SSOT 교체 아님* — 7축 통합 결정 layer 추가. 현재 호출자 0건 (PENDING_WIRING B8 P0 SLA 21일).

| 기존 SSOT | 책임 | 본 모듈과 관계 |
|-----------|------|---------------|
| `accountRiskBudget.computeRiskAdjustedSize` (ADR-0008/0036) | Kelly + BudgetPolicy + Time Decay | Phase 2 wiring 시 *입력*: regimeMultiplier/confidenceMultiplier 산출 |
| `kellyHalfLife` (ADR-0008) | 시간 감쇠 | Phase 2 wiring 시 *입력*: confidenceMultiplier 산출 |
| `slotAccounting`/`slotSizing` (ADR-0080/0085) | 자본 가중 슬롯 점유 | 본 모듈과 *직교* — 슬롯 = "몇 종목" / 본 모듈 = "한 종목 얼마" |
| `budgetPolicy` (ADR-0036) | BudgetPolicy override | Phase 2 wiring 시 fractionalKelly 결합 검토 |
| `sectorScoreBoost` (ADR-0075/0153) | 섹터 가산점 | 본 모듈 sectorExposureMultiplier 와 직교 (가산점 = Gate Score / 본 모듈 = 비중 감쇄) |
| `sizingTier` (ADR-0031 SizingDecider) | 신뢰도 티어 (CONVICTION/STANDARD/PROBING) | Phase 2 wiring 시 결합 정책 결정 (어느 SSOT 가 최종 결정인가) |

**Phase 2 결정 사항** (별도 PR + ADR):
- A. 본 모듈을 *최종 SSOT* 로 격상 (기존 SSOT 결과를 본 모듈 input 으로만 사용)
- B. 본 모듈을 *병렬 결정* (기존 SSOT 와 동시 작동, min/max 결합)
- C. 본 모듈을 *대형 계좌 한정* (DEFENSIVE/CAPITAL_PRESERVATION 만 본 모듈, 나머지는 기존)

## 4. ENV 우회 (Phase 2 도입 예정)

Phase 2 wiring PR 에서 의무 도입:
- `POSITION_SIZING_ENGINE_DISABLED=true` — 본 SSOT 비활성, 기존 사이징 경로 100% 동작 (회귀 안전망)
- `POSITION_SIZING_ENGINE_SHADOW_ONLY=true` — SHADOW 모드만 활성, LIVE 는 기존 경로 (1주 검증 후 LIVE 활성화 결정)

Phase 1 (본 PR) 은 호출자 0건이라 ENV 우회 불필요 — 모듈 자체는 dead code 로 영속.

## 5. 회귀 테스트

20 케이스 (`positionSizingEngine.test.ts`):
- 12 사용자 명시 핵심 시나리오 (TC1~TC12) — 6 티어 × 신호등급 + 3연속/5연속 손절 냉각 + 유동성 사용률 + RRR=0/regime=0 차단
- 6 티어 경계값 (499만 → MICRO / 500만 → SMALL / 1000만 → GROWTH / 3000만 → BALANCED / 1억 → DEFENSIVE / 3억 → CAPITAL_PRESERVATION)
- 2 섹터 감쇄 경계 (15% 감액 없음 / 30% 차단)

## 6. 운영 효과

**Phase 1 (본 PR)**: 호출자 0건 — LIVE 매매 영향 0. 7축 통합 결정 SSOT *모듈 단위* 정착으로 Phase 2 wiring 시 *결정 추적 가능* + 회귀 테스트 단일 위치 + 사용자 정책 6 티어 매트릭스 표면화.

**Phase 2 (P0 SLA 21일, 2026-05-23 만료)**: signalScanner / autoTradeEngine 의 사이징 결정 경로 wiring + ENV 우회 의무 + SHADOW 1주 검증.

## 7. 잘못된 해결 방법 (영구 차단)

- ❌ 본 모듈을 기존 SSOT *교체* — 기존 SSOT 6+ 모듈의 누적 운영 검증 손실. ADR-0008/0036/0080/0085 폐기 필요.
- ❌ 호출자 wiring 을 본 PR 에 통합 — LIVE 매매 본체 변경 + ENV 우회 부재 = ADR-0160 (commit 2258621 retrofit) 동일 결함 재발.
- ❌ 본 모듈의 7축 결합 공식을 기존 SSOT 에 *흡수* — 책임 분산 + drift 위험 + 회귀 테스트 분산.

## 8. 잔여 후속 PR

- **PR-Sizing-Engine-Phase2** (P0 SLA 21일): wiring 정책 결정 (옵션 A/B/C) + 호출자 wiring + ENV 우회 + SHADOW 검증 메트릭 정의
- ENV 우회 활성화 후 1주 SHADOW 모드에서 기존 SSOT 결정 vs 본 모듈 결정 *비교 로그* 누적 → LIVE 활성화 결정
- `tierMigrationDetector` 호출자 wiring (nightlyReflectionEngine 또는 부팅 시점, P1 별도 ADR)
