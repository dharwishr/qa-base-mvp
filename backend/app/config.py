from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
	model_config = SettingsConfigDict(
		env_file=".env",
		env_file_encoding="utf-8",
		extra="ignore",
	)

	# Application settings
	APP_NAME: str = "QA Base API"
	DEBUG: bool = False

	# Database settings
	DATABASE_URL: str = "sqlite:///./data/app.db"

	# LLM settings
	GEMINI_API_KEY: str = ""  # For plan generation
	BROWSER_USE_API_KEY: str = ""  # For browser automation

	# Google Cloud Speech-to-Text settings
	GOOGLE_SPEECH_API_KEY: str = ""  # Google Cloud API key for Speech-to-Text

	# Storage settings
	SCREENSHOTS_DIR: str = str(Path(__file__).parent.parent / "data" / "screenshots")
	VIDEOS_DIR: str = str(Path(__file__).parent.parent / "data" / "videos")
	LOGS_DIR: str = str(Path(__file__).parent.parent / "data" / "logs")

	# Celery settings
	CELERY_BROKER_URL: str = "redis://localhost:6379/0"
	CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"

	# JWT Authentication settings
	JWT_SECRET: str = "change-me-in-production-use-a-long-random-string"
	JWT_ALGORITHM: str = "HS256"
	JWT_EXPIRY_HOURS: int = 24

	# Single test account credentials
	AUTH_EMAIL: str = "tester@email.com"
	AUTH_PASSWORD: str = "12345678"  # Plain password - will be hashed at runtime

	@property
	def database_path(self) -> Path:
		"""Extract the database file path from the URL."""
		if self.DATABASE_URL.startswith("sqlite:///"):
			return Path(self.DATABASE_URL.replace("sqlite:///", ""))
		return Path("data/app.db")


settings = Settings()
