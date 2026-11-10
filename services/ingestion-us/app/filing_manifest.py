from __future__ import annotations

from typing import Any


def build_manifest(
    existing: list[dict[str, Any]], records: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    keyed = {
        (record["accession_number"], record["ticker"]): record
        for record in existing
    }
    for record in records:
        keyed[(record["accession_number"], record["ticker"])] = record

    manifest = []
    for record in keyed.values():
        sections = record.get("sections", {})
        if isinstance(sections, dict):
            section_names = sections.keys()
        elif isinstance(sections, list) and all(
            isinstance(section, str) for section in sections
        ):
            section_names = sections
        else:
            raise ValueError(
                "Filing manifest sections must be an object or a list of names "
                f"for {record.get('ticker')} {record.get('accession_number')}"
            )
        manifest.append(
            {
                "ticker": record["ticker"],
                "filing_type": record["filing_type"],
                "filing_date": record["filing_date"],
                "accession_number": record["accession_number"],
                "sections": sorted(section_names),
            }
        )

    return sorted(
        manifest,
        key=lambda record: (record["ticker"], record["filing_date"]),
        reverse=True,
    )
