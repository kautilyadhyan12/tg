"""User profile / onboarding API.

Production hardening (response shapes unchanged):
  * Onboarding input is validated with bounds — previously `int(body["age"])`
    style casts turned any bad payload into a 500, and nothing stopped
    age=-5 or weight=999999 from corrupting calorie math downstream.
  * Profile updates validate types/sizes per field (profilePicture capped so
    a base64 blob can't bloat the user document).
  * Every user-doc write invalidates the auth-layer Redis cache, so profile
    changes show up immediately instead of after 60s.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.core.security import get_current_user, invalidate_user_cache
from app.db.mongo import get_db

log = get_logger(__name__)
router = APIRouter(prefix="/users", tags=["Users"])

_GENDERS = {"male", "female", "other"}
_FITNESS_LEVELS = {"beginner", "intermediate", "advanced"}


class MeasurementValue(BaseModel):
    value: float = Field(gt=0, le=1000)
    unit: str = Field(default="", max_length=10)


class OnboardingRequest(BaseModel):
    age: Optional[int] = Field(default=None, ge=13, le=120)
    gender: Optional[str] = Field(default=None, max_length=20)
    height: Optional[MeasurementValue] = None
    weight: Optional[MeasurementValue] = None
    targetWeight: Optional[MeasurementValue] = None
    fitnessLevel: Optional[str] = Field(default=None, max_length=20)
    exerciseFrequency: Optional[int] = Field(default=None, ge=0, le=14)
    medicalConditions: Optional[list] = Field(default=None, max_length=20)
    availableEquipment: Optional[list] = Field(default=None, max_length=20)
    sessionDuration: Optional[int] = Field(default=None, ge=5, le=240)
    preferredWorkoutTime: Optional[str] = Field(default=None, max_length=30)
    fitnessGoals: Optional[list] = Field(default=None, max_length=10)


class ProfileUpdateRequest(BaseModel):
    fullName: Optional[str] = Field(default=None, min_length=1, max_length=100)
    age: Optional[int] = Field(default=None, ge=13, le=120)
    gender: Optional[str] = Field(default=None, max_length=20)
    height: Optional[MeasurementValue] = None
    weight: Optional[MeasurementValue] = None
    targetWeight: Optional[MeasurementValue] = None
    fitnessLevel: Optional[str] = Field(default=None, max_length=20)
    fitnessGoals: Optional[list] = Field(default=None, max_length=10)
    exerciseFrequency: Optional[int] = Field(default=None, ge=0, le=14)
    availableEquipment: Optional[list] = Field(default=None, max_length=20)
    sessionDuration: Optional[int] = Field(default=None, ge=5, le=240)
    preferredWorkoutTime: Optional[str] = Field(default=None, max_length=30)
    medicalConditions: Optional[list] = Field(default=None, max_length=20)
    # URL or small data-URI only — a raw base64 photo belongs in object
    # storage, not the user document.
    profilePicture: Optional[str] = Field(default=None, max_length=2000)


def _clean_str_list(items: Optional[list], max_item_len: int = 100) -> Optional[list]:
    if items is None:
        return None
    return [str(i)[:max_item_len] for i in items if i is not None]


@router.patch("/onboarding")
async def complete_onboarding(
    body: OnboardingRequest,
    current_user: dict = Depends(get_current_user),
):
    """Save onboarding data and mark onboarding as complete."""
    db = get_db()
    user_id = current_user["_id"]

    update = {
        "onboardingCompleted": True,
        "updated_at":          datetime.utcnow(),
    }

    if body.age is not None:
        update["age"] = body.age
    if body.gender is not None:
        update["gender"] = body.gender if body.gender in _GENDERS else "other"
    if body.height is not None:
        update["height"] = {"value": body.height.value, "unit": body.height.unit or "cm"}
    if body.weight is not None:
        update["weight"] = {"value": body.weight.value, "unit": body.weight.unit or "kg"}
    if body.targetWeight is not None:
        update["targetWeight"] = {"value": body.targetWeight.value, "unit": body.targetWeight.unit or "kg"}
    if body.fitnessLevel is not None:
        update["fitnessLevel"] = (
            body.fitnessLevel if body.fitnessLevel in _FITNESS_LEVELS else "beginner"
        )
    if body.exerciseFrequency is not None:
        update["exerciseFrequency"] = body.exerciseFrequency
    if body.medicalConditions is not None:
        update["medicalConditions"] = _clean_str_list(body.medicalConditions)
    if body.availableEquipment is not None:
        update["availableEquipment"] = _clean_str_list(body.availableEquipment)
    if body.sessionDuration is not None:
        update["sessionDuration"] = body.sessionDuration
    if body.preferredWorkoutTime is not None:
        update["preferredWorkoutTime"] = body.preferredWorkoutTime
    if body.fitnessGoals is not None:
        update["fitnessGoals"] = _clean_str_list(body.fitnessGoals)

    await db.users.update_one({"_id": user_id}, {"$set": update})
    await invalidate_user_cache(user_id)

    updated_user = await db.users.find_one({"_id": user_id})

    return {
        "success": True,
        "message": "Onboarding complete!",
        "user": {
            "id":                  str(updated_user["_id"]),
            "fullName":            updated_user.get("fullName"),
            "email":               updated_user.get("email"),
            "onboardingCompleted": True,
            "fitnessLevel":        updated_user.get("fitnessLevel"),
            "fitnessGoals":        updated_user.get("fitnessGoals", []),
            "availableEquipment":  updated_user.get("availableEquipment", []),
        },
    }


@router.get("/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    """Get full user profile."""
    db = get_db()
    user = await db.users.find_one({"_id": current_user["_id"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "success": True,
        "user": {
            "id":                   str(user["_id"]),
            "fullName":             user.get("fullName"),
            "email":                user.get("email"),
            "age":                  user.get("age"),
            "gender":               user.get("gender"),
            "height":               user.get("height"),
            "weight":               user.get("weight"),
            "targetWeight":         user.get("targetWeight"),
            "fitnessLevel":         user.get("fitnessLevel"),
            "fitnessGoals":         user.get("fitnessGoals", []),
            "exerciseFrequency":    user.get("exerciseFrequency"),
            "availableEquipment":   user.get("availableEquipment", []),
            "sessionDuration":      user.get("sessionDuration"),
            "preferredWorkoutTime": user.get("preferredWorkoutTime"),
            "medicalConditions":    user.get("medicalConditions"),
            "onboardingCompleted":  user.get("onboardingCompleted", False),
            "profilePicture":       user.get("profilePicture", ""),
            "level":                user.get("level", 1),
            "xp":                   user.get("xp", 0),
            "streak":               user.get("streak", 0),
        },
    }


@router.patch("/profile")
async def update_profile(
    body: ProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update user profile fields."""
    db = get_db()
    user_id = current_user["_id"]

    update: dict = {"updated_at": datetime.utcnow()}
    data = body.dict(exclude_none=True)

    for field, value in data.items():
        if field in ("height", "weight", "targetWeight"):
            update[field] = value  # already validated MeasurementValue shape
        elif field == "gender":
            update[field] = value if value in _GENDERS else "other"
        elif field == "fitnessLevel":
            update[field] = value if value in _FITNESS_LEVELS else "beginner"
        elif field in ("fitnessGoals", "availableEquipment", "medicalConditions"):
            update[field] = _clean_str_list(value)
        else:
            update[field] = value

    await db.users.update_one({"_id": user_id}, {"$set": update})
    await invalidate_user_cache(user_id)

    return {"success": True, "message": "Profile updated"}


@router.post("/reset-onboarding")
async def reset_onboarding(current_user: dict = Depends(get_current_user)):
    """
    Reset the user's onboarding state.
    Sets onboardingCompleted to false so they'll be redirected to the wizard.
    Does NOT delete profile data — user can re-run onboarding to update it.
    """
    db = get_db()
    user_id = current_user["_id"]

    await db.users.update_one(
        {"_id": user_id},
        {"$set": {
            "onboardingCompleted": False,
            "updated_at":          datetime.utcnow(),
        }},
    )
    await invalidate_user_cache(user_id)

    return {
        "success": True,
        "message": "Onboarding reset. You'll be redirected next time you visit the app.",
    }
