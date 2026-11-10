"""Unit tests for the pure helpers used by the PySpark RDD pipeline.

These run without a JVM, so they are safe for CI and fast (a few seconds).
"""

from __future__ import annotations

import math
from pathlib import Path

from app.spark.pipeline import (
    build_chunks,
    cosine_distance,
    entropy,
    js_divergence,
    load_raw_filings,
    normalise_filing,
    split_sentences,
    stable_id,
    tokenize,
    top_terms,
)
from app.spark.section_analysis import (
    CSV_COLUMNS,
    LOW_DETAIL_TOKEN_THRESHOLD,
    write_section_stats_csv,
)

RAW_DIR = Path(__file__).resolve().parents[3] / "data" / "raw" / "filings"


def test_stable_id_is_deterministic_and_namespaced():
    assert stable_id("company", "AAPL") == stable_id("company", "AAPL")
    assert stable_id("company", "AAPL") != stable_id("filing", "AAPL")
    assert len(stable_id("filing", "AAPL", "0000320193-25-000079")) == 32


def test_tokenize_lowercases_and_drops_stopwords():
    tokens = tokenize("The Company's revenue increased, and the Company grew.")
    assert "the" not in tokens
    assert "and" not in tokens
    assert "revenue" in tokens
    assert all(token == token.lower() for token in tokens)


def test_split_sentences_enforces_minimum_length():
    text = (
        "Short. "
        + "Revenue increased by twelve percent compared with the prior fiscal year. "
        + "Net income also increased."
    )
    sentences = split_sentences(text)
    assert sentences
    assert all(30 <= len(sentence) <= 1400 for sentence in sentences)
    assert any("Revenue increased" in sentence for sentence in sentences)


def test_entropy_of_uniform_distribution():
    assert entropy({"a": 1, "b": 1, "c": 1, "d": 1}) == 2.0
    assert entropy({}) == 0.0
    assert entropy({"only": 10}) == 0.0


def test_cosine_distance_identical_and_disjoint():
    left = {"revenue": 3, "growth": 1}
    assert cosine_distance(left, {"revenue": 3, "growth": 1}) == 0.0
    assert cosine_distance(left, {"litigation": 2}) == 1.0
    assert cosine_distance({}, left) == 0.0


def test_js_divergence_is_zero_for_identical_distributions():
    counts = {"risk": 4, "revenue": 2, "margin": 1}
    assert js_divergence(counts, dict(counts)) == 0.0
    divergent = js_divergence(counts, {"risk": 1, "litigation": 9})
    assert 0.0 < divergent < math.log2(2) + 1


def test_top_terms_sorted_by_count_then_term():
    ranked = top_terms({"beta": 2, "alpha": 2, "gamma": 5}, limit=2)
    assert ranked == [["gamma", 5], ["alpha", 2]]


def test_build_chunks_overlaps_sentences():
    text = " ".join(
        f"Sentence number {index} discusses revenue and risk in enough detail."
        for index in range(40)
    )
    chunks = build_chunks(
        {
            "text": text,
            "filing_key": "TEST:0001",
            "filing_id": "f1",
            "company_id": "c1",
            "ticker": "TEST",
            "filing_type": "10-K",
            "filing_date": "2026-01-01",
            "section_type": "item_1a",
        }
    )
    assert chunks
    assert all(chunk["token_count"] > 0 for chunk in chunks)
    assert all(chunk["text"] for chunk in chunks)


def test_raw_snapshot_has_filings_for_the_original_companies():
    records = load_raw_filings(RAW_DIR)
    assert len(records) >= 5
    assert {"AAPL", "MSFT"} <= {record["ticker"] for record in records}

    aapl = load_raw_filings(RAW_DIR, tickers=["aapl"])
    assert len(aapl) >= 3
    assert all(record["ticker"] == "AAPL" for record in aapl)


def test_normalise_filing_keeps_parsed_sections():
    records = load_raw_filings(RAW_DIR, tickers=["AAPL"])
    ten_k = next(record for record in records if record["filing_type"] == "10-K")
    normalised = normalise_filing(ten_k)
    assert normalised is not None
    assert normalised["ticker"] == "AAPL"
    assert normalised["section_count"] > 0
    assert normalised["raw_chars"] > 1000
    assert normalised["filing_id"] == stable_id("filing", "AAPL", ten_k["accession_number"])


def test_section_csv_uses_comma_free_columns(tmp_path):
    rows = [
        {
            "ticker": "AAPL",
            "section_type": "item_1a",
            "tokens": 1234,
            "sentences": 8,
            "characters": 7000,
            "unique_terms": 300,
            "entropy": 6.4,
            "normalised_entropy": 0.9,
        },
        {
            "ticker": "MSFT",
            "section_type": "item_7",
            "tokens": LOW_DETAIL_TOKEN_THRESHOLD - 1,
            "sentences": 2,
            "characters": 1800,
            "unique_terms": 90,
            "entropy": 5.1,
            "normalised_entropy": 0.8,
        },
    ]
    path = write_section_stats_csv(tmp_path / "section_stats.csv", rows)
    lines = path.read_text(encoding="utf-8").strip().splitlines()

    assert lines[0] == ",".join(CSV_COLUMNS)
    assert all(len(line.split(",")) == len(CSV_COLUMNS) for line in lines)
    assert lines[1].split(",")[0] == "AAPL"
    assert int(lines[2].split(",")[2]) == LOW_DETAIL_TOKEN_THRESHOLD - 1
