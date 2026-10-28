import numpy as np
from typing import List


def attention_to_heatmap(attention_data: dict) -> List[List[float]]:
    layers = attention_data["layers"]
    heatmaps = []

    for layer in layers:
        layer_avg = np.mean(layer, axis=0).tolist()
        heatmaps.append(layer_avg)

    return heatmaps


def get_top_attention_pairs(attention_matrix: List[List[float]], top_k: int = 10) -> List[dict]:
    mat = np.array(attention_matrix)
    pairs = []

    for i in range(mat.shape[0]):
        for j in range(mat.shape[1]):
            if i != j:
                pairs.append({"from": i, "to": j, "weight": float(mat[i, j])})

    pairs.sort(key=lambda x: x["weight"], reverse=True)
    return pairs[:top_k]


def aggregate_attention_to_cls(attention_data: dict) -> List[float]:
    layers = attention_data["layers"]
    seq_len = len(layers[0][0])

    cls_attention = np.zeros(seq_len)
    count = 0

    for layer in layers:
        for head in layer:
            cls_attention += np.array([head[i][0] for i in range(seq_len)])
            count += 1

    return (cls_attention / count).tolist()