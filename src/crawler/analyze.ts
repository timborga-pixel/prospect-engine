import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
const UA = process.env.CRAWLER_USER_AGENT ?? 'ProspectEngineBot/0.1';
export interface Signal { name: string; description: string; evidence: string; confidence: number }
/** Fetches only the homepage, and only if robots.txt allows it. Returns null when disallowed. */
export async function analyzeWebsite(domain: string) {
  const base = `https://${domain}`;
  try {
    const r = await fetch(`${base}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok && robotsParser(`${base}/robots.txt`, await r.text()).isAllowed(`${base}/`, UA) === false) return null;
  } catch { /* no robots.txt reachable: continue */ }
  const t0 = Date.now();
  const res = await fetch(base, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const ms = Date.now() - t0, html = await res.text(), $ = cheerio.load(html);
  let score = 100; const signals: Signal[] = [];
  const flag = (cond: boolean, penalty: number, name: string, description: string, evidence: string, confidence = 0.8) => { if (cond) { score -= penalty; signals.push({ name, description, evidence, confidence }); } };
  flag(!res.url.startsWith('https'), 15, 'No HTTPS', 'Site is not served over HTTPS', res.url, 0.95);
  flag(!$('title').text().trim(), 8, 'Missing title tag', 'Homepage has no title', 'no <title>', 0.95);
  flag(!$('meta[name=description]').attr('content'), 8, 'Missing meta description', 'No meta description on homepage', 'no meta description', 0.95);
  flag($('h1').length !== 1, 5, 'H1 issue', 'Homepage should have exactly one H1', `${$('h1').length} H1 tags`, 0.9);
  flag(!$('meta[name=viewport]').length, 15, 'Not mobile-optimised', 'No viewport meta tag', 'no viewport meta', 0.7);
  flag(!$('a[href^="tel:"]').length, 5, 'No click-to-call', 'No tel: link found', 'no tel: link', 0.6);
  flag(!$('form').length, 10, 'No visible lead capture form', 'No <form> on homepage', 'no <form>', 0.6);
  const cta = $('a,button').map((_, e) => $(e).text()).get().some((t) => /book|boka|appointment|tidsbok|contact|kontakt/i.test(t));
  flag(!cta, 15, 'No obvious booking/contact CTA', 'No link or button suggesting booking or contact', 'no CTA keywords in links/buttons', 0.6);
  flag(!$('script[type="application/ld+json"]').length, 8, 'No structured data', 'No schema.org JSON-LD', 'no ld+json', 0.9);
  flag(!/fbq\(|connect\.facebook\.net/.test(html), 5, 'No Meta Pixel detected', 'No Meta Pixel code in homepage HTML', 'pattern not found', 0.6);
  flag(!/gtag\(|googletagmanager|google-analytics/.test(html), 5, 'No analytics detected', 'No Google analytics/tag manager in homepage HTML', 'pattern not found', 0.6);
  flag(ms > 2500, 10, 'Slow server response', 'Homepage HTML took long to load', `${ms} ms`, 0.5);
  const yr = html.match(/(?:©|&copy;|copyright)\s*(\d{4})/i)?.[1];
  flag(!!yr && +yr < new Date().getFullYear() - 3, 10, 'Possibly outdated site', 'Footer copyright year is old', `copyright ${yr}`, 0.5);
  return { score: Math.max(0, score), metrics: { ms, status: res.status, finalUrl: res.url }, signals };
}
