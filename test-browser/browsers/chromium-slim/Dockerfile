# Chromium only - Minimal Playwright Container
# Strips unused browsers and dependencies - ~800MB instead of 2.3GB

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/node/bin

# Install Node.js and minimal dependencies for Chromium only
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g npm@latest \
    && apt-get install -y --no-install-recommends \
    chromium-browser \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libxcb1 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libcairo2 \
    libfontconfig1 \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

WORKDIR /app

# Install Playwright without browsers (use system chromium)
RUN npm install --no-save playwright@1.57.0 && \
    npm cache clean --force

EXPOSE 9222

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s \
    CMD npx playwright --version || exit 1

CMD ["sleep", "infinity"]
