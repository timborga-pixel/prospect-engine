# Prospect Engine (Phase 1)

Import companies, deduplicate, analyze websites, score against your ICP, review, export CSV.

## Run
1. Install Node 20+, pnpm (or npm) and Docker.
2. `cp .env.example .env` and set CRAWLER_USER_AGENT to your real contact details.
3. `docker compose up -d`
4. `pnpm install` (or `npm install`), then `pnpm dev`
5. Open http://localhost:3000, choose `sample.csv`, press Run search and score, then Analyze websites.

## Layout
- `src/core`: ProspectSource interface, CSV source, normalization, configurable scoring
- `src/crawler`: homepage analysis (robots.txt respected, 7-day cache, 1 req/second)
- `src/db`: schema.sql (applied on startup)
- `src/server.ts`: API (POST /api/prospects/search, /enrich, /export; GET /api/prospects, /api/prospects/:id, /api/duplicates)

## Not in Phase 1
Decision-maker enrichment, email verification, AI analysis, job queue, cold-email integration.
Add providers by implementing `ProspectSource`. Only crawl sites you are permitted to, and follow GDPR for personal data.
