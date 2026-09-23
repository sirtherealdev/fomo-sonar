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

  /**
   * When to label a holder as high-activity — likely an exchange or protocol
   * wallet rather than a person.
   *
   * Labelled, never excluded. Our structural pool test catches PDAs, but
   * plenty of infrastructure runs on ordinary keypairs, and those would
   * otherwise read as one whale holding most of the supply.
   *
   * Both conditions must hold. Activity alone is useless: an active memecoin
   * trader has thousands of transactions, and labelling every 2% holder as a
   * suspected exchange is noise that teaches the user to ignore the label.
   * The label only earns its place on a position big enough to change how the
   * concentration number reads.
   */
  highActivityMinPct: 15,

  /**
   * Insiders: wallets the dev funded, or that funded the dev. Same-source money
   * plus a position in the token is the classic "team wallet" shape.
   */
  insiderMaxHops: 1,
} as const;

export const SCORING = {
  /**
   * Relative weights. They do not need to sum to 100 — they are renormalized
   * over whichever factors were actually measurable for this token.
   */
  weights: {
    devHolding: 16,
    devSold: 8,
    bundles: 20,
    topHolders: 15,
    snipers: 11,
    freshWallets: 8,
    insiders: 10,
    authorities: 12,
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
    /** Combined holding of dev-linked wallets, % of supply. */
    insiders: { safe: 3, danger: 20 },
    /**
     * Authority risk, already expressed 0..100 by the detector:
     * 0 = both revoked, 50 = freeze authority live, 100 = mint authority live.
     * A live mint authority means the supply you are looking at is not final.
     */
    authorities: { safe: 0, danger: 100 },
  },

  /**
   * Floors: one catastrophic signal cannot be averaged away.
   *
   * A weighted sum over eight factors has a structural flaw — if bundled
   * wallets hold half the supply but everything else looks fine, the average
   * lands in "medium" and the panel reassures someone it should be warning.
   *
   * So: if a factor's measured value reaches `atLeast`, the final score cannot
   * fall below `floor`, whatever the other factors say. The weighted sum still
   * decides everything below that line.
   */
  criticalFloors: {
    /** Same-slot wallets holding a quarter of the supply. */
    bundles: { atLeast: 25, floor: 72 },
    /** Ten wallets holding half the supply. */
    topHolders: { atLeast: 50, floor: 70 },
    /** The dev still sitting on a sixth of the supply. */
    devHolding: { atLeast: 15, floor: 68 },
    /** Launch snipers holding a third of the supply. */
    snipers: { atLeast: 30, floor: 66 },
    /** Dev-linked wallets holding a sixth of the supply. */
    insiders: { atLeast: 15, floor: 66 },
    /** Brand-new wallets holding two fifths of the supply. */
    freshWallets: { atLeast: 40, floor: 62 },
    /** The dev has emptied its allocation. */
    devSold: { atLeast: 90, floor: 55 },
    /** Mint authority is live: the supply you see is not final. */
    authorities: { atLeast: 100, floor: 75 },
  },

  /**
   * How much of the scoring weight must be measurable before we are willing to
   * put a label on a token.
   *
   * Found the hard way: a token one day old had already outrun our signature
   * cap, so dev, bundler and sniper detection all dropped out — and the
   * remaining factors produced a confident "3/100 low" on a token nobody had
   * actually checked for bundling. Below this coverage we report 'unknown'.
   */
  minCoverageForLevel: 70,

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

  /**
   * Signatures fetched per wallet when profiling it.
   *
   * This costs the same single RPC call at 20 as at 1000 — only the response
   * is bigger — so ask for the maximum. It matters: below this many lifetime
   * transactions we learn the wallet's exact age and activity; above it we
   * learn nothing but "busy". At 20 we were blind to any wallet that had
   * traded more than twenty times, including wallets created an hour ago.
   */
  walletHistoryPageSize: 1000,

  /**
   * Parallel in-flight Helius requests.
   *
   * The Helius free plan allows 10 requests/sec, so 5 leaves headroom for the
   * sequential calls happening alongside the parallel batch. On a paid plan
   * (50 rps on Developer) this can go to 20+ and the analysis gets noticeably
   * faster. 429s are retried with backoff either way, so a too-high value
   * costs latency rather than correctness.
   */
  concurrency: 5,

  /**
   * Request spacing, in requests per second.
   *
   * Limiting concurrency alone is not enough: sequential calls run alongside
   * the parallel batch, and the combined burst trips the provider's limit.
   * This evenly spaces every outbound request instead.
   *
   * Helius allows 10 rps on the free plan and 50 on Developer. 8 leaves
   * headroom for retries without leaving throughput on the table.
   */
  maxRequestsPerSecond: 8,

  /**
   * Per-request retries on 429/5xx, with exponential backoff
   * (400ms, 800ms, 1.6s, 3.2s, 6.4s). Sustained rate limiting needs a budget
   * this long; three short retries just fail slower.
   */
  maxRetries: 5,
  retryBaseDelayMs: 400,
} as const;

export const CACHE = {
  /** Per-mint response TTL in Workers KV. */
  ttlSeconds: 60,
} as const;
