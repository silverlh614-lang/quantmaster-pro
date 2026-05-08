# ADR-0454: SilentDegradation `MacroState.sectorEnergyInputsUpdatedAt` Writer Wiring

> **상태**: Accepted
> **발급일**: 2026-05-08
> **카테고리**: governance / silent-degradation / sectorEnergy

## 결함

`scripts/check_silent_degradation.js` baseline 사전 1건:

```
[SilentDegradation] WARN — silent degradation 신규 위반 발견:
  - MacroState.sectorEnergyInputsUpdatedAt (server/persistence/macroStateRepo.ts:193) reader=2 writer=0
```

**Reader 2건** (`server/clients/sectorEnergyProvider.ts:1059, 1065`) — ADR-0343 L3 CACHE fallback 의 입력 데이터:

```typescript
let cached: { sectorEnergyInputs?: SectorEnergyInput[]; sectorEnergyInputsUpdatedAt?: string } | null;
try {
  const { loadMacroState } = await import('../persistence/macroStateRepo.js');
  cached = loadMacroState() as unknown as { sectorEnergyInputs?: SectorEnergyInput[]; sectorEnergyInputsUpdatedAt?: string } | null;
} catch { cached = null; }

if (cached?.sectorEnergyInputs && cached.sectorEnergyInputsUpdatedAt) {
  // ... L3 CACHE fallback 분기 ...
}
```

**Writer 0건** — `MacroState.sectorEnergyInputs` 와 `sectorEnergyInputsUpdatedAt` 두 필드 모두 영속하는 코드 0건.

**결과**: ADR-0343 L3 CACHE fallback (`ageHours < SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS = 48`) 분기 가 영구 dead code. `cached?.sectorEnergyInputs && cached.sectorEnergyInputsUpdatedAt` 조건 항상 false → cache lookup 영구 skip. KRX 일시 장애 + L1/L2 build 실패 시 L3 CACHE 회복 불가능, L4 YAHOO_ETF 또는 FAILED 직행.

## 결정

`server/trading/marketDataRefresh.ts` 의 `saveMacroState` merge 단계에 `sectorEnergyInputs` + `sectorEnergyInputsUpdatedAt` 두 필드 영속 wiring 추가. ADR-0343 의도된 cache fallback 활성화.

### 변경 매트릭스

1. **변수 선언 (line 754 근처)**:
   ```typescript
   let sectorEnergyInputsResolved: Awaited<ReturnType<typeof buildSectorEnergyInputsWithMeta>>['inputs'] | undefined;
   ```

2. **meta.inputs.length>0 분기 채움 (line 818~826)**:
   ```typescript
   if (meta.inputs.length > 0) {
     sectorEnergyResult = evaluateSectorEnergy(meta.inputs);
     sectorEnergyUpdatedAt = new Date().toISOString();
     // ADR-0454: meta.inputs SSOT 영속 — saveMacroState merge 분기에서 sectorEnergyInputs 영속.
     sectorEnergyInputsResolved = meta.inputs;
     // ...
   }
   ```

3. **saveMacroState merge 분기 영속 (line 858~)**:
   ```typescript
   ...(sectorEnergyInputsResolved && sectorEnergyUpdatedAt
     ? {
         sectorEnergyInputs: sectorEnergyInputsResolved,
         sectorEnergyInputsUpdatedAt: sectorEnergyUpdatedAt,
       }
     : {}),
   ```

### 영속 정책 (사용자 명시 절대 변경 금지)

- **meta.inputs.length>0 사이클에만 영속** — 실패 시 (meta throw / inputs.length=0) 이전 cache 보존
- **sectorEnergyResult 와 sectorEnergyInputsUpdatedAt 동기화** — 두 필드 시간축 정합 (sectorEnergyResult 가 evaluateSectorEnergy(meta.inputs) 결과이므로 inputs 와 동일 시각 보유 의무)
- **ADR-0343 cache TTL 48h 그대로 유지** — 본 PR 은 writer 만 추가, reader 정책 변경 0
- **ADR-0399 4-axis SSOT 본체 무수정** — sectorEnergySourceTier / freshness / coverage / confidence 영속 분기 그대로

## 12 Invariants

1. **LIVE 매매 본체 0줄 변경** — signalScanner / entryEngine / exitEngine/** / kisClient/** / orchestrator/** / autoTradeEngine* / trancheExecutor / buyPipeline 모두 0줄
2. **KIS 주문 함수 5종 import 0건** (정적 grep 가드)
3. **외부 API 호출 추가 0건** — wiring 은 영속 layer 만, KIS/KRX/Yahoo/Naver outbound 빈도 0 변경
4. **ADR-0343 L3 CACHE TTL 정책 보존** — 48h 임계 + reader 분기 본체 0 변경
5. **ADR-0399 4-axis SSOT 본체 0 변경** — sourceTier / freshness / coverage / confidence 영속 분기 그대로
6. **meta.inputs.length=0 시 영속 0** — 이전 cache 보존 (실패 graceful)
7. **meta throw 시 영속 0** — sectorEnergyInputsResolved undefined 유지 → spread 분기 자동 skip
8. **autoTradeEngine / orderExecutor / trancheExecutor import 0건**
9. **Gate threshold + condition weight + STRONG_BUY 조건 0 변경**
10. **virtual account holdings/cash 무수정**
11. **ADR-0157 ENV 정확 비교 의무 무관** — 본 PR ENV 신규 0건
12. **외부 패키지 추가 0건**

## 잘못된 해결 방법 영구 차단

- **BASELINE_SILENT_DEGRADATION 카탈로그 등재 (placeholder)** — *진짜 wiring* 가능한 결함을 baseline 으로 우회하면 ADR-0343 cache fallback 영구 dead code. 본 PR 은 writer wiring 의 진짜 해결.
- **sectorEnergyProvider.ts 본체에 영속 추가** — provider 가 macroStateRepo 의존성 가지면 순환 import 위험. marketDataRefresh.ts wiring 이 정합 (이미 saveMacroState 호출).
- **meta.inputs.length=0 사이클에도 영속** — 빈 배열 영속 시 다음 사이클의 cache lookup 이 빈 배열 반환 → L3 fallback 무의미. graceful fallback 보존 의무.
- **ADR-0343 TTL 48h 변경** — 본 PR scope 외. 운영 데이터 누적 후 별도 ADR.
- **sectorEnergyInputs 영속 schema 의 type 변경** — `SectorEnergyInput[]` 그대로 유지 (writer = reader 동일 type).
- **try/catch 격리 부재** — meta build 자체가 try {} 블록 안 (line 768~837). spread 영속 분기는 try {} 밖 (line 887 saveMacroState) 이지만 sectorEnergyInputsResolved 가 undefined 면 spread 자동 skip — 안전.

## 검증

- `node scripts/check_silent_degradation.js` EXIT=0 (`MacroState.sectorEnergyInputsUpdatedAt` writer=0 → writer=1 회복)
- `npx vitest run server/trading/marketDataRefreshSectorEnergyInputsAdr0454.test.ts` 8/8 PASS
- `npm run lint` EXIT=0
- `git merge-tree origin/main HEAD` 충돌 marker 0건

## 후속 PR

- ADR-0455: KRX master DB enrichment automation (사용자 3순위)
- ADR-0456: DART name disambiguation (사용자 3순위)

## 참고

- ADR-0148 INDEX SSOT
- ADR-0343 SectorEnergy L3 CACHE Fallback (48h TTL)
- ADR-0396 SectorEnergy 4-axis Decomposition
- ADR-0399 SectorEnergy DataQuality Diagnostic
- ADR-0453 ADR Index Baseline Retrofit (사용자 3순위 첫 단계)
- `scripts/check_silent_degradation.js` (ADR-0148 baseline SSOT)
