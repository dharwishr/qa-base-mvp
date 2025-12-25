from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import analysis


@asynccontextmanager
async def lifespan(app: FastAPI):
	"""Application lifespan handler."""
	# Startup: ensure directories exist
	data_dir = Path("data")
	data_dir.mkdir(exist_ok=True)
	screenshots_dir = Path(settings.SCREENSHOTS_DIR)
	screenshots_dir.mkdir(parents=True, exist_ok=True)
	yield
	# Shutdown: cleanup if needed


app = FastAPI(
	title=settings.APP_NAME,
	lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],  # Configure appropriately for production
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


@app.get("/health")
async def health_check():
	"""Health check endpoint."""
	return {"status": "healthy", "app": settings.APP_NAME}


@app.get("/")
async def root():
	"""Root endpoint."""
	return {"message": f"Welcome to {settings.APP_NAME}"}


# Include routers
app.include_router(analysis.router)

# Mount static files for screenshots
app.mount("/screenshots", StaticFiles(directory=settings.SCREENSHOTS_DIR), name="screenshots")
