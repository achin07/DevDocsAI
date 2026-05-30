from typing import List

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field
from FlagEmbedding import BGEM3FlagModel

MODEL_NAME = "BAAI/bge-m3"

app = FastAPI(title="DevDocs Embedding Service")

# use_fp16=False is safer on CPU/Mac. If you later run on GPU, you can test True.
model = BGEM3FlagModel(MODEL_NAME, use_fp16=False)


class EmbedRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1)


class EmbedResponse(BaseModel):
    model: str
    dimension: int
    embeddings: List[List[float]]


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_NAME,
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest):
    # BGE-M3 returns dense vectors, sparse vectors, and ColBERT vectors.
    # For v1, we store only dense vectors in pgvector.
    output = model.encode(
        request.texts,
        batch_size=8,
        max_length=8192,
    )

    dense_vectors = output["dense_vecs"]

    # Normalize for cosine similarity stability.
    dense_vectors = np.array(dense_vectors, dtype=np.float32)
    norms = np.linalg.norm(dense_vectors, axis=1, keepdims=True)
    dense_vectors = dense_vectors / np.clip(norms, 1e-12, None)

    embeddings = dense_vectors.tolist()

    return {
        "model": MODEL_NAME,
        "dimension": len(embeddings[0]),
        "embeddings": embeddings,
    }