"""
Running feature — AI/logic layer.

Self-contained module for the Running planner feature. Nothing here imports
from or mutates the existing workout/gamification logic; it only *reads*
shared helpers (calorie math, level curve) so the running feature stays
consistent with the rest of the app without changing it.
"""
