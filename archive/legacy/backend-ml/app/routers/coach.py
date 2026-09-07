"""
Phase 9 — RAG Coach API
Streaming chat endpoint backed by RAG + Groq LLaMA 3.1 8B.

Production hardening (behavior otherwise unchanged):
  * Groq streaming no longer blocks the event loop (iterate_in_thread) —
    previously one user's streaming reply froze every other request.
  * 30 questions/user/day quota (fail-open — this feature is cheap).
  * Message length capped (2000 chars) so token cost per call is bounded.
  * LLM context trimmed to the last 12 messages; stored history capped at
    the last 200 via $slice so conversation docs can't grow unbounded.
"""

from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.concurrency import iterate_in_thread
from app.core.logging import get_logger
from app.core.quotas import enforce_daily_quota, COACH_DAILY_LIMIT
from app.core.security import get_current_user
from app.db.mongo import get_db
from app.ai.rag.coach import stream_coach_response

log = get_logger(__name__)
router = APIRouter(prefix="/coach", tags=["Coach"])

_MAX_MESSAGE_CHARS = 2000
_LLM_HISTORY_MESSAGES = 12    # last N messages sent to the model
_STORED_HISTORY_MESSAGES = 200  # last N messages kept in MongoDB


# ── Request / response schemas ────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=_MAX_MESSAGE_CHARS)
    conversation_id: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/chat")
async def chat(
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Send a message to the AI Coach. Streams response token-by-token.
    Creates a new conversation if conversation_id is not provided.
    Saves the full exchange to MongoDB when done.
    """
    db = get_db()
    user_id = current_user["_id"]

    # Daily quota — cheap feature, fail open if Redis is unavailable
    await enforce_daily_quota(user_id, "coach", COACH_DAILY_LIMIT, fail_open=True)

    # ── Load or create conversation ───────────────────────────────────────────
    conversation = None
    if body.conversation_id:
        try:
            oid = ObjectId(body.conversation_id)
            conversation = await db.coach_conversations.find_one({
                "_id":     oid,
                "user_id": user_id,
            })
        except Exception:
            pass

    if not conversation:
        conv_doc = {
            "user_id":    user_id,
            "title":      body.message[:60],
            "messages":   [],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        result = await db.coach_conversations.insert_one(conv_doc)
        conv_doc["_id"] = result.inserted_id
        conversation = conv_doc

    # Only the recent tail goes to the model — keeps latency and token cost
    # flat no matter how long the conversation gets.
    history = conversation.get("messages", [])[-_LLM_HISTORY_MESSAGES:]

    # ── Stream response ───────────────────────────────────────────────────────
    async def event_stream():
        """SSE-style stream — newline-delimited tokens."""
        full_response = ""

        # First chunk — send conversation_id so frontend can persist it
        yield f"__CONV_ID__:{str(conversation['_id'])}\n"

        try:
            # The Groq client is synchronous; iterate it in a worker thread so
            # this stream never blocks other users' requests.
            async for token in iterate_in_thread(
                stream_coach_response(
                    question=body.message,
                    user_profile=current_user,
                    history=history,
                )
            ):
                full_response += token
                yield token
        except Exception as e:
            log.exception("Coach stream failed for user %s", user_id)
            error_msg = "\n\n[The coach hit a temporary problem — please try again.]"
            full_response += error_msg
            yield error_msg

        # ── Save the exchange to MongoDB after streaming completes ────────────
        try:
            now = datetime.utcnow()
            await db.coach_conversations.update_one(
                {"_id": conversation["_id"]},
                {
                    "$push": {
                        "messages": {
                            "$each": [
                                {"role": "user",      "content": body.message,  "timestamp": now},
                                {"role": "assistant", "content": full_response, "timestamp": now},
                            ],
                            # Cap stored history so the document can't grow
                            # unbounded (Mongo has a 16MB doc limit).
                            "$slice": -_STORED_HISTORY_MESSAGES,
                        }
                    },
                    "$set": {"updated_at": now},
                },
            )
        except Exception:
            log.exception("Failed to save chat for user %s", user_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/plain; charset=utf-8",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.get("/conversations")
async def list_conversations(
    limit: int = Query(default=20, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """List the user's recent conversations (without full messages)."""
    db = get_db()

    cursor = db.coach_conversations.find(
        {"user_id": current_user["_id"]},
        {"messages": {"$slice": -1}, "title": 1, "updated_at": 1},
    ).sort("updated_at", -1).limit(limit)

    convs = await cursor.to_list(limit)

    result = []
    for conv in convs:
        last_msg = conv.get("messages", [])
        preview = last_msg[-1]["content"][:120] if last_msg else ""
        result.append({
            "id":         str(conv["_id"]),
            "title":      conv.get("title", "Chat"),
            "preview":    preview,
            "updated_at": conv.get("updated_at").isoformat() if conv.get("updated_at") else "",
        })

    return {"success": True, "conversations": result}


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get full message history for a conversation."""
    db = get_db()

    try:
        oid = ObjectId(conversation_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid conversation ID")

    conv = await db.coach_conversations.find_one({
        "_id":     oid,
        "user_id": current_user["_id"],
    })
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {
        "success": True,
        "conversation": {
            "id":    str(conv["_id"]),
            "title": conv.get("title", "Chat"),
            "messages": [
                {
                    "role":      m["role"],
                    "content":   m["content"],
                    "timestamp": m["timestamp"].isoformat() if m.get("timestamp") else "",
                }
                for m in conv.get("messages", [])
            ],
            "created_at": conv.get("created_at").isoformat() if conv.get("created_at") else "",
        },
    }


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a conversation."""
    db = get_db()

    try:
        oid = ObjectId(conversation_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid conversation ID")

    result = await db.coach_conversations.delete_one({
        "_id":     oid,
        "user_id": current_user["_id"],
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {"success": True, "message": "Conversation deleted"}
