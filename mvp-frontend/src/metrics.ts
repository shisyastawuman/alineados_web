export type MetricKey = 'stressLeader' | 'stressJunior1' | 'stressJunior2' | 'stressJunior3' | 'stressJunior4' | 'performance' | 'bondJunior1' | 'bondJunior2' | 'bondJunior3' | 'bondJunior4' | 'bondMentor';

export const metricLabels: Record<MetricKey, string> = {
  stressLeader: 'Estrés del líder',
  stressJunior1: 'Estrés del junior 1',
  stressJunior2: 'Estrés del junior 2',
  stressJunior3: 'Estrés del junior 3',
  stressJunior4: 'Estrés del junior 4',
  performance: 'Performance del líder',
  bondJunior1: 'Vínculo con el líder',
  bondJunior2: 'Vínculo con el líder',
  bondJunior3: 'Vínculo con el líder',
  bondJunior4: 'Vínculo con el líder',
  bondMentor: 'Vínculo con el mentor'
};

export const METRIC_MIN = -1;
export const METRIC_START = 0;
export const METRIC_MAX = 5;
export const DEFEAT_METRIC_THRESHOLD = 0;

export const metricBounds: Record<MetricKey, { min: number; max: number }> = {
  stressLeader: { min: METRIC_MIN, max: METRIC_MAX },
  performance: { min: METRIC_MIN, max: METRIC_MAX },
  bondJunior1: { min: METRIC_MIN, max: METRIC_MAX },
  bondJunior2: { min: METRIC_MIN, max: METRIC_MAX },
  bondJunior3: { min: METRIC_MIN, max: METRIC_MAX },
  bondJunior4: { min: METRIC_MIN, max: METRIC_MAX },
  bondMentor: { min: METRIC_MIN, max: METRIC_MAX },
  stressJunior1: { min: METRIC_MIN, max: METRIC_MAX },
  stressJunior2: { min: METRIC_MIN, max: METRIC_MAX },
  stressJunior3: { min: METRIC_MIN, max: METRIC_MAX },
  stressJunior4: { min: METRIC_MIN, max: METRIC_MAX }
};

export const metricKeys: MetricKey[] = ['stressLeader', 'performance', 'bondJunior1', 'stressJunior1', 'bondJunior2', 'stressJunior2', 'bondJunior3', 'stressJunior3', 'bondJunior4', 'stressJunior4', 'bondMentor'];

export const metricLoadPercent = (value: number, min: number, max: number): number => {
  if (max <= min) return 0;
  const ratio = (value - min) / (max - min);
  return Math.min(100, Math.max(0, ratio * 100));
};

export const clampMetric = (key: MetricKey, value: number): number => {
  const { min, max } = metricBounds[key];
  return Math.min(max, Math.max(min, value));
};

export const applyMetricDelta = (key: MetricKey, current: number, delta: number): number => {
  return clampMetric(key, current + delta);
};

export const createDefaultOfficeMetrics = (): Record<MetricKey, number> => {
  return Object.fromEntries(metricKeys.map((key) => [key, METRIC_START])) as Record<MetricKey, number>;
};

export const hasDefeatMetrics = (metrics: Record<MetricKey, number>): boolean => {
  return metricKeys.some((key) => metrics[key] < DEFEAT_METRIC_THRESHOLD);
};

/** Align API / legacy payloads with the current metric keys and clamp to bounds. */
export const normalizeOfficeMetrics = (raw: Partial<Record<string, number>>): Record<MetricKey, number> => {
  const metrics = createDefaultOfficeMetrics();

  for (const key of metricKeys) {
    const value = raw[key];
    if (typeof value === 'number' && !Number.isNaN(value)) {
      metrics[key] = clampMetric(key, value);
    }
  }

  if (typeof raw.relationship === 'number' && !Number.isNaN(raw.relationship)) {
    const legacyBond = clampMetric('bondJunior1', raw.relationship);
    for (const bondKey of ['bondJunior1', 'bondJunior2', 'bondJunior3', 'bondJunior4', 'bondMentor'] as const) {
      if (typeof raw[bondKey] !== 'number') {
        metrics[bondKey] = legacyBond;
      }
    }
  }

  if (typeof raw.stressJunior === 'number' && !Number.isNaN(raw.stressJunior)) {
    const legacyStress = clampMetric('stressJunior1', raw.stressJunior);
    for (const stressKey of ['stressJunior1', 'stressJunior2', 'stressJunior3', 'stressJunior4'] as const) {
      if (typeof raw[stressKey] !== 'number') {
        metrics[stressKey] = legacyStress;
      }
    }
  }

  return metrics;
};
