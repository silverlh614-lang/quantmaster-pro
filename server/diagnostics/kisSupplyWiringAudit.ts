/**
 * @responsibility KIS 수급 API 배선 감사기 — 각 엔드포인트의 런타임 역할·파이프라인 단계·리스크를 점검한다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findKisOfficialEndpointByPath } from '../clients/kisClient/kisOfficialEndpointRegistry';

export interface KisSupplyWiringAuditItem {
  path: string;
  trId?: string;
  registryKey?: string;
  registryFound: boolean;
  category?: string;
  confidenceClass?: string;
  defaultUseScope?: string;
  executionImpact?: string;
  providerIssueMeansMarketSignal?: boolean;
  detectedFiles: string[];
  suspectedRuntimeRole:
    | 'PRICE'
    | 'RANKING'
    | 'SUPPLY'
    | 'PROGRAM'
    | 'SHORT_SELLING'
    | 'LOAN'
    | 'CREDIT'
    | 'ACCOUNT'
    | 'ORDER'
    | 'UNKNOWN';
  currentPipelineStage:
    | 'RAW_CALL_ONLY'
    | 'NORMALIZED'
    | 'SUPPLY_PROVIDER_HEALTH'
    | 'CANDIDATE_CONTEXT'
    | 'TELEGRAM_DIAGNOSTIC'
    | 'SHADOW_ONLY'
    | 'ADVISORY'
    | 'WEIGHTED'
    | 'GATED'
    | 'CORE'
    | 'UNKNOWN';
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  notes: string[];
}

export interface KisSupplyWiringAuditResult {
  auditedAt: string;
  executionImpact: 'NONE';
  useScope: 'DIAGNOSTIC_ONLY';
  providerIssueMeansMarketSignal: false;
  totalDetectedPaths: number;
  registeredPaths: number;
  missingRegistryPaths: string[];
  orderEndpointsDetected: string[];
  supplyEndpointsDetected: string[];
  diagnosticOnlyEndpoints: string[];
  shadowOnlyEndpoints: string[];
  advisoryEndpoints: string[];
  weightedOrHigherEndpoints: string[];
  items: KisSupplyWiringAuditItem[];
  summary: {
    registryCoverageOk: boolean;
    hasUnregisteredRuntimeKisPath: boolean;
    hasOrderEndpointOutsideOrderGuards: boolean;
    hasProviderIssueMarketSignalLeak: boolean;
    hasUnexpectedCoreSupplyConnection: boolean;
    recommendedNextAction:
      | 'NO_ACTION'
      | 'ADD_MISSING_REGISTRY_ENTRIES'
      | 'REVIEW_ORDER_GUARDS'
      | 'REVIEW_SUPPLY_PIPELINE'
      | 'READY_FOR_WEIGHTED_PROMOTION_REVIEW';
    reason: string;
  };
}

const ROOTS = ['server', 'scripts', 'shared', 'src'];
const EXCLUDED = new Set(['node_modules', 'dist', 'build', '.git', 'attached_assets', 'coverage']);
const ORDER_PATHS = ['/uapi/domestic-stock/v1/trading/order-cash', '/uapi/domestic-stock/v1/trading/order-credit', '/uapi/domestic-stock/v1/trading/order-rvsecncl'];

function walk(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (ent.isFile() && /\.(ts|tsx|js|mjs|cjs|json)$/i.test(ent.name)) files.push(p);
  }
}

function detectRole(p: string): KisSupplyWiringAuditItem['suspectedRuntimeRole'] {
  if (p.includes('/trading/order-')) return 'ORDER';
  if (p.includes('/ranking/')) return 'RANKING';
  if (p.includes('program')) return 'PROGRAM';
  if (p.includes('short')) return 'SHORT_SELLING';
  if (p.includes('loan')) return 'LOAN';
  if (p.includes('credit')) return 'CREDIT';
  if (p.includes('investor') || p.includes('supply')) return 'SUPPLY';
  if (p.includes('account')) return 'ACCOUNT';
  if (p.includes('price') || p.includes('quotations')) return 'PRICE';
  return 'UNKNOWN';
}

function detectStage(file: string, text: string): KisSupplyWiringAuditItem['currentPipelineStage'] {
  const s = `${file} ${text}`.toLowerCase();
  if (s.includes('supplyproviderhealth') || s.includes('healthbridge')) return 'SUPPLY_PROVIDER_HEALTH';
  if (s.includes('candidate') || s.includes('buylistloop') || s.includes('intradayloop')) return 'CANDIDATE_CONTEXT';
  if (s.includes('telegram') || s.includes('command')) return 'TELEGRAM_DIAGNOSTIC';
  if (s.includes('shadow') || s.includes('paper')) return 'SHADOW_ONLY';
  if (s.includes('advisory')) return 'ADVISORY';
  if (s.includes('weighted') || s.includes('score')) return 'WEIGHTED';
  if (s.includes('gate')) return 'GATED';
  if (s.includes('core') || s.includes('execution')) return 'CORE';
  if (s.includes('normalize') || s.includes('mapper') || s.includes('materializer')) return 'NORMALIZED';
  if (s.includes('query.ts') || s.includes('kisclient') || s.includes('requestkis') || s.includes('querykis')) return 'RAW_CALL_ONLY';
  return 'UNKNOWN';
}

export function runKisSupplyWiringAudit(cwd: string = process.cwd()): KisSupplyWiringAuditResult {
  const files: string[] = [];
  ROOTS.forEach((r) => walk(path.join(cwd, r), files));

  const map = new Map<string, KisSupplyWiringAuditItem>();
  for (const file of files) {
    const rel = path.relative(cwd, file).replaceAll('\\', '/');
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes('/uapi/domestic-stock')) continue;
      if (rel.endsWith('server/diagnostics/kisSupplyWiringAudit.ts')) continue;
      const pathMatch = lines[i].match(/\/uapi\/domestic-stock\/v1[^'"`\s)]*/g);
      if (!pathMatch) continue;
      const nearby = lines.slice(Math.max(0, i - 20), Math.min(lines.length, i + 21)).join('\n');
      const trMatch = nearby.match(/(?:trId|tr_id)\s*[:=]\s*['"]([A-Z0-9]+)['"]|\b(FHKST\d+|FHPTJ\d+|FHPST\d+|HHPST\d+)\b/);
      for (const detectedPath of pathMatch) {
        const existing = map.get(detectedPath);
        if (existing) {
          if (!existing.detectedFiles.includes(rel)) existing.detectedFiles.push(rel);
          continue;
        }
        const reg = findKisOfficialEndpointByPath(detectedPath);
        const role = detectRole(detectedPath);
        const stage = detectStage(rel, nearby);
        const risk: KisSupplyWiringAuditItem['risk'] = reg ? 'LOW' : 'MEDIUM';
        map.set(detectedPath, {
          path: detectedPath,
          trId: trMatch?.[1] ?? trMatch?.[2],
          registryKey: reg?.key,
          registryFound: Boolean(reg),
          category: reg?.category,
          confidenceClass: reg?.confidenceClass,
          defaultUseScope: reg?.defaultUseScope,
          executionImpact: reg?.executionImpact,
          providerIssueMeansMarketSignal: reg?.providerIssueMeansMarketSignal,
          detectedFiles: [rel],
          suspectedRuntimeRole: role,
          currentPipelineStage: stage,
          risk,
          notes: ['static heuristic: derived by local string scan and nearby context window.'],
        });
      }
    }
  }

  const items = Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
  const missingRegistryPaths = items.filter((i) => !i.registryFound).map((i) => i.path);
  const orderEndpointsDetected = items.filter((i) => ORDER_PATHS.includes(i.path)).map((i) => i.path);
  const supplyEndpointsDetected = items.filter((i) => ['SUPPLY', 'PROGRAM', 'SHORT_SELLING', 'LOAN', 'CREDIT'].includes(i.suspectedRuntimeRole)).map((i) => i.path);
  const diagnosticOnlyEndpoints = items.filter((i) => i.defaultUseScope === 'DIAGNOSTIC_ONLY').map((i) => i.path);
  const shadowOnlyEndpoints = items.filter((i) => i.defaultUseScope === 'SHADOW_ONLY').map((i) => i.path);
  const advisoryEndpoints = items.filter((i) => i.defaultUseScope === 'ADVISORY').map((i) => i.path);
  const weightedOrHigherEndpoints = items.filter((i) => i.defaultUseScope === 'WEIGHTED' || i.executionImpact === 'LIVE_ORDER').map((i) => i.path);

  const hasOrderEndpointOutsideOrderGuards = items.some((i) => ORDER_PATHS.includes(i.path) && i.detectedFiles.some((f) => !/order|kisClient|clients\/kisClient|kisProxyPolicy/i.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.js')));
  if (hasOrderEndpointOutsideOrderGuards) items.forEach((i) => { if (ORDER_PATHS.includes(i.path)) i.risk = 'HIGH'; });

  const hasProviderIssueMarketSignalLeak = items.some((i) => i.providerIssueMeansMarketSignal === true);
  const hasUnexpectedCoreSupplyConnection = items.some((i) => ['SUPPLY', 'PROGRAM', 'SHORT_SELLING', 'LOAN', 'CREDIT'].includes(i.suspectedRuntimeRole) && ['CORE', 'GATED'].includes(i.currentPipelineStage) && i.detectedFiles.every((f) => !f.includes('kisOfficialEndpointRegistry') && !f.includes('kisSupplyWiringAudit')));
  if (hasUnexpectedCoreSupplyConnection) items.forEach((i) => { if (['SUPPLY', 'PROGRAM', 'SHORT_SELLING', 'LOAN', 'CREDIT'].includes(i.suspectedRuntimeRole) && ['CORE', 'GATED'].includes(i.currentPipelineStage)) i.risk = 'HIGH'; });

  let recommendedNextAction: KisSupplyWiringAuditResult['summary']['recommendedNextAction'] = 'NO_ACTION';
  let reason = 'No critical static wiring anomaly detected.';
  if (missingRegistryPaths.length > 0) {
    recommendedNextAction = 'ADD_MISSING_REGISTRY_ENTRIES';
    reason = 'Detected runtime KIS path(s) not found in official registry.';
  } else if (hasOrderEndpointOutsideOrderGuards) {
    recommendedNextAction = 'REVIEW_ORDER_GUARDS';
    reason = 'Order endpoint was referenced outside expected order guard locations.';
  } else if (hasUnexpectedCoreSupplyConnection || hasProviderIssueMarketSignalLeak) {
    recommendedNextAction = 'REVIEW_SUPPLY_PIPELINE';
    reason = 'Potential supply signal leakage into gated/core stages detected by static heuristic.';
  } else if (weightedOrHigherEndpoints.length === 0) {
    recommendedNextAction = 'READY_FOR_WEIGHTED_PROMOTION_REVIEW';
    reason = 'Registry coverage looks complete and supply usage appears mostly diagnostic/shadow/advisory.';
  }

  return {
    auditedAt: new Date().toISOString(),
    executionImpact: 'NONE',
    useScope: 'DIAGNOSTIC_ONLY',
    providerIssueMeansMarketSignal: false,
    totalDetectedPaths: items.length,
    registeredPaths: items.length - missingRegistryPaths.length,
    missingRegistryPaths,
    orderEndpointsDetected,
    supplyEndpointsDetected,
    diagnosticOnlyEndpoints,
    shadowOnlyEndpoints,
    advisoryEndpoints,
    weightedOrHigherEndpoints,
    items,
    summary: {
      registryCoverageOk: missingRegistryPaths.length === 0,
      hasUnregisteredRuntimeKisPath: missingRegistryPaths.length > 0,
      hasOrderEndpointOutsideOrderGuards,
      hasProviderIssueMarketSignalLeak,
      hasUnexpectedCoreSupplyConnection,
      recommendedNextAction,
      reason,
    },
  };
}
