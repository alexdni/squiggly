# Deployment Guide for Vercel + Serverless Python Workers

Since you're on Vercel, we use a **hybrid architecture**:
- **Vercel**: Hosts your Next.js app (stays under 250MB limit)
- **External Python Service**: Handles heavy EEG processing (Railway/Render/etc.)

## Architecture

```
User Browser
     ↓
Vercel (Next.js)
     ↓
API Route (/api/analyses/[id]/process)
     ↓
Railway/Render (Python Worker - Flask server)
     ↓
Supabase (Database + Storage)
```

## Quick Setup (15 minutes)

### Step 1: Deploy Python Worker to Railway

**Why Railway?** Dead simple, auto-deploys from git, $5/month starter.

1. **Go to [railway.app](https://railway.app)** and sign up with GitHub

2. **Create New Project**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `squiggly` repository
   - Set root directory: `api/workers`

3. **Add Environment Variables** in Railway dashboard:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   WORKER_AUTH_TOKEN=your-secret-token-here (optional)
   PORT=8000
   ```

4. **Deploy**:
   - Railway auto-detects Python and installs dependencies
   - Takes ~5-10 minutes first time
   - You'll get a URL like: `https://eeg-worker-production.up.railway.app`

5. **Test Health Endpoint**:
   ```bash
   curl https://your-railway-url.railway.app/health
   ```
   Should return: `{"status": "healthy", ...}`

### Step 2: Configure Vercel Environment Variables

Add to your Vercel project settings:

1. Go to **Vercel Dashboard** → Your Project → Settings → Environment Variables

2. Add these variables:
   ```
   WORKER_MODE=http
   WORKER_SERVICE_URL=https://your-railway-url.railway.app
   WORKER_AUTH_TOKEN=your-secret-token-here (must match Railway)
   ```

3. **Redeploy** your Vercel app (push to git or click "Redeploy")

### Step 3: Test End-to-End

1. Upload an EDF file via your UI
2. Label EO/EC segments
3. Click "View Analysis" → "Start Analysis"
4. Wait 20-60 seconds
5. See real results!

## Alternative Platforms

### Option 1: Railway (Recommended - $5/month)

✅ **Pros**: Dead simple, auto-deploy, generous free tier
❌ **Cons**: Newer platform

**Setup**: Follow Quick Setup above

---

### Option 2: Render ($7/month)

✅ **Pros**: Established, reliable, great free tier
❌ **Cons**: Slower cold starts

**Setup**:
1. Create account at [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect GitHub repo
4. Set:
   - **Root Directory**: `api/workers`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn server:app --bind 0.0.0.0:$PORT --timeout 600`
   - **Add environment variables** (same as Railway)
5. Deploy (takes ~10 minutes)
6. Copy service URL
7. Add to Vercel environment variables

---

### Option 3: Fly.io (Pay-as-you-go)

✅ **Pros**: Fast, global CDN, generous free tier
❌ **Cons**: CLI-based deployment

**Setup**:
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
cd api/workers
fly launch --name eeg-worker

# Set secrets
fly secrets set SUPABASE_URL="https://..."
fly secrets set SUPABASE_SERVICE_ROLE_KEY="..."

# Deploy
fly deploy

# Get URL
fly status
```

---

### Option 4: Heroku (Classic - $7/month)

✅ **Pros**: Battle-tested, simple
❌ **Cons**: More expensive, slower

**Setup**:
```bash
# Install Heroku CLI
brew install heroku/brew/heroku  # or download from heroku.com

# Login
heroku login

# Create app
cd api/workers
heroku create eeg-worker

# Set environment
heroku config:set SUPABASE_URL="https://..."
heroku config:set SUPABASE_SERVICE_ROLE_KEY="..."

# Deploy
git subtree push --prefix api/workers heroku main

# Get URL
heroku open
```

---

## API Integration

Your Next.js API route is already configured! It will automatically:

1. Check `WORKER_MODE` environment variable
2. If `mock`: Generate fake results (development)
3. If `http`: Call your Python worker (production)

**Current file**: `app/api/analyses/[id]/process/route.ts`

## Testing

### Test Python Worker Directly

```bash
curl -X POST https://your-worker-url.com/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "analysis_id": "test-uuid",
    "file_path": "recordings/uuid/file.edf",
    "eo_start": 10.0,
    "eo_end": 70.0,
    "ec_start": 80.0,
    "ec_end": 140.0,
    "supabase_url": "https://your-project.supabase.co",
    "supabase_key": "your-service-role-key"
  }'
```

### Test via Vercel

1. Open your deployed app
2. Upload EDF → Label segments → Start Analysis
3. Check browser network tab for API calls
4. Should see call to `/api/analyses/[id]/process`
5. Should return `{"success": true, "mode": "http"}`

### Check Logs

**Railway**: Dashboard → Deployments → Logs
**Render**: Dashboard → Service → Logs tab
**Fly.io**: `fly logs`
**Heroku**: `heroku logs --tail`

## Cost Breakdown (1000 analyses/month)

| Platform | Cost | Free Tier | Notes |
|----------|------|-----------|-------|
| Railway | $5-20/month | $5 credit | Recommended for starting |
| Render | $7-25/month | 750 hrs/month free | Great free tier |
| Fly.io | $5-15/month | 2,340 hrs/month free | Pay-as-you-go |
| Heroku | $7-25/month | None (deprecated) | Classic option |
| Vercel | $0-20/month | 100GB bandwidth free | Just for Next.js |
| Supabase | $0-25/month | 500MB storage free | Database + storage |

**Total**: $5-45/month for production

## Environment Variables Reference

### Vercel (.env.local for local dev)
```bash
# Worker Configuration
WORKER_MODE=http                                    # 'mock' or 'http'
WORKER_SERVICE_URL=https://your-worker.railway.app # Python worker URL
WORKER_AUTH_TOKEN=your-secret-token                # Optional security

# Supabase (already exists)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Python Worker (Railway/Render/etc.)
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Security (optional but recommended)
WORKER_AUTH_TOKEN=your-secret-token

# Server (usually auto-set)
PORT=8000
```

## Monitoring

### Health Checks

All platforms support automatic health checks:
- **Endpoint**: `/health`
- **Expected**: `200 OK` with JSON `{"status": "healthy"}`

### Error Tracking

Add Sentry for error monitoring:

```python
# In server.py
import sentry_sdk
sentry_sdk.init(dsn="your-sentry-dsn")
```

Add to requirements.txt:
```
sentry-sdk[flask]==1.40.0
```

### Performance Monitoring

Railway/Render provide built-in metrics:
- CPU usage
- Memory usage
- Request count
- Response times

## Scaling

### Vertical Scaling (More Power)

**Railway**: Upgrade plan for more resources
**Render**: Change instance type (Standard → Pro)
**Fly.io**: Adjust machine size in `fly.toml`

### Horizontal Scaling (More Workers)

**Railway**: Not directly supported (use Render instead)
**Render**: Set "Instances" in dashboard
**Fly.io**: `fly scale count 3`

### Auto-Scaling

Most platforms auto-scale based on traffic.

**Recommended settings**:
- Min instances: 1
- Max instances: 3-5
- Scale-up threshold: 80% CPU
- Scale-down threshold: 20% CPU

## Troubleshooting

### "Worker service unreachable"

**Check**:
```bash
curl https://your-worker-url.com/health
```

**Solutions**:
- Verify URL in Vercel environment variables
- Check worker logs for startup errors
- Ensure PORT is correctly set

---

### "Analysis stays in 'processing' forever"

**Check worker logs**:
- Railway: Dashboard → Logs
- Render: Service → Logs

**Common causes**:
- Worker crashed (check logs)
- Timeout (increase to 600s)
- Out of memory (upgrade plan)

---

### "Import error: No module named 'mne'"

**Solution**: Requirements not installed

Railway/Render: Should auto-install, check build logs
Manual: `pip install -r requirements.txt`

---

### "502 Bad Gateway"

**Causes**:
- Worker not running
- Wrong PORT configuration
- Startup timeout

**Solutions**:
- Check health endpoint
- Verify Procfile/start command
- Check platform logs

---

### "Out of memory"

**Solutions**:
- Upgrade to higher plan (4GB+ RAM)
- Reduce ICA components (15 → 10)
- Process smaller epochs

---

## Security Best Practices

### ✅ Do
- Use `WORKER_AUTH_TOKEN` for authentication
- Use HTTPS (all platforms provide this)
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret
- Use environment variables, never commit secrets
- Enable rate limiting on platform level

### ❌ Don't
- Expose Python worker URL publicly without auth
- Use `anon` key instead of `service_role` key
- Commit `.env` files to git
- Disable HTTPS

## Next Steps

1. ✅ Deploy Python worker to Railway/Render
2. ✅ Add environment variables to Vercel
3. ✅ Test health endpoint
4. ✅ Run end-to-end test
5. Monitor logs for first few analyses
6. Add error tracking (Sentry)
7. Set up monitoring alerts
8. Document any custom configs

## Support

### Platform Documentation
- **Railway**: https://docs.railway.app
- **Render**: https://render.com/docs
- **Fly.io**: https://fly.io/docs
- **Vercel**: https://vercel.com/docs

### Common Issues
See troubleshooting section above or check platform status pages.

## Summary

You now have:
- ✅ Next.js on Vercel (under 250MB)
- ✅ Python worker on Railway/Render (no size limits)
- ✅ Seamless integration between them
- ✅ Real EEG processing with MNE-Python
- ✅ Production-ready architecture

**Deployment time**: 15-30 minutes
**Monthly cost**: $5-45 for production
**Maintenance**: Minimal (auto-deploys from git)
