import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Add the repo root to sys.path for local browser_use package
_repo_root = Path(__file__).parent.parent.parent
if str(_repo_root) not in sys.path:
	sys.path.insert(0, str(_repo_root))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import analysis, auth
from app.routers.scripts import router as scripts_router, runs_router


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
app.include_router(auth.router)
app.include_router(analysis.router)
app.include_router(scripts_router)
app.include_router(runs_router)

# Mount static files for screenshots
app.mount("/screenshots", StaticFiles(directory=settings.SCREENSHOTS_DIR), name="screenshots")
