import Papa from 'papaparse';
import type { Company, Contact, ProspectSource } from './types.js';
type Row = Record<string, string>;
export class CsvSource implements ProspectSource {
  name = 'csv'; private rows: Row[];
  constructor(text: string) { this.rows = Papa.parse<Row>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() }).data; }
  async search(): Promise<Company[]> {
    return this.rows.map((r) => ({ name: r.name, domain: r.domain, phone: r.phone, city: r.city, country: r.country, industry: r.industry, employees: r.employees ? Number(r.employees) : null, source: 'csv' })).filter((c) => c.name);
  }
  async getContacts(company: Company): Promise<Contact[]> {
    return this.rows.filter((r) => r.name === company.name && r.contact).map((r) => ({ name: r.contact, title: r.title, email: r.email || undefined, emailStatus: (r.email_status as Contact['emailStatus']) || 'unknown', source: 'csv' }));
  }
}
