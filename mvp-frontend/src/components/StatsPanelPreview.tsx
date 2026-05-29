import { useEffect, useState } from 'react';
import StatsPanel, { type MetricImpact, type OfficeMetrics } from './StatsPanel';
import { applyMetricDelta, type MetricKey } from '../metrics';

/** Sample metrics for layout / UI iteration without running the game. */
export const mockOfficeMetrics: OfficeMetrics = {
  stressLeader: 3,
  performance: 4,
  bondJunior1: 2,
  bondJunior2: 4,
  bondJunior3: 1,
  bondJunior4: 5,
  bondMentor: 3,
  stressJunior1: 2,
  stressJunior2: 1,
  stressJunior3: 4,
  stressJunior4: 0
};

export const mockMetricImpact: MetricImpact = {
  metricKey: 'bondJunior2',
  delta: 1,
  previousValue: 3,
  updatedValue: 4
};

const METRIC_CYCLE: MetricKey[] = ['stressLeader', 'performance', 'bondJunior1', 'stressJunior1', 'bondJunior2', 'stressJunior2', 'bondJunior3', 'stressJunior3', 'bondJunior4', 'stressJunior4', 'bondMentor'];

export default function StatsPanelPreview() {
  const [metrics, setMetrics] = useState<OfficeMetrics>(mockOfficeMetrics);
  const [impact, setImpact] = useState<MetricImpact | null>(mockMetricImpact);
  const [impactPulse, setImpactPulse] = useState(true);

  useEffect(() => {
    if (!impact) return;
    setImpactPulse(true);
    const timer = window.setTimeout(() => setImpactPulse(false), 1500);
    return () => window.clearTimeout(timer);
  }, [impact]);

  const bumpMetric = (key: MetricKey, delta: number) => {
    setMetrics((prev) => {
      const previousValue = prev[key];
      const updatedValue = applyMetricDelta(key, previousValue, delta);
      setImpact({ metricKey: key, delta, previousValue, updatedValue });
      return { ...prev, [key]: updatedValue };
    });
  };

  const cycleImpact = () => {
    const key = METRIC_CYCLE[Math.floor(Math.random() * METRIC_CYCLE.length)];
    bumpMetric(key, Math.random() > 0.5 ? 1 : -1);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 800, margin: '0 auto', textAlign: 'left' }}>
      <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
        Vista previa — <code>?preview=stats</code> en desarrollo. Quita el query param para volver al juego.
      </p>

      <StatsPanel metrics={metrics} currentMetricImpact={impact} impactPulse={impactPulse} />

      <div
        style={{
          marginTop: '1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'center'
        }}
      >
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Controles de prueba:</span>
        <button type="button" onClick={cycleImpact}>
          Simular impacto aleatorio
        </button>
        <button type="button" onClick={() => setImpact(null)}>
          Ocultar impacto
        </button>
        <button type="button" onClick={() => setMetrics(mockOfficeMetrics)}>
          Restaurar valores mock
        </button>
      </div>
    </div>
  );
}
