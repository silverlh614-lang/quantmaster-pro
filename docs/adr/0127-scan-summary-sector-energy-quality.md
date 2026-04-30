# ADR-0127: ScanSummary sectorEnergyQuality 표시 + emptyScanReason DATA_INVALID 가중

**상태:** 채택 (PR-3, 2026-04-30)
**시리즈:** PR #442 후속 (사용자 명시 PR-3) — ADR-0125/0126 wiring 의 진단 가시화

## 컨텍스트

ADR-0122 (PR-D) + ADR-0125 (PR-1) 가 sectorEnergy dataQuality 4값을 macroState 에 영속하지만, 운영자가 `/scan_blockers` 명령으로 *sectorEnergy 데이터 품질이 매수 차단 원인인지* 즉시 확인할 경로 부재. 사용자 명시 후속 PR-3:

> ScanSummary에 이것이 있어야 합니다.
>   sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
>   validSectorCount?: number;
>   sectorEnergyReasons?: string[];
>
> 그래야 /scan_blockers에서 이렇게 나옵니다.
>   sectorEnergy: FAILED
>   validSectorCount: 5/12
>   reason: KRX symmetry validation failed
>   emptyScanReason: DATA_INVALID

## 결정

### 1. ScanSummary +3 옵셔널 필드

```typescript
sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
validSectorCount?: number;
sectorEnergyReasons?: string[];
```

후방호환 옵셔널. macroState 의 sectorEnergyDataQuality / sectorEnergyValidSectorCount / sectorEnergyReasons 에서 carry-over.

### 2. PersistScanResultsOptions 확장

```typescript
sectorEnergyQuality?: ...;
validSectorCount?: number;
sectorEnergyReasons?: string[];
```

`signalScanner.ts` 의 `persistScanResults` 호출자가 `macroState?.sectorEnergyDataQuality` 등 3 필드 propagate.

### 3. classifyEmptyScanReason 우선순위 트리 — 5단계 가중

```
5. dataHold + corpAction ≥ 30% OR sectorEnergyQuality=FAILED → DATA_INVALID
```

기존 `dataHold 30%` 임계와 OR 결합. FAILED 단독으로도 DATA_INVALID 분류. 우선순위 보존:
- 1~4 (entries / candidates / macro / order) 가 5 보다 우선
- 6~10 (gate / wait / preBreakout / TOO_STRICT) 보다 5 우선

### 4. formatScanBlockersMessage 노출

`/scan_blockers` 응답에 신규 섹션 추가:

```
🌐 섹터 에너지 데이터 품질:
  • dataQuality: ❌ FAILED
  • validSectorCount: 5/12
  • reasons: symmetry validation failed; today indexCode 충실도 50%
  • FAILED → emptyScanReason DATA_INVALID 자동 가중 (ADR-0127)
```

icon 분기:
- OK → ✅
- PARTIAL → 🟡
- STALE → 🟠
- FAILED → ❌ + DATA_INVALID 가중 안내

reasons 는 최대 3개까지 표시 (`slice(0, 3)`) — 메시지 길이 제어. 빈 배열은 라인 미표시.

## 결과

### 변경 파일

- `server/trading/signalScanner/scanDiagnostics.ts` (ScanSummary +3 필드 + PersistScanResultsOptions +3 필드 + persistScanResults wiring + formatScanBlockersMessage 섹터 에너지 섹션)
- `server/trading/signalScanner/emptyScanClassifier.ts` (DATA_INVALID 분기에 sectorEnergyQuality=FAILED OR 결합)
- `server/trading/signalScanner.ts` (persistScanResults 호출에 macroState 의 3 필드 carry-over)
- `server/trading/signalScanner/scanDiagnosticsAdr0127.test.ts` (신규 17 케이스)

### 검증

- vitest server/trading + server/learning **1724/1724 pass** (신규 17 + 인접 무회귀)
- lint 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경 (진단 영속 + UI 표시 + 분류기 가중만)

### 운영 효과

- **`/scan_blockers` 한 번에 진단**: sectorEnergy=FAILED + validSectorCount=5/12 + reasons + DATA_INVALID 자동 분류 모두 노출
- **사용자 시나리오 재현 확인**: 1차 로그 자릿수 격차 5건 → symmetry 미통과 → FAILED → DATA_INVALID → 운영자가 1초 내 인지
- **emptyScanReason 분류 정밀화**: sectorEnergy 결함이 매수 차단 원인 시 자동 DATA_INVALID — TOO_STRICT 같은 다른 분류로 misroute 차단

### 후속 PR (옵션)

- 사용자 명시 추가 wiring 위치 (entryEngine / orderDispatch / autoTradeEngine / watchlist drift update) 별도 PR — 회귀 위험 격리
- counterfactual / ledger / kellySurface suggest 동일 패턴 SSOT 합산 (PR-F 와 동일 결함 가능성 audit)
