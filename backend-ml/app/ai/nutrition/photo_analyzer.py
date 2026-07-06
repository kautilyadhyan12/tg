"""
Phase 11 — AI Meal Photo Analysis
Uses Groq Llama 4 Scout (vision) to estimate nutrition from a meal photo.
Returns structured JSON with food items + macro estimates.
"""

import base64
import json
import re
from groq        import Groq
from app.config  import get_settings

settings     = get_settings()
_groq_client = None


def get_groq():
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=settings.groq_api_key)
    return _groq_client


ANALYSIS_PROMPT = """You are a professional nutritionist analyzing a meal photo.

Your job is to identify all food items visible in the image and estimate their nutritional content.

IMPORTANT RULES:
- Be conservative and realistic with estimates
- Account for typical serving sizes visually
- If you cannot clearly see what something is, say "Unknown food item"
- Never make up foods that aren't visible
- Base estimates on standard USDA nutrition values

Respond ONLY with a valid JSON object in this exact format, no other text:
{
  "meal_name": "Brief description of the overall meal",
  "confidence": "high|medium|low",
  "items": [
    {
      "name": "Food item name",
      "estimated_quantity": "e.g. 150g, 1 cup, 2 pieces",
      "kcal": 250,
      "protein_g": 20.0,
      "carbs_g": 15.0,
      "fat_g": 8.0,
      "fiber_g": 2.0
    }
  ],
  "totals": {
    "kcal": 250,
    "protein_g": 20.0,
    "carbs_g": 15.0,
    "fat_g": 8.0,
    "fiber_g": 2.0
  },
  "notes": "Any important notes about the analysis or what's hard to determine"
}"""


def analyze_meal_photo(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Analyze a meal photo using Groq Llama 4 Scout vision.
    Returns structured nutrition estimate.
    """
    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    client    = get_groq()

    try:
        response = client.chat.completions.create(
            model    = "meta-llama/llama-4-scout-17b-16e-instruct",
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ANALYSIS_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{b64_image}",
                            },
                        },
                    ],
                }
            ],
            max_tokens  = 1000,
            temperature = 0.1,
        )

        raw_text = response.choices[0].message.content.strip()

        # Strip markdown code blocks if present
        raw_text = re.sub(r"```(?:json)?", "", raw_text).strip()

        result = json.loads(raw_text)

        if "items" not in result or "totals" not in result:
            raise ValueError("Missing required fields in response")

        # Coerce all numeric fields to proper floats
        for item in result.get("items", []):
            item["kcal"]      = float(item.get("kcal", 0))
            item["protein_g"] = float(item.get("protein_g", 0))
            item["carbs_g"]   = float(item.get("carbs_g", 0))
            item["fat_g"]     = float(item.get("fat_g", 0))
            item["fiber_g"]   = float(item.get("fiber_g", 0))

        totals = result.get("totals", {})
        result["totals"] = {
            "kcal":      float(totals.get("kcal", 0)),
            "protein_g": float(totals.get("protein_g", 0)),
            "carbs_g":   float(totals.get("carbs_g", 0)),
            "fat_g":     float(totals.get("fat_g", 0)),
            "fiber_g":   float(totals.get("fiber_g", 0)),
        }

        return {"success": True, "analysis": result}

    except json.JSONDecodeError as e:
        return {
            "success": False,
            "error":   "Could not parse nutrition data from image",
            "detail":  str(e),
        }
    except Exception as e:
        return {
            "success": False,
            "error":   "Photo analysis failed",
            "detail":  str(e),
        }