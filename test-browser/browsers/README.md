# Browser Containers for Playwright Tests

Minimal Docker containers for running Playwright tests with different browser engines.

## Available Browsers

- **chromium/** - Chromium browser engine
- **firefox/** - Firefox browser engine  
- **edge/** - Microsoft Edge browser engine
- **webkit/** - WebKit browser engine

## Quick Start

### Build a specific browser container
```bash
# Build chromium container
docker build -t qa-chromium browsers/chromium/

# Build firefox container
docker build -t qa-firefox browsers/firefox/

# Build all browsers
for browser in chromium firefox edge webkit; do
  docker build -t qa-$browser browsers/$browser/
done
```

### Run Playwright tests in container
```bash
# Interactive shell
docker run -it --rm -v $(pwd):/workspace qa-chromium bash

# Run specific test file
docker run --rm -v $(pwd):/workspace qa-chromium \
  npx playwright test tests/example.spec.ts --project=chromium

# Run all tests
docker run --rm -v $(pwd):/workspace qa-chromium \
  npx playwright test
```

### Docker Compose

Each browser can be run as a service:

```yaml
services:
  chromium-tests:
    build:
      context: .
      dockerfile: browsers/chromium/Dockerfile
    container_name: qa-chromium
    volumes:
      - ./:/workspace
    working_dir: /workspace
    shm_size: '2gb'
    command: npx playwright test --project=chromium
```

## Configuration

### Environment Variables
- `PWDEBUG=0` - Set to `1` for interactive debug mode
- `DEBUG=pw:api` - Enable verbose Playwright logging

### Playwright Config
Tests use the project's `playwright.config.ts` configuration. Each container runs all browsers defined in the config.

## What's Included

All containers use the official Microsoft Playwright image which includes:
- Node.js and npm
- All Playwright dependencies
- Chromium, Firefox, WebKit, and Edge browser binaries
- Supporting libraries (FFMPEG, codecs, etc.)

## Health Check

Containers verify Playwright availability:
```bash
npx playwright --version
```

## Size Reference

All containers are based on the same Playwright image (~500MB). The difference in final image size is negligible since all browsers are pre-installed in the base image.

## Debugging

### View browser console output
```bash
docker logs -f <container-name>
```

### Run with debug mode
```bash
docker run -it -e PWDEBUG=1 -v $(pwd):/workspace qa-chromium \
  npx playwright test --headed
```

### Interactive shell access
```bash
docker run -it -v $(pwd):/workspace qa-chromium bash

# Inside container
npx playwright test
```

## Troubleshooting

### Tests fail with "No space left on device"
Increase shared memory size:
```bash
docker run --shm-size=4gb ...
```

### Playwright version mismatch
Ensure your local Playwright version matches v1.57.0:
```bash
npm install -D playwright@1.57.0
```

### Port already in use
Each container can bind different ports if running multiple:
```bash
docker run -p 9223:9222 ... qa-chromium
docker run -p 9224:9222 ... qa-firefox
```
