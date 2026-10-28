import os
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForSequenceClassification, BertModel
from typing import List, Optional


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
        attention_layers = []
        tokens = self.tokenizer.convert_ids_to_tokens(encoded["input_ids"][0])

        for layer_attn in outputs.attentions:
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
        attention_data = self.get_attention(text)
        tokens = attention_data["tokens"]
        layers = attention_data["layers"]

        seq_len = len(tokens)
        avg_attention_to_cls = [0.0] * seq_len

        for layer in layers:
            for head in layer:
                for i in range(seq_len):
                    avg_attention_to_cls[i] += head[0][i]

        for i in range(seq_len):
            avg_attention_to_cls[i] /= 144

        special_tokens = {"[CLS]", "[SEP]", "[PAD]"}
        scored_tokens = [
            (i, tokens[i], avg_attention_to_cls[i])
            for i in range(seq_len)
            if tokens[i] not in special_tokens
        ]
        scored_tokens.sort(key=lambda x: x[2], reverse=True)

        return [t for _, t, _ in scored_tokens[:top_k]]


_finbert_instance: Optional[FinBERTService] = None


def get_finbert() -> FinBERTService:
    global _finbert_instance
    if _finbert_instance is None:
        _finbert_instance = FinBERTService()
        _finbert_instance.load()
    return _finbert_instance