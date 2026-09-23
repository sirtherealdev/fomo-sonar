/**
 * Every tunable number in the product lives here.
 *
 * Two kinds of knob:
 *  - DETECTION: what counts as a bundler / sniper / fresh wallet.
 *  - SCORING:   how much each signal moves the risk score.
 *  - LIMITS:    how much data we are willing to pull per analysis.
 *
 * LIMITS matter operationally: a Cloudflare Worker gets 50 subrequests on the
 * free plan and 1000 on paid. The worst-case call count is roughly
 *   signaturePages + earlyTxBatches + holderPages + freshWalletChecks + 4
 * so keep an eye on meta.rpcCalls when tuning.
 */

export const DETECTION = {
  /**
   * Bundlers: wallets that bought in the creation slot, or within this many
   * slots after it. A Solana slot is ~400ms, so 2 slots ~= same bundle/block
   * neighbourhood rather than a human reacting.
   */
  bundleSlotWindow: 2,

  /** Snipers: buyers within this many seconds of the creation transaction. */
  sniperWindowSeconds: 10,

  /**
   * Funding clusters: wallets whose first inbound SOL came from the same
   * address. A cluster needs at least this many wallets before we report it —
   * two wallets funded by the same CEX hot wallet is noise.
   */
  minClusterSize: 3,

  /** Fresh wallet: fewer than this many transactions in its whole history. */
  freshWalletMaxTxCount: 20,

  /** Fresh wallet: first transaction newer than this. */
  freshWalletMaxAgeHours: 24,

  /** How many top holders we report (and score on). */
  topHolderCount: 10,
} as const;

export const SCORING = {
  /**
   * Relative weights. They do not need to sum to 100 — they are renormalized
   * over whichever factors were actually measurable for this token.
   */
  weights: {
    devHolding: 20,
    devSold: 10,
    bundles: 25,
    topHolders: 20,
    snipers: 15,
    freshWallets: 10,
  },

  /**
   * Each factor is a percentage. `safe` scores 0, `danger` scores 1, values in
   * between ramp linearly. Above `danger` clamps to 1.
   */
  ramps: {
    /** Dev's current holding, % of supply. */
    devHolding: { safe: 1, danger: 10 },
    /** % of the dev's initial allocation that has left the wallet. */
    devSold: { safe: 20, danger: 80 },
    /** Combined holding of same-slot buyers, % of supply. */
    bundles: { safe: 5, danger: 30 },
    /** Combined holding of the top 10 real wallets, % of supply. */
    topHolders: { safe: 15, danger: 50 },
    /** Combined holding of snipers, % of supply. */
    snipers: { safe: 5, danger: 25 },
    /** Combined holding of fresh wallets, % of supply. */
    freshWallets: { safe: 10, danger: 40 },
  },

  /** Score thresholds for the three-band label. */
  levels: { mediumAt: 35, highAt: 65 },
} as const;

export const LIMITS = {
  /**
   * Pages of 1000 signatures we will walk backwards through the mint's history
   * looking for the creation transaction. RPC only returns newest-first, so
   * this is the only way to reach the oldest transaction.
   * Hitting this cap makes dev/bundles/snipers unavailable rather than wrong.
   */
  maxSignaturePages: 30,

  /** Parsed transactions we pull for the early window (Helius batches 100/call). */
  maxEarlyTransactions: 500,

  /** Pages of 1000 token accounts (DAS getTokenAccounts) for the holder map. */
  maxHolderPages: 10,

  /** Wallets we check for freshness. 1 RPC call each, so this is the big lever. */
  maxFreshWalletChecks: 40,

  /** Parallel in-flight Helius requests. Helius free tier tolerates ~10 rps. */
  concurrency: 8,

  /** Per-request retries on 429/5xx, with exponential backoff. */
  maxRetries: 3,
  retryBaseDelayMs: 250,
} as const;

export const CACHE = {
  /** Per-mint response TTL in Workers KV. */
  ttlSeconds: 60,
} as const;
