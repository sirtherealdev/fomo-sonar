/**
 * Risk score: a weighted sum of six percentages, each put through a
 * safe -> danger ramp so the output is 0..100 regardless of the input's scale.
 *
 * The one rule worth knowing: a factor we could not measure is dropped and its
 * weight is redistributed across the factors we did measure. We never score an
 * unmeasured factor as zero, because "we could not check the dev wallet" is
 * not the same as "the dev holds nothing".
 */

import { SCORING } from './config.ts';
import { clamp, round2 } from './util.ts';
import type { RiskFactor, RiskLevel, ScoreFloor } from '@sonar/shared';

type FactorKey = RiskFactor['key'];

/** A measured percentage, or null when the detector was unavailable. */
export type FactorInputs = Record<FactorKey, number | null>;

export interface ScoreResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  /** Non-null when one signal alone forced the score up to a minimum. */
  floor: ScoreFloor | null;
  /** Share of the total scoring weight we could measure, 0..100. */
  coverage: number;
}

export function scoreRisk(inputs: FactorInputs): ScoreResult {
  const measured = (Object.entries(inputs) as [FactorKey, number | null][]).filter(
    (entry): entry is [FactorKey, number] => entry[1] !== null,
  );

  if (measured.length === 0) {
    return { score: 0, level: 'unknown', factors: [], floor: null, coverage: 0 };
  }

  const totalWeight = measured.reduce((sum, [key]) => sum + SCORING.weights[key], 0);
  const allWeight = Object.values(SCORING.weights).reduce((sum, w) => sum + w, 0);
  const coverage = round2((totalWeight / allWeight) * 100);

  const factors: RiskFactor[] = measured.map(([key, value]) => {
    const normalized = ramp(value, SCORING.ramps[key]);
    // Renormalize so the surviving factors still span the full 0..100 range.
    const weight = round2((SCORING.weights[key] / totalWeight) * 100);
    return { key, value: round2(value), normalized: round2(normalized), weight, points: round2(normalized * weight) };
  });

  const weighted = clamp(Math.round(factors.reduce((sum, f) => sum + f.points, 0)), 0, 100);
  const floor = strongestFloor(measured);
  const score = Math.max(weighted, floor?.floor ?? 0);

  /*
   * A floor still applies when coverage is poor: if the little we could measure
   * was alarming, that is a real finding. But a *reassuring* score built on
   * half the evidence is not — so below the coverage threshold we withhold the
   * label rather than hand out a green light we did not earn.
   */
  const level =
    coverage >= SCORING.minCoverageForLevel || floor !== null ? levelFor(score) : 'unknown';

  // The floor only matters if it actually lifted the score.
  return { score, level, factors, floor: score > weighted ? floor : null, coverage };
}

/**
 * The highest floor triggered by any single measured factor.
 *
 * This is what stops eight mild-looking averages from burying one signal that
 * on its own means "do not buy this".
 */
function strongestFloor(measured: readonly [FactorKey, number][]): ScoreFloor | null {
  let strongest: ScoreFloor | null = null;

  for (const [key, value] of measured) {
    const rule = SCORING.criticalFloors[key as keyof typeof SCORING.criticalFloors];
    if (!rule || value < rule.atLeast) continue;
    if (strongest && strongest.floor >= rule.floor) continue;
    strongest = { key, value: round2(value), floor: rule.floor };
  }

  return strongest;
}

/** Linear ramp: <= safe scores 0, >= danger scores 1. */
function ramp(value: number, bounds: { safe: number; danger: number }): number {
  const { safe, danger } = bounds;
  if (danger <= safe) return value > safe ? 1 : 0;
  return clamp((value - safe) / (danger - safe), 0, 1);
}

function levelFor(score: number): RiskLevel {
  if (score >= SCORING.levels.highAt) return 'high';
  if (score >= SCORING.levels.mediumAt) return 'medium';
  return 'low';
}
