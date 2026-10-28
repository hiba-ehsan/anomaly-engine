# Anomaly Engine — Phase 2: ingestion-us (SEC EDGAR Client)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully functional SEC EDGAR ingestion service that fetches 10-K, 10-Q, 8-K filings for any US company, parses XBRL, extracts sections, chunks text, and stores everything in Supabase.

**Architecture:** FastAPI service running on port 8001 with async HTTP clients, edgartools for filing access, spaCy for sentence tokenization, and Supabase client for storage.

**Tech Stack:** Python 3.11, FastAPI, edgartools, spaCy, httpx, Supabase Python client

## Global Constraints

- Python 3.11 for all backend services
- Supabase Cloud for PostgreSQL + pgvector — no local DB container
- User-Agent: `AnomalyEngine/1.0 (research@anomalyengine.dev)`
- Rate limiter: 5 req/s (200ms delay between requests)
- Retry with exponential backoff on 429/503

---

## File Structure

```
services/ingestion-us/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── main.py                    # FastAPI routes
    ├── edgar_client.py            # SEC EDGAR API wrapper
    ├── xbrl_parser.py             # XBRL → normalized sections
    ├── chunker.py                 # Sentence tokenization + chunking
    ├── storage.py                 # Supabase client
    └── models.py                  # Pydantic models for ingestion
```

---

### Task 1: Update requirements.txt + models.py

**Files:**
- Modify: `services/ingestion-us/requirements.txt`
- Create: `services/ingestion-us/app/models.py`

**Interfaces:**
- Produces: Pydantic models used by all other modules

- [ ] **Step 1: Update requirements.txt**

```txt
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
supabase>=2.0
edgartools>=3.0
httpx>=0.27.0
spacy>=3.7
python-dotenv>=1.0
```

- [ ] **Step 2: Create models.py**

```python
from pydantic import BaseModel
from datetime import date
from typing import Optional


class CompanyInfo(BaseModel):
    ticker: str
    cik: Optional[str] = None
    name: str
    jurisdiction: str = "US"
    sector: Optional[str] = None


class FilingInfo(BaseModel):
    ticker: str
    filing_type: str
    filing_date: date
    accession_number: str
    period_of_report: Optional[date] = None
    source_url: Optional[str] = None


class FilingChunk(BaseModel):
    filing_id: str
    section_type: str
    chunk_index: int
    text: str
    token_count: int


class IngestRequest(BaseModel):
    ticker: str
    filing_types: list[str] = ["10-K", "10-Q", "8-K"]
    max_filings: int = 10


class IngestStatus(BaseModel):
    job_id: str
    status: str  # "pending", "running", "completed", "failed"
    ticker: str
    filings_found: int = 0
    filings_ingested: int = 0
    error: Optional[str] = None
```

- [ ] **Step 3: Commit**

```bash
git add services/ingestion-us/
git commit -m "feat: add ingestion-us models and requirements"
```

---

### Task 2: Edgar Client + XBRL Parser

**Files:**
- Create: `services/ingestion-us/app/edgar_client.py`
- Create: `services/ingestion-us/app/xbrl_parser.py`

**Interfaces:**
- Consumes: CompanyInfo, FilingInfo from models.py
- Produces: Raw filing HTML, parsed XBRL sections

- [ ] **Step 1: Create edgar_client.py**

```python
import os
import asyncio
import httpx
from typing import Optional
from .models import CompanyInfo, FilingInfo


class EdgarClient:
    BASE_URL = "https://data.sec.gov"
    TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
    USER_AGENT = os.getenv("EDGAR_USER_AGENT", "AnomalyEngine/1.0 (research@anomalyengine.dev)")

    def __init__(self):
        self.ticker_map: dict[str, dict] = {}
        self.client = httpx.AsyncClient(
            headers={"User-Agent": self.USER_AGENT},
            timeout=30.0,
            follow_redirects=True,
        )

    async def close(self):
        await self.client.aclose()

    async def _rate_limit(self):
        await asyncio.sleep(0.2)

    async def _get(self, url: str) -> Optional[dict]:
        try:
            await self._rate_limit()
            resp = await self.client.get(url)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                await asyncio.sleep(5)
                return await self._get(url)
            return None
        except Exception:
            return None

    async def load_ticker_map(self):
        if self.ticker_map:
            return
        data = await self._get(self.TICKERS_URL)
        if data:
            for entry in data.values():
                ticker = entry.get("ticker", "").upper()
                self.ticker_map[ticker] = {
                    "cik": str(entry.get("cik_str", "")).zfill(10),
                    "name": entry.get("title", ""),
                }

    async def resolve_company(self, ticker: str) -> Optional[CompanyInfo]:
        await self.load_ticker_map()
        info = self.ticker_map.get(ticker.upper())
        if not info:
            return None
        return CompanyInfo(
            ticker=ticker.upper(),
            cik=info["cik"],
            name=info["name"],
            jurisdiction="US",
        )

    async def get_filings(
        self, cik: str, filing_types: list[str], max_filings: int = 10
    ) -> list[FilingInfo]:
        url = f"{self.BASE_URL}/submissions/CIK{cik}.json"
        data = await self._get(url)
        if not data:
            return []

        filings = []
        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        primary_docs = recent.get("primaryDocument", [])
        periods = recent.get("periodOfReport", [])

        for i, form in enumerate(forms[:200]):
            if form in filing_types and len(filings) < max_filings:
                accn = accessions[i]
                accn_dash = accn.replace("-", "-")
                filings.append(FilingInfo(
                    ticker=data.get("tickers", [""])[0] if data.get("tickers") else "",
                    filing_type=form,
                    filing_date=dates[i],
                    accession_number=accn,
                    period_of_report=periods[i] if i < len(periods) else None,
                    source_url=f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{accn_dash}/{primary_docs[i]}",
                ))

        return filings

    async def fetch_filing_html(self, url: str) -> Optional[str]:
        try:
            await self._rate_limit()
            resp = await self.client.get(url)
            resp.raise_for_status()
            return resp.text
        except Exception:
            return None
```

- [ ] **Step 2: Create xbrl_parser.py**

```python
import re
from typing import Optional
from bs4 import BeautifulSoup


def clean_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "meta", "link"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_sections(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    sections = {}
    current_section = None
    current_text = []

    section_patterns = {
        "item_1": r"item\s*1[\.\s]*(?:business|1a|risk\s*factors)",
        "item_1a": r"item\s*1a[\.\s]*risk\s*factors",
        "item_1b": r"item\s*1b[\.\s]*",
        "item_2": r"item\s*2[\.\s]*",
        "item_3": r"item\s*3[\.\s]*",
        "item_4": r"item\s*4[\.\s]*",
        "item_5": r"item\s*5[\.\s]*",
        "item_6": r"item\s*6[\.\s]*",
        "item_7": r"item\s*7[\.\s]*(?:md&a|management)",
        "item_7a": r"item\s*7a[\.\s]*",
        "item_8": r"item\s*8[\.\s]*(?:financial|statement)",
        "item_9": r"item\s*9[\.\s]*",
        "item_9a": r"item\s*9a[\.\s]*",
        "item_10": r"item\s*10[\.\s]*",
        "item_11": r"item\s*11[\.\s]*",
        "item_12": r"item\s*12[\.\s]*",
        "item_13": r"item\s*13[\.\s]*",
        "item_14": r"item\s*14[\.\s]*",
        "item_15": r"item\s*15[\.\s]*",
    }

    text = soup.get_text(separator="\n")
    lines = text.split("\n")

    for line in lines:
        line_lower = line.lower().strip()
        for section_key, pattern in section_patterns.items():
            if re.search(pattern, line_lower):
                if current_section and current_text:
                    sections[current_section] = "\n".join(current_text).strip()
                current_section = section_key
                current_text = []
                break
        else:
            if current_section:
                current_text.append(line.strip())

    if current_section and current_text:
        sections[current_section] = "\n".join(current_text).strip()

    return sections


def extract_press_release(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.find("title")
    if title and "press release" in title.get_text().lower():
        return clean_html(html)
    return None
```

- [ ] **Step 3: Commit**

```bash
git add services/ingestion-us/app/edgar_client.py services/ingestion-us/app/xbrl_parser.py
git commit -m "feat: add SEC EDGAR client and XBRL parser"
```

---

### Task 3: Chunker + Storage

**Files:**
- Create: `services/ingestion-us/app/chunker.py`
- Create: `services/ingestion-us/app/storage.py`

**Interfaces:**
- Consumes: Raw text, parsed sections, CompanyInfo, FilingInfo
- Produces: FilingChunk objects, Supabase records

- [ ] **Step 1: Create chunker.py**

```python
import spacy
from typing import Optional

try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    nlp = None


def tokenize_sentences(text: str) -> list[str]:
    if nlp:
        doc = nlp(text[:100000])
        return [sent.text.strip() for sent in doc.sents if sent.text.strip()]
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text)
    return [s.strip() for s in sentences if s.strip()]


def chunk_text(text: str, max_tokens: int = 512, overlap: int = 50) -> list[dict]:
    sentences = tokenize_sentences(text)
    chunks = []
    current_chunk = []
    current_tokens = 0

    for sent in sentences:
        sent_tokens = len(sent.split())
        if current_tokens + sent_tokens > max_tokens and current_chunk:
            chunks.append(" ".join(current_chunk))
            overlap_sentences = current_chunk[-overlap:] if overlap > 0 else []
            current_chunk = overlap_sentences
            current_tokens = sum(len(s.split()) for s in overlap_sentences)
        current_chunk.append(sent)
        current_tokens += sent_tokens

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return [
        {"text": chunk, "token_count": len(chunk.split())}
        for chunk in chunks
    ]


def chunk_sections(sections: dict[str, str]) -> list[dict]:
    all_chunks = []
    for section_type, text in sections.items():
        chunks = chunk_text(text)
        for i, chunk in enumerate(chunks):
            all_chunks.append({
                "section_type": section_type,
                "chunk_index": i,
                "text": chunk["text"],
                "token_count": chunk["token_count"],
            })
    return all_chunks
```

- [ ] **Step 2: Create storage.py**

```python
import os
import json
from supabase import create_client, Client
from .models import CompanyInfo, FilingInfo
from typing import Optional


class Storage:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set")
        self.client: Client = create_client(url, key)

    async def upsert_company(self, company: CompanyInfo) -> str:
        result = (
            self.client.table("companies")
            .upsert({
                "ticker": company.ticker,
                "cik": company.cik,
                "name": company.name,
                "jurisdiction": company.jurisdiction,
                "sector": company.sector,
            }, on_conflict="ticker")
            .execute()
        )
        return result.data[0]["id"]

    async def upsert_filing(self, company_id: str, filing: FilingInfo, sections: dict, clean_text: str) -> str:
        result = (
            self.client.table("filings")
            .upsert({
                "company_id": company_id,
                "filing_type": filing.filing_type,
                "filing_date": filing.filing_date.isoformat(),
                "accession_number": filing.accession_number,
                "period_of_report": filing.period_of_report.isoformat() if filing.period_of_report else None,
                "source_url": filing.source_url,
                "sections": sections,
                "clean_text": clean_text,
            }, on_conflict="company_id,filing_type,filing_date")
            .execute()
        )
        return result.data[0]["id"]

    async def upsert_chunks(self, filing_id: str, chunks: list[dict]) -> list[str]:
        ids = []
        for chunk in chunks:
            result = (
                self.client.table("filing_chunks")
                .upsert({
                    "filing_id": filing_id,
                    "section_type": chunk["section_type"],
                    "chunk_index": chunk["chunk_index"],
                    "text": chunk["text"],
                    "token_count": chunk["token_count"],
                })
                .execute()
            )
            ids.append(result.data[0]["id"])
        return ids

    async def get_company_by_ticker(self, ticker: str) -> Optional[dict]:
        result = (
            self.client.table("companies")
            .select("*")
            .eq("ticker", ticker.upper())
            .execute()
        )
        return result.data[0] if result.data else None

    async def get_filings_by_company(self, company_id: str) -> list[dict]:
        result = (
            self.client.table("filings")
            .select("*")
            .eq("company_id", company_id)
            .order("filing_date", desc=True)
            .execute()
        )
        return result.data
```

- [ ] **Step 3: Commit**

```bash
git add services/ingestion-us/app/chunker.py services/ingestion-us/app/storage.py
git commit -m "feat: add chunker and storage modules"
```

---

### Task 4: Main FastAPI App

**Files:**
- Modify: `services/ingestion-us/app/main.py`

**Interfaces:**
- Consumes: All previous modules
- Produces: Full FastAPI app with working endpoints

- [ ] **Step 1: Replace main.py**

```python
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .models import IngestRequest, IngestStatus
from .edgar_client import EdgarClient
from .xbrl_parser import extract_sections, clean_html
from .chunker import chunk_sections
from .storage import Storage

app = FastAPI(title="Ingestion US (SEC EDGAR)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

edgar = EdgarClient()
storage = Storage()
jobs: dict[str, IngestStatus] = {}


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ingestion-us"}


@app.post("/ingest/company")
async def ingest_company(req: IngestRequest):
    job_id = str(uuid.uuid4())
    status = IngestStatus(job_id=job_id, status="pending", ticker=req.ticker)
    jobs[job_id] = status

    company = await edgar.resolve_company(req.ticker)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company {req.ticker} not found")

    company_id = await storage.upsert_company(company)
    status.status = "running"

    filings = await edgar.get_filings(company.cik, req.filing_types, req.max_filings)
    status.filings_found = len(filings)

    for filing in filings:
        try:
            html = await edgar.fetch_filing_html(filing.source_url)
            if not html:
                continue

            sections = extract_sections(html)
            clean = clean_html(html)
            filing_id = await storage.upsert_filing(company_id, filing, sections, clean)

            all_chunks = chunk_sections(sections)
            await storage.upsert_chunks(filing_id, all_chunks)
            status.filings_ingested += 1
        except Exception as e:
            status.error = str(e)

    status.status = "completed"
    return {"job_id": job_id, "status": status.model_dump()}


@app.get("/ingest/status/{job_id}")
async def ingest_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id].model_dump()


@app.get("/ingest/companies")
async def list_companies():
    return {"companies": []}
```

- [ ] **Step 2: Commit**

```bash
git add services/ingestion-us/app/main.py
git commit -m "feat: add ingestion-us FastAPI routes"
```

---

### Task 5: Test + Verify

- [ ] **Step 1: Build and test locally**

```bash
docker compose build ingestion-us
docker compose run --rm ingestion-us python -c "from app.edgar_client import EdgarClient; print('edgar_client OK')"
docker compose run --rm ingestion-us python -c "from app.chunker import chunk_text; print(chunk_text('Hello world. This is a test.')[:50])"
```

- [ ] **Step 2: Start service**

```bash
docker compose up -d ingestion-us
curl http://localhost:8001/health
```

Expected: `{"status":"healthy","service":"ingestion-us"}`

- [ ] **Step 3: Test full ingest**

```bash
curl -X POST http://localhost:8001/ingest/company \
  -H "Content-Type: application/json" \
  -d '{"ticker": "AAPL", "filing_types": ["10-K"], "max_filings": 2}'
```

Expected: Job status with `filings_ingested: 2`

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: ingestion-us verified working"
```
