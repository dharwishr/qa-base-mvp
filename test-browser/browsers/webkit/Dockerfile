# WebKit only - Playwright Test Container
# Runs Playwright browser server for remote connections

FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Remove unused browsers to save space
RUN rm -rf /ms-playwright/chromium-* /ms-playwright/firefox-* && \
    rm -rf /usr/share/doc /usr/share/man /usr/share/locale && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install playwright npm package (browsers already installed in image)
RUN npm init -y && npm install playwright@1.57.0 --save

# Create browser server launcher script
RUN echo '#!/usr/bin/env node\n\
const { webkit } = require("playwright");\n\
\n\
async function main() {\n\
    const port = parseInt(process.env.WS_PORT || "9222");\n\
    console.log(`Starting WebKit browser server on port ${port}...`);\n\
    \n\
    const server = await webkit.launchServer({\n\
        headless: true,\n\
        port: port\n\
    });\n\
    \n\
    console.log(`WebKit server started: ${server.wsEndpoint()}`);\n\
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

# Health check - WebKit doesn't expose /json endpoint like Chromium
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s \
    CMD node -e "require('net').createConnection(${WS_PORT}, 'localhost').on('connect', () => process.exit(0)).on('error', () => process.exit(1))" || exit 1

CMD ["node", "/app/start-server.js"]
