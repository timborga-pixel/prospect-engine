export const normName = (s = '') => s.toLowerCase().replace(/\b(ab|aktiebolag|clinic|klinik)\b/g, '').replace(/[^a-z0-9åäö ]/g, '').replace(/\s+/g, ' ').trim();
export const normDomain = (d?: string) => (d ? d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim() || null : null);
export function dice(a: string, b: string): number {
  const g = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const x = s.slice(i, i + 2); m.set(x, (m.get(x) ?? 0) + 1); } return m; };
  const A = g(a), B = g(b); let n = 0, t = 0;
  A.forEach((v, k) => { n += Math.min(v, B.get(k) ?? 0); t += v; }); B.forEach((v) => (t += v));
  return t ? (2 * n) / t : 0;
}
