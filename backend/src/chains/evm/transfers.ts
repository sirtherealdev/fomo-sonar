/**
 * Token transfers via Alchemy's `alchemy_getAssetTransfers`.
 *
 * This replaces `eth_getLogs` wherever a key is configured, and it is not a
 * minor optimisation. Free-plan `eth_getLogs` accepts a ten-block range, which
 * cannot rebuild a holder set or even reliably cover a launch window. This
 * method takes an unbounded range, pages through results, and returns them in
 * chain order.
 *
 * Ascending order is what makes the launch cheap: the first transfer a token
 * ever had is its mint, so one call finds a launch that otherwise took a
 * twenty-eight-call binary search over historical state — and works on
 * endpoints that have no historical state at all.
 */

import type { EvmClient } from './rpc.ts';

export interface AssetTransfer {
  blockNum: string;
  hash: string;
  from: string;
  to: string | null;
  /** Decimal-adjusted by Alchemy; null when the token has odd decimals. */
  value: number | null;
  rawContract: { value?: string; decimal?: string };
}

interface TransfersPage {
  transfers: AssetTransfer[];
  pageKey?: string;
}

/**
 * Transfers of one token, oldest first.
 *
 * `maxPages` bounds the cost for a token with a long history; the caller is
 * told whether it saw everything so it can report a partial holder set rather
 * than a confident wrong number.
 */
export async function assetTransfers(
  client: EvmClient,
  token: string,
  options: { fromBlock?: string; maxPages: number; pageSize?: number },
): Promise<{ transfers: AssetTransfer[]; complete: boolean }> {
  const out: AssetTransfer[] = [];
  let pageKey: string | undefined;

  for (let page = 0; page < options.maxPages; page++) {
    const params: Record<string, unknown> = {
      fromBlock: options.fromBlock ?? '0x0',
      toBlock: 'latest',
      contractAddresses: [token],
      category: ['erc20'],
      order: 'asc',
      maxCount: `0x${(options.pageSize ?? 1000).toString(16)}`,
      excludeZeroValue: false,
    };
    if (pageKey) params['pageKey'] = pageKey;

    const result = await client.rpc<TransfersPage>('alchemy_getAssetTransfers', [params]);
    out.push(...result.transfers);

    if (!result.pageKey) return { transfers: out, complete: true };
    pageKey = result.pageKey;
  }

  return { transfers: out, complete: false };
}

/** The mint: a token's very first transfer, which always comes from nowhere. */
export async function firstTransfer(
  client: EvmClient,
  token: string,
): Promise<AssetTransfer | null> {
  const { transfers } = await assetTransfers(client, token, { maxPages: 1, pageSize: 1 });
  return transfers[0] ?? null;
}
