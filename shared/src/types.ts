/**
 * The contract between the backend and the extension.
 *
 * Percentages are always numbers in 0..100 with 2 decimals, never strings.
 * Raw token amounts are strings (base units) because they overflow Number.
 */

export type RiskLevel = 'low' | 'medium' | 'high';

/** Why a detector could not produce a number. Surfaced so the UI never shows a fake 0. */
export type Unavailable =
  | 'creation-not-found' // we could not walk back to the mint's first transaction
  | 'no-early-trades' // creation found, but no trades inside the analysis window
  | 'no-dev-allocation' // dev never held any of the supply, so "sold %" is meaningless
  | 'holder-set-partial'; // holder pagination hit its cap, percentages would understate

export interface HolderEntry {
  /** Wallet that owns the token account, not the token account itself. */
  address: string;
  /** Raw amount in base units. */
  amount: string;
  /** Share of total supply, 0..100. */
  pct: number;
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
  holdingPct: number;
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
  holdingPct: number;
  unavailable?: Unavailable;
}

/** Per-component contribution to the risk score, so the UI can explain the number. */
export interface RiskFactor {
  key: 'devHolding' | 'devSold' | 'bundles' | 'topHolders' | 'snipers' | 'freshWallets';
  /** The measured percentage this factor scored on. */
  value: number;
  /** 0..1 after the safe→danger ramp. */
  normalized: number;
  /** Weight actually applied (weights are renormalized when a factor is unavailable). */
  weight: number;
  /** Points this factor added to the final 0..100 score. */
  points: number;
}

export interface AnalyzeMeta {
  /** Total supply in base units. */
  supply: string;
  decimals: number;
  /** ISO timestamp of the mint creation transaction, if found. */
  createdAt: string | null;
  creationSignature: string | null;
  /** Number of Helius calls this analysis cost. Useful for tuning caps. */
  rpcCalls: number;
  durationMs: number;
  /** True when any detector was unavailable or any data set was truncated. */
  partial: boolean;
  /** Set when the response came from cache. */
  cached?: boolean;
}

export interface AnalyzeResponse {
  mint: string;
  /** 0..100, higher is riskier. */
  riskScore: number;
  riskLevel: RiskLevel;
  dev: DevReport;
  bundles: BundleReport;
  topHolders: TopHolderReport;
  snipers: CountAndHolding;
  freshWallets: CountAndHolding;
  analyzedAt: string;
  /** Human-readable caveats. Never empty when meta.partial is true. */
  warnings: string[];
  factors: RiskFactor[];
  meta: AnalyzeMeta;
}

export interface ApiError {
  error: string;
  message: string;
}
