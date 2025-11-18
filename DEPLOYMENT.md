# Deployment Guide

This guide covers deploying the Squiggly EEG Analysis platform with separate services for the Next.js frontend and Python worker backend.

## Architecture Overview

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Vercel    │────────▶│   Railway    │────────▶│  Supabase   │
│  Next.js    │  HTTP   │Python Worker │  API    │  Database   │
│  Frontend   │         │   Service    │         │  + Storage  │
└─────────────┘         └──────────────┘         └─────────────┘
```

- **Vercel**: Hosts the Next.js frontend and API routes (60s timeout limit)
- **Railway**: Hosts the Python worker service (no timeout limit for long-running analysis)
- **Supabase**: Database, authentication, and file storage

## 1. Deploy Python Worker to Railway

### Option A: Deploy from GitHub

1. Go to [Railway](https://railway.app)
2. Create a new project from your GitHub repository
3. Railway will auto-detect the configuration from `nixpacks.toml` or `Procfile`

### Option B: Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### Environment Variables (Railway)

Set these in your Railway project settings:

```bash
PORT=8000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WORKER_AUTH_TOKEN=generate-a-secure-random-token
```

### Generate Secure Token

```bash
# On Linux/Mac
openssl rand -base64 32

# Or use Python
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Verify Deployment

Once deployed, Railway will give you a URL like:
```
https://your-app-name.railway.app
```

Test the health endpoint:
```bash
curl https://your-app-name.railway.app/health
```

You should see:
```json
{
  "status": "healthy",
  "service": "EEG Analysis Worker",
  "timestamp": "..."
}
```

## 2. Configure Vercel Environment Variables

In your Vercel project settings, add:

```bash
# Worker Configuration
WORKER_MODE=http
WORKER_SERVICE_URL=https://your-app-name.railway.app
WORKER_AUTH_TOKEN=same-token-as-railway

# Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Important**: The `WORKER_AUTH_TOKEN` must match on both Railway and Vercel.

## 3. Redeploy Vercel

After setting the environment variables:

```bash
# Via Vercel CLI
vercel --prod

# Or trigger a redeploy in the Vercel dashboard
```

## 4. Test End-to-End

1. Upload an EEG file to your application
2. Click "Run Analysis"
3. The Next.js API route will:
   - Set analysis status to "processing"
   - Submit job to Railway worker via HTTP
   - Return immediately (< 1 second)
4. Railway worker will:
   - Download EDF file from Supabase
   - Run analysis (30-90 seconds)
   - Generate visualizations
   - Upload results back to Supabase
5. Frontend will poll the analysis status and show results when complete

## Monitoring

### Railway Logs

View logs in Railway dashboard or via CLI:
```bash
railway logs
```

### Vercel Logs

View logs in Vercel dashboard or via CLI:
```bash
vercel logs
```

### Check Worker Health

```bash
# Manual health check
curl https://your-railway-app.railway.app/health

# From your Next.js app
curl https://your-vercel-app.vercel.app/api/worker/health
```

## Scaling

### Railway

- Default: 512 MB RAM, 1 vCPU
- Increase resources in Railway settings if needed
- Consider adding multiple workers for parallel processing

### Vercel

- Hobby: 1 concurrent build, 100 GB bandwidth
- Pro: Unlimited builds, 1 TB bandwidth
- No code changes needed for scaling

## Troubleshooting

### "Worker service returned 401"
- Check that `WORKER_AUTH_TOKEN` matches on both Railway and Vercel
- Verify token doesn't have trailing spaces

### "Worker service not responding"
- Check Railway logs for errors
- Verify `WORKER_SERVICE_URL` is correct
- Test health endpoint directly

### "Analysis stuck in 'processing'"
- Check Railway logs for Python errors
- Verify Supabase credentials are correct
- Check file permissions in Supabase Storage

### "Import errors in Railway"
- Verify all dependencies in `requirements.txt`
- Check build logs for missing system packages
- May need to add packages to `nixpacks.toml`

## Cost Estimates

### Railway (Monthly)

- Hobby Plan: $5/month (500 hours)
- Pro Plan: $20/month + usage
- Typical usage: ~$10-15/month for moderate traffic

### Vercel (Monthly)

- Hobby: Free (1 user, non-commercial)
- Pro: $20/month (unlimited builds)

### Supabase (Monthly)

- Free: 500 MB database, 1 GB storage
- Pro: $25/month (8 GB database, 100 GB storage)
- Typical usage: ~$25/month for production

**Total**: ~$35-60/month for production deployment

## Local Development

For local development, keep using mock mode:

```bash
# .env.local
WORKER_MODE=mock
```

Or run the Python worker locally:

```bash
# Terminal 1: Start worker
cd api/workers
python server.py

# Terminal 2: Start Next.js
npm run dev

# .env.local
WORKER_MODE=http
WORKER_SERVICE_URL=http://localhost:8000
```

## Security Notes

1. **Never commit** `.env` files with real credentials
2. Use different `WORKER_AUTH_TOKEN` for dev/staging/prod
3. Enable Supabase RLS (Row Level Security) policies
4. Restrict Supabase Storage bucket permissions
5. Use HTTPS only in production (Railway provides this automatically)

## Support

If you encounter issues:

1. Check Railway logs first
2. Check Vercel logs second
3. Verify all environment variables
4. Test worker health endpoint
5. Check Supabase Storage permissions
