"""PySpark RDD pipeline for SEC filing anomaly features.

The pipeline is intentionally written with explicit RDD transformations and
actions (the requirement for the mid-term demo):

    parallelize -> map -> filter -> flatMap -> mapPartitions -> reduceByKey
    -> aggregateByKey -> combineByKey -> groupByKey -> join -> sortBy
    -> takeOrdered -> count -> collect

The final stage intentionally repeats the classroom RDD/DataFrame commands
(``textFile``, ``first``, ``take``, ``toDebugString``, ``read.csv``,
``explain``, ``createOrReplaceTempView``, ``spark.sql``) on the section output
so the professor can see the taught methods inside the real project.

It reads the local JSON snapshot produced by ``scripts/fetch_sec_filings.py``
and writes curated JSON + Parquet artifacts consumed by the API gateway and
the Next.js dashboard.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from pyspark import StorageLevel
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    IntegerType,
    StringType,
    StructField,
    StructType,
)

from .session import build_session
from .teacher_demo import run_teacher_checks


def _project_root() -> Path:
    """Repo root locally, service root inside a container (/app)."""
    parents = Path(__file__).resolve().parents
    return parents[4] if len(parents) > 4 else parents[2]


REPO_ROOT = _project_root()
DEFAULT_DATA_DIR = REPO_ROOT / "data"
MAX_SENTENCES_PER_SECTION = 2500
CHUNK_WORDS = 140
CHUNK_OVERLAP_SENTENCES = 2

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\"'])" )
TOKEN_RE = re.compile(r"[a-z][a-z'\-]{2,}")

STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
    "had", "her", "was", "one", "our", "out", "day", "get", "has", "him",
    "his", "how", "man", "new", "now", "old", "see", "two", "way", "who",
    "boy", "did", "its", "let", "put", "say", "she", "too", "use", "that",
    "with", "have", "this", "will", "your", "from", "they", "know", "want",
    "been", "good", "much", "some", "time", "very", "when", "come", "here",
    "just", "like", "long", "make", "many", "more", "only", "over", "such",
    "take", "than", "them", "well", "were", "what", "work", "year", "back",
    "call", "came", "each", "even", "find", "give", "most", "must", "name",
    "need", "next", "open", "part", "said", "same", "seem", "show", "side",
    "tell", "turn", "used", "want", "ways", "week", "went", "while", "with",
    "would", "about", "after", "again", "against", "because", "before",
    "being", "below", "between", "both", "could", "during", "every", "first",
    "found", "great", "group", "house", "large", "last", "later", "least",
    "might", "never", "number", "other", "place", "point", "right", "small",
    "still", "their", "there", "these", "thing", "think", "those", "three",
    "under", "until", "where", "which", "while", "world", "years", "young",
    "also", "among", "become", "came", "does", "going", "keep", "made",
    "many", "much", "once", "onto", "ours", "over", "per", "put", "rather",
    "since", "than", "through", "toward", "upon", "using", "whether",
    "company", "companies", "fiscal", "annual", "quarter", "quarterly",
    "report", "reports", "filed", "filing", "form", "item", "items", "part",
    "page", "table", "contents", "included", "including", "include",
    "in accordance", "accordance", "respect", "regarding", "related",
    "approximately", "certain", "including", "may", "could", "would", "should",
    "will", "shall", "also", "however", "therefore", "thereof", "therein",
    "herein", "hereof", "under", "within", "without", "upon", "among",
    "statements", "financial", "statements", "operations", "results",
    "period", "end", "ended", "date", "dates", "amount", "amounts",
    "total", "net", "million", "billion", "thousand", "percent", "per",
    "share", "shares", "common", "stock", "value", "values", "2022", "2023",
    "2024", "2025", "2026", "united", "states", "u.s.", "us", "sec",
    "securities", "exchange", "commission", "registrant", "registrants",
}

STOPWORDS_BROADCAST_NAME = "anomaly_stopwords"

LOGGER = logging.getLogger(__name__)


def _json_default(value: Any) -> Any:
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if isinstance(value, set):
        return sorted(value)
    return str(value)


def write_json(path: Path, payload: Any) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, default=_json_default), encoding="utf-8")
    os.replace(tmp, path)
    return {"path": str(path), "bytes": path.stat().st_size}


def stable_id(*parts: str) -> str:
    return hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()


def tokenize(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOPWORDS]


def split_sentences(text: str) -> list[str]:
    sentences = [s.strip() for s in SENTENCE_SPLIT.split(text) if s.strip()]
    return [s for s in sentences if 30 <= len(s) <= 1400 and any(c.isalpha() for c in s)]


def section_key(filing_key: str, section_type: str) -> str:
    return f"{filing_key}#{section_type}"


def _fallback_sections(clean_text: str) -> dict[str, str]:
    """Create pseudo-sections when a filing's item headings cannot be parsed."""
    text = (clean_text or "").strip()
    if not text:
        return {}
    sections: dict[str, str] = {}
    window = 45_000
    for index in range(0, min(len(text), window * 6), window):
        chunk = text[index : index + window].strip()
        if len(chunk) > 500:
            sections[f"body_{index // window + 1}"] = chunk
    return sections


def normalise_filing(record: dict[str, Any]) -> dict[str, Any] | None:
    ticker = str(record.get("ticker", "")).upper().strip()
    accession = str(record.get("accession_number", "")).strip()
    if not ticker or not accession:
        return None
    filing_key = f"{ticker}:{accession}"
    sections = {
        str(name): str(text).strip()
        for name, text in (record.get("sections") or {}).items()
        if isinstance(text, str) and len(text) > 350
    }
    if not sections:
        sections = _fallback_sections(record.get("clean_text", ""))
    if not sections:
        return None

    return {
        "filing_key": filing_key,
        "filing_id": stable_id("filing", ticker, accession),
        "company_id": stable_id("company", ticker),
        "ticker": ticker,
        "company_name": record.get("company_name") or ticker,
        "cik": record.get("cik"),
        "filing_type": record.get("filing_type") or "10-K",
        "filing_date": record.get("filing_date") or "",
        "period_of_report": record.get("period_of_report"),
        "accession_number": accession,
        "source_url": record.get("source_url"),
        "sections": sections,
        "section_count": len(sections),
        "raw_chars": sum(len(v) for v in sections.values()),
    }


def emit_sentences(record: dict[str, Any]) -> list[dict[str, Any]]:
    """mapPartitions worker: split one section into sentence rows."""
    sentences = split_sentences(record["text"])[:MAX_SENTENCES_PER_SECTION]
    rows: list[dict[str, Any]] = []
    for index, sentence in enumerate(sentences):
        rows.append(
            {
                "filing_key": record["filing_key"],
                "filing_id": record["filing_id"],
                "company_id": record["company_id"],
                "ticker": record["ticker"],
                "company_name": record["company_name"],
                "filing_type": record["filing_type"],
                "filing_date": record["filing_date"],
                "period_of_report": record["period_of_report"],
                "section_type": record["section_type"],
                "sentence_index": index,
                "text": sentence,
                "token_count": len(tokenize(sentence)),
            }
        )
    return rows


def build_chunks(record: dict[str, Any]) -> list[dict[str, Any]]:
    """mapPartitions worker: pack sentences into overlapping chunks."""
    sentences = split_sentences(record["text"])[:MAX_SENTENCES_PER_SECTION]
    chunks: list[dict[str, Any]] = []
    current: list[str] = []
    current_words = 0

    def flush() -> None:
        nonlocal current, current_words
        if not current:
            return
        text = " ".join(current).strip()
        if len(text) > 80:
            index = len(chunks)
            chunks.append(
                {
                    "chunk_id": stable_id("chunk", record["filing_key"], record["section_type"], str(index)),
                    "filing_id": record["filing_id"],
                    "company_id": record["company_id"],
                    "ticker": record["ticker"],
                    "filing_type": record["filing_type"],
                    "filing_date": record["filing_date"],
                    "section_type": record["section_type"],
                    "chunk_index": index,
                    "text": text,
                    "token_count": len(text.split()),
                }
            )
        current = current[-CHUNK_OVERLAP_SENTENCES:] if CHUNK_OVERLAP_SENTENCES else []
        current_words = sum(len(s.split()) for s in current)

    for sentence in sentences:
        words = len(sentence.split())
        if current_words + words > CHUNK_WORDS and current:
            flush()
        current.append(sentence)
        current_words += words
    flush()
    return chunks


def merge_counts(left: dict[str, int], right: dict[str, int]) -> dict[str, int]:
    merged = dict(left)
    for key, value in right.items():
        merged[key] = merged.get(key, 0) + value
    return merged


def entropy(counts: dict[str, int]) -> float:
    total = sum(counts.values())
    if total <= 0:
        return 0.0
    value = 0.0
    for count in counts.values():
        p = count / total
        value -= p * math.log2(p)
    return value


def normalised_entropy(counts: dict[str, int]) -> float:
    unique = max(1, len(counts))
    return round(entropy(counts) / math.log2(unique + 1), 6)


def cosine_distance(left: dict[str, int], right: dict[str, int]) -> float:
    if not left or not right:
        return 0.0
    shared = set(left) | set(right)
    dot = sum(left.get(t, 0) * right.get(t, 0) for t in shared)
    norm_left = math.sqrt(sum(v * v for v in left.values()))
    norm_right = math.sqrt(sum(v * v for v in right.values()))
    if norm_left == 0 or norm_right == 0:
        return 0.0
    return round(max(0.0, min(2.0, 1.0 - dot / (norm_left * norm_right))), 6)


def js_divergence(left: dict[str, int], right: dict[str, int]) -> float:
    if not left or not right:
        return 0.0

    def distribution(counts: dict[str, int]) -> dict[str, float]:
        total = sum(counts.values()) or 1
        return {term: count / total for term, count in counts.items()}

    p, q = distribution(left), distribution(right)
    terms = set(p) | set(q)
    divergence = 0.0
    for term in terms:
        pv, qv = p.get(term, 0.0), q.get(term, 0.0)
        mid = (pv + qv) / 2
        if pv:
            divergence += 0.5 * pv * math.log2(pv / mid)
        if qv:
            divergence += 0.5 * qv * math.log2(qv / mid)
    return round(max(0.0, divergence), 6)


def top_terms(counts: dict[str, int], limit: int = 8) -> list[list[Any]]:
    return [[term, count] for term, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


@dataclass
class StageRecorder:
    stages: list[dict[str, Any]] = field(default_factory=list)

    @contextmanager
    def record(self, name: str, operations: list[str], input_rows: int | None = None):
        stage: dict[str, Any] = {
            "name": name,
            "operations": operations,
            "input_rows": input_rows,
            "output_rows": None,
            "duration_ms": 0.0,
        }
        started = time.perf_counter()
        LOGGER.info("stage start: %s", name)
        try:
            yield stage
        finally:
            stage["duration_ms"] = round((time.perf_counter() - started) * 1000, 1)
            self.stages.append(stage)
            LOGGER.info(
                "stage done: %s rows=%s duration_ms=%s",
                name,
                stage["output_rows"],
                stage["duration_ms"],
            )


def load_raw_filings(raw_dir: Path, tickers: Iterable[str] | None = None) -> list[dict[str, Any]]:
    wanted = {ticker.upper() for ticker in tickers} if tickers else None
    records: list[dict[str, Any]] = []
    for path in sorted(raw_dir.glob("*/*.json")):
        if path.name == "manifest.json":
            continue
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if wanted and str(record.get("ticker", "")).upper() not in wanted:
            continue
        records.append(record)
    return records


def run_pipeline(
    *,
    tickers: list[str] | None = None,
    raw_dir: Path | None = None,
    data_dir: Path | None = None,
    spark: SparkSession | None = None,
) -> dict[str, Any]:
    """Execute the full RDD pipeline and persist curated artifacts."""
    data_dir = Path(data_dir or os.getenv("ANOMALY_DATA_DIR", DEFAULT_DATA_DIR))
    raw_dir = Path(raw_dir or os.getenv("ANOMALY_RAW_DIR", data_dir / "raw" / "filings"))
    curated_dir = data_dir / "curated" / "latest"
    runs_dir = data_dir / "curated" / "runs"
    curated_dir.mkdir(parents=True, exist_ok=True)
    runs_dir.mkdir(parents=True, exist_ok=True)

    records = load_raw_filings(raw_dir, tickers)
    if not records:
        raise RuntimeError(
            f"No raw SEC filings found in {raw_dir}. Run scripts/fetch_sec_filings.py first."
        )

    spark = spark or build_session()
    sc = spark.sparkContext
    sc.setLogLevel("WARN")

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    started_at = datetime.now(timezone.utc).isoformat()
    started = time.perf_counter()
    recorder = StageRecorder()

    token_accumulator = sc.accumulator(0)
    sentence_accumulator = sc.accumulator(0)
    stopwords = sc.broadcast(sorted(STOPWORDS))

    # ---------------------------------------------------------------- ingest
    with recorder.record("load + normalise", ["parallelize", "map", "filter", "cache"], len(records)) as stage:
        raw_rdd = sc.parallelize(records, max(2, min(len(records), 8)))
        filings_rdd = (
            raw_rdd.map(normalise_filing)
            .filter(lambda row: row is not None)
            .persist(StorageLevel.MEMORY_AND_DISK)
        )
        filing_count = filings_rdd.count()
        stage["output_rows"] = filing_count

    if filing_count == 0:
        raise RuntimeError("No usable filings after normalisation.")

    filings = filings_rdd.collect()
    filing_meta = {
        row["filing_key"]: {
            "ticker": row["ticker"],
            "company_name": row["company_name"],
            "filing_type": row["filing_type"],
            "filing_date": row["filing_date"],
            "period_of_report": row["period_of_report"],
            "filing_id": row["filing_id"],
            "company_id": row["company_id"],
        }
        for row in filings
    }

    # -------------------------------------------------------------- sections
    with recorder.record("section extraction", ["flatMap", "filter"], filing_count) as stage:
        section_rdd = (
            filings_rdd.flatMap(
                lambda row: [
                    {
                        "filing_key": row["filing_key"],
                        "filing_id": row["filing_id"],
                        "company_id": row["company_id"],
                        "ticker": row["ticker"],
                        "company_name": row["company_name"],
                        "filing_type": row["filing_type"],
                        "filing_date": row["filing_date"],
                        "period_of_report": row["period_of_report"],
                        "section_type": section_type,
                        "text": text,
                    }
                    for section_type, text in row["sections"].items()
                ]
            )
            .filter(lambda row: len(row["text"]) > 400)
            .persist(StorageLevel.MEMORY_AND_DISK)
        )
        section_count = section_rdd.count()
        stage["output_rows"] = section_count

    # ------------------------------------------------------------- sentences
    with recorder.record(
        "sentence tokenisation", ["mapPartitions", "filter", "count"], section_count
    ) as stage:
        sentence_rdd = (
            section_rdd.mapPartitions(
                lambda partition: (
                    row
                    for section in partition
                    for row in emit_sentences(section)
                )
            )
            .filter(lambda row: row["token_count"] > 3)
            .persist(StorageLevel.MEMORY_AND_DISK)
        )
        sentence_count = sentence_rdd.count()
        stage["output_rows"] = sentence_count

    # Accumulators are updated inside a mapPartitions worker.  They are used as
    # a demonstration of Spark shared counters and for the run summary.
    def count_tokens(partition: Iterable[dict[str, Any]]):
        for row in partition:
            sentence_accumulator.add(1)
            token_accumulator.add(row["token_count"])
            yield row

    sentence_rdd = sentence_rdd.mapPartitions(count_tokens).persist(StorageLevel.MEMORY_AND_DISK)
    sentence_rdd.count()

    # ------------------------------------------------------------ term counts
    with recorder.record(
        "global term frequency", ["flatMap", "map", "filter", "reduceByKey", "takeOrdered"], sentence_count
    ) as stage:
        token_pairs = (
            sentence_rdd.flatMap(lambda row: [(token, 1) for token in tokenize(row["text"])])
            .filter(lambda pair: pair[0] not in stopwords.value)
            .reduceByKey(lambda a, b: a + b)
        )
        total_tokens = token_pairs.values().sum()
        top_term_pairs = token_pairs.takeOrdered(50, key=lambda pair: -pair[1])
        stage["output_rows"] = len(top_term_pairs)

    top_terms_payload = [
        {
            "term": term,
            "count": count,
            "share": round(count / total_tokens, 6) if total_tokens else 0,
        }
        for term, count in top_term_pairs
    ]

    # Document frequency with combineByKey (explicit create/merge/combine).
    with recorder.record(
        "token document frequency", ["combineByKey", "count"], sentence_count
    ) as stage:
        def create_doc_frequency(token: str) -> int:
            return 1

        def merge_doc_frequency(acc: int, value: int) -> int:
            return acc + value

        def combine_doc_frequencies(left: int, right: int) -> int:
            return left + right

        term_document_frequency = (
            sentence_rdd.flatMap(lambda row: [(token, 1) for token in set(tokenize(row["text"]))])
            .combineByKey(create_doc_frequency, merge_doc_frequency, combine_doc_frequencies)
        )
        vocabulary_size = term_document_frequency.count()
        stage["output_rows"] = vocabulary_size

    # ----------------------------------------------------------- section stats
    with recorder.record(
        "section statistics",
        ["map", "reduceByKey", "aggregateByKey", "mapValues", "join", "collect"],
        sentence_count,
    ) as stage:
        section_token_counts = (
            sentence_rdd.flatMap(
                lambda row: [
                    (
                        (row["filing_key"], row["section_type"], token),
                        count,
                    )
                    for token, count in _term_counts(row["text"]).items()
                ]
            )
            .reduceByKey(lambda a, b: a + b)
            .persist(StorageLevel.MEMORY_AND_DISK)
        )

        section_totals = (
            sentence_rdd.map(
                lambda row: (
                    (row["filing_key"], row["section_type"]),
                    (row["token_count"], 1, len(row["text"])),
                )
            ).reduceByKey(lambda a, b: (a[0] + b[0], a[1] + b[1], a[2] + b[2]))
        )

        section_top_terms = (
            section_token_counts.map(
                lambda kv: (kv[0][:2], (kv[1], kv[0][2]))
            ).aggregateByKey(
                [],
                lambda acc, value: acc + [value],
                lambda left, right: left + right,
            ).mapValues(lambda values: sorted(values, key=lambda item: (-item[0], item[1]))[:40])
        )

        section_stats = (
            section_totals.join(section_top_terms)
            .map(
                lambda kv: {
                    "filing_key": kv[0][0],
                    "filing_id": filing_meta.get(kv[0][0], {}).get("filing_id"),
                    "ticker": filing_meta.get(kv[0][0], {}).get("ticker"),
                    "filing_type": filing_meta.get(kv[0][0], {}).get("filing_type"),
                    "filing_date": filing_meta.get(kv[0][0], {}).get("filing_date"),
                    "section_type": kv[0][1],
                    "tokens": kv[1][0][0],
                    "sentences": kv[1][0][1],
                    "characters": kv[1][0][2],
                    "unique_terms": len(kv[1][1]),
                    "entropy": round(entropy({token: count for count, token in kv[1][1]}), 6),
                    "normalised_entropy": normalised_entropy(
                        {token: count for count, token in kv[1][1]}
                    ),
                    "top_terms": top_terms({token: count for count, token in kv[1][1]}, 6),
                }
            )
            .sortBy(lambda row: (row["ticker"] or "", row["filing_date"] or "", row["section_type"] or ""))
            .collect()
        )
        stage["output_rows"] = len(section_stats)

    section_vectors = (
        section_token_counts.map(lambda kv: ((kv[0][0], kv[0][1]), {kv[0][2]: kv[1]}))
        .reduceByKey(lambda left, right: merge_counts(left, right))
        .persist(StorageLevel.MEMORY_AND_DISK)
    )

    # -------------------------------------------------------- temporal shift
    with recorder.record(
        "temporal shift", ["groupByKey", "map", "sortBy", "flatMap", "filter"], section_count
    ) as stage:
        temporal_features = (
            section_vectors.map(
                lambda kv: (
                    (filing_meta.get(kv[0][0], {}).get("ticker"), kv[0][1]),
                    (
                        kv[0][0],
                        filing_meta.get(kv[0][0], {}).get("filing_date"),
                        kv[1],
                    ),
                )
            )
            .groupByKey()
            .flatMap(lambda kv: _temporal_features(kv[0][0], kv[0][1], list(kv[1]), filing_meta))
            .filter(lambda row: row is not None)
            .persist(StorageLevel.MEMORY_AND_DISK)
        )
        temporal_count = temporal_features.count()
        stage["output_rows"] = temporal_count

    # ------------------------------------------------------- cross-section
    with recorder.record(
        "cross-section divergence", ["groupByKey", "flatMap", "filter"], section_count
    ) as stage:
        cross_features = (
            section_vectors.map(lambda kv: (kv[0][0], (kv[0][1], kv[1])))
            .groupByKey()
            .flatMap(lambda kv: _cross_section_features(kv[0], list(kv[1]), filing_meta))
            .filter(lambda row: row is not None)
            .persist(StorageLevel.MEMORY_AND_DISK)
        )
        stage["output_rows"] = cross_features.count()

    # ------------------------------------------------------------ anomalies
    with recorder.record(
        "anomaly signals", ["union", "map", "filter", "takeOrdered"], None
    ) as stage:
        signals_rdd = (
            temporal_features.map(_to_signal).union(cross_features.map(_to_signal))
        ).filter(lambda row: row is not None and row["score"] >= 0.01)
        top_signals = signals_rdd.takeOrdered(30, key=lambda row: -row["score"])
        stage["output_rows"] = len(top_signals)

    anomalies_payload = []
    for index, signal in enumerate(top_signals):
        signal = dict(signal)
        signal["id"] = stable_id(
            "anomaly",
            signal["signal_type"],
            signal.get("ticker") or "",
            signal.get("section_a") or "",
            signal.get("filing_b_date") or signal.get("filing_date") or "",
        )
        signal["detected_at"] = signal.get("filing_b_date") or signal.get("filing_date") or started_at
        signal["rank"] = index + 1
        anomalies_payload.append(signal)

    # --------------------------------------------------------------- chunks
    chunk_schema = StructType(
        [
            StructField("chunk_id", StringType(), False),
            StructField("filing_id", StringType(), False),
            StructField("company_id", StringType(), False),
            StructField("ticker", StringType(), False),
            StructField("filing_type", StringType(), False),
            StructField("filing_date", StringType(), True),
            StructField("section_type", StringType(), False),
            StructField("chunk_index", IntegerType(), False),
            StructField("text", StringType(), False),
            StructField("token_count", IntegerType(), False),
        ]
    )

    with recorder.record(
        "chunk generation", ["mapPartitions", "collect", "createDataFrame", "write.parquet"], section_count
    ) as stage:
        chunk_rdd = section_rdd.mapPartitions(
            lambda partition: (
                chunk for section in partition for chunk in build_chunks(section)
            )
        )
        # One action, then reuse the materialised rows for both the JSON and the
        # Parquet artifact.  Calling count() + createDataFrame(rdd) + collect()
        # recomputed this stage three times and doubled driver memory.
        chunk_rows = chunk_rdd.collect()
        chunk_count = len(chunk_rows)
        stage["output_rows"] = chunk_count

        chunk_df = spark.createDataFrame(chunk_rows, schema=chunk_schema)
        parquet_path = curated_dir / "chunks.parquet"
        chunk_df.write.mode("overwrite").parquet(str(parquet_path))

    # -------------------------------------------------------------- benchmark
    with recorder.record(
        "RDD vs DataFrame benchmark",
        ["flatMap", "map", "reduceByKey", "count", "spark.read.parquet", "groupBy", "count"],
        chunk_count,
    ) as stage:
        benchmark = _run_benchmark(spark, chunk_rdd, parquet_path)
        stage["output_rows"] = benchmark["dataframe_terms"]

    # ------------------------------------------- teacher-style API checkpoints
    # This is the section the professor can compare line-for-line with the
    # class notes.  It runs the same commands on the project's real section
    # data and records the RDD/DataFrame results for the dashboard.  It is the
    # final Spark stage so the dashboard timeline reads like the classroom
    # notebook: ingest, analyse, then the taught RDD/DataFrame checks.
    with recorder.record(
        "teacher-style RDD + DataFrame checks",
        [
            "textFile",
            "first",
            "filter",
            "map",
            "reduceByKey",
            "count",
            "collect",
            "take",
            "toDebugString",
            "cache",
            "read.csv",
            "groupBy",
            "agg",
            "orderBy",
            "explain",
            "show",
            "sql",
            "toDF",
        ],
        len(section_stats),
    ) as stage:
        teacher_checks = run_teacher_checks(spark, section_stats, curated_dir)
        stage["output_rows"] = teacher_checks["rdd"]["low_detail_sections"]

    # --------------------------------------------------------------- writers
    companies = {}
    for row in filings:
        companies[row["ticker"]] = {
            "id": row["company_id"],
            "ticker": row["ticker"],
            "name": row["company_name"],
            "cik": row["cik"],
            "jurisdiction": "US",
            "sector": _sector_for(row["ticker"]),
            "created_at": started_at,
        }

    filings_payload = []
    for row in sorted(filings, key=lambda r: (r["ticker"], r["filing_date"]), reverse=True):
        sections = {
            section: text[:30_000]
            for section, text in row["sections"].items()
        }
        filings_payload.append(
            {
                "id": row["filing_id"],
                "company_id": row["company_id"],
                "ticker": row["ticker"],
                "filing_type": row["filing_type"],
                "filing_date": row["filing_date"],
                "accession_number": row["accession_number"],
                "period_of_report": row["period_of_report"],
                "source_url": row["source_url"],
                "sections": sections,
                "metadata": {
                    "section_count": row["section_count"],
                    "raw_chars": row["raw_chars"],
                },
                "ingested_at": started_at,
            }
        )

    artifacts: list[dict[str, Any]] = []

    def persist(name: str, payload: Any) -> None:
        info = write_json(curated_dir / name, payload)
        artifacts.append({"name": name, "format": "json", **info, "rows": _row_count(payload)})

    persist("companies.json", sorted(companies.values(), key=lambda c: c["ticker"]))
    persist("filings.json", filings_payload)
    persist(
        "chunks.json",
        [
            {
                "id": row["chunk_id"],
                "chunk_id": row["chunk_id"],
                "filing_id": row["filing_id"],
                "company_id": row["company_id"],
                "ticker": row["ticker"],
                "section_type": row["section_type"],
                "chunk_index": row["chunk_index"],
                "text": row["text"],
                "token_count": row["token_count"],
                "created_at": started_at,
            }
            for row in chunk_rows
        ],
    )
    persist("anomalies.json", anomalies_payload)
    persist("top_terms.json", top_terms_payload)
    persist("section_stats.json", section_stats)
    persist("teacher_checks.json", teacher_checks)
    persist(
        "features.json",
        {
            "temporal": sorted(
                [row for row in temporal_features.collect() if row],
                key=lambda row: -row["score"],
            )[:100],
            "cross_section": sorted(
                [row for row in cross_features.collect() if row],
                key=lambda row: -row["score"],
            )[:100],
        },
    )

    duration = round(time.perf_counter() - started, 2)
    summary = {
        "run_id": run_id,
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": duration,
        "spark_version": spark.version,
        "master": sc.master,
        "engine": "PySpark RDD",
        "input": {
            "raw_files": len(records),
            "filings": filing_count,
            "tickers": sorted({row["ticker"] for row in filings}),
            "sections": section_count,
            "sentences": sentence_count,
            "tokens": int(token_accumulator.value),
            "chunks": chunk_count,
        },
        "counts": {
            "filings": filing_count,
            "sections": section_count,
            "sentences": sentence_count,
            "chunks": chunk_count,
            "anomalies": len(anomalies_payload),
            "temporal_features": temporal_count,
            "cross_section_features": cross_features.count(),
            "vocabulary": vocabulary_size,
        },
        "accumulators": {
            "sentences_seen": int(sentence_accumulator.value),
            "tokens_seen": int(token_accumulator.value),
        },
        "stages": recorder.stages,
        "top_terms": top_terms_payload[:30],
        "section_stats": section_stats,
        "anomalies": anomalies_payload,
        "benchmark": benchmark,
        "teacher_checks": teacher_checks,
        "artifacts": artifacts,
    }

    # `input.tokens` uses the accumulator; `counts.vocabulary` uses combineByKey.
    write_json(curated_dir / "run_summary.json", summary)
    write_json(runs_dir / f"{run_id}.json", summary)

    filings_rdd.unpersist()
    section_rdd.unpersist()
    sentence_rdd.unpersist()
    try:
        chunk_rdd.unpersist()
    except Exception:
        pass
    section_vectors.unpersist()
    temporal_features.unpersist()
    cross_features.unpersist()

    return summary


def _row_count(payload: Any) -> int:
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict):
        return sum(len(v) if isinstance(v, list) else 1 for v in payload.values())
    return 1


def _term_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for token in tokenize(text):
        counts[token] = counts.get(token, 0) + 1
    return counts


def _temporal_features(
    ticker: str | None,
    section_type: str,
    rows: list[tuple[str, str | None, dict[str, int]]],
    filing_meta: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    ordered = sorted(rows, key=lambda item: item[1] or "")
    features: list[dict[str, Any]] = []
    for previous, current in zip(ordered, ordered[1:]):
        prev_key, prev_date, prev_counts = previous
        cur_key, cur_date, cur_counts = current
        if not prev_date or not cur_date or prev_date == cur_date:
            continue
        distance = cosine_distance(prev_counts, cur_counts)
        divergence = js_divergence(prev_counts, cur_counts)
        score = round(min(1.0, 0.55 * min(distance, 1.0) + 0.45 * min(divergence * 2.5, 1.0)), 6)
        added = sorted(
            (
                (term, count - prev_counts.get(term, 0))
                for term, count in cur_counts.items()
                if count - prev_counts.get(term, 0) > 0
            ),
            key=lambda item: -item[1],
        )[:6]
        removed = sorted(
            (
                (term, prev_counts.get(term, 0) - count)
                for term, count in cur_counts.items()
                if prev_counts.get(term, 0) - count > 0
            ),
            key=lambda item: -item[1],
        )[:6]
        features.append(
            {
                "feature_type": "temporal_shift",
                "ticker": ticker,
                "section_type": section_type,
                "filing_a": prev_key,
                "filing_a_id": filing_meta.get(prev_key, {}).get("filing_id"),
                "filing_a_date": prev_date,
                "filing_b": cur_key,
                "filing_b_id": filing_meta.get(cur_key, {}).get("filing_id"),
                "filing_b_date": cur_date,
                "section_a": section_type,
                "section_b": section_type,
                "cosine_distance": distance,
                "js_divergence": divergence,
                "entropy_a": round(entropy(prev_counts), 6),
                "entropy_b": round(entropy(cur_counts), 6),
                "entropy_delta": round(entropy(cur_counts) - entropy(prev_counts), 6),
                "terms_added": [[term, value] for term, value in added],
                "terms_removed": [[term, value] for term, value in removed],
                "score": score,
            }
        )
    return features


def _cross_section_features(
    filing_key: str,
    rows: list[tuple[str, dict[str, int]]],
    filing_meta: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    by_section = {section: counts for section, counts in rows}
    priority = ["item_1a", "item_7", "item_7a", "item_8"]
    available = [section for section in priority if section in by_section]
    if len(available) < 2:
        available = list(by_section)[:2]
    if len(available) < 2:
        return []
    meta = filing_meta.get(filing_key, {})
    features: list[dict[str, Any]] = []
    for index, left in enumerate(available):
        for right in available[index + 1 :]:
            left_counts, right_counts = by_section[left], by_section[right]
            distance = cosine_distance(left_counts, right_counts)
            divergence = js_divergence(left_counts, right_counts)
            score = round(min(1.0, 0.6 * min(distance, 1.0) + 0.4 * min(divergence * 2.5, 1.0)), 6)
            features.append(
                {
                    "feature_type": "cross_section",
                    "ticker": meta.get("ticker"),
                    "filing_type": meta.get("filing_type"),
                    "filing_date": meta.get("filing_date"),
                    "filing_a": filing_key,
                    "filing_a_id": meta.get("filing_id"),
                    "filing_b": filing_key,
                    "filing_b_id": meta.get("filing_id"),
                    "filing_a_date": meta.get("filing_date"),
                    "filing_b_date": meta.get("filing_date"),
                    "section_a": left,
                    "section_b": right,
                    "cosine_distance": distance,
                    "js_divergence": divergence,
                    "entropy_a": round(entropy(left_counts), 6),
                    "entropy_b": round(entropy(right_counts), 6),
                    "entropy_delta": round(entropy(right_counts) - entropy(left_counts), 6),
                    "terms_added": top_terms(right_counts, 5),
                    "terms_removed": top_terms(left_counts, 5),
                    "score": score,
                }
            )
    return features


def _to_signal(feature: dict[str, Any] | None) -> dict[str, Any] | None:
    if not feature:
        return None
    return {
        "ticker": feature.get("ticker"),
        "company_id": stable_id("company", feature.get("ticker") or ""),
        "signal_type": "temporal_shift" if feature["feature_type"] == "temporal_shift" else "cross_section",
        "score": feature["score"],
        "filing_a_id": feature.get("filing_a_id"),
        "filing_b_id": feature.get("filing_b_id"),
        "section_a": feature.get("section_a"),
        "section_b": feature.get("section_b"),
        "filing_date": feature.get("filing_b_date") or feature.get("filing_date"),
        "detected_at": feature.get("filing_b_date") or feature.get("filing_date"),
        "details": {
            "cosine_distance": feature.get("cosine_distance"),
            "js_divergence": feature.get("js_divergence"),
            "entropy_delta": feature.get("entropy_delta"),
            "terms_added": feature.get("terms_added"),
            "terms_removed": feature.get("terms_removed"),
        },
        "severity": "high" if feature["score"] > 0.7 else "medium" if feature["score"] > 0.4 else "low",
    }


def _run_benchmark(spark: SparkSession, chunk_rdd, parquet_path: Path) -> dict[str, Any]:
    """Compare an RDD word-count with the equivalent DataFrame aggregation."""
    # Use a plain local path.  Path.as_uri() percent-encodes spaces and Hadoop's
    # RawLocalFileSystem on Windows then looks for a directory literally named
    # "Anomaly%20Engine".
    parquet_path_value = parquet_path.resolve().as_posix()

    def timed_rdd() -> tuple[int, float]:
        started = time.perf_counter()
        counts = (
            chunk_rdd.flatMap(lambda row: [word.lower() for word in row["text"].split()])
            .filter(lambda word: len(word) > 3 and word.isalpha())
            .map(lambda word: (word, 1))
            .reduceByKey(lambda a, b: a + b)
        )
        size = counts.count()
        return size, round((time.perf_counter() - started) * 1000, 1)

    dataframe = spark.read.parquet(parquet_path_value)

    def timed_dataframe() -> tuple[int, float]:
        started = time.perf_counter()
        words = dataframe.select(
            F.explode(F.split(F.lower(F.col("text")), r"\s+")).alias("word")
        ).filter((F.length("word") > 3) & F.col("word").rlike("^[a-z]+$"))
        size = words.groupBy("word").count().count()
        return size, round((time.perf_counter() - started) * 1000, 1)

    # Warm both paths so the comparison is not dominated by JIT / file open.
    timed_rdd()
    timed_dataframe()
    rdd_terms, rdd_ms = timed_rdd()
    dataframe_terms, dataframe_ms = timed_dataframe()
    fastest = min(rdd_ms, dataframe_ms)
    return {
        "rdd_ms": rdd_ms,
        "dataframe_ms": dataframe_ms,
        "rdd_terms": rdd_terms,
        "dataframe_terms": dataframe_terms,
        "match": rdd_terms == dataframe_terms,
        "speedup_dataframe_vs_rdd": round(rdd_ms / dataframe_ms, 2) if dataframe_ms else None,
        "fastest": "DataFrame" if dataframe_ms < rdd_ms else "RDD",
        "note": "Same Parquet rows; RDD uses reduceByKey, DataFrame uses groupBy().count().",
        "fastest_ms": fastest,
    }


def _sector_for(ticker: str) -> str:
    sectors = {
        "AAPL": "Technology",
        "MSFT": "Technology",
        "NVDA": "Semiconductors",
        "AMZN": "Consumer Discretionary",
        "GOOGL": "Communication Services",
        "META": "Communication Services",
        "TSLA": "Automotive",
        "JPM": "Financials",
    }
    return sectors.get(ticker.upper(), "Unknown")
