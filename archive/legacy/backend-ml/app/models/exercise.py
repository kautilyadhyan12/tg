from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ExerciseResponse(BaseModel):
    id: str
    name: str
    description: str
    category: str
    difficulty: str
    equipment: list[str]
    muscles_primary: list[str]
    muscles_secondary: list[str]
    calories_per_min: float
    duration_default: int
    reps_default: int
    image_url: str
    video_url: str
    rating: float
    rating_count: int
    times_used: int

    class Config:
        from_attributes = True


class ExerciseListResponse(BaseModel):
    success: bool
    total: int
    page: int
    limit: int
    pages: int
    exercises: list[ExerciseResponse]


class ExerciseDetailResponse(BaseModel):
    success: bool
    exercise: ExerciseResponse