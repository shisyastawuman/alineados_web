import {
  metricBounds,
  metricLabels,
  metricLoadPercent,
  type MetricKey
} from '../metrics';
import './StatsPanel.css';

export interface MetricImpact {
  metricKey: MetricKey;
  delta: number;
  previousValue: number;
  updatedValue: number;
}

export type OfficeMetrics = Record<MetricKey, number>;

interface StatsPanelProps {
  metrics: OfficeMetrics;
  currentMetricImpact?: MetricImpact | null;
  impactPulse?: boolean;
}

type BondMetricKey = 'bondJunior1' | 'bondJunior2' | 'bondJunior3' | 'bondJunior4' | 'bondMentor';

interface CharacterConfig {
  id: string;
  label: string;
  color: string;
  stats: MetricKey[];
  bondMetricKey?: BondMetricKey;
}

const SIDE_CHARACTER: CharacterConfig = {
  id: 'side',
  label: 'Mentor',
  color: '#94a3b8',
  stats: [],
  bondMetricKey: 'bondMentor'
};

const JUNIOR_CHARACTERS: CharacterConfig[] = [
  { id: 'junior-1', label: 'Junior 1', color: '#22c55e', stats: ['stressJunior1'], bondMetricKey: 'bondJunior1' },
  { id: 'junior-2', label: 'Junior 2', color: '#eab308', stats: ['stressJunior2'], bondMetricKey: 'bondJunior2' },
  { id: 'junior-3', label: 'Junior 3', color: '#f97316', stats: ['stressJunior3'], bondMetricKey: 'bondJunior3' },
  { id: 'junior-4', label: 'Junior 4', color: '#ef4444', stats: ['stressJunior4'], bondMetricKey: 'bondJunior4' }
];

const LEADER_CHARACTER: CharacterConfig = {
  id: 'leader',
  label: 'Líder',
  color: '#3b82f6',
  stats: ['stressLeader', 'performance']
};

const formatDelta = (delta: number): string => (delta > 0 ? `+${delta}` : String(delta));

const statDisplayLabel = (key: MetricKey): string => {
  if (key === 'stressLeader' || key === 'stressJunior1' || key === 'stressJunior2' || key === 'stressJunior3' || key === 'stressJunior4') return 'Estrés';
  if (key === 'performance') return 'Performance';
  return metricLabels[key];
};

interface StatBarProps {
  metricKey: MetricKey;
  value: number;
  highlighted?: boolean;
  pulse?: boolean;
}

function StatBar({ metricKey, value, highlighted, pulse }: StatBarProps) {
  const { min, max } = metricBounds[metricKey];
  const percent = metricLoadPercent(value, min, max);

  return (
    <div className={`stat-bar${highlighted ? ' stat-bar--highlighted' : ''}${pulse ? ' stat-bar--pulse' : ''}`}>
      <div className="stat-bar__header">
        <span className="stat-bar__label">{statDisplayLabel(metricKey)}</span>
        <span className="stat-bar__value">{value}</span>
      </div>
      <div
        className="stat-bar__track"
        role="progressbar"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={`${statDisplayLabel(metricKey)}: ${value}`}
      >
        <div className="stat-bar__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

interface CharacterCardProps {
  character: CharacterConfig;
  metrics: OfficeMetrics;
  impactMetricKey?: MetricKey | null;
  impactPulse?: boolean;
}

function CharacterCard({ character, metrics, impactMetricKey, impactPulse }: CharacterCardProps) {
  return (
    <article className="character-card" aria-label={character.label}>
      <div className="character-card__avatar" style={{ backgroundColor: character.color }} />
      <h3 className="character-card__name">{character.label}</h3>
      {character.stats.length > 0 && (
        <div className="character-card__stats">
          {character.stats.map((key) => (
            <StatBar
              key={`${character.id}-${key}`}
              metricKey={key}
              value={metrics[key]}
              highlighted={impactMetricKey === key}
              pulse={impactPulse && impactMetricKey === key}
            />
          ))}
        </div>
      )}
    </article>
  );
}

interface RelationshipConnectorProps {
  targetLabel: string;
  bondMetricKey: BondMetricKey;
  value: number;
  orientation: 'horizontal' | 'vertical';
  highlighted?: boolean;
  pulse?: boolean;
}

function RelationshipConnector({
  targetLabel,
  bondMetricKey,
  value,
  orientation,
  highlighted,
  pulse
}: RelationshipConnectorProps) {
  const { min, max } = metricBounds[bondMetricKey];
  const percent = metricLoadPercent(value, min, max);

  return (
    <div
      className={`relationship-connector relationship-connector--${orientation}${
        pulse ? ' relationship-connector--pulse' : ''
      }`}
      title={`${metricLabels[bondMetricKey]} (${targetLabel}): ${value}`}
    >
      {orientation === 'horizontal' && <span className="relationship-connector__line" aria-hidden />}
      <div className="relationship-connector__body">
        <span className="relationship-connector__label">Vínculo</span>
        <span className="relationship-connector__target">{targetLabel}</span>
        <div
          className="relationship-connector__track"
          role="progressbar"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-label={`Vínculo con ${targetLabel}`}
        >
          <div
            className="relationship-connector__fill"
            style={{
              width: `${percent}%`,
              opacity: highlighted ? 1 : 0.85
            }}
          />
        </div>
        <span className="stat-bar__value" style={{ fontSize: '0.7rem' }}>
          {value}
        </span>
      </div>
      <span className="relationship-connector__line" aria-hidden />
    </div>
  );
}

export default function StatsPanel({ metrics, currentMetricImpact, impactPulse = false }: StatsPanelProps) {
  const impactKey = currentMetricImpact?.metricKey ?? null;

  return (
    <section className="stats-panel" aria-labelledby="stats-panel-title">
      <h2 id="stats-panel-title" className="stats-panel__title">
        Estado de la oficina
      </h2>

      <div className="office-pyramid">
        <div className="office-pyramid__top">
          <span className="office-pyramid__top-spacer" aria-hidden />
          <div className="office-pyramid__leader-slot">
            <CharacterCard
              character={LEADER_CHARACTER}
              metrics={metrics}
              impactMetricKey={currentMetricImpact?.metricKey}
              impactPulse={impactPulse}
            />
          </div>
          <div className="office-pyramid__connector office-pyramid__connector--horizontal office-pyramid__connector--to-side">
            <RelationshipConnector
              targetLabel={SIDE_CHARACTER.label}
              bondMetricKey={SIDE_CHARACTER.bondMetricKey!}
              value={metrics[SIDE_CHARACTER.bondMetricKey!]}
              orientation="horizontal"
              highlighted={impactKey === SIDE_CHARACTER.bondMetricKey}
              pulse={impactPulse && impactKey === SIDE_CHARACTER.bondMetricKey}
            />
          </div>
          <div className="office-pyramid__side-slot">
            <CharacterCard character={SIDE_CHARACTER} metrics={metrics} />
          </div>
          <span className="office-pyramid__top-spacer" aria-hidden />
        </div>

        <div className="office-pyramid__bottom">
          {JUNIOR_CHARACTERS.map((junior) => {
            const bondKey = junior.bondMetricKey!;
            return (
            <div key={junior.id} className="office-pyramid__junior-column">
              <RelationshipConnector
                targetLabel={junior.label}
                bondMetricKey={bondKey}
                value={metrics[bondKey]}
                orientation="vertical"
                highlighted={impactKey === bondKey}
                pulse={impactPulse && impactKey === bondKey}
              />
              <CharacterCard
                character={junior}
                metrics={metrics}
                impactMetricKey={currentMetricImpact?.metricKey}
                impactPulse={impactPulse}
              />
            </div>
            );
          })}
        </div>
      </div>

      {currentMetricImpact && (
        <div
          className={`stats-panel__impact${impactPulse ? ' stats-panel__impact--pulse' : ''}`}
          role="status"
        >
          <strong>{metricLabels[currentMetricImpact.metricKey]}</strong>{' '}
          {formatDelta(currentMetricImpact.delta)} ({currentMetricImpact.previousValue} →{' '}
          {currentMetricImpact.updatedValue})
        </div>
      )}
    </section>
  );
}
