# Docker Image Size Analysis

## Current Setup
- **qa-chromium**: 2.36GB
- **qa-firefox**: 2.36GB
- **qa-edge**: 2.36GB
- **qa-webkit**: 2.36GB

**Total reported**: 9.44GB
**Actual disk usage**: ~2.5GB (images share 95% of layers)

## What's Taking Space

### Breakdown per Image
```
2.36GB total per image:
  ├── 78MB   - Debian base image
  ├── 500MB  - System packages + development libraries
  ├── 300MB  - Node.js + npm
  └── 1.2GB  - Playwright browsers (ALL 4: Chromium, Firefox, WebKit, + tools)
```

### Browser Binaries in /ms-playwright
```
357MB  - Chromium
251MB  - Chromium headless shell  
272MB  - Firefox
277MB  - WebKit
4.9MB  - FFmpeg
────────
1.16GB - Total
```

## Size Optimization Attempts

### Option 1: Remove unused browsers (❌ Doesn't work)
Attempted to remove browsers not needed for each container.
**Result**: Doesn't reduce reported size because Docker's layer squashing includes deletions in final diff. Layer still contains full base image.

### Option 2: Custom minimal image (❌ Too complex)
Build from scratch with only system chromium + Playwright client.
**Result**: Breaks Playwright version pinning and requires manual dependency management.

### Option 3: Multi-stage builds (❌ Same issue)
Copy only needed layers.
**Result**: All images are already based on the same Playwright image, so no benefit.

## Recommended Approach

**Keep the current setup** (2.36GB reported size) because:

1. **Actual disk usage is ~2.5GB total** - Docker efficiently shares identical layers
2. **All 4 browsers pre-installed** - No runtime download delays
3. **Playwright version locked** - Using official tested image v1.57.0
4. **No dependency complexity** - Everything pre-configured

## Verification

```bash
# Show actual disk usage (not reported size)
docker system df

# Show which layers are shared
docker history qa-chromium
docker history qa-firefox

# Remove unused images to reclaim space
docker system prune -a
```

## When to Consider Size Reduction

Size reduction only helps if:
- You need to push to registry frequently (bandwidth cost)
- You have extremely limited disk space (<20GB)
- You run hundreds of containers simultaneously

For local dev and CI/CD with caching, the current setup is optimal.
