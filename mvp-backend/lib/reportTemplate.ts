import fs from 'fs';
import path from 'path';
import type { GameAnalytics } from './analytics.js';
import { metricKeys, type MetricKey } from './metrics.js';

const templatePath = path.join(process.cwd(), 'report-template.json');

const metricLabels: Record<MetricKey, string> = {
  stressLeader: 'Estrés del líder',
  performance: 'Performance del líder',
  bondJunior1: 'Vínculo Junior 1',
  bondJunior2: 'Vínculo Junior 2',
  bondJunior3: 'Vínculo Junior 3',
  bondJunior4: 'Vínculo Junior 4',
  bondMentor: 'Vínculo mentor',
  stressJunior1: 'Estrés Junior 1',
  stressJunior2: 'Estrés Junior 2',
  stressJunior3: 'Estrés Junior 3',
  stressJunior4: 'Estrés Junior 4'
};

export interface TemplateSection {
  id: string;
  candidates: { when: true | Record<string, boolean | number>; text: string }[];
}

export interface ReportTemplateFile {
  sections: TemplateSection[];
}

export interface RenderedTemplateSection {
  id: string;
  text: string;
}

const loadTemplate = (): ReportTemplateFile => {
  const raw = fs.readFileSync(templatePath, 'utf-8');
  const parsed = JSON.parse(raw) as ReportTemplateFile;
  if (!parsed.sections || !Array.isArray(parsed.sections)) {
    return { sections: [] };
  }
  return parsed;
};

const matchesWhen = (when: true | Record<string, boolean | number>, ctx: Record<string, unknown>): boolean => {
  if (when === true) return true;
  if (typeof when.success === 'boolean' && when.success !== ctx.success) return false;
  if (typeof when.alignmentPctGte === 'number') {
    const pct = Number(ctx.alignmentPct);
    if (Number.isNaN(pct) || pct < when.alignmentPctGte) return false;
  }
  if (typeof when.alignmentPctLt === 'number') {
    const pct = Number(ctx.alignmentPct);
    if (Number.isNaN(pct) || pct >= when.alignmentPctLt) return false;
  }
  return true;
};

const formatMetrics = (metrics: Record<MetricKey, number>): string => {
  return metricKeys.map((key) => `${metricLabels[key]} ${metrics[key]}`).join(', ');
};

const interpolate = (text: string, vars: Record<string, string>): string => {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
};

export const buildReportTemplateContext = (analytics: GameAnalytics) => {
  const alignmentPct = analytics.alignmentPct ?? 0;
  const ctx: Record<string, unknown> = {
    success: analytics.outcomeSuccess,
    alignmentPct,
    roomCode: analytics.roomCode,
    totalRounds: String(analytics.totalRounds),
    alignmentCorrectCount: String(analytics.alignmentCorrectCount),
    outcomeLabel: analytics.outcomeSuccess ? 'éxito' : 'fracaso'
  };

  const vars: Record<string, string> = {
    roomCode: analytics.roomCode,
    totalRounds: String(analytics.totalRounds),
    alignmentPct: alignmentPct.toFixed(1),
    alignmentCorrectCount: String(analytics.alignmentCorrectCount),
    outcomeLabel: analytics.outcomeSuccess ? 'éxito' : 'fracaso',
    metricsInitial: formatMetrics(analytics.initialMetrics),
    metricsFinal: formatMetrics(analytics.finalMetrics),
    generatedAt: new Date().toLocaleString('es-AR')
  };

  return { ctx, vars };
};

export const renderNarrativeSectionsFromTemplate = (analytics: GameAnalytics): RenderedTemplateSection[] => {
  const template = loadTemplate();
  const { ctx, vars } = buildReportTemplateContext(analytics);

  const blocks: RenderedTemplateSection[] = [];
  for (const section of template.sections) {
    const chosen = section.candidates.find((candidate) => matchesWhen(candidate.when, ctx));
    if (chosen) blocks.push({ id: section.id, text: interpolate(chosen.text, vars) });
  }
  return blocks;
};

export const renderNarrativeFromTemplate = (analytics: GameAnalytics): string => {
  const blocks = renderNarrativeSectionsFromTemplate(analytics);
  return blocks.map((block) => block.text).join('\n\n');
};
