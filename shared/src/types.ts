/**
 * The contract between the backend and the extension.
 *
 * Percentages are always numbers in 0..100 with 2 decimals, never strings.
 * Raw token amounts are strings (base units) because they overflow Number.
 */

/**
 * Chains we can analyse. The ids match DexScreener's, because the market layer
 * is already multichain and there is no reason to invent a second vocabulary.
 */
export type ChainId =
  | 'solana'
  | 'base'
  | 'bsc' // BNB Chain
  | 'monad'
  | 'robinhood' // Robinhood Chain
  | 'arc'
  | 'ethereum';

/** Chain families that share a set of primitives, and therefore an adapter. */
export type ChainFamily = 'svm' | 'evm';

/**
 * `unknown` is not a fourth severity — it means we could not measure enough to
 * have an opinion. A green "low" on a token whose launch we could not read is
 * worse than showing nothing, because it reads as a clearance.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

/** Why a detector could not produce a number. Surfaced so the UI never shows a fake 0. */
export type Unavailable =
  | 'creation-not-found' // we could not walk back to the mint's first transaction
  | 'no-early-trades' // creation found, but no trades inside the analysis window
  | 'no-dev-allocation' // dev never held any of the supply, so "sold %" is meaningless
  | 'holder-set-partial' // holder pagination hit its cap, percentages would understate
  | 'no-market-data' // the token is not indexed on any DEX we can read
  | 'not-supported-on-chain' // this chain's adapter cannot measure this signal
  | 'pending'; // still being measured; a later phase of this response will fill it in

export interface HolderEntry {
  /** Wallet that owns the token account, not the token account itself. */
  address: string;
  /** Raw amount in base units. */
  amount: string;
  /** Share of total supply, 0..100. */
  pct: number;
  /** Lifetime transaction count, or null when the wallet is busier than we count. */
  txCount: number | null;
  /**
   * The wallet has far more history than any launch participant plausibly
   * would — an exchange or protocol wallet rather than a person.
   *
   * It is labelled, never excluded: dropping it would silently reshape the
   * concentration number, and we cannot prove what it is from chain data alone.
   */
  highActivity: boolean;
}

export interface ExcludedAccount {
  address: string;
  pct: number;
  reason: 'liquidity-pool' | 'program-owned' | 'burn' | 'known-program';
}

/** Wallets whose first SOL arrived from the same source address. */
export interface FundingCluster {
  funder: string;
  wallets: string[];
  /** Combined current holding of the cluster, 0..100 of supply. */
  holdingPct: number;
}

export interface DevReport {
  address: string | null;
  /** Current holding as share of total supply, 0..100. */
  holdingPct: number;
  /** Share of the dev's initial allocation that has since left the wallet, 0..100. */
  soldPct: number;
  unavailable?: Unavailable;
}

export interface BundleReport {
  /** Wallets that bought in the same slot (or within the configured slot window) as creation. */
  walletCount: number;
  /** Share of supply they hold right now, 0..100. */
  holdingPct: number;
  /** Share of supply they took at launch, 0..100. Zero holding does not undo this. */
  boughtPct: number;
  clusters: FundingCluster[];
  unavailable?: Unavailable;
}

export interface TopHolderReport {
  /** Combined share of the top 10 *real* wallets, 0..100. Pools/programs/burns excluded. */
  top10Pct: number;
  list: HolderEntry[];
  /** What we filtered out and why — shown so the number can be audited. */
  excluded: ExcludedAccount[];
}

export interface CountAndHolding {
  count: number;
  /** Share of supply these wallets hold right now, 0..100. */
  holdingPct: number;
  /**
   * Share of supply they received at launch, 0..100, or null where the idea
   * does not apply (fresh wallets, insiders).
   *
   * Current holding alone lies about the most common rug shape: wallets that
   * took half the supply in the first slot and have already sold it show 0%.
   */
  boughtPct: number | null;
  unavailable?: Unavailable;
}

/** Per-component contribution to the risk score, so the UI can explain the number. */
export interface RiskFactor {
  key:
    | 'devHolding'
    | 'devSold'
    | 'bundles'
    | 'topHolders'
    | 'snipers'
    | 'freshWallets'
    | 'insiders'
    | 'authorities';
  /** The measured percentage this factor scored on. */
  value: number;
  /** 0..1 after the safe→danger ramp. */
  normalized: number;
  /** Weight actually applied (weights are renormalized when a factor is unavailable). */
  weight: number;
  /** Points this factor added to the final 0..100 score. */
  points: number;
}

/** Identity, for the panel header. */
export interface TokenInfo {
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  websites: string[];
  socials: { type: string; url: string }[];
}

/**
 * Can anyone still change the rules of this token?
 *
 * The question is the same on every chain, the mechanism is not: on Solana it
 * is the mint and freeze authorities on the mint account, on EVM it is an
 * un-renounced owner with a mint or pause function. Adapters answer the
 * question; the panel never has to know which chain it is looking at.
 */
export interface SecurityInfo {
  /** Someone can still create new supply. */
  canMintMore: boolean;
  /** Someone can still freeze or pause balances. */
  canFreeze: boolean;
  /**
   * Someone can move tokens out of any wallet without the holder's consent.
   *
   * On Solana this is the Token-2022 permanent delegate. It is the severest
   * of these powers, and no risk panel we compared against surfaces it.
   */
  canSeize: boolean;
  /**
   * Every transfer runs third-party code that can block or alter it — the
   * Token-2022 transfer hook. Whatever it does today, it can do something
   * else tomorrow.
   */
  hasTransferHook: boolean;
  /** Tax taken on every transfer, in percent. 0 when there is none. */
  transferTaxPct: number;
  /** An authority can still change that tax, including adding or raising one. */
  taxCanChange: boolean;
  /** Address holding that power, when there is a single one. */
  controller: string | null;
  /** Chain-specific detail, for the "why" line in the panel. */
  detail: string | null;
}

/** Headline market numbers. Third-party data, so every field can be null. */
export interface MarketInfo {
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns24h: { buys: number; sells: number } | null;
  /** Which DEX the deepest pool lives on, e.g. "raydium", "pumpswap". */
  dexId: string | null;
  pairAddress: string | null;
  pairCreatedAt: string | null;
  /**
   * Creation time of the *earliest* pool for this token, across every pool.
   *
   * Not the same as `pairCreatedAt`, which belongs to the deepest pool. For a
   * token that migrated, the deepest pool was created long after the launch —
   * using it as a launch hint sent a block scan four minutes past the real
   * creation and it confidently reported a passing trade as the launch.
   */
  firstPairCreatedAt: string | null;
  /** True when the team has paid for a DexScreener token profile. */
  dexPaid: boolean | null;
  source: 'dexscreener';
}

/** Set when a single signal was severe enough to set a minimum risk score. */
export interface ScoreFloor {
  key: RiskFactor['key'];
  /** The measured value that triggered it. */
  value: number;
  /** The minimum score it forced. */
  floor: number;
}

export interface AnalyzeMeta {
  /** Total supply in base units. */
  supply: string;
  decimals: number;
  /** ISO timestamp of the mint creation transaction, if found. */
  createdAt: string | null;
  creationSignature: string | null;
  /**
   * How the launch was read: by walking the token's history, or by scanning
   * the blocks around its creation. Null when we could not read it at all.
   */
  launchSource: 'history' | 'block-scan' | null;
  /** Number of Helius calls this analysis cost. Useful for tuning caps. */
  rpcCalls: number;
  durationMs: number;
  /** True when any detector was unavailable or any data set was truncated. */
  partial: boolean;
  /** Set when the response came from cache. */
  cached?: boolean;
}

export interface AnalyzeResponse {
  /** Contract address: a base58 mint on Solana, a 0x address on EVM chains. */
  mint: string;
  chain: ChainId;
  /**
   * `partial` arrives first and carries everything that does not need
   * per-wallet lookups — which is most of the weight and about a third of the
   * time. `final` follows with fresh wallets, insiders and funding clusters.
   *
   * A non-streaming client can simply ignore every object but the last.
   */
  phase: 'partial' | 'final';
  /**
   * Share of the scoring weight we could actually measure, 0..100.
   * Below SCORING.minCoverageForLevel the level is reported as 'unknown'.
   */
  coverage: number;
  token: TokenInfo;
  market: MarketInfo | null;
  security: SecurityInfo;
  /** Number of wallets holding a non-zero balance. */
  holderCount: number;
  /** 0..100, higher is riskier. */
  riskScore: number;
  riskLevel: RiskLevel;
  dev: DevReport;
  bundles: BundleReport;
  topHolders: TopHolderReport;
  snipers: CountAndHolding;
  freshWallets: CountAndHolding;
  /** Wallets the dev funded, or that funded the dev. */
  insiders: CountAndHolding;
  analyzedAt: string;
  /** Human-readable caveats. Never empty when meta.partial is true. */
  warnings: string[];
  factors: RiskFactor[];
  /** Non-null when one signal alone set the floor for riskScore. */
  scoreFloor: ScoreFloor | null;
  meta: AnalyzeMeta;
}

export interface ApiError {
  error: string;
  message: string;
}
