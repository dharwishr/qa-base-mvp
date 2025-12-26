FROM debian:bookworm-slim

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    tigervnc-standalone-server \
    fluxbox \
    supervisor \
    wget \
    curl \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    python3 \
    python3-numpy \
    procps \
    net-tools \
    socat \
    && rm -rf /var/lib/apt/lists/*

# Install noVNC and websockify
RUN mkdir -p /opt/novnc \
    && wget -qO- https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz --strip-components=1 -C /opt/novnc \
    && ln -s /opt/novnc/vnc.html /opt/novnc/index.html

# Install websockify as Python package
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
    && pip3 install --break-system-packages websockify \
    && apt-get remove -y python3-pip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Create supervisor config directory
RUN mkdir -p /etc/supervisor/conf.d

# Copy supervisor configuration
COPY supervisord.conf /etc/supervisor/supervisord.conf

# Copy startup scripts
COPY scripts/start-xvfb.sh /usr/local/bin/
COPY scripts/start-fluxbox.sh /usr/local/bin/
COPY scripts/start-novnc.sh /usr/local/bin/
COPY scripts/start-chromium.sh /usr/local/bin/
COPY scripts/start-cdp-proxy.sh /usr/local/bin/
COPY scripts/start-cors-proxy.sh /usr/local/bin/

# Make scripts executable
RUN chmod +x /usr/local/bin/*.sh

# Environment variables
ENV DISPLAY=:99
ENV SCREEN_WIDTH=1920
ENV SCREEN_HEIGHT=1080
ENV SCREEN_DEPTH=24
ENV VNC_PORT=5900
ENV NOVNC_PORT=7900
ENV CDP_PORT=9222

# Expose ports
# 5900 - VNC (raw)
# 7900 - noVNC (web interface)
# 9222 - CDP (Chrome DevTools Protocol)
# 9224 - CDP with CORS (for browser access)
EXPOSE 5900 7900 9222 9224

# Health check - verify CDP is responding
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s \
    CMD curl -sf http://localhost:${CDP_PORT}/json/version || exit 1

# Start supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
