#!/usr/bin/env node
/**
 * P0-KIS-OFFICIAL-REGISTRY guard.
 *
 * This script intentionally checks the registry as text so it can run without
 * TypeScript compilation or importing runtime trading code.
 */

import fs from 'node:fs';
import path from 'node:path';

const REGISTRY_REL = 'server/clients/kisClient/kisOfficialEndpointRegistry.ts';
const REGISTRY_PATH = path.resolve(process.cwd(), REGISTRY_REL);
const REQUIRED_KEYS = [
  'inquirePrice',
  'inquireInvestor',
  'investorTradeByStockDaily',
  'investorTrendEstimate',
  'inquireInvestorDailyByMarket',
  'inquireInvestorTimeByMarket',
  'programTradeByStock',
  'programTradeByStockDaily',
  'compProgramTradeToday',
  'compProgramTradeDaily',
  'investorProgramTradeToday',
  'dailyShortSale',
  'shortSaleRanking',
  'dailyLoanTrans',
  'dailyCreditBalance',
  'creditBalanceRanking',
  'foreignInstitutionTotal',
  'inquireDailyItemChartPrice',
  'inquireDailyIndexChartPrice',
  'inquireBalance',
  'inquireDailyCcld',
  'orderCash',
  'orderRvsecncl',
];

const REQUIRED_PATHS = [
  '/uapi/domestic-stock/v1/quotations/inquire-price',
  '/uapi/domestic-stock/v1/quotations/inquire-investor',
  '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
  '/uapi/domestic-stock/v1/quotations/investor-trend-estimate',
  '/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',
  '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market',
  '/uapi/domestic-stock/v1/quotations/program-trade-by-stock',
  '/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily',
  '/uapi/domestic-stock/v1/quotations/comp-program-trade-today',
  '/uapi/domestic-stock/v1/quotations/comp-program-trade-daily',
  '/uapi/domestic-stock/v1/quotations/investor-program-trade-today',
  '/uapi/domestic-stock/v1/quotations/daily-short-sale',
  '/uapi/domestic-stock/v1/ranking/short-sale',
  '/uapi/domestic-stock/v1/quotations/daily-loan-trans',
  '/uapi/domestic-stock/v1/quotations/daily-credit-balance',
  '/uapi/domestic-stock/v1/ranking/credit-balance',
  '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
  '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
  '/uapi/domestic-stock/v1/trading/inquire-balance',
  '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
  '/uapi/domestic-stock/v1/trading/order-cash',
  '/uapi/domestic-stock/v1/trading/order-rvsecncl',
];

const ORDER_KEYS = new Set(['orderCash', 'orderRvsecncl']);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  console.warn(`⚠️ ${message}`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function extractEndpointBlocks(src) {
  const blocks = new Map();
  const registryStart = src.indexOf('export const KIS_OFFICIAL_ENDPOINTS = {');
  const registryEnd = src.indexOf('\n} as const', registryStart);
  const registryBody = src.slice(registryStart, registryEnd > registryStart ? registryEnd : undefined);
  const matches = [...registryBody.matchAll(/\n  ([A-Za-z0-9]+): \{/g)];
  for (let idx = 0; idx < matches.length; idx += 1) {
    const key = matches[idx][1];
    const start = matches[idx].index;
    const end = idx + 1 < matches.length ? matches[idx + 1].index : registryBody.length;
    blocks.set(key, registryBody.slice(start, end));
  }
  return blocks;
}

function parseRegistryPaths(src) {
  const matches = [...src.matchAll(/path:\s*['"]([^'"]+)['"]/g)];
  return new Set(matches.map((m) => m[1]));
}

function parseCodePaths() {
  const roots = ['server', 'src'];
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx']);
  const found = new Set();
  for (const root of roots) {
    for (const file of walk(path.resolve(process.cwd(), root))) {
      if (!exts.has(path.extname(file))) continue;
      if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;
      if (file.endsWith(REGISTRY_REL.replaceAll('/', path.sep))) continue;
      const text = readText(file);
      for (const match of text.matchAll(/['"`](\/uapi\/domestic-stock\/[^'"`\s?]+)['"`]/g)) {
        found.add(match[1]);
      }
    }
  }
  return found;
}

function scanOfficialExamples(root, registryPaths) {
  const officialRoot = path.resolve(root);
  if (!fs.existsSync(officialRoot)) {
    warn(`KIS_OFFICIAL_API_ROOT does not exist: ${officialRoot}`);
    return;
  }

  const domesticDir = path.join(officialRoot, 'examples_llm', 'domestic_stock');
  if (!fs.existsSync(domesticDir)) {
    warn(`Official examples_llm/domestic_stock not found under ${officialRoot}; skipping best-effort official comparison`);
    return;
  }

  const pyFiles = walk(domesticDir).filter((file) => file.endsWith('.py'));
  let officialText = '';
  for (const file of pyFiles) {
    try {
      officialText += `\n${readText(file)}`;
    } catch (err) {
      warn(`Unable to read official sample ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const registryPath of registryPaths) {
    if (!officialText.includes(registryPath)) {
      warn(`Official sample path not found best-effort: ${registryPath}`);
    }
  }

  const trIds = ['FHKST01010100', 'FHKST01010900', 'FHPTJ04160001', 'FHPST04830000', 'HHPST074500C0', 'FHPST04760000', 'FHKST03010100'];
  for (const trId of trIds) {
    if (!officialText.includes(trId)) {
      if (trId === 'FHKST01010900' && officialText.includes('FHKST01010300')) {
        warn('Known drift: official/current samples expose FHKST01010300 while registry pins inquire-investor to FHKST01010900');
      } else {
        warn(`Official sample TR_ID not found best-effort: ${trId}`);
      }
    }
  }
}

function main() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    fail(`Missing registry file: ${REGISTRY_REL}`);
    process.exit(1);
  }

  const src = readText(REGISTRY_PATH);
  const blocks = extractEndpointBlocks(src);
  const registryPaths = parseRegistryPaths(src);

  for (const key of REQUIRED_KEYS) {
    if (!new RegExp(`\\b${escapeRegex(key)}\\s*:`).test(src)) {
      fail(`Missing endpoint key: ${key}`);
    }
  }

  for (const requiredPath of REQUIRED_PATHS) {
    if (!src.includes(requiredPath)) {
      fail(`Missing endpoint path: ${requiredPath}`);
    }
  }

  for (const [key, block] of blocks.entries()) {
    if (ORDER_KEYS.has(key)) {
      if (!/executionImpact:\s*['"]LIVE_ORDER['"]/.test(block)) {
        fail(`${key} must use executionImpact LIVE_ORDER`);
      }
    } else if (/executionImpact:\s*['"]LIVE_ORDER['"]/.test(block)) {
      fail(`Non-order endpoint ${key} must not use executionImpact LIVE_ORDER`);
    }
  }

  if (/providerIssueMeansMarketSignal:\s*true/.test(src)) {
    fail('providerIssueMeansMarketSignal: true is forbidden in P0');
  }

  if (src.includes('FHKST01010300')) {
    warn('Known drift warning: FHKST01010300 appears in registry text. P0 must not auto-replace existing QMP code.');
  } else {
    warn('Known drift warning: existing QMP code may use FHKST01010300 while registry pins inquire-investor to FHKST01010900.');
  }

  const codePaths = parseCodePaths();
  for (const codePath of codePaths) {
    if (!registryPaths.has(codePath)) {
      warn(`QMP domestic-stock path not in official registry yet: ${codePath}`);
    }
  }

  const officialRoot = process.env.KIS_OFFICIAL_API_ROOT;
  if (officialRoot) {
    scanOfficialExamples(officialRoot, registryPaths);
  }

  if (process.exitCode) process.exit(1);
  console.log('✅ KIS official endpoint registry check completed');
}

main();
