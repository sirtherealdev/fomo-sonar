/**
 * Thin Helius client. The only thing in this codebase that talks to the network.
 *
 * Two surfaces:
 *  - JSON-RPC (standard Solana methods + Helius DAS extensions)
 *  - Enhanced Transactions API (human-parsed transfers, saves us decoding IDLs)
 *
 * Every call is counted so an analysis can report what it cost.
 */

import { LIMITS } from '../../config.ts';

export class HeliusError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HeliusError';
  }
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
}

/** The SPL mint account, parsed. Supply, decimals and both authorities in one call. */
export interface MintAccount {
  supply: string;
  decimals: number;
  /** null means revoked: nobody can mint more. */
  mintAuthority: string | null;
  /** null means revoked: nobody can freeze balances. */
  freezeAuthority: string | null;
}

/** DAS metadata, narrowed to the fields the panel header needs. */
export interface AssetMetadata {
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
}

export interface LargestAccount {
  /** Token account address, not the owning wallet. */
  address: string;
  amount: string;
}

export interface DasTokenAccount {
  address: string;
  owner: string;
  amount: number | string;
}

export interface AccountInfo {
  /** Program that owns this account. System Program => a plain wallet. */
  owner: string;
  lamports: number;
  executable: boolean;
}

/** Shape of the Enhanced Transactions API response, narrowed to what we use. */
export interface EnhancedTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  feePayer: string;
  type: string;
  source: string;
  transactionError: unknown | null;
  tokenTransfers: {
    fromUserAccount: string | null;
    toUserAccount: string | null;
    fromTokenAccount: string | null;
    toTokenAccount: string | null;
    tokenAmount: number;
    mint: string;
  }[];
  nativeTransfers: {
    fromUserAccount: string | null;
    toUserAccount: string | null;
    amount: number;
  }[];
  accountData?: { account: string }[];
}

export class HeliusClient {
  private callCount = 0;
  /** Timestamp the next request is allowed to go out, for even spacing. */
  private nextSlotAt = 0;
  private readonly rpcUrl: string;
  private readonly enhancedUrl: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new HeliusError('HELIUS_API_KEY is not set');
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    this.enhancedUrl = `https://api.helius.xyz/v0/transactions?api-key=${apiKey}`;
  }

  /** Helius calls made so far. Surfaced in the API response as meta.rpcCalls. */
  get calls(): number {
    return this.callCount;
  }

  async rpc<T>(method: string, params: unknown): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: method, method, params });
    const json = await this.send<{ result?: T; error?: { message: string; code: number } }>(
      this.rpcUrl,
      body,
    );
    if (json.error) throw new HeliusError(`${method}: ${json.error.message}`);
    if (json.result === undefined) throw new HeliusError(`${method}: empty result`);
    return json.result;
  }

  /** POST up to 100 signatures, get back human-parsed transactions. */
  async parsedTransactions(signatures: string[]): Promise<EnhancedTransaction[]> {
    if (signatures.length === 0) return [];
    if (signatures.length > 100) throw new HeliusError('parsedTransactions takes at most 100');
    return this.send<EnhancedTransaction[]>(this.enhancedUrl, JSON.stringify({ transactions: signatures }));
  }

  /**
   * Hold every caller to an even request cadence.
   *
   * Reserving a slot rather than sleeping a fixed amount means concurrent
   * callers queue instead of all firing at once the moment a delay elapses.
   */
  private async reserveSlot(): Promise<void> {
    const spacingMs = 1000 / LIMITS.maxRequestsPerSecond;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + spacingMs;
    if (slot > now) await sleep(slot - now);
  }

  private async send<T>(url: string, body: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(LIMITS.retryBaseDelayMs * 2 ** (attempt - 1));
      }
      await this.reserveSlot();
      this.callCount++;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });

        // 429 and 5xx are worth retrying; 4xx is our bug or a bad key.
        if (res.status === 429 || res.status >= 500) {
          // Respect Retry-After when the server tells us how long to wait.
          const retryAfter = Number(res.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            this.nextSlotAt = Date.now() + retryAfter * 1000;
          }
          lastError = new HeliusError(`Helius returned ${res.status}`, res.status);
          continue;
        }
        if (!res.ok) {
          throw new HeliusError(`Helius returned ${res.status}: ${await res.text()}`, res.status);
        }
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof HeliusError && err.status !== undefined && err.status < 500) throw err;
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new HeliusError('Helius request failed');
  }

  // --- Convenience wrappers -------------------------------------------------

  /**
   * One call for supply, decimals and the two authorities. Cheaper than
   * getTokenSupply + a separate authority lookup, and the authorities are two
   * of the headline safety checks.
   */
  async getMintAccount(mint: string): Promise<MintAccount> {
    const res = await this.rpc<{
      value: {
        data?: {
          parsed?: {
            info?: {
              supply?: string;
              decimals?: number;
              mintAuthority?: string | null;
              freezeAuthority?: string | null;
            };
          };
        };
      } | null;
    }>('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);

    const info = res.value?.data?.parsed?.info;
    if (!info || info.supply === undefined || info.decimals === undefined) {
      throw new HeliusError(`${mint} is not an SPL mint account`);
    }

    return {
      supply: info.supply,
      decimals: info.decimals,
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
    };
  }

  /**
   * DAS metadata. Best-effort: tokens that predate DAS indexing, or that were
   * created seconds ago, can 404 here. Returns nulls rather than throwing,
   * because a missing token name must never fail a risk report.
   */
  async getAssetMetadata(mint: string): Promise<AssetMetadata> {
    try {
      const asset = await this.rpc<{
        content?: {
          metadata?: { name?: string; symbol?: string };
          links?: { image?: string };
        };
      }>('getAsset', { id: mint, displayOptions: { showFungible: true } });

      return {
        name: asset.content?.metadata?.name ?? null,
        symbol: asset.content?.metadata?.symbol ?? null,
        imageUrl: asset.content?.links?.image ?? null,
      };
    } catch {
      return { name: null, symbol: null, imageUrl: null };
    }
  }

  async getSignatures(address: string, before?: string, limit = 1000): Promise<SignatureInfo[]> {
    const options: Record<string, unknown> = { limit };
    if (before) options['before'] = before;
    return this.rpc<SignatureInfo[]>('getSignaturesForAddress', [address, options]);
  }

  async getTokenLargestAccounts(mint: string): Promise<LargestAccount[]> {
    const res = await this.rpc<{ value: LargestAccount[] }>('getTokenLargestAccounts', [mint]);
    return res.value;
  }

  /**
   * DAS extension: every token account for a mint, 1000 at a time. This is what
   * lets us compute holdings for arbitrary wallet sets in one pass instead of
   * one RPC call per wallet.
   */
  async getTokenAccountsPage(mint: string, page: number, limit = 1000): Promise<DasTokenAccount[]> {
    const res = await this.rpc<{ token_accounts?: DasTokenAccount[] }>('getTokenAccounts', {
      mint,
      page,
      limit,
      options: { showZeroBalance: false },
    });
    return res.token_accounts ?? [];
  }

  /**
   * Account owners only (dataSlice keeps the response tiny). Used to tell a
   * real wallet (owned by the System Program) from a program-controlled
   * account such as an AMM vault.
   */
  async getAccountOwners(addresses: string[]): Promise<(AccountInfo | null)[]> {
    if (addresses.length === 0) return [];
    const res = await this.rpc<{ value: (AccountInfo | null)[] }>('getMultipleAccounts', [
      addresses,
      { encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
    ]);
    return res.value;
  }

  /** Token account -> owning wallet, for the largest-accounts list. */
  async getTokenAccountOwners(tokenAccounts: string[]): Promise<(string | null)[]> {
    if (tokenAccounts.length === 0) return [];
    const res = await this.rpc<{
      value: ({ data?: { parsed?: { info?: { owner?: string } } } } | null)[];
    }>('getMultipleAccounts', [tokenAccounts, { encoding: 'jsonParsed' }]);
    return res.value.map((acc) => acc?.data?.parsed?.info?.owner ?? null);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
