# ADR-0068: macroState stale 시 자동매매 진입 차단 + 24h+ BLOCK 정책

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0064 (marketOverview prefill overlay), ADR-0067 (boundary 가드), 후속 ADR-0070 (MarketDataHealthScore), 사용자 보고 PR-2 (USD/KRW 6개월 stale)

---

## 1. 배경

ADR-0067 (PR #4) 이 *공간* 차원에서 marketOverview ↔ 자동매매 격리를 강제했다.
본 ADR 은 *시간* 차원에서 macroState 데이터 노화를 차단한다.

### 1.1 사용자 보고 (PR-2)

> `/regime` 메시지에 USD/KRW 1,380 표시되지만 실제 환율 1,474 (-6.8% 격차, 6개월 stale 의심)

PR-2 는 `/health` `/regime` 메시지에 신선도 라인을 *표시* 하는 것까지만 했고, 실제
*자동매매 진입 차단* 은 후속 PR 로 분리됐다. 본 ADR 이 그 후속.

### 1.2 위험 시나리오

macroState cron 이 정지되거나 ECOS/FRED API 가 장기 down 되면 macroState 가 24h+
stale 상태로 진입한다. 이때:

- `getLiveRegime(macroState)` 가 6개월 전 환율로 R4_NEUTRAL 판정
- `evaluateGate0` 이 잘못된 VKOSPI/VIX 로 진입 신호 생성
- `evaluatePortfolioRisk` 가 잘못된 sector 가중치로 차단 미작동
- LIVE 주문이 실 시장 상황과 무관한 의사결정으로 발주

→ 거시 상황이 6개월 전과 완전히 다를 가능성 있음 (금리 변화·전쟁·블랙스완 등). 자동
매매 안전성을 위해 시간차원 가드 필요.

---

## 2. 결정

### 2.1 신규 모듈 — `server/trading/macroStaleness.ts`

`evaluateMacroStaleness(macro?, now?)` 순수 함수 SSOT. 4 tier 분류:

| Tier | 임계 | 진입 차단 | 운영자 알림 |
|------|------|-----------|-------------|
| `FRESH` | age ≤ 8h | ❌ | ❌ |
| `STALE_WARN` | 8h < age ≤ 24h | ❌ (허용) | ✅ |
| `STALE_BLOCK` | age > 24h | ✅ (차단) | ✅ CRITICAL |
| `NO_DATA` | updatedAt 부재/잘못된 ISO | ✅ (안전 차단) | ✅ CRITICAL |

`MacroStalenessResult` 인터페이스에 `shouldBlockEntry` / `shouldAlertOperator` /
`reason` (한국어) 노출 — 호출자(preflight)가 분기 결정.

### 2.2 환경변수 우회 SSOT

| ENV | 효과 | Default |
|-----|------|---------|
| `MACRO_STALENESS_DISABLED=true` | 모든 검사 무력화 (긴급 운영 우회) | `false` |
| `MACRO_STALE_WARN_HOURS=N` | WARN 임계 override | `8` |
| `MACRO_STALE_BLOCK_HOURS=N` | BLOCK 임계 override | `24` |

긴급 우회는 권장 안 함 — macroState cron 자체를 복구해야 진짜 해결.

### 2.3 preflight.ts wiring

`runPreflight()` 의 Step 4 (레짐 분류) 직후, Step 5 (SELL_ONLY 예외) 직전에 staleness
gate 추가:

```
if (staleness.shouldBlockEntry) {
  await sendTelegramAlert('🛑 [MacroState STALE_BLOCK] 자동매매 진입 차단 ...');
  await updateShadowResults(shadows, regime);
  saveShadowTrades(shadows);
  return { shouldAbort: true, abortReason: 'MACRO_STATE_STALE', sellOnly };
}
if (staleness.shouldAlertOperator && staleness.tier === 'STALE_WARN') {
  await sendTelegramAlert('⚠️ [MacroState 갱신 지연] 진입 허용·경보 ...');
}
```

R6_DEFENSE 게이트와 동일 패턴 (Telegram alert + shadow update + abort). `abortReason`
union 은 `string` 자유형이라 호환.

### 2.4 정책 우선순위

```
KIS_APP_KEY 미설정 (Step 1)
  → Manual 가드 / shadowMode 분기 (Step 2-3)
  → 레짐 분류 (Step 4)
  → MacroState staleness (Step 4.5) ← 본 ADR
  → SELL_ONLY 예외 (Step 5)
  → R6_DEFENSE (Step 6)
  → VIX (Step 7) / FOMC (Step 8) / Data starvation (Step 9) / Position full / Volume clock
```

staleness 게이트는 *레짐 분류 이후* 에 위치 — 레짐을 알아야 운영자에게 "현재 R4 로
판정됐지만 macroState 가 6개월 stale 이라 신뢰도 0" 같은 컨텍스트 전달 가능.

---

## 3. dryRunScanner 영향

`server/trading/dryRunScanner.ts:70` 도 `loadMacroState()` 사용. 운영자 진단 목적의
강제 트리거 (`/dryrun`) 라 본 ADR scope 외 — staleness 차단 미적용. 진단 시 stale
감지는 `evaluateMacroStaleness()` 를 직접 호출해 표시만.

후속 PR 에서 dryRunScanner 출력에 staleness tier 라인 추가 가능 (운영자 선택).

---

## 4. 후속 ADR

- **ADR-0070** (MarketDataHealthScore): macroState staleness 를 점수 0-100 기여 인자로
  통합 — `STALE_BLOCK` → -40점, `STALE_WARN` → -15점, `NO_DATA` → -50점.
- **fomcDayLiquidation.ts** 도 macroState 사용 (`loadMacroState() at L354`) — 본 ADR
  적용 검토 필요. FOMC DAY 청산은 시장 *방어* 액션이라 macroState stale 이라도 실행
  하는 것이 더 안전 (시장 진입이 아닌 보유 청산). 현재 미적용.

---

## 5. 회귀 위험

### 5.1 False positive 방어

- macroState cron 이 매 분 갱신되므로 정상 운영 환경에서 8h 임계 도달 거의 불가
- Railway 재배포 시 macroState 디스크 영속 → 재시작 후에도 신선도 유지
- 부팅 직후 macroState 가 default state (`updatedAt: new Date().toISOString()`) 로
  초기화되므로 첫 cron 갱신 전이라도 NO_DATA 분기 회피

### 5.2 False negative 방어

- updatedAt 잘못된 ISO → NO_DATA + 차단 (안전 fallback)
- macroState 인스턴스가 frozen (mtime 갱신 X) 인 경우 ageHoursRaw 정확 계산
- `MACRO_STALENESS_DISABLED` env 우회는 *명시적* 으로만 활성

### 5.3 boundary 정확성

`ageHoursRaw` (raw ms / 3_600_000) 와 `ageHours` (round 1 자리) 분리 — 비교는 raw,
표시는 round. 24h + 1초 도 정확히 STALE_BLOCK 분류 (회귀 테스트 검증).

---

## 6. 검증

- 회귀 테스트 22 케이스 — `server/trading/macroStaleness.test.ts`:
  - tier 5 분기 (FRESH / boundary / STALE_WARN / STALE_BLOCK / NO_DATA / USD/KRW 6개월 시나리오)
  - NO_DATA 안전 fallback 3 (null / 빈 ISO / 잘못된 ISO)
  - MACRO_STALENESS_DISABLED 우회 3
  - env 임계 override 3 (WARN / BLOCK / 잘못된 값 fallback)
  - formatStalenessTier 4 라벨
  - boundary millisecond 정확성 3
- preflight.ts lint pass (TypeScript + abortReason union)
- 자동매매 본체 0줄 변경 — preflight.ts 만 wiring 추가 (35줄)
