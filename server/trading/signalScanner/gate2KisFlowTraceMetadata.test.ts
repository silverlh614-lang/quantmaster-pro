/**
 * @responsibility gate2KisFlowTraceMetadata 헬퍼 단위 테스트 — metadata carry/drop·KRX·executionImpact 분기 검증.
 */
import { describe, it, expect } from 'vitest';
import {
  buildKisFlowTraceFields,
  KIS_INVESTOR_FLOW_CANONICAL,
  type BuildKisFlowTraceInput,
} from './gate2KisFlowTraceMetadata.js';

function toMap(fields: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of fields) {
    const match = /^- ([^=]+)=(.*)$/.exec(line);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

describe('buildKisFlowTraceFields', () => {
  it('KIS_API + metadata 미carry → apiPath/trId 가 canonical 값 참조 + traceBreakPoint + canonical 참조값 표기', () => {
    const input: BuildKisFlowTraceInput = {
      selectedProvider: 'KIS_API',
      apiPath: undefined,
      trId: undefined,
      selectedRowPath: 'output2[0]',
      selectedFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
      foreignNetBuy: 1234,
      institutionNetBuy: -567,
      useScope: 'GATE_SCORE_ELIGIBLE',
    };

    const fields = buildKisFlowTraceFields(input);
    const map = toMap(fields);

    // Patch B: apiPath/trId 가 bare UNKNOWN 대신 canonical 값을 참조 (METADATA_NOT_CARRIED 마커 부기).
    expect(map.get('apiPath')).toBe(`${KIS_INVESTOR_FLOW_CANONICAL.apiPath} (canonical;UNKNOWN_METADATA_NOT_CARRIED)`);
    expect(map.get('trId')).toBe(`${KIS_INVESTOR_FLOW_CANONICAL.trId} (canonical;UNKNOWN_METADATA_NOT_CARRIED)`);
    expect(map.get('apiPath')).not.toBe('UNKNOWN_METADATA_NOT_CARRIED');
    expect(map.get('trId')).not.toBe('UNKNOWN_METADATA_NOT_CARRIED');
    expect(map.get('traceBreakPoint')).toBe('PROVIDER_METADATA_DROPPED_AFTER_ROUTER');
    expect(map.get('canonicalApiPath')).toBe(KIS_INVESTOR_FLOW_CANONICAL.apiPath);
    expect(map.get('canonicalTrId')).toBe(KIS_INVESTOR_FLOW_CANONICAL.trId);
    expect(map.get('sourceProvider')).toBe('KIS_API');
    expect(map.get('foreignNetBuy')).toBe('1234');
    expect(map.get('institutionNetBuy')).toBe('-567');
    expect(map.get('executionImpact')).toBe('NONE');
    // GATE_SCORE_ELIGIBLE → diagnosticOnly=false
    expect(map.get('diagnosticOnly')).toBe('false');
  });

  it('KRX provider → endpoint(BLD) 를 apiPath 위치에 표기 + trId=NOT_APPLICABLE_KRX_PROVIDER', () => {
    const input: BuildKisFlowTraceInput = {
      selectedProvider: 'KRX',
      krxEndpoint: 'MDCSTAT02203',
      selectedRowPath: 'OutBlock_1[0]',
      selectedFieldKeys: ['FORN_NETBYN_TRDVAL'],
      foreignNetBuy: 999,
      institutionNetBuy: 111,
      useScope: 'GATE_SCORE_ELIGIBLE',
    };

    const fields = buildKisFlowTraceFields(input);
    const map = toMap(fields);

    expect(map.get('apiPath')).toBe('MDCSTAT02203');
    expect(map.get('trId')).toBe('NOT_APPLICABLE_KRX_PROVIDER');
    expect(map.get('sourceProvider')).toBe('KRX');
    expect(map.get('executionImpact')).toBe('NONE');
    // KRX 분기는 canonical/traceBreakPoint 표기 안 함
    expect(map.has('traceBreakPoint')).toBe(false);
    expect(map.has('canonicalApiPath')).toBe(false);
  });

  it('KRX_API provider 도 KRX 계열로 인식', () => {
    const fields = buildKisFlowTraceFields({
      selectedProvider: 'KRX_API',
      krxEndpoint: 'MDCSTAT02203',
      useScope: 'GATE_SCORE_ELIGIBLE',
    });
    const map = toMap(fields);
    expect(map.get('trId')).toBe('NOT_APPLICABLE_KRX_PROVIDER');
    expect(map.get('apiPath')).toBe('MDCSTAT02203');
  });

  it('metadata 정상 carry → 호출자가 넘긴 실제 apiPath/trId 표기 (UNKNOWN/canonical 미표기)', () => {
    const input: BuildKisFlowTraceInput = {
      selectedProvider: 'KIS_API',
      apiPath: KIS_INVESTOR_FLOW_CANONICAL.apiPath,
      trId: KIS_INVESTOR_FLOW_CANONICAL.trId,
      selectedRowPath: 'output2[0]',
      selectedFieldKeys: ['frgn_ntby_qty'],
      foreignNetBuy: 42,
      institutionNetBuy: 7,
      useScope: 'GATE_SCORE_ELIGIBLE',
    };

    const fields = buildKisFlowTraceFields(input);
    const map = toMap(fields);

    expect(map.get('apiPath')).toBe(KIS_INVESTOR_FLOW_CANONICAL.apiPath);
    expect(map.get('trId')).toBe(KIS_INVESTOR_FLOW_CANONICAL.trId);
    expect(map.has('traceBreakPoint')).toBe(false);
    expect(map.has('canonicalApiPath')).toBe(false);
    expect(map.get('executionImpact')).toBe('NONE');
  });

  it('executionImpact 는 모든 분기에서 항상 NONE', () => {
    const scopes: BuildKisFlowTraceInput['useScope'][] = [
      'GATE_SCORE_ELIGIBLE',
      'SHADOW_ONLY_NEUTRAL_UNKNOWN',
      'DIAGNOSTIC_ONLY',
    ];
    const providers = ['KIS_API', 'KRX', 'NONE', null, undefined];
    for (const useScope of scopes) {
      for (const selectedProvider of providers) {
        const map = toMap(buildKisFlowTraceFields({ selectedProvider, useScope }));
        expect(map.get('executionImpact')).toBe('NONE');
      }
    }
  });

  it('diagnosticOnly 는 useScope 가 GATE_SCORE_ELIGIBLE 가 아니면 true', () => {
    const eligible = toMap(
      buildKisFlowTraceFields({ selectedProvider: 'KIS_API', useScope: 'GATE_SCORE_ELIGIBLE' }),
    );
    expect(eligible.get('diagnosticOnly')).toBe('false');

    const shadow = toMap(
      buildKisFlowTraceFields({
        selectedProvider: 'KIS_API',
        useScope: 'SHADOW_ONLY_NEUTRAL_UNKNOWN',
      }),
    );
    expect(shadow.get('diagnosticOnly')).toBe('true');

    const diagnostic = toMap(
      buildKisFlowTraceFields({ selectedProvider: 'KIS_API', useScope: 'DIAGNOSTIC_ONLY' }),
    );
    expect(diagnostic.get('diagnosticOnly')).toBe('true');
  });

  it('numeric 미존재(null/NaN) → UNKNOWN, providerIssue→marketSignal 변환 없음(표시 전용)', () => {
    const map = toMap(
      buildKisFlowTraceFields({
        selectedProvider: 'KIS_API',
        foreignNetBuy: null,
        institutionNetBuy: Number.NaN,
        useScope: 'SHADOW_ONLY_NEUTRAL_UNKNOWN',
      }),
    );
    expect(map.get('foreignNetBuy')).toBe('UNKNOWN');
    expect(map.get('institutionNetBuy')).toBe('UNKNOWN');
    // marketSignal/bearish 같은 필드는 이 모듈이 절대 생성하지 않는다.
    const joined = Array.from(map.keys()).join(',');
    expect(joined).not.toMatch(/marketSignal/i);
    expect(joined).not.toMatch(/bearish/i);
  });
});
