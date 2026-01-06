# Dokku Deployment Plan for QA Base Application

## Overview
Deploy the QA Base application to server `143.110.181.55` using Dokku with:
- **Frontend**: `app.mvp-blr.x.qola.top` (React/Vite + Nginx)
- **Backend**: `api.mvp-blr.x.qola.top` (FastAPI)
- **Let's Encrypt SSL** for both domains
- **Persistent storage** for database, screenshots, and videos

## Architecture

```
                    *.mvp-blr.x.qola.top (Wildcard DNS)
                              |
                        Dokku (nginx)
                       /            \
        app.mvp-blr.x.qola.top    api.mvp-blr.x.qola.top
                |                          |
           [frontend]                 [backend]
            (nginx)                   (FastAPI)
                                          |
                                     [celery] ←→ [redis]
```

## Services to Deploy
| Service | Dokku App Name | Port | Domain |
|---------|---------------|------|--------|
| Frontend | qa-frontend | 80 | app.mvp-blr.x.qola.top |
| Backend | qa-backend | 8000 | api.mvp-blr.x.qola.top |
| Celery | qa-celery | - | (internal) |
| Redis | - | 6379 | (plugin) |

---

## Deployment Steps

### Phase 1: Install Dokku on Server

```bash
# SSH into server
ssh root@143.110.181.55

# Install Dokku (latest stable)
wget -NP . https://dokku.com/bootstrap.sh
sudo DOKKU_TAG=v0.34.4 bash bootstrap.sh

# Set global domain
dokku domains:set-global mvp-blr.x.qola.top
```

### Phase 2: Install Required Plugins

```bash
# Install Let's Encrypt plugin for SSL
sudo dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git

# Install Redis plugin
sudo dokku plugin:install https://github.com/dokku/dokku-redis.git redis

# Configure Let's Encrypt email
dokku letsencrypt:set --global email main.smarttester@gmail.com
```

### Phase 3: Create Redis Service

```bash
# Create Redis instance
dokku redis:create qa-redis
```

### Phase 4: Create Backend App

```bash
# Create app
dokku apps:create qa-backend

# Set domain
dokku domains:set qa-backend api.mvp-blr.x.qola.top

# Link Redis
dokku redis:link qa-redis qa-backend

# Create persistent storage
mkdir -p /var/lib/dokku/data/storage/qa-backend/{data,screenshots,videos}
dokku storage:mount qa-backend /var/lib/dokku/data/storage/qa-backend/data:/app/data
dokku storage:mount qa-backend /var/lib/dokku/data/storage/qa-backend/screenshots:/app/data/screenshots
dokku storage:mount qa-backend /var/lib/dokku/data/storage/qa-backend/videos:/app/data/videos

# Mount Docker socket for browser orchestration
dokku storage:mount qa-backend /var/run/docker.sock:/var/run/docker.sock

# Get Redis URL (includes auto-generated password from dokku redis:link)
REDIS_URL=$(dokku config:get qa-backend REDIS_URL)

# Set environment variables
dokku config:set qa-backend \
  DATABASE_URL=sqlite:///./data/app.db \
  JWT_SECRET=$(openssl rand -hex 32) \
  JWT_ALGORITHM=HS256 \
  JWT_EXPIRY_HOURS=24 \
  ADMIN_EMAIL=admin@xitester.com \
  ADMIN_PASSWORD=CHANGE_THIS_PASSWORD \
  ADMIN_NAME="Admin User" \
  DEFAULT_ORG_NAME=XiTester \
  DEFAULT_ORG_DESCRIPTION="Default organization" \
  CELERY_BROKER_URL="${REDIS_URL}/0" \
  CELERY_RESULT_BACKEND="${REDIS_URL}/0" \
  GEMINI_API_KEY=placeholder_add_later \
  BROWSER_USE_API_KEY=placeholder_add_later

# Set port mapping
dokku ports:set qa-backend http:80:8000

# Set Dockerfile path
dokku builder:set qa-backend build-dir backend
```

### Phase 5: Create Celery Worker App

```bash
# Create app
dokku apps:create qa-celery

# Link Redis
dokku redis:link qa-redis qa-celery

# Create persistent storage (shared with backend)
dokku storage:mount qa-celery /var/lib/dokku/data/storage/qa-backend/data:/app/data
dokku storage:mount qa-celery /var/lib/dokku/data/storage/qa-backend/screenshots:/app/data/screenshots
dokku storage:mount qa-celery /var/lib/dokku/data/storage/qa-backend/videos:/app/data/videos
dokku storage:mount qa-celery /var/run/docker.sock:/var/run/docker.sock

# Get JWT_SECRET from backend to use same value
JWT_SECRET=$(dokku config:get qa-backend JWT_SECRET)

# Get Redis URL (includes auto-generated password from dokku redis:link)
REDIS_URL=$(dokku config:get qa-celery REDIS_URL)

# Set environment variables (same as backend)
dokku config:set qa-celery \
  DATABASE_URL=sqlite:///./data/app.db \
  JWT_SECRET=$JWT_SECRET \
  JWT_ALGORITHM=HS256 \
  ADMIN_EMAIL=admin@xitester.com \
  ADMIN_PASSWORD=CHANGE_THIS_PASSWORD \
  ADMIN_NAME="Admin User" \
  DEFAULT_ORG_NAME=XiTester \
  DEFAULT_ORG_DESCRIPTION="Default organization" \
  CELERY_BROKER_URL="${REDIS_URL}/0" \
  CELERY_RESULT_BACKEND="${REDIS_URL}/0" \
  GEMINI_API_KEY=placeholder_add_later \
  BROWSER_USE_API_KEY=placeholder_add_later

# Set custom start command for celery worker
dokku config:set qa-celery DOKKU_DOCKERFILE_START_CMD="celery -A app.celery_app worker --loglevel=info"

# Disable checks (celery doesn't expose HTTP)
dokku checks:disable qa-celery
```

### Phase 6: Create Frontend App

```bash
# Create app
dokku apps:create qa-frontend

# Set domain
dokku domains:set qa-frontend app.mvp-blr.x.qola.top

# Set API URL environment variable
dokku config:set qa-frontend VITE_API_URL=https://api.mvp-blr.x.qola.top

# Set port mapping
dokku ports:set qa-frontend http:80:80

# Set Dockerfile path
dokku builder:set qa-frontend build-dir frontend
```

### Phase 7: Deploy Applications (Monorepo Strategy)

Since this is a monorepo, we'll use `dokku git:from-archive` with tar files:

```bash
# On the LOCAL machine (where the code is), create deployment tarballs

# Backend tarball (needs root context for imports)
cd /home/dharwish/work/SmartTester/MVP2/qa-base
tar -czf /tmp/backend.tar.gz backend/

# Frontend tarball
cd /home/dharwish/work/SmartTester/MVP2/qa-base/frontend
tar -czf /tmp/frontend.tar.gz .

# Copy to server
scp /tmp/backend.tar.gz /tmp/frontend.tar.gz root@143.110.181.55:/tmp/
```

**On the server:**
```bash
# Deploy backend
cd /tmp && mkdir -p backend-deploy && tar -xzf backend.tar.gz -C backend-deploy
cd backend-deploy
dokku git:from-archive qa-backend /tmp/backend.tar.gz

# Deploy frontend
dokku git:from-archive qa-frontend /tmp/frontend.tar.gz
```

**Alternative: Build images directly on server**
```bash
# Clone repo on server
cd /tmp
git clone https://github.com/YOUR_REPO/qa-base.git
cd qa-base

# Build and tag backend image
docker build -t dokku/qa-backend:latest -f backend/Dockerfile .
dokku tags:deploy qa-backend latest

# Build and tag frontend image
docker build -t dokku/qa-frontend:latest -f frontend/Dockerfile frontend/
dokku tags:deploy qa-frontend latest

# For celery (uses same image as backend with different command)
docker tag dokku/qa-backend:latest dokku/qa-celery:latest
dokku tags:deploy qa-celery latest
```

### Phase 8: Enable SSL with Let's Encrypt

```bash
# Enable SSL for backend
dokku letsencrypt:enable qa-backend

# Enable SSL for frontend
dokku letsencrypt:enable qa-frontend

# Set up auto-renewal cron
dokku letsencrypt:cron-job --add
```

### Phase 9: Create Procfile for Celery Worker

Create `/backend/Procfile.celery`:
```
worker: celery -A app.celery_app worker --loglevel=info
```

Or use dokku run command:
```bash
dokku run qa-celery celery -A app.celery_app worker --loglevel=info
```

---

## Files to Create/Modify

### 1. Create `backend/Procfile` (if not exists)
```
web: alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 2. Create `backend/app.json` for Dokku
```json
{
  "name": "qa-backend",
  "scripts": {
    "dokku": {
      "predeploy": "alembic upgrade head"
    }
  }
}
```

### 3. Create `celery/Dockerfile` for Celery worker
```dockerfile
FROM qa-backend:latest
CMD ["celery", "-A", "app.celery_app", "worker", "--loglevel=info"]
```

---

## Post-Deployment Verification

```bash
# Check app status
dokku ps:report qa-backend
dokku ps:report qa-frontend

# Check logs
dokku logs qa-backend
dokku logs qa-frontend
dokku logs qa-celery

# Verify SSL
curl -I https://app.mvp-blr.x.qola.top
curl -I https://api.mvp-blr.x.qola.top

# Check Redis connection
dokku redis:info qa-redis
```

---

## Environment Variables Summary

### Backend (qa-backend)
| Variable | Value |
|----------|-------|
| DATABASE_URL | sqlite:///./data/app.db |
| JWT_SECRET | (auto-generated at deploy time) |
| JWT_ALGORITHM | HS256 |
| JWT_EXPIRY_HOURS | 24 |
| ADMIN_EMAIL | admin@xitester.com |
| ADMIN_PASSWORD | (set secure password) |
| CELERY_BROKER_URL | (uses REDIS_URL from dokku redis:link - includes password) |
| CELERY_RESULT_BACKEND | (uses REDIS_URL from dokku redis:link - includes password) |
| GEMINI_API_KEY | (add later) |
| BROWSER_USE_API_KEY | (add later) |

### Frontend (qa-frontend)
| Variable | Value |
|----------|-------|
| VITE_API_URL | https://api.mvp-blr.x.qola.top |

---

## Network Configuration

Create browser network for container orchestration:
```bash
docker network create qa-browser-network
```

### Connect Dokku containers to browser network (Required for browser automation)

Browser containers are spawned on `qa-browser-network`, but Dokku apps run on the `bridge` network by default. To enable communication:

```bash
# Connect containers manually (one-time after deployment)
docker network connect qa-browser-network qa-backend.web.1
docker network connect qa-browser-network qa-celery.web.1
```

### Post-Deploy Hooks (Automatic reconnection after each deploy)

Create hooks to automatically reconnect containers after redeployment:

```bash
# Backend post-deploy hook
mkdir -p /var/lib/dokku/data/scheduler-docker-local/qa-backend
cat > /var/lib/dokku/data/scheduler-docker-local/qa-backend/post-deploy << 'EOF'
#!/bin/bash
docker network connect qa-browser-network qa-backend.web.1 2>/dev/null || true
EOF
chmod +x /var/lib/dokku/data/scheduler-docker-local/qa-backend/post-deploy

# Celery post-deploy hook
mkdir -p /var/lib/dokku/data/scheduler-docker-local/qa-celery
cat > /var/lib/dokku/data/scheduler-docker-local/qa-celery/post-deploy << 'EOF'
#!/bin/bash
docker network connect qa-browser-network qa-celery.web.1 2>/dev/null || true
EOF
chmod +x /var/lib/dokku/data/scheduler-docker-local/qa-celery/post-deploy
```

### Verify network connectivity
```bash
docker network inspect qa-browser-network --format '{{range .Containers}}{{.Name}} {{end}}'
```

---

## Rollback Commands

```bash
# Rollback to previous release
dokku releases:rollback qa-backend
dokku releases:rollback qa-frontend

# View release history
dokku releases qa-backend
```

---

# Deployment Summary (Completed: January 6, 2026)

## Deployment Status: ✅ SUCCESS

All services have been successfully deployed to server `143.110.181.55`.

### Access URLs

| Service | URL | Status |
|---------|-----|--------|
| **Frontend** |  ✅ Running |
| **Backend API** | https://api.mvp-blr.x.qola.top | ✅ Running |
| **Celery Worker** | Internal service | ✅ Running |
| **Redis** | Internal service | ✅ Running |

### SSL Certificates
- ✅ Let's Encrypt SSL enabled for `app.mvp-blr.x.qola.top`
- ✅ Let's Encrypt SSL enabled for `api.mvp-blr.x.qola.top`
- ✅ Auto-renewal cron job configured
- ✅ HSTS enabled for both domains

### Login Credentials
- **Email**: `admin@xitester.com`
- **Password**: *(set during deployment - change immediately)*

### Installed Components
- **Dokku Version**: 0.37.4
- **Redis Version**: 8.4.0
- **Let's Encrypt Plugin**: Installed
- **Redis Plugin**: Installed

---

## Next Steps - Add API Keys

To enable full functionality, add your API keys:

```bash
ssh root@143.110.181.55

# Add Gemini API key
dokku config:set qa-backend GEMINI_API_KEY=your_actual_key
dokku config:set qa-celery GEMINI_API_KEY=your_actual_key

# Add Browser Use API key
dokku config:set qa-backend BROWSER_USE_API_KEY=your_actual_key
dokku config:set qa-celery BROWSER_USE_API_KEY=your_actual_key
```

---

## Useful Dokku Commands

### View Logs
```bash
dokku logs qa-backend
dokku logs qa-frontend
dokku logs qa-celery
dokku logs qa-backend --tail 100
```

### Restart Services
```bash
dokku ps:restart qa-backend
dokku ps:restart qa-frontend
dokku ps:restart qa-celery
```

### Check Status
```bash
dokku ps:report
dokku apps:list
dokku redis:info qa-redis
```

### View SSL Status
```bash
dokku letsencrypt:list
dokku letsencrypt:revoke qa-backend  # If needed
```

### Update Configuration
```bash
# View current config
dokku config:show qa-backend

# Set new config value
dokku config:set qa-backend KEY=value

# Unset config value
dokku config:unset qa-backend KEY
```

### Database Backup
```bash
# Backup SQLite database
docker cp $(docker ps -qf "name=qa-backend.web"):/app/data/app.db /var/lib/dokku/data/storage/qa-backend/backup_$(date +%Y%m%d).db
```

### Redeploy
```bash
# Copy new code to server and rebuild
cd /tmp/qa-base
docker build -t dokku/qa-backend:latest -f backend/Dockerfile .
dokku git:from-image qa-backend dokku/qa-backend:latest

docker build -t dokku/qa-frontend:latest --build-arg VITE_API_URL=https://api.mvp-blr.x.qola.top -f frontend/Dockerfile frontend/
dokku git:from-image qa-frontend dokku/qa-frontend:latest
```

---

## Server Security (Already Configured)

### Fail2ban
- ✅ Installed and running
- ✅ SSH jail enabled (max 3 retries, 1 hour ban)
- ✅ Whitelisted IPs:
  - `2003:f8:b702:3919:45f9:b181:1fc6:c2f6`
  - `93.224.209.195`
  - `111.92.68.54`

### Check Fail2ban Status
```bash
fail2ban-client status sshd
fail2ban-client get sshd ignoreip
```
