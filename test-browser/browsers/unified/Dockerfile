# Unified Browser Container - Supports all browsers via BROWSER_TYPE env var
# Runs Playwright browser server for remote connections
#
# Usage:
#   docker run -e BROWSER_TYPE=chromium -p 9222:9222 dharwish/test-run-browser:latest
#   docker run -e BROWSER_TYPE=firefox -p 9222:9222 dharwish/test-run-browser:latest
#   docker run -e BROWSER_TYPE=webkit -p 9222:9222 dharwish/test-run-browser:latest
#   docker run -e BROWSER_TYPE=edge -p 9222:9222 dharwish/test-run-browser:latest

FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Keep ALL browsers (chromium, firefox, webkit already in base image)
# Only clean up docs/locale to save some space
RUN rm -rf /usr/share/doc /usr/share/man /usr/share/locale && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install playwright npm package and MS Edge browser
RUN npm init -y && npm install playwright@1.57.0 --save && \
    npx playwright install msedge

# Create dynamic browser server launcher script
# Reads BROWSER_TYPE env var: chromium (default), firefox, webkit, edge
RUN echo '#!/usr/bin/env node\n\
const { chromium, firefox, webkit } = require("playwright");\n\
\n\
async function main() {\n\
    const port = parseInt(process.env.WS_PORT || "9222");\n\
    const browserType = (process.env.BROWSER_TYPE || "chromium").toLowerCase();\n\
\n\
    console.log(`Starting ${browserType} browser server on port ${port}...`);\n\
\n\
    let server;\n\
\n\
    switch (browserType) {\n\
        case "chromium":\n\
            server = await chromium.launchServer({\n\
                headless: true,\n\
                port: port,\n\
                args: [\n\
                    "--no-sandbox",\n\
                    "--disable-dev-shm-usage",\n\
                    "--disable-gpu"\n\
                ]\n\
            });\n\
            break;\n\
\n\
        case "firefox":\n\
            server = await firefox.launchServer({\n\
                headless: true,\n\
                port: port\n\
            });\n\
            break;\n\
\n\
        case "webkit":\n\
            server = await webkit.launchServer({\n\
                headless: true,\n\
                port: port\n\
            });\n\
            break;\n\
\n\
        case "edge":\n\
            server = await chromium.launchServer({\n\
                headless: true,\n\
                port: port,\n\
                channel: "msedge",\n\
                args: [\n\
                    "--no-sandbox",\n\
                    "--disable-dev-shm-usage",\n\
                    "--disable-gpu"\n\
                ]\n\
            });\n\
            break;\n\
\n\
        default:\n\
            console.error(`Unknown browser type: ${browserType}`);\n\
            console.error("Supported types: chromium, firefox, webkit, edge");\n\
            process.exit(1);\n\
    }\n\
\n\
    console.log(`${browserType} server started: ${server.wsEndpoint()}`);\n\
\n\
    process.on("SIGTERM", async () => {\n\
        console.log("Shutting down...");\n\
        await server.close();\n\
        process.exit(0);\n\
    });\n\
\n\
    process.on("SIGINT", async () => {\n\
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

# Environment defaults
ENV WS_PORT=9222
ENV BROWSER_TYPE=chromium

# Expose WebSocket port
EXPOSE 9222

# Health check - works for all browser types
# Use TCP socket check as WebKit doesn't expose /json endpoint
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s \
    CMD node -e "require('net').createConnection(${WS_PORT}, 'localhost').on('connect', () => process.exit(0)).on('error', () => process.exit(1))" || exit 1

CMD ["node", "/app/start-server.js"]
