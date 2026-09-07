from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    ml_port: int = 8000
    node_env: str = "development"
    log_level: str = "INFO"

    # JWT (must match backend-auth)
    ml_jwt_secret: str = "change-me"

    # Database
    mongo_uri: str = "mongodb://localhost:27017/ai_home_gym"
    redis_url: str = "redis://localhost:6379"

    # External APIs
    rapidapi_key: str = ""
    usda_api_key: str = ""
    ors_api_key: str = ""   # OpenRouteService — blank runs offline mock routes

    # Groq
    groq_api_key: str = "placeholder"
    groq_model: str = "llama-3.1-8b-instant"

    # Ollama
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3:8b-instruct-q4_K_M"

    # Non-pose model paths (unchanged)
    ncf_model_path: str = "model_artifacts/ncf.pt"
    calorie_xgb_path: str = "model_artifacts/calorie_xgb.json"
    faiss_index_path: str = "model_artifacts/faiss_index"

    # Frontend — comma-separated list of allowed origins in production,
    # e.g. FRONTEND_URL=https://app.example.com,https://www.example.com
    frontend_url: str = "http://localhost:5173"

    class Config:
        env_file = ".env"
        extra = "ignore"

    # ── Derived helpers ──────────────────────────────────────────────────────
    @property
    def is_production(self) -> bool:
        return self.node_env.lower() == "production"

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip() for o in self.frontend_url.split(",") if o.strip()]
        if not self.is_production:
            # Local dev conveniences only outside production
            origins += ["http://localhost:5173", "http://localhost:3000"]
        # Deduplicate, preserve order
        return list(dict.fromkeys(origins))

    def validate_for_production(self) -> None:
        """Refuse to boot in production with insecure/placeholder config."""
        if not self.is_production:
            return
        problems = []
        if self.ml_jwt_secret in ("", "change-me") or len(self.ml_jwt_secret) < 32:
            problems.append(
                "ML_JWT_SECRET is missing/default/too short (need >= 32 chars, "
                "must match backend-auth)"
            )
        if self.groq_api_key in ("", "placeholder"):
            problems.append("GROQ_API_KEY is not set (Coach will fail)")
        if any(o.startswith("http://localhost") for o in self.cors_origins):
            problems.append("FRONTEND_URL points at localhost in production")
        if "localhost" in self.mongo_uri and "127.0.0.1" not in self.mongo_uri:
            # Allowed if Mongo truly runs on the same box, but warn loudly.
            pass
        if problems:
            raise RuntimeError(
                "Refusing to start in production with insecure config:\n  - "
                + "\n  - ".join(problems)
            )


@lru_cache()
def get_settings() -> Settings:
    return Settings()
