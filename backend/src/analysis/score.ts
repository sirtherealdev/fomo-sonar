/**
 * Risk score: a weighted sum of six percentages, each put through a
 * safe -> danger ramp so the output is 0..100 regardless of the input's scale.
 *
 * The one rule worth knowing: a factor we could not measure is dropped and its
 * weight is redistributed across the factors we did measure. We never score an
 * unmeasured factor as zero, because "we could not check the dev wallet" is
 * not the same as "the dev holds nothing".
 */

import { SCORING } from '../config.ts';
import { clamp, round2 } from '../util.ts';
import type { RiskFactor, RiskLevel } from '@scope/shared';

type FactorKey = RiskFactor['key'];

/** A measured percentage, or null when the detector was unavailable. */
export type FactorInputs = Record<FactorKey, number | null>;

export interface ScoreResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export function scoreRisk(inputs: FactorInputs): ScoreResult {
  const measured = (Object.entries(inputs) as [FactorKey, number | null][]).filter(
    (entry): entry is [FactorKey, number] => entry[1] !== null,
  );

  if (measured.length === 0) {
    return { score: 0, level: 'low', factors: [] };
  }

  const totalWeight = measured.reduce((sum, [key]) => sum + SCORING.weights[key], 0);

  const factors: RiskFactor[] = measured.map(([key, value]) => {
    const normalized = ramp(value, SCORING.ramps[key]);
    // Renormalize so the surviving factors still span the full 0..100 range.
    const weight = round2((SCORING.weights[key] / totalWeight) * 100);
    return { key, value: round2(value), normalized: round2(normalized), weight, points: round2(normalized * weight) };
  });

  const score = clamp(Math.round(factors.reduce((sum, f) => sum + f.points, 0)), 0, 100);

  return { score, level: levelFor(score), factors };
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
