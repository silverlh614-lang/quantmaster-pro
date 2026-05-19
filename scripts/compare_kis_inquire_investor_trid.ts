#!/usr/bin/env tsx
// @responsibility KIS inquire-investor TR_ID comparison command.
import { compareKisInquireInvestorTrid } from '../server/diagnostics/kisInquireInvestorTridCompare.js';

interface CliArgs {
  code: string;
  marketDivCode: string;
  dryRun: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run diagnose:kisInquireInvestorTrid -- 005930',
    '  npm run diagnose:kisInquireInvestorTrid -- 005930 --dry-run',
    '  npm run diagnose:kisInquireInvestorTrid -- 005930 --market J',
  ].join('\n');
}

function parseArgs(args: string[]): CliArgs {
  let code = '';
  let marketDivCode = 'J';
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--market') {
      const next = args[i + 1];
      if (!next) throw new Error('--market requires a value');
      marketDivCode = next;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error(usage());
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!code) {
      code = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!code) throw new Error(`Missing stock code\n${usage()}`);
  return { code, marketDivCode, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await compareKisInquireInvestorTrid({
    code: args.code,
    marketDivCode: args.marketDivCode,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
