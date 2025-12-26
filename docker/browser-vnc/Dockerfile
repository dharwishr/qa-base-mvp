FROM debian:bookworm-slim

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    tigervnc-standalone-server \
    tigervnc-common \
    xvfb \
    fluxbox \
    supervisor \
    wget \
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

# Create supervisor config
RUN mkdir -p /etc/supervisor/conf.d

COPY supervisord.conf /etc/supervisor/supervisord.conf

# Create startup scripts
COPY start-xvfb.sh /usr/local/bin/
COPY start-vnc.sh /usr/local/bin/
COPY start-novnc.sh /usr/local/bin/
COPY start-chromium.sh /usr/local/bin/
COPY start-fluxbox.sh /usr/local/bin/
COPY start-cdp-proxy.sh /usr/local/bin/

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
EXPOSE 5900 7900 9222

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s \
    CMD curl -sf http://localhost:${CDP_PORT}/json/version || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
