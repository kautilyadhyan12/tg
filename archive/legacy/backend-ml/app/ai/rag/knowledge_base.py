"""
Knowledge base ingestion.
Reads markdown files from ./knowledge/, splits into chunks,
embeds with sentence-transformers, stores in ChromaDB.
"""

import os
from pathlib import Path
import chromadb
from sentence_transformers import SentenceTransformer

# Paths
RAG_DIR        = Path(__file__).parent
KNOWLEDGE_DIR  = RAG_DIR / "knowledge"
CHROMA_DIR     = RAG_DIR / "chroma_db"

# Embedding model — small, fast, runs on CPU
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

# Singletons
_client     = None
_collection = None
_embedder   = None


def get_embedder():
    """Load the embedding model once."""
    global _embedder
    if _embedder is None:
        print(f"Loading embedding model: {EMBEDDING_MODEL}...")
        _embedder = SentenceTransformer(EMBEDDING_MODEL)
        print("  ✅ Embedding model loaded")
    return _embedder


def get_client():
    """Get or create the ChromaDB client."""
    global _client
    if _client is None:
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return _client


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """
    Split text into overlapping chunks by paragraphs.
    Tries to keep paragraphs together. Falls back to word splits for big ones.
    """
    # Split on double newlines (paragraphs)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks       = []
    current      = ""
    current_size = 0

    for para in paragraphs:
        para_size = len(para.split())

        # Big paragraph — split by words
        if para_size > chunk_size:
            if current:
                chunks.append(current)
                current      = ""
                current_size = 0
            words = para.split()
            for i in range(0, len(words), chunk_size - overlap):
                chunks.append(" ".join(words[i:i + chunk_size]))
            continue

        # Would overflow — flush current
        if current_size + para_size > chunk_size:
            chunks.append(current)
            # Carry overlap from end of previous chunk
            overlap_words = current.split()[-overlap:] if current else []
            current       = " ".join(overlap_words) + "\n\n" + para if overlap_words else para
            current_size  = len(current.split())
        else:
            current      = current + "\n\n" + para if current else para
            current_size += para_size

    if current:
        chunks.append(current)

    return chunks


def get_collection():
    """Get or create the fitness knowledge collection."""
    global _collection
    if _collection is None:
        client      = get_client()
        _collection = client.get_or_create_collection(
            name="fitness_knowledge",
            metadata={"description": "AI Home Gym RAG knowledge base"},
        )
    return _collection


def ingest_knowledge_base():
    """
    Read all .md files, chunk them, embed, store in ChromaDB.
    Skips ingestion if collection is already populated.
    """
    collection = get_collection()

    # Skip if already ingested
    if collection.count() > 0:
        print(f"  ℹ️  Knowledge base already loaded ({collection.count()} chunks)")
        return collection.count()

    if not KNOWLEDGE_DIR.exists():
        print(f"  ⚠️  Knowledge folder not found: {KNOWLEDGE_DIR}")
        return 0

    embedder = get_embedder()
    md_files = list(KNOWLEDGE_DIR.glob("*.md"))

    if not md_files:
        print(f"  ⚠️  No .md files found in {KNOWLEDGE_DIR}")
        return 0

    print(f"  Ingesting {len(md_files)} knowledge files...")

    all_chunks    = []
    all_metadatas = []
    all_ids       = []

    for md_file in md_files:
        topic = md_file.stem  # e.g. "form_guides"
        text  = md_file.read_text(encoding="utf-8")
        chunks = chunk_text(text)

        for i, chunk in enumerate(chunks):
            all_chunks.append(chunk)
            all_metadatas.append({
                "topic":  topic,
                "source": md_file.name,
                "chunk":  i,
            })
            all_ids.append(f"{topic}_{i}")

        print(f"    • {md_file.name}: {len(chunks)} chunks")

    # Batch embed
    print(f"  Embedding {len(all_chunks)} chunks...")
    embeddings = embedder.encode(all_chunks, show_progress_bar=False).tolist()

    # Add to ChromaDB
    collection.add(
        documents=all_chunks,
        embeddings=embeddings,
        metadatas=all_metadatas,
        ids=all_ids,
    )

    print(f"  ✅ Ingested {len(all_chunks)} chunks total")
    return len(all_chunks)