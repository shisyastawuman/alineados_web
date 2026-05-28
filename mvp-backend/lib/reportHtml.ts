import fs from 'fs';
import path from 'path';
import type { GameAnalytics } from './analytics.js';
import type { MetricKey } from './gameTypes.js';
import { renderNarrativeSectionsFromTemplate } from './reportTemplate.js';

const metricLabels: Record<MetricKey, string> = {
  stressLeader: 'Nerón - Estrés',
  performance: 'Nerón - Performance',
  relationship: 'Vínculo con el líder',
  stressJunior: 'Júniors - Estrés'
};

const metricKeys: MetricKey[] = ['stressLeader', 'performance', 'relationship', 'stressJunior'];

const escapeHtml = (value: string | number | null | undefined): string => {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
};

const formatPct = (value: number | null | undefined): string => {
  return value == null ? 'N/D' : `${value.toFixed(1)}%`;
};

const signed = (value: number): string => {
  return value > 0 ? `+${value}` : String(value);
};

const toAssetDataUri = (filePath: string | undefined): string | null => {
  if (!filePath) return null;
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return null;
  const ext = path.extname(resolved).toLowerCase();
  const mime =
    ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(resolved).toString('base64')}`;
};

const narrativeById = (analytics: GameAnalytics): Record<string, string> => {
  return Object.fromEntries(renderNarrativeSectionsFromTemplate(analytics).map((section) => [section.id, section.text]));
};

const impactLabel = (value: number): string => {
  if (value >= 5) return 'Crítico';
  if (value >= 2) return 'Alto';
  if (value >= 0) return 'Esperable';
  return 'Bajo';
};

const anticipationLevel = (pct: number): string => {
  if (pct < 25) return 'Nula';
  if (pct < 50) return 'Baja';
  if (pct < 75) return 'Media';
  return 'Alta';
};

const sectionText = (sections: Record<string, string>, id: string, fallback: string): string => {
  return sections[id] || fallback;
};

const renderHeader = (page: number, title?: string): string => `
  <header class="page-header">
    <div class="page-number">${page}</div>
  </header>
`;

const renderLogo = (logoDataUri: string | null): string => {
  return logoDataUri
    ? `<img class="brand-logo-img" src="${logoDataUri}" alt="Alineados" />`
    : '<div class="brand-logo">A</div>';
};

const renderParticipants = (analytics: GameAnalytics): string => {
  const participants = analytics.participantNames.length > 0 ? analytics.participantNames : analytics.nonLeaderPlayers.map((p) => p.username);
  return `
    <div class="participants-block">
      <div>
        <h3>LÍDER:</h3>
        <p class="person-name">${escapeHtml(analytics.leaderName ?? 'Sin líder registrado')}</p>
      </div>
      <div>
        <h3>EQUIPO:</h3>
        <ul class="person-list">
          ${
            participants.length > 0
              ? participants.map((name) => `<li>${escapeHtml(name)}</li>`).join('')
              : '<li>Sin participantes registrados</li>'
          }
        </ul>
      </div>
    </div>
  `;
};

const renderMetricTableRows = (analytics: GameAnalytics): string => {
  return metricKeys
    .map((key) => {
      const initial = analytics.initialMetrics[key];
      const final = analytics.finalMetrics[key];
      const delta = final - initial;
      return `
        <tr>
          <td>${escapeHtml(metricLabels[key])}</td>
          <td>${escapeHtml(initial)}</td>
          <td>${escapeHtml(final)}</td>
          <td>${escapeHtml(signed(delta))}</td>
          <td>${escapeHtml(impactLabel(final))}</td>
          <td>${escapeHtml(`La métrica cerró en ${final}, con una variación de ${signed(delta)} respecto del inicio.`)}</td>
        </tr>
      `;
    })
    .join('');
};

const renderAnticipationScale = (analytics: GameAnalytics): string => {
  const pct = analytics.alignmentPct ?? 0;
  const levels = ['Nula', 'Baja', 'Media', 'Alta'];
  const active = anticipationLevel(pct);
  return `
    <div class="scale">
      ${levels.map((level) => `<div class="scale-segment ${level === active ? 'active' : ''}">${level}</div>`).join('')}
    </div>
    <div class="scale-marker" style="left: calc(${Math.min(100, Math.max(0, pct))}% - 10px);"></div>
  `;
};

const renderParticipantMatrix = (analytics: GameAnalytics): string => {
  const players = analytics.nonLeaderPlayers;
  if (players.length === 0) {
    return '<p>No hay suficientes datos de participantes para construir la matriz.</p>';
  }

  return `
    <div class="scatter">
      <div class="scatter-label top">Coincidencia individuo-mayoría</div>
      <div class="scatter-label left">Coincidencia individuo-líder</div>
      <div class="risk risk-left">Individualismo total</div>
      <div class="risk risk-right">Pérdida de capacidad crítica</div>
      ${players
        .map((player, index) => {
          const x = Math.min(96, Math.max(4, player.pctRoundsMatchingOthersMajority ?? 0));
          const y = 100 - Math.min(96, Math.max(4, player.pctRoundsMatchingLeader ?? 0));
          return `<div class="dot" style="left:${x}%; top:${y}%;" title="${escapeHtml(player.username)}">${index + 1}</div>`;
        })
        .join('')}
    </div>
    <ol class="legend-list">
      ${players
        .map(
          (player, index) =>
            `<li><strong>${index + 1}.</strong> ${escapeHtml(player.username)} - líder ${formatPct(player.pctRoundsMatchingLeader)}, mayoría ${formatPct(player.pctRoundsMatchingOthersMajority)}</li>`
        )
        .join('')}
    </ol>
  `;
};

const scenarioFor = (situation: GameAnalytics['situations'][number]): 1 | 2 | 3 | 4 => {
  const highLeaderCoincidence = (situation.shareMatchingLeader ?? 0) > 50;
  if (situation.alignmentCorrect && highLeaderCoincidence) return 1;
  if (!situation.alignmentCorrect && highLeaderCoincidence) return 2;
  if (situation.alignmentCorrect && !highLeaderCoincidence) return 3;
  return 4;
};

const renderAlignmentMatrix = (analytics: GameAnalytics): string => {
  const scenarios = [1, 2, 3, 4] as const;
  const counts = Object.fromEntries(scenarios.map((id) => [id, analytics.situations.filter((s) => scenarioFor(s) === id)])) as Record<
    1 | 2 | 3 | 4,
    GameAnalytics['situations']
  >;
  const total = Math.max(1, analytics.situations.length);

  return `
    <div class="alignment-matrix">
      <div class="matrix-axis y">Coincidencia individuos-líder</div>
      <div class="matrix-axis x">Anticipación equipo-líder</div>
      <div class="quadrant q1"><strong>Escenario 1</strong><span>Con anticipación · Alta coincidencia</span><b>${counts[1].length}</b></div>
      <div class="quadrant q2"><strong>Escenario 2</strong><span>Sin anticipación · Alta coincidencia</span><b>${counts[2].length}</b></div>
      <div class="quadrant q3"><strong>Escenario 3</strong><span>Con anticipación · Baja coincidencia</span><b>${counts[3].length}</b></div>
      <div class="quadrant q4"><strong>Escenario 4</strong><span>Sin anticipación · Baja coincidencia</span><b>${counts[4].length}</b></div>
    </div>
    <table class="compact-table">
      <thead><tr><th>Escenario</th><th>Anticipación</th><th>Coincidencia</th><th>Situaciones</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>Con</td><td>Alta</td><td>${counts[1].length} de ${total}</td></tr>
        <tr><td>2</td><td>Sin</td><td>Alta</td><td>${counts[2].length} de ${total}</td></tr>
        <tr><td>3</td><td>Con</td><td>Baja</td><td>${counts[3].length} de ${total}</td></tr>
        <tr><td>4</td><td>Sin</td><td>Baja</td><td>${counts[4].length} de ${total}</td></tr>
      </tbody>
    </table>
  `;
};

const buildConclusions = (analytics: GameAnalytics, sections: Record<string, string>): string[] => {
  const pct = analytics.alignmentPct ?? 0;
  const level = anticipationLevel(pct).toLowerCase();
  const strongestMetric = metricKeys
    .map((key) => ({ key, delta: analytics.finalMetrics[key] - analytics.initialMetrics[key] }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  return [
    `En Estado final de la oficina, la métrica más afectada fue ${strongestMetric ? metricLabels[strongestMetric.key] : 'sin datos'}, con una variación de ${strongestMetric ? signed(strongestMetric.delta) : '0'}.`,
    `En Nivel de anticipación, el equipo alcanzó un nivel ${level}, con ${analytics.alignmentCorrectCount} anticipaciones correctas sobre ${analytics.totalRounds} situaciones.`,
    `En Coincidencia entre individuos, el análisis muestra la distancia entre las preferencias individuales, la mayoría del equipo y las decisiones del líder.`,
    sectionText(sections, 'closing', 'La alineación debe sostener coordinación sin eliminar la diversidad de criterios del equipo.')
  ];
};

export const buildReportHtml = (analytics: GameAnalytics): string => {
  const sections = narrativeById(analytics);
  const logoDataUri = toAssetDataUri(process.env.REPORT_LOGO_PATH);
  const watermarkDataUri = toAssetDataUri(process.env.REPORT_WATERMARK_PATH);
  const generatedDate = new Date(analytics.finishedAt).toLocaleDateString('es-AR');
  const pct = analytics.alignmentPct ?? 0;
  const level = anticipationLevel(pct).toLowerCase();
  const conclusions = buildConclusions(analytics, sections);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Informe de Jugada ${escapeHtml(analytics.roomCode)}</title>
  <style>
    @page { size: A4; margin: 0; }
    :root {
      --ink: #1f2933;
      --muted: #65717f;
      --green: #fad0d4;
      --green-dark: #EF3340;
      --sand: #ece4d6;
      --paper: #f8f4ec;
      --accent: #2E86E0;
      --line: rgba(31, 41, 51, 0.16);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "Aptos", "Segoe UI", Arial, sans-serif;
      background: white;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      position: relative;
      padding: 23mm 21mm 18mm;
      overflow: hidden;
      background: var(--paper);
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .page::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(72, 107, 89, 0.12), transparent 21%),
        radial-gradient(circle at 88% 12%, rgba(180, 135, 79, 0.14), transparent 22%),
        var(--paper);
      z-index: 0;
    }
    .page > * { position: relative; z-index: 1; }
    .cover {
      display: grid;
      align-content: space-between;
      background: var(--green);
      color: white;
    }
    .cover::before {
      background:
        radial-gradient(circle at 78% 18%, rgba(255,255,255,0.16), transparent 24%),
        linear-gradient(145deg, var(--green), var(--green-dark));
    }
    .watermark {
      position: absolute;
      right: -30mm;
      bottom: -25mm;
      width: 135mm;
      height: 135mm;
      border: 16px solid rgba(255,255,255,0.08);
      border-radius: 50%;
      transform: rotate(-12deg);
      z-index: 0;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      ${watermarkDataUri ? `background-image: url("${watermarkDataUri}"); border: 0; opacity: 0.12;` : ''}
    }
    .cover .watermark { opacity: 1; }
    .cover-top {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12mm;
      align-items: start;
      font-size: 13px;
      line-height: 1.5;
    }
    .brand-logo {
      width: 22mm;
      height: 22mm;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255,255,255,0.5);
      border-radius: 50%;
      font-weight: 900;
      font-size: 24px;
      letter-spacing: -0.05em;
    }
    .brand-logo-img { max-width: 46mm; max-height: 22mm; object-fit: contain; }
    .cover-title h1 {
      margin: 0;
      max-width: 132mm;
      font-size: 56px;
      line-height: 0.95;
      letter-spacing: -0.055em;
    }
    .cover-title p {
      margin: 8mm 0 0;
      max-width: 115mm;
      color: rgba(255,255,255,0.82);
      font-size: 15px;
      line-height: 1.55;
    }
    .cover-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6mm;
    }
    .cover-card {
      padding: 6mm;
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 18px;
      background: rgba(255,255,255,0.1);
    }
    .cover-card span {
      display: block;
      color: rgba(255,255,255,0.72);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .cover-card strong {
      display: block;
      margin-top: 2mm;
      font-size: 24px;
      line-height: 1.05;
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20mm;
      color: var(--green-dark);
    }
    .brand-title {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .page-number {
      width: 9mm;
      height: 9mm;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--green);
      color: white;
      font-size: 11px;
      font-weight: 800;
    }
    h2 {
      margin: 0 0 8mm;
      color: var(--green-dark);
      font-size: 28px;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: -0.02em;
    }
    h3 {
      margin: 0 0 4mm;
      color: var(--green);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    p, li {
      font-size: 12.3px;
      line-height: 1.58;
    }
    p { margin: 0 0 4mm; }
    .index-grid {
      display: grid;
      gap: 5mm;
      max-width: 135mm;
      margin-top: 15mm;
    }
    .index-row {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: end;
      gap: 6mm;
      font-size: 20px;
      color: var(--green-dark);
    }
    .index-row::after {
      content: "";
      height: 1px;
      background: var(--line);
      grid-column: 1 / -1;
      order: 2;
    }
    .participants-block {
      display: grid;
      grid-template-columns: 0.8fr 1.2fr;
      gap: 18mm;
      margin-top: 20mm;
    }
    .person-name {
      font-size: 22px;
      color: var(--green-dark);
      font-weight: 700;
    }
    .person-list {
      margin: 0;
      padding-left: 0;
      list-style: none;
      display: grid;
      gap: 3mm;
    }
    .person-list li {
      padding-bottom: 2mm;
      border-bottom: 1px solid var(--line);
      color: var(--ink);
    }
    .intro-note {
      margin-top: 9mm;
      padding: 7mm;
      border-left: 5px solid var(--accent);
      background: rgba(255,255,255,0.62);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: rgba(255,255,255,0.72);
      font-size: 10px;
    }
    th {
      background: var(--green-dark);
      color: white;
      padding: 8px;
      text-align: left;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    td {
      border-bottom: 1px solid var(--line);
      padding: 8px;
      vertical-align: top;
    }
    .office-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 7mm;
    }
    .summary-card {
      padding: 7mm;
      background: rgba(255,255,255,0.7);
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .scale-wrap {
      position: relative;
      margin-top: 14mm;
      padding: 0 4mm;
    }
    .scale {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid var(--line);
    }
    .scale-segment {
      padding: 5mm 3mm;
      text-align: center;
      background: rgba(255,255,255,0.7);
      border-right: 1px solid var(--line);
      font-weight: 700;
      color: var(--muted);
    }
    .scale-segment:last-child { border-right: 0; }
    .scale-segment.active {
      background: var(--green);
      color: white;
    }
    .scale-marker {
      position: absolute;
      top: -8mm;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--accent);
      border: 3px solid white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    }
    .scatter {
      position: relative;
      height: 118mm;
      margin: 6mm 0;
      border: 1px solid var(--line);
      background:
        linear-gradient(90deg, transparent 49.7%, rgba(31,41,51,0.16) 50%, transparent 50.3%),
        linear-gradient(0deg, transparent 49.7%, rgba(31,41,51,0.16) 50%, transparent 50.3%),
        rgba(255,255,255,0.68);
    }
    .scatter-label {
      position: absolute;
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .scatter-label.top { top: -8mm; left: 50%; transform: translateX(-50%); }
    .scatter-label.left { left: -31mm; top: 50%; transform: rotate(-90deg); }
    .risk {
      position: absolute;
      bottom: 6mm;
      font-size: 10px;
      color: var(--muted);
    }
    .risk-left { left: 5mm; }
    .risk-right { right: 5mm; }
    .dot {
      position: absolute;
      width: 8mm;
      height: 8mm;
      margin-left: -4mm;
      margin-top: -4mm;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--green);
      color: white;
      font-weight: 800;
      font-size: 10px;
    }
    .legend-list {
      columns: 2;
      margin: 0;
      padding-left: 5mm;
      color: var(--muted);
    }
    .alignment-matrix {
      position: relative;
      height: 120mm;
      margin-bottom: 8mm;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-template-rows: repeat(2, 1fr);
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.66);
    }
    .quadrant {
      padding: 8mm;
      border: 1px solid var(--line);
      display: grid;
      align-content: center;
      gap: 2mm;
    }
    .quadrant strong {
      color: var(--green-dark);
      font-size: 18px;
    }
    .quadrant span {
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .quadrant b {
      color: var(--accent);
      font-size: 34px;
      line-height: 1;
    }
    .matrix-axis {
      position: absolute;
      color: var(--green-dark);
      font-weight: 800;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .matrix-axis.y { left: -32mm; top: 50%; transform: rotate(-90deg); }
    .matrix-axis.x { bottom: -8mm; left: 50%; transform: translateX(-50%); }
    .compact-table {
      font-size: 10px;
    }
    .quote {
      margin-top: 10mm;
      padding: 7mm;
      background: var(--green-dark);
      color: white;
      border-radius: 16px;
    }
    .quote p {
      color: white;
      font-size: 13px;
    }
    .footer {
      position: absolute;
      left: 21mm;
      right: 21mm;
      bottom: 10mm;
      display: flex;
      justify-content: space-between;
      color: rgba(31,41,51,0.5);
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
  </style>
</head>
<body>
  <section class="page cover">
    <div class="watermark"></div>
    <div class="cover-top">
      <div>
        <div>${escapeHtml(generatedDate)}</div>
      </div>
      ${renderLogo(logoDataUri)}
    </div>
    <div class="cover-title">
      <h1>Informe de jugada</h1>
      <p>${escapeHtml(sectionText(sections, 'opening', `La partida finalizó con ${formatPct(analytics.alignmentPct)} de anticipación correcta.`))}</p>
    </div>
  </section>

  <section class="page">
    ${renderHeader(2, 'Índice')}
    <h2>ÍNDICE</h2>
    <div class="index-grid">
      <div class="index-row"><span>Introducción</span><strong>4</strong></div>
      <div class="index-row"><span>Estado final de la oficina</span><strong>5</strong></div>
      <div class="index-row"><span>Nivel de anticipación</span><strong>6</strong></div>
      <div class="index-row"><span>Coincidencia entre individuos</span><strong>7</strong></div>
      <div class="index-row"><span>Matriz de alineación</span><strong>8</strong></div>
      <div class="index-row"><span>Conclusiones</span><strong>9</strong></div>
    </div>
    <div class="footer"><span>Alineados</span><span>${escapeHtml(analytics.roomCode)}</span></div>
  </section>

  <section class="page">
    ${renderHeader(3, 'Participantes')}
    <h2>PARTICIPANTES</h2>
    ${renderParticipants(analytics)}
    <div class="footer"><span>Alineados</span></div>
  </section>

  <section class="page">
    ${renderHeader(4, 'Introducción')}
    <h2>INTRODUCCIÓN</h2>
    <p>“Alineados” es un juego donde el líder del grupo participante se enfrentará a una serie de situaciones conflictivas de management, donde debe tomar las decisiones correctas para lograr que Nerón lidere efectivamente su primer proyecto. El desafío es doble, ya que su equipo debe lograr anticipar la mayor cantidad de sus decisiones.</p>
    <p>¿Por qué es importante la alineación del equipo con el líder? Un equipo alineado puede anticipar cómo piensa su líder, incluso en contextos de incertidumbre, y coincide en una medida adecuada con las decisiones de ese líder.</p>
    <p>Una buena alineación no implica total coincidencia de opinión. La diversidad de criterios enriquece el funcionamiento del equipo, pero a la hora de ejecutar un proyecto es importante que las ideas y directivas del líder sean claras para los integrantes.</p>
    <p>Este informe permite comprender cuál es la alineación del equipo durante la partida y organiza los resultados en cinco dimensiones principales.</p>
    <div class="footer"><span>Introducción</span><span>4</span></div>
  </section>

  <section class="page">
    ${renderHeader(5, 'Estado final de la oficina')}
    <h2>ESTADO FINAL DE LA OFICINA</h2>
    <div class="office-grid">
      <p>En el diseño de esta jugada no definimos respuestas correctas o incorrectas para cada situación. El líder es libre de responder como quiera, y es la acumulación de las consecuencias de sus decisiones lo que lleva a un estado final de la oficina.</p>
      <p>Dicho estado, sin embargo, tiene rangos esperables para los valores finales de las distintas métricas, de acuerdo a la narrativa y a los posibles efectos de cada decisión. Estos valores de referencia nos sirven para identificar tendencias (positivas o negativas) que se salgan de dichos rangos.</p>
      <table>
        <thead><tr><th>Variables</th><th>Inicio</th><th>Fin</th><th>Variación</th><th>Referencia</th><th>Observaciones</th></tr></thead>
        <tbody>${renderMetricTableRows(analytics)}</tbody>
      </table>
    </div>
    <div class="footer"><span>Estado final de la oficina</span><span>5</span></div>
  </section>

  <section class="page">
    ${renderHeader(6, 'Nivel de anticipación')}
    <h2>NIVEL DE ANTICIPACIÓN</h2>
    <p>La frecuencia de anticipación observada es del <strong>${escapeHtml(formatPct(analytics.alignmentPct))}</strong> (${analytics.alignmentCorrectCount} de ${analytics.totalRounds} situaciones). Este resultado se considera de nivel <strong>${escapeHtml(level)}</strong>.</p>
    <div class="scale-wrap">${renderAnticipationScale(analytics)}</div>
    <div class="summary-card" style="margin-top: 16mm;">
      <h3>Texto dinámico</h3>
      <p>${escapeHtml(sectionText(sections, 'opening', 'Sin texto dinámico configurado.'))}</p>
    </div>
    <div class="footer"><span>Nivel de anticipación</span><span>6</span></div>
  </section>

  <section class="page">
    ${renderHeader(7, 'Coincidencia entre individuos')}
    <h2>COINCIDENCIA ENTRE INDIVIDUOS</h2>
    <p>En esta sección, analizamos las respuestas individuales de los integrantes del equipo frente a cada situación. Estas respuestas corresponden a cómo ellos resolverían la situación (sin tener en cuenta lo que el líder haría).</p>
    <p>Para este análisis, comparamos su respuesta con la respuesta del líder, por un lado, y con la respuesta de la mayoría de sus compañeros, por el otro.</p>
    <p>Ordenamos los resultados en una matriz que relaciona ambos tipos de coincidencia, identificando zonas de riesgo de individualismo extremo (integrantes que no coinciden para nada con el líder o el grupo) y de pérdida de capacidad crítica (integrantes que coinciden totalmente con el líder o el grupo).</p>
    <p>Agregamos una referencia al valor de alineación del equipo (línea amarilla punteada).</p>
    ${renderParticipantMatrix(analytics)}
    <div class="footer"><span>Coincidencia entre individuos</span><span>7</span></div>
  </section>

  <section class="page">
    ${renderHeader(8, 'Matriz de alineación')}
    <h2>MATRIZ DE ALINEACIÓN</h2>
    <h3>Matriz de coincidencia / anticipación de individuo / equipo</h3>
    <p>La siguiente matriz relaciona, para cada situación, si el equipo pudo anticipar o no al líder (eje horizontal) con si los individuos del equipo decidirían igual que el líder (eje vertical). Estas dos variables se combinan en cuatro escenarios posibles. Lo deseable es que la mayoría de los casos pertenezcan, de forma equilibrada, a los escenarios 1 y 3, ya que eso  representaría que los individuos anticipan siempre al líder, incluso cuando tienen otra opinión (lo cual es saludable).</p>
    ${renderAlignmentMatrix(analytics)}
    <div class="footer"><span>Matriz de alineación</span><span>8</span></div>
  </section>

  <section class="page">
    ${renderHeader(9, 'Conclusiones')}
    <h2>CONCLUSIONES</h2>
    <p>A partir de lo analizado en el informe, arribamos a las siguientes conclusiones:</p>
    <ul>
      ${conclusions.map((conclusion) => `<li>${escapeHtml(conclusion)}</li>`).join('')}
    </ul>
    <div class="quote">
      <p>La alineación de un equipo con su líder es una medida confiable sobre la capacidad de ese equipo de actuar coordinadamente y llevar adelante la visión de ese líder. Al mismo tiempo que es deseable la mayor alineación posible, debemos cuidar que esa alineación no obture la capacidad crítica y diversidad de opiniones.</p>
      <p>Un equipo idóneo demuestra una multiplicidad de perspectivas a la hora de discutir y arribar a una decisión, y una alineación de criterios a la hora de ejecutarla.</p>
    </div>
    <div class="footer"><span>Conclusiones</span><span>9</span></div>
  </section>
</body>
</html>`;
};
