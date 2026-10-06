# CEO Signal

An interactive website profiling the CEOs of the companies ranked 1–100 on the 2026 Fortune 500: their college, major, career path, tenure, and notable decisions or statements, plus quick graphs of trends across the group.

Built by Calvin Hunt for the AI Builder Space Proseminar sprint.

## View the site
- **Locally:** double-click `index.html`.
- **Online:** GitHub repo → Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)` → Save. The site appears at https://calhunt.github.io/sprint1/ within a few minutes.

## Updating data
Edit `data/companies.json` or `data/profiles/*.json`, then run `python scripts/build_data.py` to regenerate `data/site-data.js` (the file the site reads). The build applies `data/vocab.json` (standard university names, field-of-study groups, degree levels) and prints any field of study it can't place in a group.

## Repo layout
- `index.html`, `assets/`: the website (plain HTML/CSS/JS, no build tools)
- `data/companies.json`: seed list of the 100 companies (rank, sector, current CEO, ticker, sources)
- `data/SCHEMA.md`: data fields and sourcing rules
- `data/profiles/`: one JSON per CEO (co-CEOs: `<company>--<lastname>.json`) + `REVIEW.md` checklist
- `data/vocab.json`: standard vocabulary for filters and charts
- `data/site-data.js`: generated bundle of the above
- `scripts/build_data.py`: builds `site-data.js`

## Status
- [x] Data schema
- [x] Seed list of 100 companies (checked 2026-10-05)
- [x] 5-CEO pilot profiles (Nvidia, JPMorgan Chase, Walmart, Eli Lilly, StoneX)
- [x] Website v1 (search, A–Z dropdown, industry tabs, profile mini-pages, side-by-side compare, trend graphs)
- [x] Filter panel: university, field of study, degree type, professional background
- [x] Standard vocabulary for universities, fields of study and degree levels
- [x] All 100 companies profiled (104 CEOs incl. co-CEOs), checked 2026-10-05
- [ ] Enrichment pass on profiles researched without web search (see data/profiles/REVIEW.md)
- [ ] Automatic CEO-change detection (SEC 8-K via GitHub Actions)
