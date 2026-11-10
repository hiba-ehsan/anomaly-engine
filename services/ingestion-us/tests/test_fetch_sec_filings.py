from app.filing_manifest import build_manifest


def test_manifest_update_accepts_existing_section_names_and_fetched_sections():
    existing = [
        {
            "ticker": "AAPL",
            "filing_type": "10-K",
            "filing_date": "2025-01-01",
            "accession_number": "old",
            "sections": ["item_1", "item_7"],
        }
    ]
    fetched = [
        {
            "ticker": "AMZN",
            "filing_type": "10-Q",
            "filing_date": "2025-04-01",
            "accession_number": "new",
            "sections": {"item_1": "text", "item_2": "text"},
        }
    ]

    manifest = build_manifest(existing, fetched)

    assert {
        record["accession_number"]: record["sections"] for record in manifest
    } == {
        "old": ["item_1", "item_7"],
        "new": ["item_1", "item_2"],
    }
