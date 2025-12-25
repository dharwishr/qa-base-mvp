# ============================================
# Stage 1: Build Stage
# ============================================
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency management
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Copy browser_use local package first and install it
COPY browser_use /app/browser_use
RUN cd /app/browser_use && uv pip install --system -e .

# Copy backend files
COPY backend/pyproject.toml /app/

# Create a modified pyproject.toml without the local path reference
RUN sed -i '/\[tool.uv.sources\]/,/browser-use/d' /app/pyproject.toml

# Install backend dependencies (browser-use will come from PyPI or already installed)
RUN uv pip install --system -e .

# ============================================
# Stage 2: Production Stage
# ============================================
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies including Playwright browser dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    # Playwright/Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libpangocairo-1.0-0 \
    fonts-liberation \
    fonts-noto-color-emoji \
    wget \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install uv/uvx for browser management
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Install Playwright and download Chromium browser
RUN pip install playwright && playwright install chromium

# Copy browser_use package
COPY browser_use /app/browser_use

# Copy backend application
COPY backend/app /app/app
COPY backend/alembic /app/alembic
COPY backend/alembic.ini /app/alembic.ini

# Create necessary directories
RUN mkdir -p /app/data/screenshots /app/data/logs

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH="/app:/app/browser_use"
# Tell Playwright to use the installed browser
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run migrations and start server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

