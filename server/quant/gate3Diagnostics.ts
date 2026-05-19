// @responsibility Gate3 timing wiring diagnostics (diagnostic-only; no scoring impact).
import type { GateLayerName, ServerGateResult } from '../quantFilter.js';

export type Gate3WiringStatus = 'FIRED' | 'THRESHOLD_NOT_MET' | 'DATA_UNAVAILABLE' | 'PROVIDER_DEGRADED' | 'CALCULATION_MISSING' | 'ERROR';
export type Gate3DataPath = 'QUOTE_ONLY' | 'TECHNICAL' | 'INTRADAY' | 'VOLUME' | 'PRICE_STRUCTURE' | 'MIXED' | 'UNKNOWN';

type GateEvaluatorOutput = NonNullable<ServerGateResult['outputs']>[number];

export interface Gate3WiringDiagnostic {
  key: string;
  layer: 'gate3';
  status: Gate3WiringStatus;
  inputs: string[];
  quoteInputs: string[];
  technicalInputs: string[];
  intradayInputs: string[];
  volumeInputs: string[];
  priceStructureInputs: string[];
  missingInputs: string[];
  availableInputs: string[];
  requiredData: string[];
  missingRequiredData: string[];
  dataPath: Gate3DataPath;
  providerIssue: boolean;
  calculationIssue: boolean;
  marketSignal: false;
  diagnosticOnly: true;
}

export interface Gate3SourceCoverage { conditionCount:number; quoteInputCount:number; technicalInputCount:number; intradayInputCount:number; volumeInputCount:number; priceStructureInputCount:number; requiredData:string[]; missingInputs:string[]; missingRequiredData:string[]; providerIssues:string[]; calculationIssues:string[]; allDeclaredInputsAvailable:boolean; allRequiredDataAvailable:boolean; marketSignal:false; diagnosticOnly:true; }

const TECH = /(rsi|macd|bb|bollinger|atr|ma\d*|ichimoku)/i;
const INTRA = /(intraday|minute|realtime|volumeClock|lastTick)/i;
const VOLUME = /(volume|avgVolume|volumeRatio|dry)/i;
const PRICE = /(high\d+d|low\d+d|breakout|pullback|priceStructure|range|currentPrice|price$)/i;

const norm=(s:string)=>s.startsWith('quote.')?s.slice(6):s;
const isTech=(s:string)=>TECH.test(norm(s));
const isIntra=(s:string)=>INTRA.test(norm(s));
const isVolume=(s:string)=>VOLUME.test(norm(s));
const isPrice=(s:string)=>PRICE.test(norm(s));

function statusOf(o:GateEvaluatorOutput):Gate3WiringStatus{ const s=o.output?.status ?? (o.output?'FIRED':o.context?.hadRequiredData===false?'DATA_UNAVAILABLE':'THRESHOLD_NOT_MET'); if(s==='ERROR'||s==='FIRED'||s==='THRESHOLD_NOT_MET'||s==='DATA_UNAVAILABLE'||s==='PROVIDER_DEGRADED') return s; return 'THRESHOLD_NOT_MET'; }
function unique(a:string[]){return [...new Set(a.filter(Boolean))];}

export function buildGate3WiringDiagnostics(input:{outputs:NonNullable<ServerGateResult['outputs']>; layerMap:Record<string,GateLayerName>}):Gate3WiringDiagnostic[]{
  const out:Gate3WiringDiagnostic[]=[];
  for(const item of input.outputs){ if(input.layerMap[item.key] !== 'gate3') continue;
    const inputs=[...(item.inputs??[])];
    const quoteInputs=unique((item.context?.quoteInputs??inputs.filter(i=>i.startsWith('quote.'))).map(String));
    const technicalInputs=unique(inputs.filter(isTech));
    const intradayInputs=unique(inputs.filter(isIntra));
    const volumeInputs=unique(inputs.filter(isVolume));
    const priceStructureInputs=unique(inputs.filter(isPrice));
    const missingInputs=unique([...(item.context?.missingInputs??[])]);
    const availableInputs=inputs.filter(i=>!missingInputs.includes(i));
    const requiredData=unique([...(item.context?.requiredData??[])]);
    const missingRequiredData=requiredData.filter(k=>item.context?.availableData?.[k]!==true);
    let dataPath:Gate3DataPath='UNKNOWN';
    const domains=[technicalInputs.length>0,intradayInputs.length>0,volumeInputs.length>0,priceStructureInputs.length>0,quoteInputs.length>0].filter(Boolean).length;
    if(domains>1) dataPath='MIXED'; else if(intradayInputs.length) dataPath='INTRADAY'; else if(technicalInputs.length) dataPath='TECHNICAL'; else if(volumeInputs.length) dataPath='VOLUME'; else if(priceStructureInputs.length) dataPath='PRICE_STRUCTURE'; else if(quoteInputs.length) dataPath='QUOTE_ONLY';
    const providerIssue=statusOf(item)==='PROVIDER_DEGRADED'||missingRequiredData.length>0;
    const calculationIssue=missingInputs.some(isTech)||statusOf(item)==='CALCULATION_MISSING';
    out.push({key:item.key,layer:'gate3',status:statusOf(item),inputs,quoteInputs,technicalInputs,intradayInputs,volumeInputs,priceStructureInputs,missingInputs,availableInputs,requiredData,missingRequiredData,dataPath,providerIssue,calculationIssue,marketSignal:false,diagnosticOnly:true});
  }
  return out;
}

export function buildGate3SourceCoverage(wiring:Gate3WiringDiagnostic[]):Gate3SourceCoverage{
  return {conditionCount:wiring.length,quoteInputCount:unique(wiring.flatMap(w=>w.quoteInputs)).length,technicalInputCount:unique(wiring.flatMap(w=>w.technicalInputs)).length,intradayInputCount:unique(wiring.flatMap(w=>w.intradayInputs)).length,volumeInputCount:unique(wiring.flatMap(w=>w.volumeInputs)).length,priceStructureInputCount:unique(wiring.flatMap(w=>w.priceStructureInputs)).length,requiredData:unique(wiring.flatMap(w=>w.requiredData)),missingInputs:unique(wiring.flatMap(w=>w.missingInputs)),missingRequiredData:unique(wiring.flatMap(w=>w.missingRequiredData)),providerIssues:unique(wiring.filter(w=>w.providerIssue).map(w=>w.key)),calculationIssues:unique(wiring.filter(w=>w.calculationIssue).map(w=>w.key)),allDeclaredInputsAvailable:wiring.every(w=>w.missingInputs.length===0),allRequiredDataAvailable:wiring.every(w=>w.missingRequiredData.length===0),marketSignal:false,diagnosticOnly:true};
}

type ExtStatus='VERIFIED'|'DEGRADED'|'MISSING'|'STALE'|'CALCULATION_MISSING'|'STAGE_NOT_FETCHED'|'UNKNOWN';
export interface Gate3ExternalDataCoverage{technicalIndicators:{required:true;available:boolean;provider:'QMP_INDICATORS'|'YAHOO'|'KIS_CHART'|'CACHE'|'UNKNOWN';status:ExtStatus;fields:Record<string,boolean>;providerIssue:boolean;calculationIssue:boolean;marketSignal:false};priceStructure:{required:true;available:boolean;provider:'QMP_INDICATORS'|'YAHOO'|'KIS_CHART'|'CACHE'|'UNKNOWN';status:ExtStatus;fields:Record<string,boolean>;providerIssue:boolean;calculationIssue:boolean;marketSignal:false};volumeStructure:{required:true;available:boolean;provider:'KIS_OFFICIAL'|'QMP_QUOTE'|'YAHOO'|'CACHE'|'UNKNOWN';status:ExtStatus;fields:Record<string,boolean>;providerIssue:boolean;calculationIssue:boolean;marketSignal:false};intradayTiming:{required:false;available:boolean;provider:'KIS_MINUTE_CHART'|'KIS_REALTIME'|'QMP_CACHE'|'UNKNOWN';status:ExtStatus;fields:Record<string,boolean>;providerIssue:boolean;marketSignal:false};}

export function buildGate3ExternalDataCoverage(quote:Record<string,unknown>):Gate3ExternalDataCoverage{
  const has=(k:string)=>quote[k]!=null;
  const techFields={rsi14:has('rsi14'),rsi5dAgo:has('rsi5dAgo'),macdHistogram:has('macdHistogram'),macd5dHistAgo:has('macd5dHistAgo'),bbWidth:has('bbWidthCurrent')||has('bbWidth'),atr14:has('atr14')||has('atr'),ma5:has('ma5'),ma20:has('ma20'),ma60:has('ma60')};
  const priceFields={high5d:has('high5d'),high20d:has('high20d'),high60d:has('high60d'),low20d:has('low20d'),low60d:has('low60d'),currentPrice:has('currentPrice')||has('price')};
  const volFields={volume:has('volume'),avgVolume:has('avgVolume'),avgVolume20d:has('avgVolume20d'),volumeRatio:has('volumeRatio'),tradingValue:has('tradingValue')};
  const intraFields={intradayVolume:has('intradayVolume'),intradayVolumeRatio:has('intradayVolumeRatio'),volumeClock:has('volumeClock'),lastTickAt:has('lastTickAt')};
  const mk=(fields:Record<string,boolean>,required:boolean):{available:boolean;status:ExtStatus}=>{const ok=Object.values(fields).every(Boolean);const any=Object.values(fields).some(Boolean);if(ok) return {available:true,status:'VERIFIED'}; if(!any) return {available:false,status:required?'MISSING':'STAGE_NOT_FETCHED'}; return {available:false,status:'CALCULATION_MISSING'};};
  const t=mk(techFields,true), p=mk(priceFields,true), v=mk(volFields,true), i=mk(intraFields,false);
  return {technicalIndicators:{required:true,available:t.available,provider:'UNKNOWN',status:t.status,fields:techFields,providerIssue:t.status==='DEGRADED'||t.status==='STALE',calculationIssue:t.status==='CALCULATION_MISSING'||t.status==='MISSING',marketSignal:false},priceStructure:{required:true,available:p.available,provider:'UNKNOWN',status:p.status,fields:priceFields,providerIssue:p.status==='DEGRADED'||p.status==='STALE',calculationIssue:p.status==='CALCULATION_MISSING'||p.status==='MISSING',marketSignal:false},volumeStructure:{required:true,available:v.available,provider:'UNKNOWN',status:v.status,fields:volFields,providerIssue:v.status==='DEGRADED'||v.status==='STALE',calculationIssue:v.status==='CALCULATION_MISSING'||v.status==='MISSING',marketSignal:false},intradayTiming:{required:false,available:i.available,provider:'UNKNOWN',status:i.status,fields:intraFields,providerIssue:i.status==='DEGRADED'||i.status==='STALE',marketSignal:false}};
}
