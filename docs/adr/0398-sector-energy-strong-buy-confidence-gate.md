# ADR-0398 — UI Language SSOT + STRONG_BUY Confidence Gate

**상태**: Accepted (2026-05-06)

**의도된 정책 명칭**: ADR-0373 — UI Language SSOT + STRONG_BUY Confidence Gate (사용자 명시, 실제 발급 0398 — INDEX.md `다음 발급` SSOT 정합, ADR-0148 발급 룰 준수)

**관련 ADR**:
- ADR-0396 (= 사용자 명시 ADR-0371) — sourceTier/freshness/coverage/confidence 4-axis 분리 SSOT (직접 전제)
- ADR-0397 (= 사용자 명시 ADR-0372) — Yahoo ETF L4 + dataQuality='DEGRADED' 강제 정책 (직접 전제)
- ADR-0094 — UI Language SSOT (uiLanguageRegistry, useUILang 훅, scripts/check_ui_language.js)
- ADR-0125 — sectorEnergy dataQuality 단일 라벨

## 배경

### 핵심 정책 — 보조 신호로서의 sectorEnergy

사용자 명시 정책 (ADR-0373) 직접 반영:

> 섹터에너지가 약하다고 매수를 막는 게 아니라, 섹터에너지 신뢰도가 낮으면 **최고 등급 승격을 막는** 구조.

**일반 BUY 차단 금지** — 섹터에너지는 보조 신호. 개별 종목 수급/기술/펀더멘털이 좋으면 BUY 가능.

### STRONG_BUY 차단 정책 SSOT (4 조건 OR)

```typescript
forbidStrongBuy =
  sectorEnergy.confidence < 0.6 ||
  sectorEnergy.dataQuality === 'DEGRADED' ||
  sectorEnergy.dataQuality === 'FAILED' ||
  sectorEnergy.sourceTier === 'YAHOO_ETF';
```

### UI 문구 SSOT — `uiLanguageRegistry` 갱신 (ADR-0094 정합)

기존 `UI_LANG` 7 카테고리 (nav/card/tier/regime/gate/empty/action) 위에 **`sectorEnergy` 8번째 카테고리 신규 추가**:

```typescript
sectorEnergy: {
  BOOST_DISABLED: '섹터 가산점 미적용',
  DEGRADED: '섹터 신호 저신뢰, STRONG BUY 승격 제한',
  FAILED: '섹터 신호 사용 불가, 개별 종목 판단만 사용',
  YAHOO_ETF: '해외 ETF 프록시 기반 보조 신호, 고신뢰 아님',
  STALE: '섹터 신호 지연 데이터, fallback 진행 중',
  PARTIAL: '섹터 신호 부분 수신',
  OK: '섹터 신호 정상',
}
```

## 결정

### 1. `sectorEnergyStrongBuyGate.ts` SSOT 신설

신규 모듈 — ADR-0396 4-axis 결과 + ADR-0397 sourceTier 입력 → STRONG_BUY 차단 결정.

```typescript
export interface StrongBuyGateInput {
  confidence: number;
  dataQuality: SectorEnergyDataQuality5;
  sourceTier: SectorEnergySourceTier;
}

export interface StrongBuyGateResult {
  forbidStrongBuy: boolean;
  reasons: string[]; // 차단 사유 카탈로그 (ADR 추적성)
}

export function evaluateSectorEnergyStrongBuyGate(
  input: StrongBuyGateInput,
): StrongBuyGateResult;
```

### 2. 차단 임계값 SSOT (사용자 명시 절대 변경 금지)

```
CONFIDENCE_GATE_THRESHOLD = 0.6
```

### 3. 차단 사유 reasons 라벨 (UI 표시용)

```
'confidence < 0.6 (저신뢰)'
'dataQuality=DEGRADED (심각한 부족)'
'dataQuality=FAILED (산출 불가)'
'sourceTier=YAHOO_ETF (해외 ETF 프록시 보조 신호)'
```

여러 사유 동시 충족 시 `reasons[]` 모두 포함 — 운영자 진단 정확성.

### 4. `/sector_energy_diag` 텔레그램 명령 신규

- **명령**: `/sector_energy_diag` (alias `/sed` / `/sector_diag`)
- **카테고리**: SYS, riskLevel=0, ADMIN, read-only
- **출력 5 필드**: sourceTier / freshness / coverage / confidence / dataQuality
- **추가 출력**: forbidStrongBuy 여부 + 차단 사유 (ADR-0398 SSOT 호출)
- **마커**: 5단계 dataQuality 별 이모지 (✅ OK / 🟡 PARTIAL / 🟠 STALE / 🔶 DEGRADED / ❌ FAILED)

### 5. ENV 우회

```
SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true (default OFF)
```

- 정확 비교 (ADR-0157 정합)
- 활성화 시 즉시 STRONG_BUY 게이트 비활성 → ADR-0397 동작 100% 복원 (회귀 1줄 즉시 롤백)
- `isSectorEnergyStrongBuyGateDisabled()` 헬퍼 SSOT 위임 (ADR-0185~0189 정합)

### 6. 호출자 0건 (Phase 1 dead code)

본 PR scope = SSOT 모듈 + UI 문구 + 진단 명령. **실제 매매 결정 wiring 0건** — 호출자 통합은 후속 PR 분리 (회귀 위험 격리). 사용자 명시 *"섹터에너지가 약하다고 매수를 막는 게 아니라 최고 등급 승격을 막는"* 정책 직접 적용 시 signalScanner Gate Score 산출 직후 wiring 필요 — 별도 ADR + 별도 PR.

## 안전 invariant (절대 변경 금지)

1. **LIVE 매매 본체 0줄 변경** — signalScanner/entryEngine/exitEngine/orchestrator/autoTradeEngine 본체 무수정.
2. **KIS 주문 함수 5종 import 0건** — 정적 grep 가드 회귀 테스트 의무.
3. **호출자 0건 (Phase 1 dead code)** — 실제 매매 결정 wiring 후속 PR 분리.
4. **일반 BUY 차단 금지** — 사용자 명시 정책 (섹터에너지는 보조 신호).
5. **4 조건 OR SSOT 절대 변경 금지** — confidence<0.6 / dataQuality∈{DEGRADED,FAILED} / sourceTier='YAHOO_ETF'.
6. **호출자 측 inline ENV 검사 0건** — SSOT 위임 (ADR-0185~0189 정합).
7. **UI 문구 SSOT 정합** — sectorEnergy 8번째 카테고리 ADR-0094 패턴 준수.

## 잘못된 해결 방법 (영구 차단)

1. **일반 BUY 차단** — 사용자 명시 정책 위배 (섹터에너지는 보조).
2. **4 조건 OR 임계값 변경** — 사용자 명시 SSOT 위배.
3. **호출자 측 inline 산출** — drift 위험 (SSOT 단일 진입점).
4. **`/sector_energy_diag` 명령에 manual override 트리거** — read-only 진단 정합 위배.
5. **ENV default ON** — 운영자 결정 위임 (사용자 SHADOW only 운영 정합).
6. **UI 문구 한국어 외 다른 언어 추가** — ADR-0094 한국어 SSOT 정합 위배 (KO/EN 토글은 useUILang 훅 격상 후속 PR).
7. **호출자 wiring 본 PR 통합** — 회귀 위험 격리 위배.

## 검증

- vitest **신규 ≥10 케이스** (heuristic 5/100 LoC 충족) — 4 조건 OR boundary + reasons 라벨 + ENV gate + /sector_energy_diag 명령 + UI 문구 SSOT.
- `npm run lint` EXIT=0 (변경 파일 자체).
- `npm run validate:all` 16종 baseline 무회귀.
- vitest 영향 영역 무회귀.
- `ALLOW_DEPLOY_WINDOW=1 npm run precommit` EXIT=0.

## 후속 PR (scope 외)

- **호출자 wiring** — signalScanner Gate Score 산출 직후 `evaluateSectorEnergyStrongBuyGate(...)` 호출 + STRONG_BUY 등급 분기 적용. 별도 ADR + 별도 PR (회귀 위험 격리).
- **KO/EN 토글** — `useUILang` 훅 다국어 지원 격상 (별도 ADR).
- **/sector_energy_diag 명령에 4-axis 시계열 표시** — macroState 영속 시계열 추가 후 별도 PR.
