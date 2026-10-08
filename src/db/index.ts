import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text: string, params?: unknown[]) => pool.query(text, params);
export const migrate = () => q(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
