# Anomaly Engine — Phase 4: nlp-engine (FinBERT)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the NLP engine service with FinBERT inference — sentiment classification, 768-dim embeddings, and 12×12 attention matrix extraction.

**Architecture:** FastAPI service on port 8003. Load FinBERT once on startup. Batch inference up to 32 chunks. Three endpoints: sentiment, embeddings, attention.

**Tech Stack:** Python 3.11, FastAPI, PyTorch 2.4+, transformers 4.40+, FinBERT (ProsusAI/finbert)

---

## File Structure

```
services/nlp-engine/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── main.py                    # FastAPI routes
    ├── finbert_service.py         # Model loading + inference
    ├── divergence.py              # Cosine drift, KL-div, entropy
    └── attention.py               # Attention extraction utilities
```

---

### Task 1: Models + FinBERT Service

**Files:**
- Create: `services/nlp-engine/app/models.py`
- Create: `services/nlp-engine/app/finbert_service.py`

**Interfaces:**
- Produces: Pydantic request/response models; FinBERTService class

- [ ] **Step 1: Create models.py**

```python
from pydantic import BaseModel
from typing import Optional
from typing import List


class SentimentRequest(BaseModel):
    texts: List[str]


class SentimentScore(BaseModel):
    positive: float
    negative: float
    neutral: float


class SentimentResponse(BaseModel):
    scores: List[SentimentScore]
    model_version: str = "finbert-base"


class EmbeddingRequest(BaseModel):
    texts: List[str]
    model_version: str = "finbert-base"


class EmbeddingResponse(BaseModel):
    embeddings: List[List[float]]
    model_version: str
    dimensions: int = 768


class AttentionRequest(BaseModel):
    text: str


class AttentionMatrix(BaseModel):
    layers: List[List[List[float]]]  # [layer][head] = seq_len x seq_len matrix


class AttentionResponse(BaseModel):
    attention: AttentionMatrix
    tokens: List[str]
    input_text: str


class DivergenceRequest(BaseModel):
    filing_a_id: str
    filing_b_id: str
    signal_type: str  # "cross_section", "temporal_shift", "attention_drift"


class DivergenceDetails(BaseModel):
    cosine_distance: Optional[float] = None
    kl_divergence: Optional[float] = None
    entropy: Optional[float] = None
    key_sentences: Optional[List[str]] = None
```

- [ ] **Step 2: Create finbert_service.py**

```python
import os
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForSequenceClassification, BertModel
from typing import List, Optional
import json


class FinBERTService:
    def __init__(self):
        self.model_name = os.getenv("FINBERT_MODEL", "ProsusAI/finbert")
        self.device = os.getenv("MODEL_DEVICE", "cpu")
        self.tokenizer = None
        self.classifier = None
        self.base_model = None
        self.id2label = {0: "positive", 1: "negative", 2: "neutral"}

    def load(self):
        print(f"Loading FinBERT from {self.model_name} on {self.device}...")
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)

        # Load base model for embeddings + attention
        self.base_model = BertModel.from_pretrained(
            self.model_name,
            output_attentions=True,
            output_hidden_states=True,
        ).to(self.device)
        self.base_model.eval()

        # Load classifier for sentiment
        self.classifier = AutoModelForSequenceClassification.from_pretrained(
            self.model_name,
        ).to(self.device)
        self.classifier.eval()

        print("FinBERT loaded successfully")

    def _batch_inference(self, texts: List[str], max_length: int = 512):
        encoded = self.tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        ).to(self.device)
        return encoded

    def get_sentiment(self, texts: List[str]) -> List[dict]:
        if not texts:
            return []

        encoded = self._batch_inference(texts)
        with torch.no_grad():
            outputs = self.classifier(**encoded)
            logits = outputs.logits
            probs = F.softmax(logits, dim=-1)

        results = []
        for i in range(len(texts)):
            results.append({
                "positive": float(probs[i, 0]),
                "negative": float(probs[i, 1]),
                "neutral": float(probs[i, 2]),
            })
        return results

    def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        encoded = self._batch_inference(texts)
        with torch.no_grad():
            outputs = self.base_model(**encoded)
            # Use [CLS] token embedding
            cls_embeddings = outputs.last_hidden_state[:, 0, :]
            # Normalize
            cls_embeddings = F.normalize(cls_embeddings, p=2, dim=1)

        return cls_embeddings.cpu().numpy().tolist()

    def get_attention(self, text: str) -> dict:
        encoded = self.tokenizer(
            text,
            padding=False,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        ).to(self.device)

        with torch.no_grad():
            outputs = self.base_model(**encoded)

        # Get attention from all 12 layers
        # outputs.attentions is tuple of 12 tensors: (batch, heads, seq_len, seq_len)
        attention_layers = []
        tokens = self.tokenizer.convert_ids_to_tokens(encoded["input_ids"][0])

        for layer_attn in outputs.attentions:
            # layer_attn: (1, 12, seq_len, seq_len)
            layer_heads = []
            for head_idx in range(12):
                head_matrix = layer_attn[0, head_idx].cpu().numpy().tolist()
                layer_heads.append(head_matrix)
            attention_layers.append(layer_heads)

        return {
            "layers": attention_layers,
            "tokens": tokens,
        }

    def get_key_sentences_from_attention(self, text: str, top_k: int = 5) -> List[str]:
        """Extract sentences with highest attention to [CLS] token."""
        attention_data = self.get_attention(text)
        tokens = attention_data["tokens"]
        layers = attention_data["layers"]

        # Average attention across all layers and heads for each token to [CLS]
        # [CLS] is index 0
        seq_len = len(tokens)
        avg_attention_to_cls = [0.0] * seq_len

        for layer in layers:
            for head in layer:
                for i in range(seq_len):
                    avg_attention_to_cls[i] += head[0][i]  # attention from token i to [CLS]

        # Normalize by number of layers × heads (12 × 12 = 144)
        for i in range(seq_len):
            avg_attention_to_cls[i] /= 144

        # Get token indices sorted by attention (excluding [CLS], [SEP], [PAD])
        special_tokens = {"[CLS]", "[SEP]", "[PAD]"}
        scored_tokens = [
            (i, tokens[i], avg_attention_to_cls[i])
            for i in range(seq_len)
            if tokens[i] not in special_tokens
        ]
        scored_tokens.sort(key=lambda x: x[2], reverse=True)

        # Map back to sentences (simple heuristic)
        # Just return top tokens for now - sentence mapping needs spacy
        return [t for _, t, _ in scored_tokens[:top_k]]


# Singleton
_finbert_instance: Optional[FinBERTService] = None


def get_finbert() -> FinBERTService:
    global _finbert_instance
    if _finbert_instance is None:
        _finbert_instance = FinBERTService()
        _finbert_instance.load()
    return _finbert_instance
```

- [ ] **Step 3: Commit**

```bash
git add services/nlp-engine/app/models.py services/nlp-engine/app/finbert_service.py
git commit -m "feat: add FinBERT service with sentiment, embeddings, attention"
```

---

### Task 2: Divergence Math Engine

**Files:**
- Create: `services/nlp-engine/app/divergence.py`
- Create: `services/nlp-engine/app/attention.py`

**Interfaces:**
- Consumes: Embeddings, sentiment scores, attention matrices
- Produces: Anomaly signals (cosine drift, KL-div, entropy)

- [ ] **Step 1: Create divergence.py**

```python
import numpy as np
from scipy.stats import entropy as scipy_entropy
from typing import List, Optional


def cosine_distance(vec_a: List[float], vec_b: List[float]) -> float:
    """1 - cosine similarity. 0 = identical, 2 = opposite."""
    a = np.array(vec_a)
    b = np.array(vec_b)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 1.0
    return 1.0 - (dot / (norm_a * norm_b))


def kl_divergence(p: List[float], q: List[float]) -> float:
    """KL(P || Q). P = true distribution, Q = approx."""
    p = np.array(p) + 1e-10
    q = np.array(q) + 1e-10
    p = p / p.sum()
    q = q / q.sum()
    return float(np.sum(p * np.log(p / q)))


def sentence_entropy(sentiment_scores: dict) -> float:
    """Entropy of FinBERT sentiment distribution. Higher = more uncertain."""
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
    """Cosine distance between press release and risk factors embeddings."""
    distance = cosine_distance(press_embedding, risk_embedding)
    return {
        "cosine_distance": distance,
        "signal_type": "cross_section",
    }


def compute_temporal_shift(
    current_embedding: List[float],
    previous_embedding: List[float],
) -> dict:
    """Cosine distance between current and previous quarter risk sections."""
    distance = cosine_distance(current_embedding, previous_embedding)
    return {
        "cosine_distance": distance,
        "signal_type": "temporal_shift",
    }


def compute_attention_divergence(
    attention_a: List[List[List[float]]],
    attention_b: List[List[List[float]]],
) -> dict:
    """KL-divergence between attention weight distributions."""
    # Flatten attention matrices for comparison
    # Average across heads, then flatten spatial dims
    a_flat = []
    b_flat = []

    for layer_a, layer_b in zip(attention_a, attention_b):
        for head_a, head_b in zip(layer_a, layer_b):
            a_flat.extend(np.array(head_a).flatten())
            b_flat.extend(np.array(head_b).flatten())

    # Add small epsilon and normalize
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
    """Compute all three anomaly signals between two filings."""
    signals = []

    # Cross-section: press vs risk factors (same filing)
    # This would be called with embeddings from different sections of SAME filing

    # Temporal shift: current vs previous quarter
    if filing_a_embeddings and filing_b_embeddings:
        # Use average embeddings
        a_avg = np.mean(filing_a_embeddings, axis=0).tolist()
        b_avg = np.mean(filing_b_embeddings, axis=0).tolist()

        temporal = compute_temporal_shift(a_avg, b_avg)
        signals.append(temporal)

    # Attention divergence
    if filing_a_attention and filing_b_attention:
        attn_div = compute_attention_divergence(filing_a_attention, filing_b_attention)
        signals.append(attn_div)

    return signals
```

- [ ] **Step 2: Create attention.py**

```python
import numpy as np
from typing import List


def attention_to_heatmap(attention_data: dict) -> List[List[float]]:
    """Convert attention matrices to 2D heatmap per layer (avg over heads)."""
    layers = attention_data["layers"]
    heatmaps = []

    for layer in layers:
        # Average across 12 heads
        layer_avg = np.mean(layer, axis=0).tolist()
        heatmaps.append(layer_avg)

    return heatmaps


def get_top_attention_pairs(attention_matrix: List[List[float]], top_k: int = 10) -> List[dict]:
    """Find token pairs with highest attention."""
    mat = np.array(attention_matrix)
    pairs = []

    for i in range(mat.shape[0]):
        for j in range(mat.shape[1]):
            if i != j:
                pairs.append({"from": i, "to": j, "weight": float(mat[i, j])})

    pairs.sort(key=lambda x: x["weight"], reverse=True)
    return pairs[:top_k]


def aggregate_attention_to_cls(attention_data: dict) -> List[float]:
    """Get average attention from each token to [CLS] token across all layers/heads."""
    layers = attention_data["layers"]
    seq_len = len(layers[0][0])

    cls_attention = np.zeros(seq_len)
    count = 0

    for layer in layers:
        for head in layer:
            cls_attention += np.array([head[i][0] for i in range(seq_len)])
            count += 1

    return (cls_attention / count).tolist()
```

- [ ] **Step 3: Commit**

```bash
git add services/nlp-engine/app/divergence.py services/nlp-engine/app/attention.py
git commit -m "feat: add divergence math engine and attention utilities"
```

---

### Task 3: Main FastAPI App

**Files:**
- Modify: `services/nlp-engine/app/main.py`

**Interfaces:**
- Consumes: All previous modules
- Produces: FastAPI app with 4 endpoints

- [ ] **Step 1: Replace main.py**

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .models import (
    SentimentRequest, SentimentResponse,
    EmbeddingRequest, EmbeddingResponse,
    AttentionRequest, AttentionResponse,
)
from .finbert_service import get_finbert
from .divergence import compute_all_signals, sentence_entropy

app = FastAPI(title="NLP Engine (FinBERT)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    # Pre-load FinBERT on startup
    get_finbert()


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "nlp-engine", "model": "ProsusAI/finbert"}


@app.post("/analyze/sentiment", response_model=SentimentResponse)
async def analyze_sentiment(req: SentimentRequest):
    finbert = get_finbert()
    scores = finbert.get_sentiment(req.texts)
    return SentimentResponse(scores=scores)


@app.post("/analyze/embeddings", response_model=EmbeddingResponse)
async def analyze_embeddings(req: EmbeddingRequest):
    finbert = get_finbert()
    embeddings = finbert.get_embeddings(req.texts)
    return EmbeddingResponse(
        embeddings=embeddings,
        model_version=req.model_version,
    )


@app.post("/analyze/attention", response_model=AttentionResponse)
async def analyze_attention(req: AttentionRequest):
    finbert = get_finbert()
    result = finbert.get_attention(req.text)
    return AttentionResponse(
        attention=result["layers"],
        tokens=result["tokens"],
        input_text=req.text,
    )


@app.post("/analyze/divergence")
async def analyze_divergence(
    filing_a_embeddings: list[list[float]],
    filing_b_embeddings: list[list[float]],
    filing_a_sections: dict = None,
    filing_b_sections: dict = None,
    filing_a_attention: list = None,
    filing_b_attention: list = None,
):
    signals = compute_all_signals(
        filing_a_embeddings,
        filing_b_embeddings,
        filing_a_sections or {},
        filing_b_sections or {},
        filing_a_attention,
        filing_b_attention,
    )
    return {"signals": signals}


@app.post("/analyze/entropy")
async def analyze_entropy(texts: list[str]):
    finbert = get_finbert()
    scores = finbert.get_sentiment(texts)
    entropies = [sentence_entropy(s) for s in scores]
    return {"texts": texts, "entropies": entropies, "mean_entropy": sum(entropies)/len(entropies) if entropies else 0}
```

- [ ] **Step 2: Commit**

```bash
git add services/nlp-engine/app/main.py
git commit -m "feat: add nlp-engine FastAPI routes"
```

---

### Task 4: Dockerfile + Verify

**Files:**
- Modify: `services/nlp-engine/Dockerfile`
- Modify: `services/nlp-engine/requirements.txt`

- [ ] **Step 1: Update Dockerfile (CPU-only)**

```dockerfile
FROM python:3.11-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]

FROM base AS development
RUN pip install --no-cache-dir watchdog[watchmedo]
CMD ["watchmedo", "auto-restart", "--pattern=*.py", "--recursive", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003", "--reload"]
```

- [ ] **Step 2: Update requirements.txt**

```txt
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
torch>=2.4.0
transformers>=4.40.0
numpy>=1.26.0
scipy>=1.12.0
```

- [ ] **Step 3: Verify imports**

```bash
python -c "
import sys
sys.path.insert(0, 'services/nlp-engine')
from app.models import SentimentRequest, EmbeddingRequest
from app.finbert_service import FinBERTService
from app.divergence import cosine_distance, kl_divergence
print('All nlp-engine modules import OK')
"
```

- [ ] **Step 4: Commit**

```bash
git add services/nlp-engine/
git commit -m "feat: nlp-engine complete with FinBERT service"
```