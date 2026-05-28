import { chromium } from 'playwright';
import { buildReportHtml } from './reportHtml.js';
export const buildAnalyticsPdfBuffer = (analytics) => {
    return buildAnalyticsPdfBufferWithBrowser(analytics);
};
const buildAnalyticsPdfBufferWithBrowser = async (analytics) => {
    let browser = null;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage({
            viewport: { width: 1240, height: 1754 },
            deviceScaleFactor: 2
        });
        await page.emulateMedia({ media: 'print' });
        await page.setContent(buildReportHtml(analytics), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        return await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' }
        });
    }
    finally {
        await browser?.close();
    }
};
