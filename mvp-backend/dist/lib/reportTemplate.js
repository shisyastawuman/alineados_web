import fs from 'fs';
import path from 'path';
const templatePath = path.join(process.cwd(), 'report-template.json');
const metricLabels = {
    stressLeader: 'Estrés del líder',
    performance: 'Performance del líder',
    relationship: 'Vínculo con el líder',
    stressJunior: 'Estrés de los juniors'
};
const loadTemplate = () => {
    const raw = fs.readFileSync(templatePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.sections || !Array.isArray(parsed.sections)) {
        return { sections: [] };
    }
    return parsed;
};
const matchesWhen = (when, ctx) => {
    if (when === true)
        return true;
    if (typeof when.success === 'boolean' && when.success !== ctx.success)
        return false;
    if (typeof when.alignmentPctGte === 'number') {
        const pct = Number(ctx.alignmentPct);
        if (Number.isNaN(pct) || pct < when.alignmentPctGte)
            return false;
    }
    if (typeof when.alignmentPctLt === 'number') {
        const pct = Number(ctx.alignmentPct);
        if (Number.isNaN(pct) || pct >= when.alignmentPctLt)
            return false;
    }
    return true;
};
const formatMetrics = (metrics) => {
    return Object.keys(metricLabels)
        .map((key) => `${metricLabels[key]} ${metrics[key]}`)
        .join(', ');
};
const interpolate = (text, vars) => {
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '');
};
export const buildReportTemplateContext = (analytics) => {
    const alignmentPct = analytics.alignmentPct ?? 0;
    const ctx = {
        success: analytics.outcomeSuccess,
        alignmentPct,
        roomCode: analytics.roomCode,
        totalRounds: String(analytics.totalRounds),
        alignmentCorrectCount: String(analytics.alignmentCorrectCount),
        outcomeLabel: analytics.outcomeSuccess ? 'éxito' : 'fracaso'
    };
    const vars = {
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
export const renderNarrativeSectionsFromTemplate = (analytics) => {
    const template = loadTemplate();
    const { ctx, vars } = buildReportTemplateContext(analytics);
    const blocks = [];
    for (const section of template.sections) {
        const chosen = section.candidates.find((candidate) => matchesWhen(candidate.when, ctx));
        if (chosen)
            blocks.push({ id: section.id, text: interpolate(chosen.text, vars) });
    }
    return blocks;
};
export const renderNarrativeFromTemplate = (analytics) => {
    const blocks = renderNarrativeSectionsFromTemplate(analytics);
    return blocks.map((block) => block.text).join('\n\n');
};
