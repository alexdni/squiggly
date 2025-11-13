# Deployment Checklist ✅

Your app is ready to deploy! Follow this checklist.

## ✅ What's Ready

- ✅ Next.js build passes (no errors)
- ✅ Python workers ready (Flask server)
- ✅ Dual-mode API (mock/production)
- ✅ Vercel-compatible (under 250MB)
- ✅ Documentation complete

## 🚀 Deployment Steps

### Step 1: Deploy to Vercel (5 minutes)

Your Next.js app is already on Vercel, but let's make sure everything is set:

1. **Push your latest changes**:
   ```bash
   git add .
   git commit -m "Add Python EEG workers and serverless deployment"
   git push
   ```

2. **Vercel will auto-deploy** (or manually deploy from dashboard)

3. **Build should succeed** ✅ (we just tested it locally)

### Step 2: Deploy Python Worker to Railway (10 minutes)

1. **Go to [railway.app](https://railway.app)** and login with GitHub

2. **Create New Project**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Set **Root Directory**: `api/workers`

3. **Add Environment Variables** (in Railway dashboard):
   ```
   SUPABASE_URL = https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = your-service-role-key
   WORKER_AUTH_TOKEN = make-a-random-secure-token
   PORT = 8000
   ```

   Get Supabase credentials:
   - Supabase Dashboard → Settings → API
   - Copy "Project URL" and "service_role" secret key

4. **Deploy** (Railway auto-detects Python and deploys)

5. **Generate Domain**:
   - Settings tab → Domains section
   - Click "Generate Domain"
   - Copy URL (e.g., `https://eeg-worker-production.up.railway.app`)

6. **Test Health**:
   ```bash
   curl https://your-railway-url.railway.app/health
   ```
   Should return: `{"status": "healthy", ...}`

### Step 3: Configure Vercel Environment Variables (2 minutes)

1. **Go to Vercel Dashboard** → Your Project → Settings → Environment Variables

2. **Add these variables**:
   ```
   WORKER_MODE = http
   WORKER_SERVICE_URL = https://your-railway-url.railway.app
   WORKER_AUTH_TOKEN = same-token-from-railway
   ```

3. **Redeploy**:
   - Go to Deployments tab
   - Click "..." on latest deployment
   - Click "Redeploy"
   - Or push a new commit

### Step 4: Test End-to-End (5 minutes)

1. **Open your deployed app** (your-app.vercel.app)

2. **Sign in with Google**

3. **Create a project**

4. **Upload an EDF file** (19-channel 10-20 montage)

5. **Label EO/EC segments**

6. **Click "View Analysis" → "Start Analysis"**

7. **Wait 20-60 seconds**

8. **See real analysis results!** 🎉

## 📋 Environment Variables Summary

### Vercel
```bash
# Supabase (already exists)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Worker Configuration (ADD THESE)
WORKER_MODE=http
WORKER_SERVICE_URL=https://your-railway-url.railway.app
WORKER_AUTH_TOKEN=your-secret-token
```

### Railway
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WORKER_AUTH_TOKEN=same-as-vercel
PORT=8000
```

## 🔍 Verification

### Check Vercel Build
```bash
# Locally
npm run build

# Should show: ✓ Compiled successfully
```

### Check Railway Deploy
```bash
# Test health endpoint
curl https://your-railway-url.railway.app/health

# Should return
{
  "status": "healthy",
  "service": "eeg-analysis-worker",
  "version": "1.0.0"
}
```

### Check Integration
```bash
# Check Vercel logs
vercel logs

# Check Railway logs
# Go to Railway Dashboard → Logs tab
```

## 🐛 Troubleshooting

### Vercel Build Fails
**Error**: TypeScript errors in workers
**Solution**: Already fixed - we excluded `api/workers` in tsconfig.json

---

### Railway Build Fails
**Common**: Missing dependencies
**Solution**: Check Railway build logs, ensure requirements.txt is correct

---

### Worker Returns 500
**Check Railway logs** for actual error
**Common causes**:
- Missing environment variables
- Wrong Supabase credentials
- Out of memory (upgrade plan)

---

### Analysis Stays "Processing"
**Check**:
1. Railway logs for errors
2. Worker health endpoint
3. Vercel environment variables are set

**Solution**: Most likely worker crashed, check Railway logs

---

## 💰 Cost Estimate

| Service | Cost | Free Tier |
|---------|------|-----------|
| Vercel | $0-20/mo | Yes (100GB bandwidth) |
| Railway | $5-20/mo | $5 credit/month |
| Supabase | $0-25/mo | Yes (500MB storage) |
| **Total** | **$5-45/mo** | **~$5-10/mo realistically** |

## 📊 Monitoring

### Railway
- Dashboard → Logs (real-time)
- Dashboard → Metrics (CPU, memory)

### Vercel
- Dashboard → Logs
- Dashboard → Analytics

### Supabase
- Dashboard → Storage (check usage)
- Dashboard → Database (check row counts)

## 🎯 Next Steps After Deployment

1. **Test with real EDF files** (upload 3-5 different files)
2. **Monitor logs** for first few analyses
3. **Check costs** after 1 week
4. **Add error tracking** (Sentry - optional)
5. **Scale if needed** (upgrade Railway plan)

## 📚 Documentation Reference

- **Quick Setup**: [RAILWAY_QUICKSTART.md](api/workers/RAILWAY_QUICKSTART.md)
- **Full Guide**: [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md)
- **Alternative Platforms**: [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) (Render, Fly.io, Heroku)

## ✅ Success Criteria

- [ ] Vercel build passes
- [ ] Railway deployed and healthy
- [ ] Environment variables configured
- [ ] Health endpoint returns 200
- [ ] Can upload EDF file
- [ ] Can label segments
- [ ] Analysis completes successfully
- [ ] Real results appear in UI

## 🎉 You're Done!

Your production-ready EEG analysis platform is now live!

**Architecture**:
```
User → Vercel (Next.js) → Railway (Python+MNE) → Supabase (DB+Storage)
```

**What works**:
- ✅ File upload to Supabase
- ✅ EDF validation
- ✅ EO/EC labeling
- ✅ Real MNE-Python processing
- ✅ Feature extraction (band power, coherence, asymmetry, etc.)
- ✅ Results visualization
- ✅ Multi-user support
- ✅ Project management

**Enjoy!** 🚀
