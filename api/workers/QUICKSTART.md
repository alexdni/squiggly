# Python EEG Workers - Quick Start Guide

Get the Python EEG analysis workers up and running in 5 minutes.

## What You Have Now

Your system currently runs in **mock mode** - the UI works, but analysis results are fake. This guide shows you how to enable real EEG processing.

## Option 1: Test Locally (Easiest - 5 minutes)

Perfect for testing the Python pipeline without deployment.

### 1. Install Dependencies

```bash
cd api/workers
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

This will take ~5 minutes to install MNE and dependencies.

### 2. Get a Sample EDF File

You need an EDF file with 19-channel 10-20 montage. If you don't have one:
- Upload a file through your UI first
- Or download sample EEG from: https://www.physionet.org/

### 3. Run Analysis

```bash
python analyze_eeg.py \
  --file /path/to/your/recording.edf \
  --eo-start 10.0 \
  --eo-end 70.0 \
  --ec-start 80.0 \
  --ec-end 140.0 \
  --output results.json
```

Replace times with actual EO/EC segments from your file.

### 4. Check Results

```bash
cat results.json | head -50
```

You should see QC metrics, band power, coherence, etc.

## Option 2: Deploy to Railway (Production - 15 minutes)

Railway is the easiest way to deploy for production use.

### 1. Sign Up

- Go to https://railway.app
- Sign up with GitHub

### 2. Create New Project

- Click "New Project"
- Choose "Deploy from GitHub repo"
- Select your repository
- Choose the `api/workers` folder as root

### 3. Add Environment Variables

In Railway dashboard, add:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Get these from your Supabase dashboard → Settings → API.

### 4. Deploy

Railway will automatically:
- Build Docker container
- Deploy to cloud
- Provide a public URL

### 5. Get Service URL

Copy the URL from Railway dashboard (e.g., `https://eeg-worker-production.up.railway.app`)

### 6. Configure Next.js

Add to your `.env.local`:
```bash
WORKER_MODE=http
WORKER_SERVICE_URL=https://your-railway-url.railway.app
```

### 7. Test

- Restart Next.js dev server: `npm run dev`
- Upload an EDF file
- Label EO/EC segments
- Click "View Analysis" → "Start Analysis"
- Watch it process for real!

## Option 3: Docker Locally (Testing - 10 minutes)

Run the worker in Docker on your machine.

### 1. Build Container

```bash
cd api/workers
docker build -t eeg-worker .
```

### 2. Run Container

```bash
docker run -v $(pwd)/data:/data eeg-worker \
  python analyze_eeg.py \
  --file /data/your-file.edf \
  --eo-start 10 --eo-end 70 \
  --ec-start 80 --ec-end 140 \
  --output /data/results.json
```

### 3. Check Results

```bash
cat data/results.json
```

## Option 4: Deploy to VPS (Advanced - 30 minutes)

For full control and lower costs long-term.

### 1. Create VPS

- DigitalOcean, AWS EC2, or Google Compute Engine
- 4GB RAM, 2 CPUs minimum
- Ubuntu 22.04 LTS

### 2. Install Docker

```bash
ssh your-vps
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

### 3. Clone and Deploy

```bash
git clone your-repo
cd squiggly/api/workers

# Create .env file
nano .env
# Add:
# SUPABASE_URL=...
# SUPABASE_SERVICE_ROLE_KEY=...

# Build and run
docker-compose up -d
```

### 4. Setup Worker Daemon

Create `worker_daemon.py` (see DEPLOYMENT.md for full code).

### 5. Configure Firewall

```bash
sudo ufw allow 8000/tcp
```

### 6. Get VPS IP

Your worker will be available at `http://your-vps-ip:8000`

### 7. Configure Next.js

```bash
WORKER_MODE=http
WORKER_SERVICE_URL=http://your-vps-ip:8000
```

## Verifying It Works

### Check Worker Health

```bash
# Railway/VPS
curl https://your-worker-url.com/health

# Should return: {"status": "healthy", "timestamp": ...}
```

### Check Logs

```bash
# Railway: Use web dashboard
# Docker: docker logs -f eeg-worker
# VPS: journalctl -u eeg-worker -f
```

### End-to-End Test

1. Upload EDF file via UI
2. Label EO/EC segments
3. Click "View Analysis"
4. Click "Start Analysis"
5. Wait 20-60 seconds
6. Should see: "Processing EEG Data..."
7. Then: Real analysis results!

## Troubleshooting

### "Module 'mne' not found"
**Fix**: Install dependencies
```bash
pip install -r requirements.txt
```

### "Worker service unreachable"
**Fix**: Check URL is correct
```bash
curl $WORKER_SERVICE_URL/health
```

### "Analysis stays in 'processing' forever"
**Fix**: Check worker logs for errors
```bash
# Railway: Web dashboard
# Docker: docker logs eeg-worker
```

### "Out of memory"
**Fix**: Increase memory limit
```yaml
# docker-compose.yml
services:
  eeg-worker:
    mem_limit: 2g
```

### "Analysis failed: Channel not found"
**Fix**: Check EDF has 19-channel 10-20 montage
```bash
python validate_montage_lite.py your-file.edf
```

## What to Expect

### First Real Analysis
- Processing time: 20-60 seconds
- Memory usage: 500MB-1GB
- Output: ~50KB JSON file

### Results Include
✅ Quality control report
✅ Band power (8 bands × 19 channels × 2 conditions)
✅ Band ratios (theta/beta, alpha/theta)
✅ Hemispheric asymmetry (3 indices)
✅ Coherence analysis (7 pairs × 8 bands)
✅ Risk pattern detection (5 patterns)

## Next Steps

After getting it working:

1. **Production deployment**: Move from Railway to VPS for cost savings
2. **Monitoring**: Add Sentry for error tracking
3. **Scaling**: Deploy multiple workers
4. **Features**: Add PDF reports, topoplots
5. **Optimization**: Tune preprocessing parameters

## Getting Help

### Check Documentation
- `README.md` - Complete guide
- `DEPLOYMENT.md` - All deployment options
- `IMPLEMENTATION_SUMMARY.md` - Technical details

### Common Commands

```bash
# Check Python version
python3 --version  # Should be 3.11+

# Check Docker
docker --version

# Test preprocessing only
python preprocess.py file.edf 10 70 80 140

# Test with custom config
python analyze_eeg.py --file test.edf \
  --eo-start 10 --eo-end 70 \
  --ec-start 80 --ec-end 140 \
  --config custom_config.json
```

### Custom Config Example

```json
{
  "preprocessing": {
    "resample_freq": 250,
    "filter_low": 0.5,
    "filter_high": 45.0,
    "notch_freq": 60.0,
    "epoch_duration": 2.0,
    "ica_n_components": 15
  }
}
```

## Cost Summary

### Development (Free)
- Local testing: $0
- Supabase free tier: $0

### Production (per month, ~1000 analyses)
- Railway: $5-20
- VPS: $24 (DigitalOcean)
- Cloud Run: $10-20
- Supabase: $0-25

**Recommended**: Railway for starting, VPS for scale

## Architecture Flow

```
User uploads EDF
      ↓
Next.js UI
      ↓
API Route detects WORKER_MODE
      ↓
      ├─→ mock: Generate fake results (dev)
      └─→ http: Call Python worker (prod)
             ↓
        Worker downloads from Supabase
             ↓
        MNE preprocessing (20-40s)
             ↓
        Feature extraction (5-15s)
             ↓
        Upload results to Supabase
             ↓
        User sees real analysis!
```

## Success Checklist

- [ ] Python dependencies installed
- [ ] Can run analyze_eeg.py locally
- [ ] Worker deployed (Railway/VPS/Docker)
- [ ] WORKER_MODE=http in .env.local
- [ ] WORKER_SERVICE_URL configured
- [ ] Health check returns 200 OK
- [ ] End-to-end test successful
- [ ] Real results visible in UI

## You're Ready!

You now have a production-ready EEG analysis pipeline using MNE-Python.

**Current mode**: Check with `echo $WORKER_MODE` (should be 'http')

**Test it**: Upload an EDF and start an analysis!

**Questions?**: Check DEPLOYMENT.md for detailed guides.
