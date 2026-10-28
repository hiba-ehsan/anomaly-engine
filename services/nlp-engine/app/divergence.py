import numpy as np
from scipy.stats import entropy as scipy_entropy
from typing import List, Optional


def cosine_distance(vec_a: List[float], vec_b: List[float]) -> float:
    a = np.array(vec_a)
    b = np.array(vec_b)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 1.0
    return 1.0 - (dot / (norm_a * norm_b))


def kl_divergence(p: List[float], q: List[float]) -> float:
    p = np.array(p) + 1e-10
    q = np.array(q) + 1e-10
    p = p / p.sum()
    q = q / q.sum()
    return float(np.sum(p * np.log(p / q)))


def sentence_entropy(sentiment_scores: dict) -> float:
    probs = np.array([
        sentiment_scores["positive"],
        sentiment_scores["negative"],
        sentiment_scores["neutral"],
    ])
    probs = probs + 1e-10
    probs = probs / probs.sum()
    return float(scipy_entropy(probs))


def compute_cross_section_discrepancy(
    press_embedding: List[float],
    risk_embedding: List[float],
) -> dict:
    distance = cosine_distance(press_embedding, risk_embedding)
    return {
        "cosine_distance": distance,
        "signal_type": "cross_section",
    }


def compute_temporal_shift(
    current_embedding: List[float],
    previous_embedding: List[float],
) -> dict:
    distance = cosine_distance(current_embedding, previous_embedding)
    return {
        "cosine_distance": distance,
        "signal_type": "temporal_shift",
    }


def compute_attention_divergence(
    attention_a: List[List[List[float]]],
    attention_b: List[List[List[float]]],
) -> dict:
    a_flat = []
    b_flat = []

    for layer_a, layer_b in zip(attention_a, attention_b):
        for head_a, head_b in zip(layer_a, layer_b):
            a_flat.extend(np.array(head_a).flatten())
            b_flat.extend(np.array(head_b).flatten())

    a_flat = np.array(a_flat) + 1e-10
    b_flat = np.array(b_flat) + 1e-10
    a_flat = a_flat / a_flat.sum()
    b_flat = b_flat / b_flat.sum()

    kl = kl_divergence(a_flat, b_flat)
    return {
        "kl_divergence": kl,
        "signal_type": "attention_drift",
    }


def compute_all_signals(
    filing_a_embeddings: List[List[float]],
    filing_b_embeddings: List[float],
    filing_a_sections: dict,
    filing_b_sections: dict,
    filing_a_attention: Optional[List[List[List[float]]]] = None,
    filing_b_attention: Optional[List[List[List[float]]]] = None,
) -> List[dict]:
    signals = []

    if filing_a_embeddings and filing_b_embeddings:
        a_avg = np.mean(filing_a_embeddings, axis=0).tolist()
        b_avg = np.mean(filing_b_embeddings, axis=0).tolist()

        temporal = compute_temporal_shift(a_avg, b_avg)
        signals.append(temporal)

    if filing_a_attention and filing_b_attention:
        attn_div = compute_attention_divergence(filing_a_attention, filing_b_attention)
        signals.append(attn_div)

    return signals