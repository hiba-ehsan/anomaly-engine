"""HTML cleaning and SEC filing section extraction.

SEC 10-K / 10-Q documents are large and extremely noisy.  The extractor below
is deliberately dependency-light (BeautifulSoup only) and works on the plain
text representation of a filing.  It recognises "Item 1A. Risk Factors" style
headings, ignores table-of-contents duplicates by keeping the longest body for
each item, and caps each section so downstream Spark jobs stay predictable.
"""

from __future__ import annotations

import re
from typing import Optional

from bs4 import BeautifulSoup

MAX_SECTION_CHARS = 220_000
MAX_CLEAN_TEXT_CHARS = 500_000

# Canonical item labels found in 10-K and 10-Q filings.
ITEM_NAMES = {
    "1": "business",
    "1a": "risk_factors",
    "1b": "unresolved_staff_comments",
    "1c": "cybersecurity",
    "2": "properties",
    "3": "legal_proceedings",
    "4": "mine_safety",
    "5": "market_for_registrants_equity",
    "6": "selected_financial_data",
    "7": "md&a",
    "7a": "quantitative_market_risk",
    "8": "financial_statements",
    "9": "changes_in_disagreements",
    "9a": "controls_and_procedures",
    "9b": "other_information",
    "10": "directors_and_governance",
    "11": "executive_compensation",
    "12": "security_ownership",
    "13": "related_party_transactions",
    "14": "principal_accountant_fees",
    "15": "exhibits",
}

# Headings that should not be treated as the beginning of a section body.
_HEADING_RE = re.compile(
    r"^\s*item\s+(\d{1,2}[a-c]?)\s*(?:[\.\:\-–—]\s*)?(.*)$", re.IGNORECASE
)
_TOC_HINT_RE = re.compile(r"(?:\.{3,}|\s{4,}\d+\s*$)")
_PAGE_NUMBER_RE = re.compile(r"^\s*(?:page\s*)?\d{1,3}\s*$", re.IGNORECASE)


def clean_html(html: str) -> str:
    """Return readable plain text for a filing, capped for downstream use."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "meta", "link", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()[:MAX_CLEAN_TEXT_CHARS]


def _normalise_heading(line: str) -> Optional[tuple[str, str]]:
    """Return (canonical item key, remainder of heading) for a heading line."""
    stripped = line.strip()
    if not stripped or len(stripped) > 160:
        return None
    match = _HEADING_RE.match(stripped)
    if not match:
        return None
    number = match.group(1).lower()
    if number not in ITEM_NAMES:
        return None
    return f"item_{number}", match.group(2).strip(" .:-–—")


def extract_sections(html: str) -> dict[str, str]:
    """Extract item-level sections, keeping the longest body per item.

    Table-of-contents entries are usually short; the real section body is much
    longer.  We therefore accumulate every candidate and keep the longest one,
    which is robust against the common duplicate-heading problem in 10-Ks.
    """
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "meta", "link", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.split("\n")]

    candidates: dict[str, list[str]] = {}
    current: Optional[str] = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current, current_lines
        if current and current_lines:
            body = "\n".join(current_lines).strip()
            if len(body) > 200:
                candidates.setdefault(current, []).append(body)
        current = None
        current_lines = []

    for line in lines:
        if not line or _PAGE_NUMBER_RE.match(line):
            continue
        heading = _normalise_heading(line)
        if heading:
            remainder = heading[1]
            # Ignore TOC-ish lines such as "Item 7. MD&A ....... 32".
            if _TOC_HINT_RE.search(line) or (remainder and re.search(r"\d{1,3}$", remainder) and len(line) < 80):
                continue
            flush()
            current = heading[0]
            if remainder and len(remainder) > 3:
                current_lines.append(remainder)
            continue
        if current:
            current_lines.append(line)

    flush()

    sections: dict[str, str] = {}
    for key, bodies in candidates.items():
        body = max(bodies, key=len).strip()
        if len(body) < 400:
            continue
        sections[key] = body[:MAX_SECTION_CHARS]
    return sections


def extract_press_release(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.find("title")
    if title and "press release" in title.get_text().lower():
        return clean_html(html)
    return None
