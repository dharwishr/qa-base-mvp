# Edge only - Playwright Test Container
# Runs Playwright browser server for remote connections (Edge uses Chromium)

FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Remove unused browsers to save space
RUN rm -rf /ms-playwright/firefox-* /ms-playwright/webkit-* && \
    rm -rf /usr/share/doc /usr/share/man /usr/share/locale && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install playwright npm package and MS Edge browser
RUN npm init -y && npm install playwright@1.57.0 --save && \
    npx playwright install msedge

# Create browser server launcher script (Edge uses Chromium binary)
RUN echo '#!/usr/bin/env node\n\
const { chromium } = require("playwright");\n\
\n\
async function main() {\n\
    const port = parseInt(process.env.WS_PORT || "9222");\n\
    console.log(`Starting Edge (Chromium) browser server on port ${port}...`);\n\
    \n\
    const server = await chromium.launchServer({\n\
        headless: true,\n\
        port: port,\n\
        channel: "msedge",\n\
        args: [\n\
            "--no-sandbox",\n\
            "--disable-dev-shm-usage",\n\
            "--disable-gpu"\n\
        ]\n\
    });\n\
    \n\
    console.log(`Edge server started: ${server.wsEndpoint()}`);\n\
    \n\
    // Keep running\n\
    process.on("SIGTERM", async () => {\n\
        console.log("Shutting down...");\n\
        await server.close();\n\
        process.exit(0);\n\
    });\n\
}\n\
\n\
main().catch(err => {\n\
    console.error("Failed to start browser server:", err);\n\
    process.exit(1);\n\
});\n\
' > /app/start-server.js

# Environment
ENV WS_PORT=9222

# Expose WebSocket port
EXPOSE 9222

# Health check
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s \
    CMD curl -sf http://localhost:${WS_PORT}/json || exit 1

CMD ["node", "/app/start-server.js"]
