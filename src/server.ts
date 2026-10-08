import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import Papa from 'papaparse';
import path from 'node:path';
import { q, migrate } from './db/index.js';
import { CsvSource } from './core/csvSource.js';
import { dice, normDomain, normName } from './core/normalize.js';
import { scoreProspect } from './core/scoring.js';
import { analyzeWebsite } from './crawler/analyze.js';
import { defaultIcp, type Company, type Icp } from './core/types.js';

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
app.register(fastifyStatic, { root: path.resolve('public') });

async function upsertCompany(c: Company): Promise<number> {
  const dom = normDomain(c.domain), nn = normName(c.name), now = new Date().toISOString();
  let hit = dom ? (await q('SELECT id FROM companies WHERE domain=$1', [dom])).rows[0] : undefined;
  if (!hit && c.phone) hit = (await q('SELECT id FROM companies WHERE phone=$1 AND city IS NOT DISTINCT FROM $2', [c.phone, c.city ?? null])).rows[0];
  if (hit) {
    await q(`UPDATE companies SET phone=COALESCE(phone,$2),city=COALESCE(city,$3),industry=COALESCE(industry,$4),employees=COALESCE(employees,$5),sources=(SELECT array_agg(DISTINCT s) FROM unnest(sources||$6::text[]) s) WHERE id=$1`,
      [hit.id, c.phone ?? null, c.city ?? null, c.industry ?? null, c.employees ?? null, [c.source]]);
    return hit.id;
  }
  const prov: Record<string, unknown> = {};
  for (const k of ['employees', 'industry', 'phone', 'city'] as const) if (c[k] != null && c[k] !== '') prov[k] = { value: c[k], source: c.source, retrieved_at: now };
  const ins = await q('INSERT INTO companies(name,normalized_name,domain,phone,city,country,industry,employees,sources,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
    [c.name, nn, dom, c.phone ?? null, c.city ?? null, c.country ?? null, c.industry ?? null, c.employees ?? null, [c.source], prov]);
  const id = ins.rows[0].id as number;
  // Uncertain match: keep both records and flag for review (never auto-merge on fuzzy).
  const cands = (await q('SELECT id,normalized_name FROM companies WHERE city IS NOT DISTINCT FROM $1 AND id<>$2', [c.city ?? null, id])).rows;
  const best = cands.map((x) => ({ id: x.id as number, sim: dice(x.normalized_name, nn) })).filter((x) => x.sim > 0.8).sort((a, b) => b.sim - a.sim)[0];
  if (best) await q('INSERT INTO dedupe_candidates(company_id,incoming,similarity) VALUES($1,$2,$3)', [best.id, JSON.stringify({ ...c, new_company_id: id }), best.sim]);
  return id;
}

async function scoreAll(searchId: number, icp: Icp) {
  const cos = (await q(`SELECT c.*, w.score AS ws FROM companies c JOIN prospects p ON p.company_id=c.id AND p.search_id=$1 LEFT JOIN website_analysis w ON w.company_id=c.id`, [searchId])).rows;
  const cts = (await q('SELECT * FROM contacts')).rows;
  for (const c of cos) {
    const s = scoreProspect(c, cts.filter((x) => x.company_id === c.id), c.ws, icp);
    await q('UPDATE prospects SET score=$3,band=$4,breakdown=$5 WHERE search_id=$1 AND company_id=$2', [searchId, c.id, s.total, s.band, JSON.stringify(s.parts)]);
  }
}

type Entry = { c: Company; contact?: { name: string; title?: string; email?: string; emailStatus?: string } };

// Creates a project (or updates one when searchId is given), adds companies from CSV and/or manual input, then scores the project.
app.post<{ Body: { searchId?: number; name?: string; icp?: Icp; csv?: string; companies?: any[] } }>('/api/prospects/search', async (req) => {
  const b = req.body, icp = { ...defaultIcp, ...(b.icp ?? {}) };
  let sid: number;
  if (b.searchId) { sid = b.searchId; await q('UPDATE searches SET name=COALESCE($2,name), icp=$3 WHERE id=$1', [sid, b.name ?? null, JSON.stringify(icp)]); }
  else sid = (await q('INSERT INTO searches(name,icp) VALUES($1,$2) RETURNING id', [b.name || 'Nytt projekt', JSON.stringify(icp)])).rows[0].id as number;
  const entries: Entry[] = [];
  if (b.csv) { const src = new CsvSource(b.csv); for (const c of await src.search()) entries.push({ c, contact: ((await src.getContacts?.(c)) ?? [])[0] }); }
  for (const m of b.companies ?? []) if (m.name) entries.push({ c: { name: m.name, domain: m.domain, phone: m.phone, city: m.city, industry: m.industry, employees: m.employees ? Number(m.employees) : null, source: 'manual' }, contact: m.contact ? { name: m.contact, title: m.title, email: m.email, emailStatus: 'unknown' } : undefined });
  for (const { c, contact } of entries) {
    const id = await upsertCompany(c);
    await q(`INSERT INTO prospects(search_id,company_id,score,band,breakdown) VALUES($1,$2,0,'','[]') ON CONFLICT DO NOTHING`, [sid, id]);
    if (contact) await q('INSERT INTO contacts(company_id,name,title,email,email_status,source) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (company_id,name) DO NOTHING', [id, contact.name, contact.title ?? null, contact.email || null, contact.emailStatus ?? 'unknown', c.source]);
  }
  await scoreAll(sid, icp);
  return { searchId: sid, imported: entries.length };
});

app.get('/api/searches', async () => (await q('SELECT s.id,s.name,s.created_at,(SELECT count(*)::int FROM prospects WHERE search_id=s.id) n FROM searches s ORDER BY s.id DESC')).rows);
app.get<{ Params: { id: string } }>('/api/searches/:id', async (req, rep) => (await q('SELECT * FROM searches WHERE id=$1', [req.params.id])).rows[0] ?? rep.code(404).send({ error: 'not found' }));
app.delete<{ Params: { id: string } }>('/api/searches/:id', async (req) => { await q('DELETE FROM searches WHERE id=$1', [req.params.id]); return { ok: true }; });

// Crawls homepages (robots.txt respected, results cached for 7 days) then re-scores.
app.post<{ Body: { searchId: number } }>('/api/prospects/enrich', async (req) => {
  const sid = req.body.searchId;
  const todo = (await q(`SELECT c.id,c.domain FROM companies c JOIN prospects p ON p.company_id=c.id AND p.search_id=$1 LEFT JOIN website_analysis w ON w.company_id=c.id WHERE c.domain IS NOT NULL AND (w.next_refresh_at IS NULL OR w.next_refresh_at<now())`, [sid])).rows;
  let done = 0, skipped = 0;
  for (const c of todo) {
    try {
      const a = await analyzeWebsite(c.domain);
      if (!a) { skipped++; continue; }
      await q(`INSERT INTO website_analysis(company_id,score,metrics,last_scraped_at,next_refresh_at) VALUES($1,$2,$3,now(),now()+interval '7 days') ON CONFLICT (company_id) DO UPDATE SET score=$2,metrics=$3,last_scraped_at=now(),next_refresh_at=now()+interval '7 days'`, [c.id, a.score, a.metrics]);
      for (const s of a.signals)
        await q(`INSERT INTO prospect_signals(company_id,name,description,evidence,source,confidence) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (company_id,name) DO UPDATE SET evidence=$4,confidence=$6,detected_at=now()`, [c.id, s.name, s.description, s.evidence, `https://${c.domain}`, s.confidence]);
      await q('UPDATE companies SET last_enriched_at=now() WHERE id=$1', [c.id]); done++;
    } catch (e) { req.log.warn({ domain: c.domain, err: String(e) }, 'analysis failed'); skipped++; }
    await new Promise((r) => setTimeout(r, 1000)); // polite rate limit
  }
  const icp = (await q('SELECT icp FROM searches WHERE id=$1', [sid])).rows[0].icp as Icp;
  await scoreAll(sid, icp);
  return { analyzed: done, skipped };
});

const LIST = `SELECT p.company_id id,c.name,c.domain,c.city,c.industry,c.employees,p.score,p.band,w.score website_score,
 (SELECT row_to_json(t) FROM (SELECT name,title,email,email_status FROM contacts WHERE company_id=c.id ORDER BY (email_status='valid') DESC,id LIMIT 1) t) contact,
 (SELECT COALESCE(json_agg(name),'[]') FROM prospect_signals WHERE company_id=c.id) signals
 FROM prospects p JOIN companies c ON c.id=p.company_id LEFT JOIN website_analysis w ON w.company_id=c.id`;

app.get<{ Querystring: { searchId: string; min?: string } }>('/api/prospects', async (req) =>
  (await q(`${LIST} WHERE p.search_id=$1 AND p.score>=$2 ORDER BY p.score DESC`, [req.query.searchId, req.query.min ?? 0])).rows);

app.get<{ Params: { id: string }; Querystring: { searchId: string } }>('/api/prospects/:id', async (req, rep) => {
  const { id } = req.params;
  const row = (await q(`${LIST} WHERE p.search_id=$1 AND p.company_id=$2`, [req.query.searchId, id])).rows[0];
  if (!row) return rep.code(404).send({ error: 'not found' });
  const [company, contacts, signals, analysis, prospect] = await Promise.all([
    q('SELECT * FROM companies WHERE id=$1', [id]), q('SELECT * FROM contacts WHERE company_id=$1', [id]),
    q('SELECT * FROM prospect_signals WHERE company_id=$1', [id]), q('SELECT * FROM website_analysis WHERE company_id=$1', [id]),
    q('SELECT breakdown FROM prospects WHERE search_id=$1 AND company_id=$2', [req.query.searchId, id])]);
  return { company: company.rows[0], contacts: contacts.rows, signals: signals.rows, website: analysis.rows[0] ?? null, breakdown: prospect.rows[0].breakdown };
});

app.get('/api/duplicates', async () => (await q(`SELECT d.*,c.name existing_name FROM dedupe_candidates d JOIN companies c ON c.id=d.company_id WHERE status='pending'`)).rows);

app.post<{ Body: { searchId: number; ids?: number[] } }>('/api/prospects/export', async (req, rep) => {
  const icp = (await q('SELECT icp FROM searches WHERE id=$1', [req.body.searchId])).rows[0].icp as Icp;
  let rows = (await q(`${LIST} WHERE p.search_id=$1 ORDER BY p.score DESC`, [req.body.searchId])).rows;
  if (req.body.ids?.length) rows = rows.filter((r) => req.body.ids!.includes(r.id));
  const out = rows.map((r) => {
    const blocked = icp.excludeEmailStatuses.includes(r.contact?.email_status ?? '');
    return { company: r.name, domain: r.domain, city: r.city, industry: r.industry, employees: r.employees, contact: r.contact?.name, title: r.contact?.title,
      email: blocked ? '' : r.contact?.email, email_status: r.contact?.email_status, icp_score: r.score, band: r.band, website_score: r.website_score, opportunity_signals: (r.signals as string[]).join('; ') };
  });
  rep.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename=prospects.csv');
  return Papa.unparse(out);
});

await migrate();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
