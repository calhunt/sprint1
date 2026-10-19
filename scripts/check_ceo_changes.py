#!/usr/bin/env python3
"""CEO Signal: weekly CEO-change watcher (SEC EDGAR, 8-K Item 5.02).

Two modes
---------
  python scripts/check_ceo_changes.py --init-ciks
      One-time setup. Matches each company in data/companies.json to its SEC
      CIK number (by ticker, then by name) and writes data/sec_ids.json.
      REVIEW THAT FILE BY HAND: every match shows the SEC's own company name.

  python scripts/check_ceo_changes.py
      Weekly scan. Looks for 8-K filings that include Item 5.02 ("departure or
      appointment of officers/directors") in the filing window, and writes a
      Markdown report (ceo_watch_report.md) for the GitHub Action to post as an
      Issue. It only FLAGS possible changes; a human verifies and updates
      profiles. Item 5.02 also covers non-CEO officers and directors, so
      false alarms are expected. The report sorts likely-CEO filings first.

Single source: SEC EDGAR only (free, official, no API key). The SEC requires a
User-Agent that identifies you with a contact email: set SEC_USER_AGENT, e.g.
    SEC_USER_AGENT="CEO Signal your.name@example.com"

Standard library only, so the Action needs no pip install.
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPANIES_PATH = ROOT / "data" / "companies.json"
SEC_IDS_PATH = ROOT / "data" / "sec_ids.json"
REPORT_PATH = ROOT / "ceo_watch_report.md"

SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FILING_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"
INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/"

PAUSE = 0.25  # seconds between requests; SEC's limit is 10/second
CEO_RE = re.compile(r"chief\s+executive\s+officer|co-chief\s+executive|\bCEO\b", re.I)
MAX_REPORT_CHARS = 60000  # GitHub issue bodies cap at 65,536 characters


# ----------------------------------------------------------------- HTTP ----
def _user_agent():
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if "@" not in ua:
        sys.exit(
            "Set SEC_USER_AGENT to something with a contact email, e.g.\n"
            '  SEC_USER_AGENT="CEO Signal your.name@example.com"\n'
            "The SEC blocks requests that don't identify the sender."
        )
    return ua


def get_text(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": _user_agent()})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            time.sleep(PAUSE)
            return data.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise


def get_json(url):
    return json.loads(get_text(url))


# ----------------------------------------------------------- companies -----
def load_companies():
    """Tolerant loader: a list of objects, {"companies": [...]}, or {id: obj}."""
    raw = json.loads(COMPANIES_PATH.read_text(encoding="utf-8"))
    pairs = []
    if isinstance(raw, dict) and isinstance(raw.get("companies"), list):
        raw = raw["companies"]
    if isinstance(raw, dict):
        pairs = [(k, v) for k, v in raw.items() if isinstance(v, dict)]
    else:
        pairs = [(None, v) for v in raw if isinstance(v, dict)]
    out = []
    for key, c in pairs:
        cid = c.get("id") or c.get("company_id") or key
        name = c.get("name") or c.get("company") or cid
        out.append({"id": cid, "name": name, "ticker": (c.get("ticker") or "").upper()})
    return out


def norm_name(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", "", s)
    drop = {"inc", "corp", "corporation", "company", "co", "the", "holdings",
            "group", "plc", "ltd", "limited", "and", "de", "sa", "nv"}
    return " ".join(w for w in s.split() if w not in drop)


def init_ciks(force=False):
    companies = load_companies()
    existing = {}
    if SEC_IDS_PATH.exists() and not force:
        existing = json.loads(SEC_IDS_PATH.read_text(encoding="utf-8"))
    tickers = get_json(TICKERS_URL)
    by_ticker, by_name = {}, {}
    for row in tickers.values():
        by_ticker.setdefault(row["ticker"].upper(), row)
        by_name.setdefault(norm_name(row["title"]), row)

    result, unmatched = dict(existing), []
    for c in companies:
        if c["id"] in existing and existing[c["id"]].get("cik"):
            continue
        row, how = None, None
        if c["ticker"] and c["ticker"] in by_ticker:
            row, how = by_ticker[c["ticker"]], "ticker"
        elif norm_name(c["name"]) in by_name:
            row, how = by_name[norm_name(c["name"])], "name"
        if row:
            result[c["id"]] = {"name": c["name"], "cik": int(row["cik_str"]),
                               "sec_name": row["title"], "matched_by": how}
        else:
            result[c["id"]] = {"name": c["name"], "cik": None,
                               "note": "no match; fill in CIK by hand, or leave null "
                                       "(private/mutual companies may not file 8-Ks)"}
            unmatched.append(c["name"])
    SEC_IDS_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {SEC_IDS_PATH}: {len(result) - len(unmatched)} matched, "
          f"{len(unmatched)} need review.")
    for n in unmatched:
        print("  unmatched:", n)
    print("Check each 'sec_name' against the company before trusting it.")


# ----------------------------------------------------------- scanning ------
def recent_502_filings(sub, start, end):
    """Yield 8-K filings with Item 5.02 filed between start and end (inclusive)."""
    r = sub.get("filings", {}).get("recent", {})
    forms = r.get("form", [])
    for i, form in enumerate(forms):
        if not str(form).startswith("8-K"):
            continue
        filed = r["filingDate"][i]
        if not (start <= filed <= end):
            continue
        items = [x.strip() for x in (r.get("items", [""] * len(forms))[i] or "").split(",")]
        if "5.02" not in items:
            continue
        yield {
            "form": form,
            "filed": filed,
            "accession": r["accessionNumber"][i],
            "doc": r["primaryDocument"][i],
        }


def analyse_filing(cik, f):
    """Fetch the filing text; report whether it mentions the CEO and a snippet."""
    acc = f["accession"].replace("-", "")
    url = FILING_URL.format(cik=cik, acc=acc, doc=f["doc"])
    f["url"] = url
    f["index_url"] = INDEX_URL.format(cik=cik, acc=acc)
    try:
        text = get_text(url)
    except Exception as e:  # keep the flag even if the text can't be read
        f["mentions_ceo"] = None
        f["snippet"] = f"(could not read filing text: {e})"
        return f
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"\s+", " ", text)
    f["mentions_ceo"] = bool(CEO_RE.search(text))
    m = re.search(r"Item\s+5\.02", text, re.I)
    start = m.start() if m else 0
    # skip past the cover page's table of contents if the heading appears twice
    ms = list(re.finditer(r"Item\s+5\.02", text, re.I))
    if len(ms) > 1:
        start = ms[1].start()
    f["snippet"] = text[start:start + 450].strip()
    return f


def default_window(today=None):
    """Previous Monday through Sunday, so weekly runs never overlap or skip."""
    today = today or dt.date.today()
    return (today - dt.timedelta(days=7)).isoformat(), (today - dt.timedelta(days=1)).isoformat()


def build_report(start, end, hits, errors, skipped, checked):
    lines = [f"# CEO watch: SEC 8-K Item 5.02 filings, {start} to {end}", ""]
    lines.append(f"Checked {checked} companies on SEC EDGAR. "
                 f"{len(hits)} filing(s) flagged. These are **possible** changes, "
                 "not confirmed ones: Item 5.02 also covers other officers and "
                 "directors. Verify each before editing a profile.")
    lines.append("")
    likely = [h for h in hits if h["mentions_ceo"]]
    other = [h for h in hits if not h["mentions_ceo"]]

    def block(title, group):
        if not group:
            return
        lines.extend([f"## {title}", ""])
        for h in group:
            lines.append(f"- [ ] **{h['company']}** (`{h['company_id']}`), {h['form']} "
                         f"filed {h['filed']}: [filing]({h['url']}) · "
                         f"[all documents]({h['index_url']})")
            lines.append(f"  > {h['snippet']}")
        lines.append("")

    block("Mentions the CEO: check first", likely)
    block("No CEO mention found (likely other officers or directors)", other)
    if not hits:
        lines.extend(["No Item 5.02 filings in this window. Nothing to do.", ""])
    if errors:
        lines.extend(["## Lookup errors (these companies were NOT checked)", ""])
        lines.extend(f"- {e}" for e in errors)
        lines.append("")
    if skipped:
        lines.extend(["## No SEC ID on file: check by hand occasionally", "",
                      ", ".join(skipped), ""])
    lines.extend([
        "## When a CEO change is confirmed",
        "",
        "1. Re-run the research prompt for the new CEO (see `data/SCHEMA.md`); "
        "use the 8-K or its press release exhibit as the tenure source.",
        "2. Update `data/companies.json` and add the new profile; keep the "
        "outgoing CEO out of the site.",
        "3. Run `python scripts/build_data.py`, then commit and push.",
    ])
    text = "\n".join(lines)
    if len(text) > MAX_REPORT_CHARS:
        text = text[:MAX_REPORT_CHARS] + "\n\n(report truncated)"
    return text


def scan(start, end):
    ids = json.loads(SEC_IDS_PATH.read_text(encoding="utf-8")) \
        if SEC_IDS_PATH.exists() else sys.exit("data/sec_ids.json not found: run with --init-ciks first.")
    hits, errors, skipped, checked = [], [], [], 0
    for c in load_companies():
        entry = ids.get(c["id"], {})
        cik = entry.get("cik")
        if not cik:
            skipped.append(c["name"])
            continue
        try:
            sub = get_json(SUBMISSIONS_URL.format(cik=int(cik)))
            checked += 1
            for f in recent_502_filings(sub, start, end):
                f = analyse_filing(int(cik), f)
                f.update(company=c["name"], company_id=c["id"])
                hits.append(f)
        except Exception as e:
            errors.append(f"{c['name']} (CIK {cik}): {e}")
    hits.sort(key=lambda h: (not h["mentions_ceo"], h["company"]))
    return hits, errors, skipped, checked


def write_outputs(**kv):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            for k, v in kv.items():
                fh.write(f"{k}={v}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--init-ciks", action="store_true", help="build data/sec_ids.json")
    ap.add_argument("--force", action="store_true", help="with --init-ciks: redo all matches")
    ap.add_argument("--start", default="", help="window start, YYYY-MM-DD (default: last Monday)")
    ap.add_argument("--end", default="", help="window end, YYYY-MM-DD (default: yesterday)")
    args = ap.parse_args()

    if args.init_ciks:
        init_ciks(force=args.force)
        return

    d_start, d_end = default_window()
    start, end = args.start or d_start, args.end or d_end
    hits, errors, skipped, checked = scan(start, end)
    REPORT_PATH.write_text(build_report(start, end, hits, errors, skipped, checked), encoding="utf-8")
    print(f"Window {start} to {end}: checked {checked}, flagged {len(hits)}, "
          f"errors {len(errors)}, no-CIK {len(skipped)}. Report: {REPORT_PATH}")
    write_outputs(notify=str(bool(hits or errors)).lower(), window=f"{start} to {end}")
    if checked == 0:
        sys.exit("No companies could be checked: failing so the Action shows red.")


if __name__ == "__main__":
    main()
