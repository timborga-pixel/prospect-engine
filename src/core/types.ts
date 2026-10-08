export interface Company { name: string; domain?: string; phone?: string; city?: string; country?: string; industry?: string; employees?: number | null; source: string; sourceUrl?: string }
export interface Contact { name: string; title?: string; email?: string; emailStatus?: 'valid' | 'invalid' | 'risky' | 'unknown'; source: string }
export interface SearchQuery { text?: string }
/** Add new discovery providers by implementing this. */
export interface ProspectSource {
  name: string;
  search(query: SearchQuery): Promise<Company[]>;
  getCompanyDetails?(id: string): Promise<Company>;
  getContacts?(company: Company): Promise<Contact[]>;
}
export interface Icp {
  industryKeywords: string[]; excludeKeywords: string[]; cities: string[];
  employeesMin: number; employeesMax: number; weakWebsiteBelow: number;
  priorityTitles: string[]; excludeEmailStatuses: string[];
  weights: Record<'industry' | 'location' | 'employees' | 'website' | 'websiteProblems' | 'decisionMaker' | 'verifiedEmail', number>;
  bands: { potential: number; good: number; high: number };
}
export const defaultIcp: Icp = {
  industryKeywords: ['dental'], excludeKeywords: ['hospital', 'university'], cities: ['Stockholm'],
  employeesMin: 5, employeesMax: 50, weakWebsiteBelow: 60,
  priorityTitles: ['owner', 'founder', 'ceo', 'managing director', 'marketing'], excludeEmailStatuses: ['invalid', 'risky'],
  weights: { industry: 20, location: 15, employees: 10, website: 5, websiteProblems: 25, decisionMaker: 10, verifiedEmail: 15 },
  bands: { potential: 40, good: 60, high: 80 },
};
