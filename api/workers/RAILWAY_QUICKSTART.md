# Railway Deployment - 5 Minute Guide

The fastest way to get your Python EEG worker running.

## Step 1: Sign Up (1 minute)

1. Go to [railway.app](https://railway.app)
2. Click "Login" → "Login with GitHub"
3. Authorize Railway

## Step 2: Deploy (2 minutes)

1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose your repository (`squiggly`)
4. Railway will ask for the root directory:
   - Click "Configure"
   - Set **Root Directory**: `api/workers`
   - Click "Deploy"

## Step 3: Add Environment Variables (2 minutes)

While it's building, add environment variables:

1. Click on your service in Railway dashboard
2. Go to **"Variables"** tab
3. Click **"New Variable"** and add these:

```
SUPABASE_URL
Value: https://your-project.supabase.co

SUPABASE_SERVICE_ROLE_KEY
Value: your-service-role-key-from-supabase

WORKER_AUTH_TOKEN (optional but recommended)
Value: make-up-a-random-string-here
```

To get Supabase credentials:
- Go to Supabase Dashboard
- Click Settings → API
- Copy "Project URL" and "service_role" key

4. Click **"Deploy"** to restart with new variables

## Step 4: Get Your URL (1 minute)

1. Go to **"Settings"** tab
2. Scroll to **"Domains"**
3. Click **"Generate Domain"**
4. Copy the URL (e.g., `https://eeg-worker-production.up.railway.app`)

## Step 5: Test It Works

```bash
curl https://your-railway-url.railway.app/health
```

Should return:
```json
{"status": "healthy", "service": "eeg-analysis-worker", "version": "1.0.0"}
```

## Step 6: Configure Vercel

1. Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**

2. Add these:
```
WORKER_MODE = http
WORKER_SERVICE_URL = https://your-railway-url.railway.app
WORKER_AUTH_TOKEN = same-token-you-used-in-railway
```

3. **Redeploy** your Vercel app:
   - Go to Deployments
   - Click "..." on latest deployment
   - Click "Redeploy"

## Step 7: Test End-to-End

1. Open your deployed app
2. Upload an EDF file
3. Label EO/EC segments
4. Click "View Analysis" → "Start Analysis"
5. Wait 20-60 seconds
6. See real results!

## Monitoring

### Check Logs
1. Railway Dashboard → Your Service
2. Click "Deployments" tab
3. Click on latest deployment
4. See live logs

### Check Health
```bash
curl https://your-railway-url.railway.app/health
```

## Troubleshooting

### Build Failed
- Check Railway build logs
- Common issue: Python version
- Solution: Railway auto-detects Python 3.11

### Worker Returns 500
- Check Railway logs for errors
- Verify environment variables are set
- Make sure Supabase credentials are correct

### Analysis Stays "Processing"
- Check Railway logs for the actual error
- Common: Out of memory (upgrade plan)
- Common: Missing dependencies (check build logs)

## Cost

- **Free Tier**: $5 credit (lasts ~1 month with light usage)
- **Starter Plan**: $5/month (1000+ analyses)
- **Pro Plan**: $20/month (unlimited)

## Files Railway Uses

- `requirements.txt` - Python dependencies
- `server.py` - Main Flask server
- `railway.json` - Deployment config (optional)
- `Procfile` - Start command

## What Railway Does Automatically

✅ Detects Python and version
✅ Runs `pip install -r requirements.txt`
✅ Sets PORT environment variable
✅ Starts server with command from Procfile or railway.json
✅ Provides HTTPS URL
✅ Auto-deploys on git push
✅ Health checks
✅ Auto-restart on crash

## Summary

You now have:
- ✅ Python worker running on Railway
- ✅ Vercel calling Railway worker
- ✅ Real EEG analysis working end-to-end

**Total time**: 5-10 minutes
**Cost**: $5/month
**Maintenance**: Push to git, Railway auto-deploys

## Next Commands

```bash
# Test health
curl https://your-url.railway.app/health

# Test analysis (with real data)
curl -X POST https://your-url.railway.app/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"analysis_id": "...","file_path": "...","eo_start": 10, ...}'

# Watch logs
# Go to Railway Dashboard → Logs tab
```

## Done!

Your EEG analysis pipeline is now live. Upload an EDF and try it!
