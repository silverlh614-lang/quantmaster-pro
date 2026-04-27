# ADR-0074 — `/regime` 메시지에 매매 레짐(R1~R6) 라인 추가

## Status
Accepted (2026-04-27)

## Context

사용자 운영 보고 (2026-04-27): "거시 regime 정보에 대한 신뢰도가 떨어진다."

기존 `/regime` 메시지 구조:
```
🌐 [매크로 레짐 현황]
━━━━━━━━━━━━━━━━
🟢 MHS: 65
🟢 레짐: GREEN     ← macroState.regime (GREEN/YELLOW/RED 단순 분류)
📊 VKOSPI: 18.2
📊 VIX: 16.5
💱 USD/KRW: 1,472 (Yahoo)
...
```

**갭**: 매매 결정에 실제 사용되는 `getLiveRegime()` 의 `RegimeLevel` (R1_TURBO~R6_DEFENSE) 가 미노출. 두 SSOT 가 메시지에서 충돌:

- `macroState.regime`: GREEN/YELLOW/RED — 단순 표시용
- `getLiveRegime(macroState)`: R1~R6 — 실제 매매 정책 (Kelly 배율 / 최대 포지션 / 허용 신호 / 손절 임계 모두 결정)

운영자가 "지금 매매가 왜 안 되지?" 같은 질문에 메시지만 보고 답을 받기 불가능 — `regime: GREEN` 인데 실제로는 `R6_DEFENSE` (강제 다운그레이드 활성) 인 경우 모순적 인지.

## Decision

`/regime` 메시지에 **매매 레짐 라인 1줄 추가**:

```
🌐 [매크로 레짐 현황]
━━━━━━━━━━━━━━━━
🟢 MHS: 65
🟢 매크로: GREEN                              ← 단순 분류 (기존)
🟢 매매: R2_BULL (Kelly ×0.80, 최대 6포지션)  ← NEW
📊 VKOSPI: 18.2
...
```

### 이모지 SSOT (방어 → 공격)

| RegimeLevel | 이모지 | 의미 |
|-------------|:------:|------|
| R6_DEFENSE | 🛑 | 매수 전면 차단 |
| R5_CAUTION | 🟡 | CONFIRMED_STRONG_BUY 전용 |
| R4_NEUTRAL | 🟠 | 선택적 진입 |
| R3_EARLY | 🌱 | 선취매 (선행 신호) |
| R2_BULL | 🟢 | 적극 매수 |
| R1_TURBO | 🔥 | 공격 MAX |

### 표시 정책 분기

- **`kellyMultiplier === 0`** (R6_DEFENSE) → "신규 진입 차단" 표기 (Kelly 0 표기 대신 명확한 의미)
- **그 외** → `Kelly ×0.XX, 최대 N포지션` 표기
- **REGIME_CONFIGS 미정의** → `⚙️ 매매: ${liveRegime}` fallback (방어적)

## Effects

### 즉시 효과

- **운영자 의사결정 신뢰도 격상**: "왜 매매 안 되지?" → 1메시지에서 즉시 답
- **두 SSOT 충돌 가시화**: GREEN + R6_DEFENSE 같은 모순 시 운영자가 즉시 인지 (아이디어 7 강제 다운그레이드 / 학습 자동 강등 등)
- **PR-1 (Entry Circuit Breaker) 보완**: 보호 발동 시 `R5_CAUTION` 으로 매매 정책 보수화 결과를 메시지에서 확인 가능

### Negative
- 메시지 1줄 추가 — 모바일 화면 1줄 추가 점유 (수용 가능)
- REGIME_CONFIGS / getLiveRegime / RegimeLevel import 추가 — 클라이언트 ↔ 서버 직접 import (절대 규칙 #3) 영향 *없음* — 서버 → 서버 import 만

### Neutral
- LIVE 매매 본체 0줄 변경 — 메시지 빌더만 수정
- ADR-0071 USD/KRW 라인 + ADR-0061 freshness 라인과 동일 패턴 (formatXxxLine SSOT 헬퍼)

## Implementation

- `server/telegram/commands/system/regime.cmd.ts` — `formatLiveRegimeLine(liveRegime)` SSOT 헬퍼 추가 + 메시지 빌더에 라인 삽입
- `getLiveRegime()` (regimeBridge) + `REGIME_CONFIGS` (regimeEngine) import
- 회귀 테스트 — 6 RegimeLevel 모두 검증 + REGIME_CONFIGS 미정의 fallback + Kelly 0 분기

## References

- 사용자 운영 보고 (2026-04-27): "거시 regime 정보 신뢰도 하락"
- ADR-0008: kellyMultiplier wiring
- ADR-0007: 강제 다운그레이드 (isForcedRegimeDowngradeActive)
- ADR-0071: USD/KRW dual-source (formatUsdKrwLine 패턴 차용)
- ADR-0061 §PR-2: freshness 라인 (formatRegimeFreshnessLine 패턴 차용)
