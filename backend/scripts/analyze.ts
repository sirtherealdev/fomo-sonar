/**
 * CLI: run the real analysis against real mints, no Worker involved.
 *
 *   npm run analyze -- <mint> [<mint> ...] [--json]
 *
 * This is the validation harness for the detection logic. Run it against
 * tokens whose history you already know (a confirmed bundled launch, a clean
 * launch, a rugged one) and check the numbers before any of this reaches a UI.
 */

import { HeliusClient } from '../src/helius.ts';
import { analyzeMint } from '../src/analysis/index.ts';
import { isValidMint } from '../src/util.ts';
import type { AnalyzeResponse } from '@scope/shared';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const COLORS = { low: '\x1b[32m', medium: '\x1b[33m', high: '\x1b[31m' } as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const mints = args.filter((a) => !a.startsWith('--'));

  if (mints.length === 0) {
    console.error('Usage: npm run analyze -- <mint> [<mint> ...] [--json]');
    process.exit(1);
  }

  const apiKey = process.env['HELIUS_API_KEY'];
  if (!apiKey) {
    console.error('HELIUS_API_KEY is not set. Put it in backend/.dev.vars (see .dev.vars.example).');
    process.exit(1);
  }

  for (const mint of mints) {
    if (!isValidMint(mint)) {
      console.error(`Skipping ${mint}: not a Solana address.`);
      continue;
    }

    try {
      // A fresh client per mint keeps meta.rpcCalls per-token.
      const result = await analyzeMint(new HeliusClient(apiKey), mint);
      if (asJson) console.log(JSON.stringify(result, null, 2));
      else printReport(result);
    } catch (err) {
      console.error(`\n${mint}: analysis failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function printReport(r: AnalyzeResponse): void {
  const color = COLORS[r.riskLevel];
  console.log(`\n${BOLD}${r.mint}${RESET}`);
  console.log(`  risk        ${color}${r.riskScore}/100 ${r.riskLevel}${RESET}`);
  console.log(
    `  created     ${r.meta.createdAt ?? 'unknown'}  ${DIM}${r.meta.creationSignature?.slice(0, 12) ?? ''}${RESET}`,
  );
  console.log(
    `  dev         ${short(r.dev.address)}  holds ${pct(r.dev.holdingPct)}  sold ${pct(r.dev.soldPct)}${note(r.dev.unavailable)}`,
  );
  console.log(
    `  bundlers    ${r.bundles.walletCount} wallets  ${pct(r.bundles.holdingPct)}  ${r.bundles.clusters.length} funding cluster(s)${note(r.bundles.unavailable)}`,
  );
  for (const cluster of r.bundles.clusters.slice(0, 3)) {
    console.log(
      `                ${DIM}${short(cluster.funder)} funded ${cluster.wallets.length} wallets holding ${pct(cluster.holdingPct)}${RESET}`,
    );
  }
  console.log(`  top 10      ${pct(r.topHolders.top10Pct)}  ${DIM}(${r.topHolders.excluded.length} pool/program accounts excluded)${RESET}`);
  for (const holder of r.topHolders.list.slice(0, 5)) {
    console.log(`                ${DIM}${short(holder.address)}  ${pct(holder.pct)}${RESET}`);
  }
  console.log(`  snipers     ${r.snipers.count} wallets  ${pct(r.snipers.holdingPct)}${note(r.snipers.unavailable)}`);
  console.log(`  fresh       ${r.freshWallets.count} wallets  ${pct(r.freshWallets.holdingPct)}`);

  console.log(`  ${DIM}factors${RESET}`);
  for (const f of r.factors) {
    console.log(`                ${DIM}${f.key.padEnd(13)} ${String(f.value).padStart(6)}%  -> ${String(f.points).padStart(5)} pts (weight ${f.weight})${RESET}`);
  }

  for (const warning of r.warnings) console.log(`  ${COLORS.medium}!${RESET} ${warning}`);
  console.log(`  ${DIM}${r.meta.rpcCalls} helius calls, ${r.meta.durationMs}ms${RESET}`);
}

const pct = (n: number): string => `${n.toFixed(2)}%`;
const short = (a: string | null): string => (a ? `${a.slice(0, 4)}..${a.slice(-4)}` : 'unknown');
const note = (u: string | undefined): string => (u ? `  ${DIM}[${u}]${RESET}` : '');

void main();
