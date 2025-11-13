# Railway Deployment Troubleshooting

## Issue: `$PORT` is not a valid port number

### Cause
Railway was using a config file that doesn't support environment variable expansion.

### Solution ✅
We've removed `railway.json` and updated `Procfile` to use proper shell expansion:

```bash
web: gunicorn server:app --bind 0.0.0.0:${PORT:-8000} --timeout 600 --workers 2 --log-level info
```

### To Fix Your Deployment

1. **Pull latest changes**:
   ```bash
   git pull
   ```

2. **Railway will auto-redeploy** when you push, or:
   - Go to Railway Dashboard
   - Click your service
   - Click "Redeploy"

3. **Verify it worked**:
   ```bash
   curl https://your-railway-url.railway.app/health
   ```

## Alternative: Manual Configuration in Railway Dashboard

If the Procfile still doesn't work, you can override the start command in Railway:

1. Go to Railway Dashboard
2. Click your service
3. Go to "Settings" tab
4. Scroll to "Deploy"
5. Under "Custom Start Command", enter:
   ```
   gunicorn server:app --bind 0.0.0.0:8000 --timeout 600 --workers 2 --log-level info
   ```
   (Note: Using hardcoded port 8000 works because Railway auto-maps to public URL)

6. Click "Deploy" to restart

## How Railway Works

Railway automatically:
1. Detects Python via `requirements.txt`
2. Runs `pip install -r requirements.txt`
3. Looks for start command in this order:
   - Custom start command (in dashboard)
   - `Procfile` (web process)
   - Auto-detected (for Flask: `python server.py`)
4. Sets PORT environment variable
5. Maps internal port to public HTTPS URL

## Environment Variables to Set

Make sure these are set in Railway dashboard:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WORKER_AUTH_TOKEN=your-secret-token (optional)
```

Railway automatically sets:
- `PORT` (don't set this manually)
- `RAILWAY_ENVIRONMENT`
- `RAILWAY_PROJECT_ID`
- etc.

## Common Issues

### Build Fails
**Symptoms**: Deployment fails during build
**Check**: Build logs in Railway dashboard
**Common causes**:
- Missing dependencies in requirements.txt
- Python version mismatch
- Out of memory during install

**Solution**:
- Check build logs for specific error
- Ensure requirements.txt is in `api/workers/` directory

---

### Deploy Succeeds but Health Check Fails
**Symptoms**: Build succeeds but service shows "unhealthy"
**Check**: Runtime logs in Railway dashboard

**Common causes**:
- Missing environment variables
- Server not binding to 0.0.0.0
- Wrong port

**Solution**:
```bash
# Check logs
# Railway Dashboard → Logs

# Test locally first
cd api/workers
pip install -r requirements.txt
gunicorn server:app --bind 0.0.0.0:8000
# Then visit http://localhost:8000/health
```

---

### 502 Bad Gateway
**Symptoms**: URL returns 502 error
**Cause**: Service isn't running

**Solution**:
1. Check Railway logs for startup errors
2. Verify PORT is being used correctly
3. Make sure server.py is binding to `0.0.0.0` not `localhost`

---

### Out of Memory
**Symptoms**: Service crashes or restarts frequently
**Cause**: MNE-Python uses ~500MB-1GB during processing

**Solution**:
- Upgrade to higher Railway plan (more RAM)
- Or reduce ICA components in preprocessing config
- Or process smaller chunks of data

---

## Testing Locally Before Deploying

Always test locally first:

```bash
cd api/workers

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-key"
export PORT=8000

# Run server
gunicorn server:app --bind 0.0.0.0:8000

# Test in another terminal
curl http://localhost:8000/health
```

If this works, Railway should work too!

## Checking Railway Logs

**Real-time logs**:
1. Railway Dashboard
2. Click your service
3. Click "Deployments" tab
4. Click on latest deployment
5. View logs in real-time

**Download logs**:
- Click "Download logs" button in deployment view

## Success Checklist

- [ ] Build completes without errors
- [ ] Service starts (check logs for "Running on http://0.0.0.0:...")
- [ ] Health endpoint returns 200: `/health`
- [ ] Environment variables are set
- [ ] Can call `/analyze` endpoint

## Still Having Issues?

1. **Check Railway Status**: https://status.railway.app
2. **Check our deployment guide**: `RAILWAY_QUICKSTART.md`
3. **Try alternative platforms**: See `VERCEL_DEPLOYMENT.md` for Render, Fly.io options

## Quick Commands Reference

```bash
# Test health endpoint
curl https://your-url.railway.app/health

# Test with auth
curl https://your-url.railway.app/health \
  -H "Authorization: Bearer your-token"

# Test analyze endpoint (dummy data)
curl -X POST https://your-url.railway.app/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"analysis_id":"test",...}'
```

## Working Configuration

After the fix, your deployment should show in Railway logs:

```
[INFO] Starting gunicorn 21.2.0
[INFO] Listening at: http://0.0.0.0:8000
[INFO] Using worker: sync
[INFO] Booting worker with pid: 123
```

And health check should return:
```json
{
  "status": "healthy",
  "service": "eeg-analysis-worker",
  "version": "1.0.0"
}
```

## Contact

If you're still stuck:
1. Check Railway community Discord
2. Review Railway documentation
3. Try deploying to Render (simpler) - see `VERCEL_DEPLOYMENT.md`
