# Minimal Playwright Test Browser Setup

## Purpose
Run Playwright tests without unnecessary overhead (VNC, window manager, display server, supervisors, etc.)

## What's Removed
- ❌ Xvfb/Xvnc (virtual display) - Playwright handles headless
- ❌ Fluxbox (window manager) - not needed for headless tests
- ❌ TigerVNC/noVNC - no remote viewing for automated tests
- ❌ socat/CORS proxies - unnecessary layers
- ❌ Supervisor - Docker manages processes natively
- ❌ Multi-browser setup (browsers/ dir) - use single container per browser type

## What's Kept
- ✓ Official Playwright image (includes all browsers)
- ✓ Shared memory size for stability
- ✓ CDP port (9222) for optional debugging

## Usage

### Build
```bash
docker-compose -f docker-compose.minimal.yaml build
```

### Run Tests in Container
```bash
docker-compose -f docker-compose.minimal.yaml run playwright \
  npx playwright test --project=chromium
```

### Run Tests Locally (container as dependency)
```bash
# Start container in background
docker-compose -f docker-compose.minimal.yaml up -d

# Run tests against container's CDP endpoint
npx playwright test --project=chromium --reporter=html
```

### Interactive Shell
```bash
docker-compose -f docker-compose.minimal.yaml exec playwright bash
```

## Configuration

### Environment Variables
- `PWDEBUG=0` - Set to `1` for inspector mode
- `DEBUG=pw:api` - Enable verbose logging

### Playwright Config Example
```javascript
// playwright.config.js
export default {
  projects: [
    {
      name: 'chromium',
      use: {
        // Connect to container's CDP if remote
        // connectOptions: {
        //   wsEndpoint: 'ws://localhost:9222/...'
        // }
      }
    }
  ]
};
```

## Size Comparison
- **Current setup**: ~3GB+ (multiple services, VNC, supervision)
- **Minimal setup**: ~500MB (Playwright image only)

## When to Use Each

| Setup | Use Case |
|-------|----------|
| **Current** | Visual debugging, CI/CD with recording, monitoring |
| **Minimal** | Local development, CI tests, fast iteration |

## Quick Start
```bash
cd test-browser
docker-compose -f docker-compose.minimal.yaml up -d
docker-compose -f docker-compose.minimal.yaml run playwright npx playwright test
```
