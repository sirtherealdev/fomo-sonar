/**
 * Minimal Ethereum JSON-RPC client.
 *
 * Deliberately not a library: we use nine methods, all of which take and
 * return hex strings, and a dependency would cost more to audit than this
 * costs to read. Shares the shape of the Solana client — counted calls, evenly
 * spaced requests, retries on 429 and 5xx — so both chains behave the same
 * under load.
 */

import { LIMITS } from '../../config.ts';
import { hexToNumber, toHex } from './helpers.ts';

export class EvmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EvmError';
  }
}

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

export interface EvmBlock {
  number: string;
  timestamp: string;
}

export class EvmClient {
  private callCount = 0;
  private nextSlotAt = 0;

  constructor(
    private readonly rpcUrl: string,
    private readonly requestsPerSecond: number,
  ) {}

  get calls(): number {
    return this.callCount;
  }

  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    // The method name travels with the error: "RPC returned 403" on its own
    // says nothing about which call a public endpoint objected to.
    const json = await this.send<{ result?: T; error?: { message: string } }>(body, method);

    if (json.error) throw new EvmError(`${method}: ${json.error.message}`);
    if (json.result === undefined) throw new EvmError(`${method}: empty result`);
    return json.result;
  }

  private async reserveSlot(): Promise<void> {
    const spacingMs = 1000 / this.requestsPerSecond;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + spacingMs;
    if (slot > now) await sleep(slot - now);
  }

  private async send<T>(body: string, method: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
      if (attempt > 0) await sleep(LIMITS.retryBaseDelayMs * 2 ** (attempt - 1));
      await this.reserveSlot();
      this.callCount++;

      try {
        const res = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            /*
             * Not optional. Several public endpoints — publicnode's among
             * them — answer 403 to a request with no User-Agent, which reads
             * as a permissions failure and cost an afternoon to find. Naming
             * ourselves is also the polite thing to do on a free endpoint.
             */
            'user-agent': 'scope-scanner/0.1 (+https://github.com/scope-scanner)',
          },
          body,
        });

        /*
         * 403 is a throttle here, not a permissions problem: publicnode
         * endpoints answer 403 rather than 429 when a burst is too fast, and
         * every method works again once the pace drops.
         */
        if (res.status === 429 || res.status === 403 || res.status >= 500) {
          lastError = new EvmError(`${method}: RPC returned ${res.status}`, res.status);
          continue;
        }
        if (!res.ok) {
          // The body is where providers explain themselves — "range too
          // large", "not enabled for this app". A bare status code sent me
          // hunting twice; carrying the reason costs one read.
          const detail = (await res.text().catch(() => '')).slice(0, 200);
          throw new EvmError(`${method}: RPC returned ${res.status} ${detail}`, res.status);
        }

        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof EvmError && err.status !== undefined && err.status < 500) throw err;
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new EvmError(`${method}: RPC request failed`);
  }

  // --- Convenience wrappers -------------------------------------------------

  async blockNumber(): Promise<number> {
    return hexToNumber(await this.rpc<string>('eth_blockNumber', []));
  }

  async blockTimestamp(block: number): Promise<number | null> {
    const b = await this.rpc<EvmBlock | null>('eth_getBlockByNumber', [toHex(block), false]);
    return b ? hexToNumber(b.timestamp) : null;
  }

  /** Empty ("0x") means no contract existed at that block. */
  async codeAt(address: string, block: number | 'latest'): Promise<string> {
    const tag = block === 'latest' ? 'latest' : toHex(block);
    return this.rpc<string>('eth_getCode', [address, tag]);
  }

  async logs(address: string, topic0: string, fromBlock: number, toBlock: number): Promise<EvmLog[]> {
    return this.rpc<EvmLog[]>('eth_getLogs', [
      { address, topics: [topic0], fromBlock: toHex(fromBlock), toBlock: toHex(toBlock) },
    ]);
  }

  /** A wallet's nonce is its exact lifetime transaction count. One call, no pagination. */
  async transactionCount(address: string): Promise<number> {
    return hexToNumber(await this.rpc<string>('eth_getTransactionCount', [address, 'latest']));
  }

  async transactionSender(hash: string): Promise<string | null> {
    const tx = await this.rpc<{ from?: string } | null>('eth_getTransactionByHash', [hash]);
    return tx?.from ?? null;
  }

  /** Timestamp of a block, by number in hex as Alchemy returns it. */
  async blockTimestampHex(blockHex: string): Promise<number | null> {
    const b = await this.rpc<EvmBlock | null>('eth_getBlockByNumber', [blockHex, false]);
    return b ? hexToNumber(b.timestamp) : null;
  }

  /** Read-only contract call. `data` is the selector plus encoded arguments. */
  async call(to: string, data: string): Promise<string> {
    return this.rpc<string>('eth_call', [{ to, data }, 'latest']);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
