/**
 * CLI: run the real analysis against real tokens, no Worker involved.
 *
 *   npm run analyze -- <address> [<address> ...] [--chain=solana] [--json]
 *
 * This is the validation harness for the detection logic. Run it against
 * tokens whose history you already know (a confirmed bundled launch, a clean
 * launch, a rugged one) and check the numbers before any of this reaches a UI.
 *
 * It goes through the same chain registry the Worker uses, so whatever passes
 * here is what the API will return.
 */

import { getAdapter, supportedChains } from '../src/chains/registry.ts';
import { ChainNotSupportedError } from '../src/chains/types.ts';
import type { AnalyzeResponse, ChainId } from '@scope/shared';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const COLORS = { low: '\x1b[32m', medium: '\x1b[33m', high: '\x1b[31m' } as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const chain = (args.find((a) => a.startsWith('--chain='))?.split('=')[1] ?? 'solana') as ChainId;
  const addresses = args.filter((a) => !a.startsWith('--'));

  if (addresses.length === 0) {
    console.error('Usage: npm run analyze -- <address> [<address> ...] [--chain=solana] [--json]');
    console.error(`Chains: ${supportedChains().join(', ')}`);
    process.exit(1);
  }

  const env = {
    HELIUS_API_KEY: process.env['HELIUS_API_KEY'],
    EVM_RPC_URL: process.env['EVM_RPC_URL'],
  };

  let adapter;
  try {
    adapter = getAdapter(chain);
  } catch {
    console.error(`Unknown chain "${chain}". Chains: ${supportedChains().join(', ')}`);
    process.exit(1);
  }

  if (adapter.family === 'svm' && !env.HELIUS_API_KEY) {
    console.error('HELIUS_API_KEY is not set. Put it in backend/.dev.vars (see .dev.vars.example).');
    process.exit(1);
  }

  for (const address of addresses) {
    if (!adapter.isValidAddress(address)) {
      console.error(`Skipping ${address}: not a valid ${chain} address.`);
      continue;
    }

    try {
      const result = await adapter.analyze(address, env);
      if (asJson) console.log(JSON.stringify(result, null, 2));
      else printReport(result);
    } catch (err) {
      if (err instanceof ChainNotSupportedError) {
        console.error(`\n${address}: ${err.message}`);
        continue;
      }
      console.error(
        `\n${address}: analysis failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function printReport(r: AnalyzeResponse): void {
  const color = COLORS[r.riskLevel];
  const name = r.token.symbol ? `${r.token.name ?? r.token.symbol} (${r.token.symbol})` : r.mint;

  console.log(`\n${BOLD}${name}${RESET}  ${DIM}${r.chain}:${r.mint}${RESET}`);

  // --- Headline strip -------------------------------------------------------
  const m = r.market;
  if (m) {
    console.log(
      `  price       ${usd(m.priceUsd, 8)}  ${change(m.priceChange.h24)} 24h   ${DIM}${change(m.priceChange.m5)} 5m  ${change(m.priceChange.h1)} 1h${RESET}`,
    );
    console.log(
      `  mcap        ${usd(m.marketCapUsd)}   liq ${usd(m.liquidityUsd)}   vol24h ${usd(m.volume24hUsd)}`,
    );
    console.log(
      `  market      ${m.dexId ?? '?'}  ${m.txns24h ? `${m.txns24h.buys}B / ${m.txns24h.sells}S 24h` : ''}  ${DIM}dex paid: ${yesNo(m.dexPaid)}${RESET}`,
    );
  } else {
    console.log(`  market      ${DIM}no DEX pool found${RESET}`);
  }
  console.log(
    `  holders     ${r.holderCount}   can mint more ${flag(!r.security.canMintMore)}   can freeze ${flag(!r.security.canFreeze)}`,
  );
  if (r.security.detail) console.log(`              ${DIM}${r.security.detail}${RESET}`);

  // --- Risk strip -----------------------------------------------------------
  console.log(`  ${BOLD}risk        ${color}${r.riskScore}/100 ${r.riskLevel}${RESET}`);
  if (r.scoreFloor) {
    console.log(
      `              ${DIM}floor ${r.scoreFloor.floor} forced by ${r.scoreFloor.key} at ${r.scoreFloor.value}%${RESET}`,
    );
  }
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
  console.log(
    `  top 10      ${pct(r.topHolders.top10Pct)}  ${DIM}(${r.topHolders.excluded.length} pool/program accounts excluded)${RESET}`,
  );
  for (const holder of r.topHolders.list.slice(0, 5)) {
    console.log(`                ${DIM}${short(holder.address)}  ${pct(holder.pct)}${RESET}`);
  }
  console.log(
    `  snipers     ${r.snipers.count} wallets  ${pct(r.snipers.holdingPct)}${note(r.snipers.unavailable)}`,
  );
  console.log(`  insiders    ${r.insiders.count} wallets  ${pct(r.insiders.holdingPct)}${note(r.insiders.unavailable)}`);
  console.log(`  fresh       ${r.freshWallets.count} wallets  ${pct(r.freshWallets.holdingPct)}`);

  console.log(`  ${DIM}factors${RESET}`);
  for (const f of r.factors) {
    console.log(
      `                ${DIM}${f.key.padEnd(13)} ${String(f.value).padStart(6)}%  -> ${String(f.points).padStart(5)} pts (weight ${f.weight})${RESET}`,
    );
  }

  for (const warning of r.warnings) console.log(`  ${COLORS.medium}!${RESET} ${warning}`);
  console.log(`  ${DIM}${r.meta.rpcCalls} helius calls, ${r.meta.durationMs}ms${RESET}`);
}

function usd(value: number | null, maxDigits = 2): string {
  if (value === null) return '—';
  if (value >= 1000) {
    const units = [
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ] as const;
    for (const [size, suffix] of units) {
      if (value >= size) return `$${(value / size).toFixed(2)}${suffix}`;
    }
  }
  return `$${value.toFixed(value < 1 ? maxDigits : 2)}`;
}

function change(value: number | null): string {
  if (value === null) return '—';
  const color = value >= 0 ? COLORS.low : COLORS.high;
  return `${color}${value >= 0 ? '+' : ''}${value.toFixed(2)}%${RESET}`;
}

/** Green means the power is gone: nobody can mint or freeze. */
function flag(safe: boolean): string {
  return safe ? `${COLORS.low}no${RESET}` : `${COLORS.high}YES${RESET}`;
}

function yesNo(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

const pct = (n: number): string => `${n.toFixed(2)}%`;
const short = (a: string | null): string => (a ? `${a.slice(0, 4)}..${a.slice(-4)}` : 'unknown');
const note = (u: string | undefined): string => (u ? `  ${DIM}[${u}]${RESET}` : '');

void main();
