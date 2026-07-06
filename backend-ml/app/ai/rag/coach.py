"""
RAG Coach — generates personalised fitness answers using:
  - Retrieved knowledge base chunks (context)
  - User's profile (level, goals, equipment)
  - Groq LLaMA 3.1 8B Instant for fast streaming generation
"""

from groq import Groq
from app.config import get_settings
from app.ai.rag.retriever import retrieve, format_context

settings = get_settings()

_groq_client = None


def get_groq():
    """Lazy-init Groq client."""
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=settings.groq_api_key)
    return _groq_client


def build_system_prompt(user_profile: dict) -> str:
    """Build a system prompt incorporating the user's profile."""
    level       = user_profile.get("fitnessLevel")  or "beginner"
    goals       = user_profile.get("fitnessGoals")  or []
    equipment   = user_profile.get("availableEquipment") or []
    age         = user_profile.get("age")
    medical     = user_profile.get("medicalConditions") or ""

    goal_str  = ", ".join(goals) if goals else "general fitness"
    equip_str = ", ".join(equipment) if equipment else "bodyweight only"

    profile_block = f"""USER PROFILE:
- Fitness level: {level}
- Goals: {goal_str}
- Equipment available: {equip_str}"""

    if age:
        profile_block += f"\n- Age: {age}"
    if medical:
        profile_block += f"\n- Medical notes: {medical}"

    return f"""You are an expert fitness coach for the AI Home Gym app. You give clear, encouraging, science-based advice.

{profile_block}

RULES:
- Tailor advice to the user's level and equipment.
- Use the provided context to ground your answers. Don't invent facts not present in context or general fitness knowledge.
- Keep answers focused and practical — no fluff.
- Use markdown formatting (bullet points, **bold** for emphasis, numbered steps).
- For form/technique questions, list specific cues.
- For programming questions, give concrete sets/reps/frequencies.
- For nutrition, give actionable numbers (grams, calories).
- If the user has medical conditions, add appropriate caution but don't refuse to help.
- If unsure, say so honestly — never make up information."""


def stream_coach_response(question: str, user_profile: dict, history: list = None):
    """
    Generator that streams response tokens from Groq.
    Yields strings (token chunks).
    """
    history = history or []

    # 1. Retrieve relevant knowledge
    chunks  = retrieve(question, top_k=3)
    context = format_context(chunks)

    # 2. Build messages
    system_prompt = build_system_prompt(user_profile)

    messages = [{"role": "system", "content": system_prompt}]

    # Include last 6 messages of history (3 exchanges)
    for msg in history[-6:]:
        if msg.get("role") in ("user", "assistant") and msg.get("content"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    # User question with retrieved context
    user_message = f"""CONTEXT FROM KNOWLEDGE BASE:
{context}

QUESTION: {question}"""

    messages.append({"role": "user", "content": user_message})

    # 3. Stream from Groq
    client = get_groq()
    stream = client.chat.completions.create(
        model       = settings.groq_model,
        messages    = messages,
        temperature = 0.7,
        max_tokens  = 800,
        stream      = True,
    )

    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta