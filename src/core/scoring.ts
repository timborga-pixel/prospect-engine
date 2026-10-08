import type { Icp } from './types.js';
interface Co { industry?: string | null; city?: string | null; employees?: number | null; domain?: string | null; name: string }
interface Ct { title?: string | null; email_status?: string | null }
export function scoreProspect(c: Co, contacts: Ct[], websiteScore: number | null, icp: Icp) {
  const w = icp.weights, parts: { rule: string; points: number; evidence: string }[] = [];
  const add = (rule: string, points: number, ok: boolean, evidence: string) => ok && parts.push({ rule, points, evidence });
  const text = `${c.industry ?? ''} ${c.name}`.toLowerCase();
  const excluded = icp.excludeKeywords.some((k) => text.includes(k.toLowerCase()));
  add('Industry match', w.industry, !excluded && icp.industryKeywords.some((k) => text.includes(k.toLowerCase())), c.industry ?? c.name);
  add('Location match', w.location, !!c.city && icp.cities.some((x) => x.toLowerCase() === c.city!.toLowerCase()), c.city ?? '');
  add('Employee range', w.employees, c.employees != null && c.employees >= icp.employeesMin && c.employees <= icp.employeesMax, `${c.employees} employees`);
  add('Website exists', w.website, !!c.domain, c.domain ?? '');
  add('Website problems', w.websiteProblems, websiteScore != null && websiteScore < icp.weakWebsiteBelow, `website score ${websiteScore}`);
  add('Decision maker', w.decisionMaker, contacts.some((x) => icp.priorityTitles.some((t) => (x.title ?? '').toLowerCase().includes(t))), 'priority title found');
  add('Verified email', w.verifiedEmail, contacts.some((x) => x.email_status === 'valid'), 'email status valid');
  const total = excluded ? 0 : Math.min(100, parts.reduce((a, p) => a + p.points, 0));
  const b = icp.bands;
  const band = total >= b.high ? 'High priority' : total >= b.good ? 'Good' : total >= b.potential ? 'Potential' : 'Poor fit';
  return { total, band, parts };
}
