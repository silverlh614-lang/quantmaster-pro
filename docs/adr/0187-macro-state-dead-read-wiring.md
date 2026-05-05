# ADR-0187: macroState dead-read 2 필드 wiring (sectorEnergyValidSectorCount + mhsAxisUpdatedAt)

## 1. 배경

사용자 요청 *"macroState 영속 직접 점검"* 후속 분석. `validate:silentDegradation` 정적 검증으로 62 옵셔널 필드 reader/writer 매트릭스 추출 결과:

- **silent degradation 0건** (ADR-0148 baseline 정합 회복 유지)
- **Reader 0건 — 영속만 되고 read 누락 2건**:
  - `sectorEnergyValidSectorCount` (L92, writer: `marketDataRefresh.ts:811`) — ADR-0125 도입 시 `/scan_blockers` 진단용으로 영속, 실제 메시지에서 read 누락
  - `mhsAxisUpdatedAt` (L103, writer: `marketDataRefresh.ts:823`) — ADR-0107 MHS axis 분해 도입 시 `/regime` 신선도 표시용으로 영속, `formatMhsAxisLine` 갱신 시각 read 누락

**진단 결과**: `silent degradation` 자체는 부재 (Writer ≥1 + Reader 분기 표면적으로 존재 — `formatScanBlockersMessage:276-278` 의 `summary.validSectorCount` 가 *별도 ScanSummary 필드*) 하지만 carry-over chain 미완 — `runAutoSignalScan` 의 `persistScanResults` 호출 site (`signalScanner/index.ts`) 에서 `macroState.sectorEnergy*` 3 필드를 ScanSummary 로 carry-over 하는 wiring 부재 → 운영자 `/scan_blockers` 명령 시 §"섹터 에너지 데이터 품질" 섹션이 *영원히 미노출*. `mhsAxisUpdatedAt` 도 동일 패턴 — `formatMhsAxisLine` 시그니처에 `mhsAxisUpdatedAt` 미수신.

### 영향 범위
- 운영 안전성: **0** (read 누락은 *진단 가시성* 결함, LIVE 매매 의사결정 무영향).
- 진단 가시성: 운영자가 `/scan_blockers` 호출 시 sectorEnergy dataQuality (ADR-0125 도입) 가 보이지 않음. `/regime` 의 mhsAxis 라인이 *언제 갱신됐는지* 표기 부재 — cron 미실행 시점 인지 지연 가능.

## 2. 결정

**옵션 C 채택** — 두 dead-read 동시 wiring (단일 PR, 도메인 다르지만 동일 결함 패턴).

### Wiring 1 — `sectorEnergyValidSectorCount` carry-over

**위치**: `server/trading/signalScanner/index.ts` `runAutoSignalScan`

**변경**: `persistScanResults` 호출 (정상 경로 L67~ + abort 경로 L42~) 직전에 `preflightResult.context.macroState` 에서 3 필드 (`sectorEnergyDataQuality` / `sectorEnergyValidSectorCount` / `sectorEnergyReasons`) 추출 후 `PersistScanResultsOptions` 의 동등 필드 (`sectorEnergyQuality` / `validSectorCount` / `sectorEnergyReasons`) 로 매핑 spread.

**가드**: `sectorEnergyDataQuality !== undefined` 시에만 carry-over (macroState 부재 시 후방호환 skip).

### Wiring 2 — `mhsAxisUpdatedAt` 신선도 suffix

**위치**: `server/telegram/commands/system/regime.cmd.ts` `formatMhsAxisLine`

**변경**: 시그니처에 `mhsAxisUpdatedAt?: string` 옵셔널 + `now: Date = new Date()` 인자 추가. `mhsAxis` 라인 끝에 신선도 suffix 부착:
- `ageHours < 1` → ` · 갱신 Nm 전`
- `ageHours 1~23` → ` · 갱신 Nh 전`
- `ageHours ≥ 24` → ` · 갱신 N일 전 ⚠️ STALE`

**가드 4종**: `mhsAxisUpdatedAt` 부재 / 잘못된 ISO (`Number.isFinite` 검증) / 음수 ageMs (미래 시각) / `mhsAxis` 부재 (suffix 무관) — 모두 base 라인 또는 N/A 안내 fallback.

## 3. 회귀 테스트 12 신규

- `regimeMhsAxis.test.ts +7`: suffix 부재 후방호환 / 30m / 5h / 30h STALE / 잘못된 ISO / 미래 시각 / mhsAxis 부재 + updatedAt 무시
- `scanIndexAdr0187Wiring.test.ts` 7: 정적 grep 가드 — sectorEnergyDataQuality / validSectorCount / reasons 매핑 / abort 경로 / undefined 가드 / ADR 주석 / persistScanResults 호출 수 2 정확

## 4. 안전 invariant 6종 (절대 규칙)

1. **LIVE 매매 본체 0줄 변경** — 진단 가시성 격상만, 의사결정/주문 무관.
2. **KIS/KRX 주문 함수 import 0건** — read-only carry-over 만.
3. **byte-equivalent 후방호환** — `formatMhsAxisLine` 시그니처 옵셔널 인자 + macroState 부재 시 spread skip.
4. **회귀 테스트 정적 가드** — wiring 누락 자동 차단 (drift 영구 차단).
5. **ENV 우회 0건** — 진단 가시성 결함이라 ENV gate 부적합 (운영자 결정 위임 영역 아님).
6. **단일 진입점** — `preflightResult.context.macroState` 단일 read, 다른 macroState 영속 read 추가 0건.

## 5. 잘못된 해결 방법 영구 차단

1. **`marketDataRefresh.ts` 본체 변경** — 영속 wiring 은 정상, read chain 만 결함.
2. **macroState schema 변경** — 영속 필드는 정확히 영속 중. carry-over chain 만 누락.
3. **별도 endpoint 추가** — 기존 `/scan_blockers` + `/regime` 내부 wiring 만으로 충분.
4. **`mhsAxisUpdatedAt` writer 추가 변경** — writer 1건 (`marketDataRefresh.ts:823`) 정상.
5. **신선도 임계 ENV 도입** — 24h STALE 임계는 운영 상식 정합, 향후 운영 데이터 누적 후 조정 검토.

## 6. 거버넌스 정합

- ADR-0146 PR 자가 review 5 카테고리 모두 PASS (LIVE 안전성 / wiring vs 인프라 / ADR 발급 / 회귀 테스트 / 정책 위반).
- ADR-0148 4 정적 검증 baseline 무회귀 (adrIndex 196 unique / pendingWiring / silentDegradation 0건 유지 / prPaceAudit).
- ADR-0157 `now` injection 패턴 차용 (`formatMhsAxisLine(macro, now=new Date())`) — 시간 의존 회귀 테스트 격리.
- PENDING_WIRING.md 등재 **불필요** — silent degradation 자체는 부재 (Writer ≥1) + dead-read 는 운영 안전성 결함 아님 + 본 PR 으로 즉시 종결.

## 7. 운영 효과

- 운영자 `/scan_blockers` 명령 시 §"섹터 에너지 데이터 품질" 섹션 노출 (`✅ OK / 🟡 PARTIAL / 🟠 STALE / ❌ FAILED` + `validSectorCount: N/12` + reasons Top 3).
- 운영자 `/regime` 명령 시 MHS axis 라인 끝에 신선도 suffix — cron 미실행 (≥24h) 시 ⚠️ STALE 마커 즉시 인지.
- `marketDataRefresh` 영속 자산 사용도 격상 — ADR-0125 (sectorEnergy data quality) + ADR-0107 (MHS axis) 의도된 효과 첫 활성화.
