import { applyMetricDelta, clampMetric, isMetricKey, type GameMetrics, type MetricKey } from './metrics.js';

export interface OptionAssessment {
  metricKey: MetricKey;
  targetValue: number;
}

export interface OptionConsequence {
  /** When null, only the narrative is applied (no metric change). */
  metricKey: MetricKey | null;
  delta: number;
  narrative: string;
}

export interface SituationOption {
  id: string;
  label: string;
  assessment?: OptionAssessment | null;
  consequences: OptionConsequence[];
}

export interface ResolvedOptionOutcome {
  narrative: string;
  consequenceIndex: number;
  assessmentMet: boolean | null;
  metricKey: MetricKey | null;
  delta: number;
  previousValue: number | null;
  updatedValue: number | null;
}

const parseConsequence = (raw: unknown): OptionConsequence | null => {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<OptionConsequence & { metricKey?: string | null }>;
  if (!item.narrative || typeof item.narrative !== 'string') return null;

  const rawMetricKey = item.metricKey == null ? '' : String(item.metricKey).trim();
  const metricKey = rawMetricKey === '' ? null : isMetricKey(rawMetricKey) ? rawMetricKey : null;

  if (rawMetricKey !== '' && metricKey == null) return null;
  if (typeof item.delta !== 'number' || Number.isNaN(item.delta)) return null;

  return {
    metricKey,
    delta: metricKey == null ? 0 : Number(item.delta),
    narrative: String(item.narrative).trim()
  };
};

/** Supports legacy `{ metricKey, delta }` options from older catalogs. */
export const parseSituationOption = (raw: unknown): { ok: true; option: SituationOption } | { ok: false; error: string } => {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Opción inválida.' };
  }

  const legacy = raw as Partial<SituationOption & { metricKey?: string; delta?: number }>;
  if (!legacy.id || !legacy.label) {
    return { ok: false, error: 'Cada opción debe incluir id y label.' };
  }

  if (Array.isArray(legacy.consequences)) {
    const consequences: OptionConsequence[] = [];
    for (const entry of legacy.consequences) {
      const parsed = parseConsequence(entry);
      if (!parsed) {
        return { ok: false, error: `Consecuencia inválida en opción ${legacy.id}.` };
      }
      consequences.push(parsed);
    }

    if (consequences.length < 1 || consequences.length > 2) {
      return { ok: false, error: `La opción ${legacy.id} debe tener 1 o 2 consecuencias.` };
    }

    let assessment: OptionAssessment | null = null;
    if (legacy.assessment != null) {
      if (typeof legacy.assessment !== 'object') {
        return { ok: false, error: `Evaluación inválida en opción ${legacy.id}.` };
      }
      const rawAssessment = legacy.assessment as Partial<OptionAssessment>;
      if (!rawAssessment.metricKey || !isMetricKey(rawAssessment.metricKey)) {
        return { ok: false, error: `metricKey de evaluación inválido en opción ${legacy.id}.` };
      }
      if (typeof rawAssessment.targetValue !== 'number' || Number.isNaN(rawAssessment.targetValue)) {
        return { ok: false, error: `targetValue inválido en opción ${legacy.id}.` };
      }
      assessment = {
        metricKey: rawAssessment.metricKey,
        targetValue: clampMetric(rawAssessment.metricKey, rawAssessment.targetValue)
      };
      if (consequences.length !== 2) {
        return {
          ok: false,
          error: `La opción ${legacy.id} con evaluación debe definir exactamente 2 consecuencias.`
        };
      }
    } else if (consequences.length !== 1) {
      return {
        ok: false,
        error: `La opción ${legacy.id} sin evaluación debe tener exactamente 1 consecuencia.`
      };
    }

    return {
      ok: true,
      option: {
        id: String(legacy.id),
        label: String(legacy.label),
        assessment,
        consequences
      }
    };
  }

  if (legacy.metricKey && typeof legacy.delta === 'number' && isMetricKey(legacy.metricKey)) {
    return {
      ok: true,
      option: {
        id: String(legacy.id),
        label: String(legacy.label),
        assessment: null,
        consequences: [
          {
            metricKey: legacy.metricKey,
            delta: legacy.delta,
            narrative: `La oficina reacciona tras "${String(legacy.label)}".`
          }
        ]
      }
    };
  }

  return { ok: false, error: `Formato de opción no reconocido: ${legacy.id}.` };
};

/**
 * Picks the consequence branch:
 * - No assessment → consequences[0]
 * - With assessment → consequences[0] if current >= target, else consequences[1]
 */
export const resolveSituationOption = (
  option: SituationOption,
  metrics: GameMetrics
): ResolvedOptionOutcome => {
  let consequenceIndex = 0;
  let assessmentMet: boolean | null = null;

  if (option.assessment) {
    const current = metrics[option.assessment.metricKey];
    assessmentMet = current >= option.assessment.targetValue;
    consequenceIndex = assessmentMet ? 0 : 1;
  }

  const chosen = option.consequences[consequenceIndex] ?? option.consequences[0]!;
  const metricKey = chosen.metricKey;

  if (!metricKey) {
    return {
      narrative: chosen.narrative,
      consequenceIndex,
      assessmentMet,
      metricKey: null,
      delta: 0,
      previousValue: null,
      updatedValue: null
    };
  }

  const previousValue = metrics[metricKey];
  const updatedValue = applyMetricDelta(metricKey, previousValue, chosen.delta);

  return {
    narrative: chosen.narrative,
    consequenceIndex,
    assessmentMet,
    metricKey,
    delta: chosen.delta,
    previousValue,
    updatedValue
  };
};

export const applyResolvedOutcomeToMetrics = (
  metrics: GameMetrics,
  outcome: ResolvedOptionOutcome
): GameMetrics => {
  if (!outcome.metricKey) return metrics;
  return {
    ...metrics,
    [outcome.metricKey]: outcome.updatedValue ?? metrics[outcome.metricKey]
  };
};
