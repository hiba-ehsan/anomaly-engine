import re
from typing import Any, Optional


_nlp: Optional[Any] = None
_nlp_loaded = False


def _get_nlp():
    global _nlp, _nlp_loaded
    if not _nlp_loaded:
        _nlp_loaded = True
        try:
            import spacy

            _nlp = spacy.load("en_core_web_sm")
        except Exception:
            _nlp = None
    return _nlp


def tokenize_sentences(text: str) -> list[str]:
    nlp = _get_nlp()
    if nlp:
        doc = nlp(text[:100000])
        return [sent.text.strip() for sent in doc.sents if sent.text.strip()]
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
