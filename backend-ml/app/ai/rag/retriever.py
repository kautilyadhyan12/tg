"""
Retriever — finds the most relevant knowledge chunks for a user query.
"""

from app.ai.rag.knowledge_base import get_collection, get_embedder


def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """
    Retrieve top_k most relevant chunks for a query.
    Returns list of dicts with 'text', 'topic', 'distance'.
    """
    collection = get_collection()
    embedder   = get_embedder()

    # Embed the query
    query_embedding = embedder.encode([query]).tolist()

    # Search
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=top_k,
    )

    # Unpack results — ChromaDB returns nested lists
    docs       = results.get("documents", [[]])[0]
    metadatas  = results.get("metadatas", [[]])[0]
    distances  = results.get("distances", [[]])[0]

    chunks = []
    for doc, meta, dist in zip(docs, metadatas, distances):
        chunks.append({
            "text":     doc,
            "topic":    meta.get("topic", "unknown"),
            "source":   meta.get("source", ""),
            "distance": round(float(dist), 4),
        })

    return chunks


def format_context(chunks: list[dict]) -> str:
    """
    Format retrieved chunks into a single context string for the LLM.
    """
    if not chunks:
        return "No specific context available."

    parts = []
    for i, chunk in enumerate(chunks, 1):
        parts.append(f"[Source {i} — {chunk['topic']}]\n{chunk['text']}")

    return "\n\n---\n\n".join(parts)