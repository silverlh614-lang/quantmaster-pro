# ADR-0028 — 갭/수익률 % 계산 단일 안전 헬퍼

## 상태
Accepted (2026-04-26, PR-53)

## 배경

ADR-0004 (Yahoo ADR 역산 폐기) 가 PKX/SSNLF/SKM 같은 OTC 저유동성 종목의
*수년 전 stale 종가* 가 "최신" 으로 반환돼 한국 종목 이론시가 역산이 -93.69%
로 출력되던 문제를 *해당 경로 한정* 으로 차단했다. 그러나 코드베이스 전반에는
`((current - base) / base) * 100` 패턴이 **78곳** 에 분산되어 있고, 각 호출자가
sanity bound·stale check·NaN/Infinity 가드를 *제각기 (또는 부재)* 적용하는
일관성 결함이 잔존.

사용자 보고: "역산갭 GDR 오류 발생 가능성. 안전한 계산 적용 (과거 데이터가
기준이 되서 -90% 가 넘는 상황도 있었음)."

### 현재 위험 경로 (audit 결과)

| 경로 | 가드 상태 |
|------|----------|
| `preMarketGapProbe.gapPct` | ✅ 30% SKIP_DATA_ERROR + 2영업일 stale check (PR-1) |
| `entryEngine.openGapPct` | ✅ `openGapPct < 30` 안전 분기 (Yahoo gap 30%+ 무시) |
| `marketDataRefresh.nDayReturn` | ❌ sanity 가드 부재 — KOSPI 매크로 지표가 망가지면 레짐 분류·자동매매 전체 영향 |
| `dxyMonitor.nDayPct` | ⚠️ `past <= 0` 만 가드 — stale 동일값 시 0% 반환은 안전하지만 sanity bound 부재 |
| `riskManager.shouldTakeProfit returnPct` | ❌ sanity 가드 부재 — currentPrice 이상값 시 가짜 익절 트리거 가능 |
| 기타 9개 returnPct/driftPct 호출자 | ❌ 대부분 sanity 가드 부재 |

## 결정

`server/utils/safePctChange.ts` 단일 헬퍼를 도입해 **모든 % 변화율 계산** 의
공통 SSOT 로 정착시킨다. 핵심 가드 5종을 한 곳에 집약:

1. **분모 가드**: `base ≤ 0` 또는 `!isFinite(base)` → `null`
2. **분자 가드**: `current < 0` (음수 가격) 또는 `!isFinite(current)` → `null`
3. **NaN/Infinity 가드**: 결과가 `!isFinite(result)` → `null`
4. **Sanity bound**: `|result| > sanityBoundPct` (default 90%) → `null` + 진단 로그
5. **호출자 컨텍스트**: `label?` 옵션으로 위반 발견 시 발생 위치 식별

```ts
safePctChange(current: number, base: number, opts?: {
  sanityBoundPct?: number;  // default 90
  label?: string;            // 진단 로그용
  silent?: boolean;          // sanity 위반 시 로그 출력 차단
}): number | null
```

## 적용 우선순위

### Phase 1 (본 PR — 4 경로)
1. **`marketDataRefresh.nDayReturn`** — KOSPI 매크로 지표. **최우선** (망가지면 레짐 분류 망가짐).
2. **`riskManager.shouldTakeProfit returnPct`** — 가짜 익절 트리거 차단.
3. **`dxyMonitor.nDayPct`** — DXY 변화율 sanity bound.
4. **`preMarketGapProbe.gapPct`** — SKIP_DATA_ERROR 30% 가드와 일관된 SSOT 정착 (행위 변경 없음).

### Phase 2 (후속 PR)
- `tradeReplacement.returnPct`, `exitEngine.returnPct`, `sell.cmd.returnPct`,
  `manualExitContext.returnPct`, `sectorEnergyProvider.returnPct`,
  `watchlistManager.driftPct`, `miniEvaluate.returnPct`, `stockScreener.return5d/20d`,
  `sectorEtfMomentum`, `killSwitch.vkospiPct` 등 9 경로

## 결과

- **단일 SSOT**: 새 호출자 추가 시 헬퍼만 사용하면 5종 가드 자동 적용
- **silent degradation 차단**: |%| > 90 발견 시 progressive 진단 로그 (1분 throttle)
- **null 대신 0 반환 차단**: stale 시 0% 변화로 "정상" 처리되던 회귀 위험 종결
- **호환성**: 기존 30% SKIP/4% gap 가드는 유지 — 본 헬퍼는 그 *위*의 sanity layer

## 비고

- sanity bound 90% 는 한국 주식의 일일 가격 제한(±30%)·환율(±10%)·지수(±15%) 모두 충분히 포함하면서 "stale 데이터" 만 명확히 거른다.
- 호출자 추가 marshaling 비용 0 — 기존 `((a-b)/b)*100` 한 줄을 헬퍼로 치환.
- Phase 2 는 `validate:responsibility` 스캔에 본 헬퍼 사용 검증 추가 후 점진 적용.
