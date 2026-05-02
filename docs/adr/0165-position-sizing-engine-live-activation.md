# ADR-0165 — Phase 3: LIVE 활성화 ENV 도입 (`POSITION_SIZING_ENGINE_LIVE_ENABLED`)

**상태**: Accepted (Phase 3 LIVE Activation — ENV 기반 동적 활성화, default OFF)
**날짜**: 2026-05-02
**관련 PR**: PR-Sizing-Phase3-LiveActivation
**의존성**: ADR-0161 (Phase 1 인프라) / ADR-0162 (Phase 2-D SHADOW wiring) / ADR-0163 (3 경로 확장) / ADR-0164 (peakEquity 영속)
**SLA 충족**: ADR-0162 §"운영자 활성화 절차" §"Phase3 LIVE Activation P0 SLA 만기 2026-05-23" 정합

## 1. 문제

ADR-0162~0164 가 SHADOW only 동작 — `isLivePositionSizingEngineEnabled()` 가 *영원히 false* 하드코딩 (ADR-0162 §"잘못된 해결 방법" 영구 차단 가정). LIVE 매매 본체는 본 모듈 영향 0 → 사용자 실제 자본 (LIVE 시 재확인) 의 6 티어 매트릭스 정확 적용 부재.

운영자가 SHADOW 1주 검증 후 LIVE 활성화 결정해도 *코드 변경 없이* 활성화할 경로 부재.

## 2. 결정

`isLivePositionSizingEngineEnabled()` 함수를 **ENV 기반 동적 결정** 으로 변경:

```typescript
export function isLivePositionSizingEngineEnabled(): boolean {
  return process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED === 'true';
}
```

default OFF — 운영자가 SHADOW 1주 검증 후 명시 활성화 의무.

### 2.1 활성화 매트릭스

| 모드 | SHADOW APPLY ENV | LIVE ENABLED ENV | 본 모듈 활성 | peakMode |
|------|------------------|------------------|--------------|----------|
| SHADOW | OFF (default) | * | ❌ | - |
| SHADOW | **ON** | * | ✅ | SHADOW |
| LIVE | * | OFF (default) | ❌ (LIVE_MODE skip) | - |
| LIVE | * | **ON** | ✅ (ADR-0165 신규) | LIVE |

**LIVE only 모드 부재** — LIVE ENV 활성 시 SHADOW APPLY ENV 무관 (LIVE 활성화는 SHADOW 검증 완료 후 결정). 두 ENV 동시 활성도 정상 (각 모드별 독립 적용).

### 2.2 mode 자동 결정 — peakEquity 격리

`applyPositionSizingEngine` 진입부에서 `peakEquityMode` 자동 결정:
```typescript
const peakMode = ctx.peakEquityMode ?? (shadowMode ? 'SHADOW' : 'LIVE');
```

- 호출자 명시 전달 (`ctx.peakEquityMode`) 우선
- 미전달 시 `shadowMode` 기반 자동 (SHADOW vs LIVE 격리 보장)

이후 `mapToPositionSizingInput(ctx)` 호출 시 `ctx` 에 결정된 `peakEquityMode` 주입 → SHADOW/LIVE peak 영속 영원히 격리.

### 2.3 4 호출자 변경 0건

ADR-0163 의 4 wiring (buyListLoop 3 + intradayLoop 1) 모두 `applyPositionSizingEngine(stockShadowMode, ctx)` 형식 — `peakEquityMode` 미전달. 본 PR 의 자동 결정 로직이 `shadowMode=false` 시 자동으로 `'LIVE'` 매핑 → **호출자 코드 변경 0**.

호출자 매트릭스:
- buyListLoop 메인 (`buyListLoop.ts:1031`) — `applyPositionSizingEngine(stockShadowMode, ctx)`
- buyListLoop PRE_BREAKOUT_FOLLOWTHROUGH (`buyListLoop.ts:354`) — `applyPositionSizingEngine(ctx.shadowMode, ctx)`
- buyListLoop PRE_BREAKOUT 30% (`buyListLoop.ts:524`) — `applyPositionSizingEngine(ctx.shadowMode, ctx)`
- intradayLoop INTRADAY_STRONG (`intradayLoop.ts:112`) — `applyPositionSizingEngine(ctx.shadowMode, ctx)`

## 3. ENV 우회

| ENV | Default | 효과 |
|-----|---------|------|
| `POSITION_SIZING_ENGINE_SHADOW_APPLY` | OFF | `=true` 시 SHADOW 모드 활성 (ADR-0162 그대로) |
| **`POSITION_SIZING_ENGINE_LIVE_ENABLED`** | **OFF** | **`=true` 시 LIVE 모드 활성 (ADR-0165 신규)** |

운영자 LIVE 활성화 절차:
1. PR #521 (Drawdown) + 본 PR 머지 후 SHADOW 모드 1주 검증
2. `data/peak-equity.json` SHADOW 영속 분석 + `sizingSource='NEW_TIER_ENGINE'` trade 분포 + drawdown multiplier 활성 빈도 확인
3. `AUTO_TRADE_MODE=LIVE` + `POSITION_SIZING_ENGINE_LIVE_ENABLED=true` 동시 설정
4. LIVE 매매에서 본 모듈 결정 사용 + LIVE peak 자동 영속 갱신
5. 만족 시 운영 유지, 문제 시 ENV `=false` 즉시 비활성화 (롤백 1줄)

## 4. LIVE 매매 영향 (의도된 변경)

본 PR 은 *의도된 LIVE 매매 본체 변경* — 다음 4 영역:

1. **LIVE ENV 활성 시** `applyPositionSizingEngine` 가 LIVE 모드에서도 본 모듈 결정 사용 → `quantity` 가 본 모듈 결과로 *override* (이전엔 항상 legacy SSOT)
2. **LIVE ENV 활성 시** `livePeakEquity` 자동 갱신 + 영속 (`data/peak-equity.json`)
3. **LIVE ENV 활성 시** drawdown multiplier (-10/-15/-25/-30%) LIVE 매매에 적용
4. **LIVE ENV 활성 시** `sizingSource='NEW_TIER_ENGINE'` 영속 marker LIVE trade 에 부착

**LIVE ENV OFF 시 (default)** 영향 0 — ADR-0162 동작 100% 보존:
- `shouldApplyPositionSizingEngine(false)` → `false` (LIVE 활성화 ENV 미설정)
- `applied=false` + `skipReason='LIVE_MODE'` → legacy quantity 사용

## 5. 회귀 테스트

`positionSizingEngineWiringPhase3.test.ts` 24 케이스:
- isLivePositionSizingEngineEnabled 5 (default false / true / 'false' / '1' / 'TRUE' 정확히 'true' 만)
- shouldApplyPositionSizingEngine LIVE 분기 6 (4 매트릭스 + LIVE only 2 분기)
- applyPositionSizingEngine LIVE 적용 6 (LIVE ENV ON 활성 / OFF skip / LIVE peak 자동 영속 / SHADOW 격리 / 역격리 / drawdown 적용)
- mapToPositionSizingInput peakEquityMode 자동 2 (LIVE 명시 / SHADOW default)
- 4 진입 경로 공용 3 (LIVE 활성 + 4 호출자 / INTRADAY rrr=0 BLOCKED / 두 ENV 동시 ON)
- 회귀 격리 2 (SHADOW only / 두 ENV OFF default 보존)

기존 `positionSizingEngineWiring.test.ts` 정합 정정 (3 케이스):
- "LIVE 활성화 영구 차단" describe 블록 → "ADR-0165 ENV 동적 결정 (default OFF)"
- 기존 영구 false 가정 → default OFF 검증 + LIVE_ENABLED ENV 활성 분기는 Phase3 테스트로 위임

## 6. 잘못된 해결 방법 (영구 차단)

- ❌ ADR-0162 §"잘못된 해결 방법" 의 *영원히 false 하드코딩* 유지 — LIVE 활성화 경로 영구 부재. **ENV 기반 동적 결정으로 운영자 결정 위임**.
- ❌ LIVE only 모드 신설 (LIVE ENV ON + SHADOW ENV 무관) 거부 — 두 모드 분리 매트릭스 복잡도 ↑. **LIVE ENV 활성 시 두 모드 모두 활성** 정합.
- ❌ 호출자 (4 wiring) 측 명시 `peakEquityMode` 전달 의무 — 4 곳 drift 위험. **자동 결정** 이 단일 SSOT.
- ❌ LIVE 활성화 시 SHADOW peak 사용 — 가상/실제 자본 영속 오염. **SHADOW vs LIVE 영속 영원히 격리** (ADR-0164 §2 정합).

## 7. 운영 효과 (ENV 활성화 후)

- 사용자 실제 자본 (LIVE 시 재확인, 3천만 미만 GROWTH 티어 예상) 의 정확한 6 티어 매트릭스 적용
- LIVE 매매에서 drawdown 자동 차단 (-30% BLOCKED) 활성화 — 치명적 손실 방어
- LIVE peak 자동 영속 → `data/peak-equity.json` 의 `livePeakEquity` 추적 → 운영자 LIVE 자본 곡선 분석
- `[PeakEquity] LIVE peak 갱신 → ...원` 진단 로그
- 문제 발생 시 ENV `=false` 1줄로 즉시 롤백 (코드 변경 없이)

## 8. 잔여 후속 PR (PENDING_WIRING B8 P0 완료, 잔여 2)

본 PR 후 B8 P0 완료 — Phase 3 LIVE Activation SLA 만기 (2026-05-23) 충족.

잔여 (P1/P2):
- **PR-LossStreakIntegration** — 외부 학습 SSOT 와 본 모듈 `LossStreakState` 연결 (현재 default 0건)
- **PR-UniverseIntegration / PR-SectorWeightIntegration** — `preScreenStocks` / `sectorPreGuard` 결과 ctx 노출

## 9. SLA 충족 명시

ADR-0162 §"잔여 후속 PR" §"Phase3 LIVE Activation P0 SLA 만기 2026-05-23" 정합. 본 PR 머지 (2026-05-02) → 만기 21일 전 충족 → PENDING_WIRING B8 P0 항목 정식 완료.
