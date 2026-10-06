# CEO Signal data schema

Scope: CEOs of the companies ranked 1–100 on the **2026 Fortune 500**. Industry tabs use **Fortune's sector labels**.
Rule: **every fact carries a source URL.** No source, no fact.

## 1. `data/companies.json` (seed list, one entry per company)

| Field | Meaning |
|---|---|
| `id` | URL-safe key, e.g. `walmart`. Also the profile filename. |
| `rank` | 2026 Fortune 500 rank (1–100). |
| `company`, `ticker` | Name and primary US ticker (`null` for mutuals/private firms). |
| `sector`, `industry` | Fortune 500 sector (drives industry tabs) and Fortune industry. |
| `ceo.names` | Current CEO(s); two names = co-CEOs. |
| `ceo.co_ceo`, `ceo.interim` | Flags for co-CEO and interim/acting arrangements. |
| `ceo.since` | Start date in role (`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`). |
| `review` | `ceo_confidence` (high/medium/low), `sector_verified`, `since_verified`, `checked_on`. |
| `notes`, `sources` | Context (e.g. recent changes) and the URLs used. |

## 2. `data/profiles/<id>.json` (one per CEO; co-CEOs use `<company_id>--<lastname>.json`)

```json
{
  "id": "walmart",
  "name": "John R. Furner",
  "company_id": "walmart",
  "role": "CEO | Co-CEO | Interim CEO | Acting CEO",
  "education": [
    {"institution": "…", "degree": "BA", "field": "…", "year": 1996, "source": "https://…"}
  ],
  "career": [
    {"organization": "…", "title": "…", "start": "YYYY", "end": "YYYY or null", "source": "https://…"}
  ],
  "background_category": "Founder | Operations | Finance | Engineering/Technical | Sales & Marketing | Law | Consulting | Science/Medical | Investment/Trading",
  "background_rationale": "One sentence explaining the category.",
  "tenure": {"start": "YYYY-MM-DD", "source": "https://…"},
  "notable": [
    {"date": "YYYY-MM", "type": "decision | statement", "summary": "One neutral sentence.", "source": "https://…"}
  ],
  "personal_story": {
    "hook": "One punchy, literally true sentence (max ~20 words).",
    "summary": "3-5 vivid, factual sentences: origins, formative moments, turning points.",
    "facts": [{"label": "Grew up | Family background | First job | Turning point | Early ambition | Mentor | Other", "value": "…", "source": "https://…"}],
    "quote": {"text": "Short verbatim quote in the CEO's words", "context": "where/when", "source": "https://…"},
    "depth": "rich | moderate | limited",
    "sources": ["https://…"]
  },
  "last_reviewed": "YYYY-MM-DD",
  "open_issues": ["anything not yet confirmed"],
  "needs_enrichment": false
}
```

Notes:
- `field` (major) and `institution` should use consistent naming so the trend graphs count correctly (e.g. always "University of Pennsylvania", not "Penn" / "UPenn").
- `background_category` is the one judgment field; it powers the "professional background" graph. Keep categories to a fixed short list.
- Notable decisions/statements: 2–4 per CEO, neutral wording, each linked to its source.
- Personal story: sourced from interviews, profiles, speeches, (auto)biographies and news; only what the CEO has shared publicly or is widely reported; no judgments of character. Depth follows availability ("limited" is an honest answer).
- `open_issues` and `needs_enrichment` are internal review notes; the build strips them from the public site.
- Standard vocabulary (`data/vocab.json`): the build maps university aliases to one official name, adds `field_groups` (e.g. Engineering, Economics) and `degree_level` (Bachelor's, MBA, Master's, Law, Doctorate/MD) to each education entry. The site's filters and charts use these; profiles keep the original wording for display.
- Personality profiles are out of scope for this sprint.

## 3. Update mechanism (planned)

A scheduled GitHub Action reads tickers from `companies.json`, maps them to SEC CIK numbers, and checks EDGAR for new **Form 8-K Item 5.02** filings (officer departures/appointments). Hits are flagged for review. Companies with `ticker: null` (mutual insurers, Publix, etc.) need a news-based check instead.
