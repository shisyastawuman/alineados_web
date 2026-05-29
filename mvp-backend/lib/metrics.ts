export type MetricKey =
  | 'stressLeader'
  | 'stressJunior1'
  | 'stressJunior2'
  | 'stressJunior3'
  | 'stressJunior4'
  | 'performance'
  | 'bondJunior1'
  | 'bondJunior2'
  | 'bondJunior3'
  | 'bondJunior4'
  | 'bondMentor';

export type GameMetrics = Record<MetricKey, number>;

export const METRIC_MIN = -1;
export const METRIC_START = 3;
export const METRIC_MAX = 5;
export const DEFEAT_METRIC_THRESHOLD = 0;

export const metricKeys: MetricKey[] = [
  'stressLeader',
  'performance',
  'bondJunior1',
  'stressJunior1',
  'bondJunior2',
  'stressJunior2',
  'bondJunior3',
  'stressJunior3',
  'bondJunior4',
  'stressJunior4',
  'bondMentor'
];

const metricBounds: Record<MetricKey, { min: number; max: number }> = Object.fromEntries(
  metricKeys.map((key) => [key, { min: METRIC_MIN, max: METRIC_MAX }])
) as Record<MetricKey, { min: number; max: number }>;

export const clampMetric = (key: MetricKey, value: number): number => {
  const { min, max } = metricBounds[key];
  return Math.min(max, Math.max(min, value));
};

export const applyMetricDelta = (key: MetricKey, current: number, delta: number): number => {
  return clampMetric(key, current + delta);
};

export const createDefaultMetrics = (): GameMetrics => {
  return Object.fromEntries(metricKeys.map((key) => [key, METRIC_START])) as GameMetrics;
};

export const hasDefeatMetrics = (metrics: GameMetrics): boolean => {
  return metricKeys.some((key) => metrics[key] < DEFEAT_METRIC_THRESHOLD);
};

/** Maps legacy persisted games (relationship / stressJunior) into the current metric shape. */
export const normalizeGameMetrics = (raw: Record<string, unknown>): GameMetrics => {
  const metrics = createDefaultMetrics();

  for (const key of metricKeys) {
    if (typeof raw[key] === 'number' && !Number.isNaN(raw[key])) {
      metrics[key] = clampMetric(key, raw[key] as number);
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

export const isMetricKey = (value: string): value is MetricKey => {
  return (metricKeys as string[]).includes(value);
};
