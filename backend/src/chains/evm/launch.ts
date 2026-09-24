/**
 * Finding an ERC-20's launch.
 *
 * EVM has no "first transaction of this address" query, but it has something
 * better than Solana's: `eth_getCode` at a historical block tells us whether
 * the contract existed yet. That makes the deployment block a binary search —
 * about ten calls with a timestamp hint to narrow the bracket, twenty-five
 * without — and it works at any age.
 *
 * From there the launch itself is the first `Transfer` log with a zero sender,
 * which is the mint. That single log gives us the block, the transaction, and
 * whoever received the initial supply.
 */

import { DETECTION, LIMITS } from '../../config.ts';
import type { ResolvedEvmChain } from './chains.ts';
import { hexToBigInt, hexToNumber, topicToAddress, ZERO_ADDRESS } from './helpers.ts';
import type { EvmClient, EvmLog } from './rpc.ts';
import { assetTransfers, firstTransfer, type AssetTransfer } from './transfers.ts';

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface EvmLaunch {
  /** Transaction that minted the initial supply. */
  txHash: string;
  block: number;
  /** Unix seconds. */
  timestamp: number;
  /** Whoever deployed it — the sender of the minting transaction. */
  dev: string;
  /** Decimal-adjusted tokens the dev received at launch. */
  devInitialUiAmount: number;
  /** Wallets that received tokens in the launch block window. */
  bundlers: string[];
  /** Wallets that received tokens inside the sniper window, excluding bundlers. */
  snipers: string[];
  /** wallet -> net tokens taken during the launch window. */
  bought: Record<string, number>;
  truncated: boolean;
}

/**
 * The block a token launched in, by whichever route this endpoint supports.
 *
 * Preferred: binary search on `eth_getCode`, which proves the answer. Most
 * free public nodes are not archive nodes though — measured, only Base and
 * Monad answered historical state — so there is a fallback that needs nothing
 * but logs: estimate the block from the pool's creation time and look for the
 * mint there.
 *
 * The fallback is weaker. It trusts a timestamp from market data, and if the
 * token has no pool there is nothing to estimate from, so it reports nothing
 * rather than guessing at a block.
 */
export async function locateLaunchBlock(
  client: EvmClient,
  chain: ResolvedEvmChain,
  token: string,
  hintTimestamp: number | null,
): Promise<number | null> {
  /*
   * With the transfers API this is one call: a token's first transfer is its
   * mint, and the results come back in chain order. No binary search, no
   * historical state, no timestamp hint to be wrong about.
   */
  if (chain.useAssetTransfers) {
    const first = await firstTransfer(client, token);
    return first ? hexToNumber(first.blockNum) : null;
  }

  try {
    return await findDeploymentBlock(client, chain, token, hintTimestamp);
  } catch (err) {
    /*
     * Any failure here means the proven route is unavailable, and the fallback
     * below proves its own answer anyway — it only accepts a transfer out of
     * the zero address, which can only be a mint.
     *
     * Catching narrowly was a mistake worth recording: endpoints signal "no
     * archive" inconsistently. Some return a JSON-RPC error saying so, and
     * publicnode returns HTTP 403, which read as a permissions problem and
     * failed the whole analysis instead of falling through.
     */
    console.warn('deployment search unavailable, falling back to log scan', String(err));
  }

  if (hintTimestamp === null) return null;
  return findMintByLogs(client, chain, token, hintTimestamp);
}

/**
 * Find the mint by scanning logs around an estimated block.
 *
 * Walks outward from the estimate in both directions — a pool can be created
 * a little before or after the mint — and stops at the first Transfer out of
 * the zero address, which can only be the mint.
 */
async function findMintByLogs(
  client: EvmClient,
  chain: ResolvedEvmChain,
  token: string,
  timestamp: number,
): Promise<number | null> {
  const latest = await client.blockNumber();
  const latestTime = await client.blockTimestamp(latest);
  if (latestTime === null || timestamp >= latestTime) return null;

  /*
   * Measure the block rate instead of trusting the configured one.
   *
   * The configured value is a label, and labels rot: Robinhood Chain was
   * listed at two seconds a block and actually produces one every tenth of a
   * second. A twenty-fold error puts the estimate nowhere near the launch and
   * the search quietly finds nothing. Two calls buy the real number.
   */
  const baseline = Math.max(1, latest - 10_000);
  const baselineTime = await client.blockTimestamp(baseline);
  const secondsPerBlock =
    baselineTime !== null && latestTime > baselineTime
      ? (latestTime - baselineTime) / (latest - baseline)
      : chain.blockTimeSeconds;

  const estimate = Math.max(0, latest - Math.ceil((latestTime - timestamp) / secondsPerBlock));

  const span = chain.maxLogRange;
  // Alternate after and before the estimate, widening each round.
  for (let round = 0; round < LIMITS.evmLaunchSearchRounds; round++) {
    for (const direction of [1, -1]) {
      const start = estimate + direction * round * span;
      if (start < 0) continue;

      const logs = await client
        .logs(token, TRANSFER_TOPIC, start, start + span - 1)
        .catch(() => []);

      const mint = logs.find((log) => topicToAddress(log.topics[1] ?? '') === ZERO_ADDRESS);
      if (mint) return hexToNumber(mint.blockNumber);
    }
  }

  return null;
}

/**
 * The block a contract first existed at, proven by binary search.
 *
 * `hintTimestamp` only narrows the starting bracket; the search proves the
 * answer either way, so a wrong hint costs calls rather than correctness.
 * Throws on a non-archive node, which the caller treats as "use the fallback".
 */
export async function findDeploymentBlock(
  client: EvmClient,
  chain: ResolvedEvmChain,
  token: string,
  hintTimestamp: number | null,
): Promise<number | null> {
  const latest = await client.blockNumber();

  // Nothing deployed at all: not a contract address.
  if ((await client.codeAt(token, 'latest')) === '0x') return null;

  let low = 0;
  let high = latest;

  if (hintTimestamp !== null) {
    const latestTime = await client.blockTimestamp(latest);
    if (latestTime !== null && hintTimestamp < latestTime) {
      const behind = Math.ceil((latestTime - hintTimestamp) / chain.blockTimeSeconds);
      // Generous either side: block times drift, and being wrong here only
      // means the search below widens again.
      low = Math.max(0, latest - Math.ceil(behind * 1.5));
      high = Math.min(latest, latest - Math.floor(behind * 0.5));

      // If the guess was late, the contract already exists at `low` — fall
      // back to searching the whole chain rather than trusting the hint.
      if ((await client.codeAt(token, low)) !== '0x') {
        low = 0;
        high = latest;
      }
    }
  }

  // Invariant: no code at `low`, code at `high`.
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if ((await client.codeAt(token, mid)) === '0x') low = mid;
    else high = mid;
  }

  return high;
}

/**
 * Read the launch window starting from the deployment block.
 *
 * Bundlers are wallets that received tokens in the same block as the mint (or
 * within the configured block window): that is one transaction bundle, not
 * separate people reacting. Snipers are the rest of the first N seconds,
 * disjoint from bundlers so the score cannot count a wallet twice.
 */
export async function readEvmLaunch(
  client: EvmClient,
  chain: ResolvedEvmChain,
  token: string,
  deploymentBlock: number,
  decimals: number,
): Promise<EvmLaunch | null> {
  const windowBlocks = Math.ceil(DETECTION.sniperWindowSeconds / chain.blockTimeSeconds);
  const span = Math.max(windowBlocks, DETECTION.bundleBlockWindow + 1);

  const moves = chain.useAssetTransfers
    ? await windowFromTransfers(client, token, deploymentBlock, span)
    : await windowFromLogs(client, chain, token, deploymentBlock, span);

  if (moves.length === 0) return null;

  const mint = moves.find((m) => m.from === ZERO_ADDRESS);
  if (!mint) return null;

  const mintBlock = mint.block;
  const mintTime = (await client.blockTimestamp(mintBlock)) ?? 0;
  const dev = (await client.transactionSender(mint.txHash))?.toLowerCase() ?? null;
  if (!dev) return null;

  const scale = 10 ** decimals;
  const bought: Record<string, number> = {};
  const bundlers = new Set<string>();
  const snipers = new Set<string>();
  let devInitialUiAmount = 0;

  const maxBundleBlock = mintBlock + DETECTION.bundleBlockWindow;
  const truncated = moves.length > LIMITS.maxEarlyTransactions;

  for (const move of moves.slice(0, LIMITS.maxEarlyTransactions)) {
    const { from, to, block } = move;
    const amount = move.rawAmount !== null ? Number(move.rawAmount) / scale : (move.uiAmount ?? 0);

    // Net, not gross: tokens cycle between wallets during a launch, and
    // counting every inbound transfer lets a set of wallets appear to have
    // taken more than the entire supply.
    if (from !== ZERO_ADDRESS) bought[from] = (bought[from] ?? 0) - amount;
    if (to === ZERO_ADDRESS) continue;
    bought[to] = (bought[to] ?? 0) + amount;

    if (to === dev) {
      devInitialUiAmount += amount;
      continue; // The dev is reported separately, never as a bundler or sniper.
    }

    if (block <= maxBundleBlock) bundlers.add(to);
    else snipers.add(to);
  }

  for (const wallet of bundlers) snipers.delete(wallet);

  /*
   * Drop contracts from both sets.
   *
   * At launch the deployer sends most of the supply to the liquidity pool, and
   * the pool is a contract receiving a transfer in the mint block — which is
   * exactly the shape of a bundler. Left in, it made a perfectly ordinary
   * launch report "bundlers bought 98.57% of supply" and scored it high.
   * Routers and vaults have the same problem.
   */
  await removeContracts(client, bundlers);
  await removeContracts(client, snipers);

  for (const [wallet, amount] of Object.entries(bought)) {
    if (amount <= 0 || (!bundlers.has(wallet) && !snipers.has(wallet) && wallet !== dev)) {
      delete bought[wallet];
    }
  }

  return {
    txHash: mint.txHash,
    block: mintBlock,
    timestamp: mintTime,
    dev,
    devInitialUiAmount,
    bundlers: [...bundlers],
    snipers: [...snipers],
    bought,
    truncated,
  };
}

/** One token movement, however we read it. */
interface Move {
  from: string;
  to: string;
  block: number;
  txHash: string;
  /** Raw base units when we have them. */
  rawAmount: bigint | null;
  /** Decimal-adjusted, when that is all the source gives. */
  uiAmount: number | null;
}

function toMove(t: AssetTransfer): Move {
  return {
    from: t.from.toLowerCase(),
    to: (t.to ?? ZERO_ADDRESS).toLowerCase(),
    block: hexToNumber(t.blockNum),
    txHash: t.hash,
    rawAmount: t.rawContract.value ? hexToBigInt(t.rawContract.value) : null,
    uiAmount: t.value,
  };
}

async function windowFromTransfers(
  client: EvmClient,
  token: string,
  fromBlock: number,
  span: number,
): Promise<Move[]> {
  const { transfers } = await assetTransfers(client, token, {
    fromBlock: `0x${fromBlock.toString(16)}`,
    maxPages: 1,
    pageSize: LIMITS.maxEarlyTransactions,
  });

  return transfers.map(toMove).filter((m) => m.block <= fromBlock + span);
}

async function windowFromLogs(
  client: EvmClient,
  chain: ResolvedEvmChain,
  token: string,
  fromBlock: number,
  span: number,
): Promise<Move[]> {
  const logs = await client.logs(
    token,
    TRANSFER_TOPIC,
    fromBlock,
    fromBlock + Math.min(span, chain.maxLogRange),
  );

  return logs.map((log) => ({
    from: topicToAddress(log.topics[1] ?? ''),
    to: topicToAddress(log.topics[2] ?? ''),
    block: hexToNumber(log.blockNumber),
    txHash: log.transactionHash,
    rawAmount: hexToBigInt(log.data),
    uiAmount: null,
  }));
}

/** Remove every address in the set that has bytecode, in place. */
async function removeContracts(client: EvmClient, wallets: Set<string>): Promise<void> {
  for (const wallet of [...wallets]) {
    const code = await client.codeAt(wallet, 'latest').catch(() => '0x');
    if (code !== '0x') wallets.delete(wallet);
  }
}

/** Transfer logs between two blocks, respecting this endpoint's range limit. */
export async function transfersInRange(
  client: EvmClient,
  chain: ResolvedEvmChain,
  token: string,
  fromBlock: number,
  toBlock: number,
  maxQueries: number,
): Promise<{ logs: EvmLog[]; complete: boolean }> {
  const out: EvmLog[] = [];
  let cursor = fromBlock;
  let queries = 0;

  while (cursor <= toBlock) {
    if (queries >= maxQueries) return { logs: out, complete: false };
    const end = Math.min(cursor + chain.maxLogRange - 1, toBlock);
    out.push(...(await client.logs(token, TRANSFER_TOPIC, cursor, end)));
    queries++;
    cursor = end + 1;
  }

  return { logs: out, complete: true };
}
