# EEG Worker Deployment Guide

Complete guide for deploying the Python EEG analysis workers.

## Quick Start

### Local Development

1. **Setup environment**:
   ```bash
   cd api/workers
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure**:
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

3. **Test locally**:
   ```bash
   python analyze_eeg.py --file test.edf \
     --eo-start 10 --eo-end 70 \
     --ec-start 80 --ec-end 140 \
     --output results.json
   ```

### Docker Deployment

```bash
# Build
docker build -t eeg-worker .

# Run
docker run -v $(pwd)/data:/data eeg-worker \
  python analyze_eeg.py --file /data/test.edf \
  --eo-start 10 --eo-end 70 --ec-start 80 --ec-end 140
```

## Production Deployment Options

### Option 1: Docker on VPS (Recommended for Getting Started)

**Best for**: Small-medium scale, predictable workload

#### Setup on DigitalOcean/AWS EC2/Google Compute

1. **Create VM**:
   - 2-4 CPUs
   - 4-8GB RAM
   - 20GB storage

2. **Install Docker**:
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   sudo usermod -aG docker $USER
   ```

3. **Deploy**:
   ```bash
   # Clone repo
   git clone your-repo
   cd squiggly/api/workers

   # Setup environment
   nano .env  # Add Supabase credentials

   # Build and run
   docker-compose up -d
   ```

4. **Setup worker daemon** (create `worker_daemon.py`):
   ```python
   #!/usr/bin/env python3
   """Worker daemon that polls Supabase for pending analyses"""

   import os
   import time
   import logging
   from supabase import create_client
   from analyze_eeg import analyze_eeg_file, upload_results_to_supabase, mark_analysis_failed
   from dotenv import load_dotenv

   load_dotenv()

   logger = logging.getLogger(__name__)

   def main():
       supabase_url = os.getenv('SUPABASE_URL')
       supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

       supabase = create_client(supabase_url, supabase_key)

       logger.info("Worker daemon started")

       while True:
           try:
               # Poll for pending analyses
               response = supabase.table('analyses')\
                   .select('*, recording:recordings(*)')\
                   .eq('status', 'pending')\
                   .limit(1)\
                   .execute()

               if response.data:
                   analysis = response.data[0]
                   logger.info(f"Processing analysis: {analysis['id']}")

                   # Mark as processing
                   supabase.table('analyses').update({
                       'status': 'processing',
                       'started_at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z')
                   }).eq('id', analysis['id']).execute()

                   # Run analysis
                   # ... (implementation)

               time.sleep(5)  # Poll every 5 seconds

           except Exception as e:
               logger.error(f"Worker error: {e}")
               time.sleep(10)

   if __name__ == '__main__':
       main()
   ```

5. **Run worker**:
   ```bash
   docker-compose up -d
   ```

**Pros**: Simple, full control, $10-40/month
**Cons**: Manual scaling, single point of failure

---

### Option 2: Google Cloud Run

**Best for**: Variable workload, pay-per-use

#### Setup

1. **Install gcloud CLI**:
   ```bash
   curl https://sdk.cloud.google.com | bash
   gcloud init
   ```

2. **Build and deploy**:
   ```bash
   cd api/workers

   # Build
   gcloud builds submit --tag gcr.io/PROJECT_ID/eeg-worker

   # Deploy
   gcloud run deploy eeg-worker \
     --image gcr.io/PROJECT_ID/eeg-worker \
     --platform managed \
     --region us-central1 \
     --memory 2Gi \
     --timeout 600s \
     --set-env-vars SUPABASE_URL=$SUPABASE_URL \
     --set-env-vars SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_KEY \
     --no-allow-unauthenticated
   ```

3. **Get service URL**:
   ```bash
   gcloud run services describe eeg-worker --region us-central1 --format 'value(status.url)'
   ```

4. **Update Next.js API** to call Cloud Run:
   ```typescript
   // app/api/analyses/[id]/process/route.ts
   const response = await fetch(process.env.CLOUD_RUN_URL + '/analyze', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${token}` // Use service account token
     },
     body: JSON.stringify({
       analysis_id: params.id
     })
   });
   ```

**Pros**: Auto-scaling, pay-per-use, managed
**Cons**: Cold starts (~10-30s), requires GCP account

---

### Option 3: AWS Lambda with Container Support

**Best for**: AWS ecosystem, serverless

#### Setup

1. **Create ECR repository**:
   ```bash
   aws ecr create-repository --repository-name eeg-worker
   ```

2. **Build and push**:
   ```bash
   # Login to ECR
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

   # Build for Lambda
   docker build --platform linux/amd64 -t eeg-worker .

   # Tag and push
   docker tag eeg-worker:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/eeg-worker:latest
   docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/eeg-worker:latest
   ```

3. **Create Lambda function**:
   ```bash
   aws lambda create-function \
     --function-name eeg-worker \
     --package-type Image \
     --code ImageUri=ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/eeg-worker:latest \
     --role arn:aws:iam::ACCOUNT_ID:role/lambda-execution-role \
     --memory-size 3008 \
     --timeout 600
   ```

4. **Create Lambda handler**:
   Update `analyze_eeg.py` to include Lambda handler:
   ```python
   def lambda_handler(event, context):
       """AWS Lambda handler"""
       analysis_id = event['analysis_id']

       # Run analysis
       # ...

       return {
           'statusCode': 200,
           'body': json.dumps({'success': True})
       }
   ```

**Pros**: Serverless, AWS integration, 10GB container support
**Cons**: Complex setup, cold starts

---

### Option 4: Railway.app (Easiest for Beginners)

**Best for**: Rapid deployment, minimal config

#### Setup

1. **Sign up**: https://railway.app

2. **Create new project** from GitHub repo

3. **Add environment variables**:
   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

4. **Deploy**: Automatic from git push

5. **Get service URL** from Railway dashboard

**Pros**: Dead simple, auto-deploys from git, $5-20/month
**Cons**: Less control, newer platform

---

## Integration with Next.js API

### Current State (Mock Data)

```typescript
// app/api/analyses/[id]/process/route.ts
await new Promise((resolve) => setTimeout(resolve, 2000));
const mockResults = generateMockResults(analysis.recording);
```

### Updated Implementation (Real Workers)

#### Option A: HTTP Webhook (Recommended)

```typescript
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    // Update status to processing
    await (supabase as any)
      .from('analyses')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    // Call worker service
    const workerUrl = process.env.WORKER_SERVICE_URL;
    const response = await fetch(`${workerUrl}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WORKER_AUTH_TOKEN}` // Optional
      },
      body: JSON.stringify({
        analysis_id: params.id,
        supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY
      })
    });

    if (!response.ok) {
      throw new Error('Worker request failed');
    }

    return NextResponse.json({
      success: true,
      message: 'Analysis started',
      analysis_id: params.id,
    });
  } catch (error) {
    // Handle error
  }
}
```

#### Option B: Queue-Based (Best for High Volume)

1. **Install Redis or use Supabase Queue**:
   ```bash
   npm install ioredis
   ```

2. **Enqueue job**:
   ```typescript
   import Redis from 'ioredis';

   const redis = new Redis(process.env.REDIS_URL);

   await redis.lpush('analysis_queue', JSON.stringify({
     analysis_id: params.id,
     timestamp: Date.now()
   }));
   ```

3. **Worker polls queue**:
   ```python
   import redis
   import json

   r = redis.Redis.from_url(os.getenv('REDIS_URL'))

   while True:
       # Block until job available
       job = r.brpop('analysis_queue', timeout=5)

       if job:
           data = json.loads(job[1])
           # Process analysis
           # ...
   ```

**Pros**: Reliable, handles bursts, retry logic
**Cons**: Additional infrastructure (Redis)

---

## Environment Variables

Add to `.env.local` in Next.js project:

```bash
# Worker Service
WORKER_SERVICE_URL=https://your-worker-service.com
WORKER_AUTH_TOKEN=your-secret-token  # Optional

# Supabase (already exists)
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Add to worker `.env`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
LOG_LEVEL=INFO
```

---

## Testing

### Test worker endpoint:

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "analysis_id": "test-uuid",
    "supabase_url": "...",
    "supabase_key": "..."
  }'
```

### Test full pipeline:

1. Upload EDF file via UI
2. Label EO/EC segments
3. Click "View Analysis" → "Start Analysis"
4. Monitor logs:
   ```bash
   # Docker
   docker logs -f eeg-worker

   # VPS
   tail -f /var/log/eeg-worker.log

   # Cloud Run
   gcloud run logs tail eeg-worker
   ```

---

## Monitoring & Alerts

### Health Check Endpoint

Add to `analyze_eeg.py`:

```python
from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'timestamp': time.time()})

@app.route('/analyze', methods=['POST'])
def analyze():
    # Main analysis endpoint
    pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
```

### Error Tracking (Sentry)

```bash
pip install sentry-sdk
```

```python
import sentry_sdk

sentry_sdk.init(
    dsn="your-sentry-dsn",
    traces_sample_rate=1.0
)
```

---

## Scaling

### Horizontal Scaling

**Docker Compose**:
```yaml
services:
  eeg-worker:
    deploy:
      replicas: 3
```

**Cloud Run**: Auto-scales based on traffic

**Kubernetes**:
```yaml
spec:
  replicas: 3
  autoscaling:
    minReplicas: 2
    maxReplicas: 10
```

### Performance Optimization

- Use faster machines (more CPUs)
- Reduce ICA components (15 → 10)
- Shorter epochs (2s → 1s)
- Cache frequently accessed data

---

## Cost Estimates

### VPS (DigitalOcean)
- 4GB RAM, 2 CPUs: $24/month
- Can process ~100-200 recordings/day

### Cloud Run (Google)
- $0.00002400/second (2GB memory)
- ~$0.01-0.02 per analysis (45s)
- $10-20/month for 1000 analyses

### AWS Lambda
- $0.0000166667/GB-second
- Similar to Cloud Run

### Railway.app
- $5/month starter
- $20/month for production

---

## Troubleshooting

### Worker not processing:
```bash
# Check logs
docker logs eeg-worker

# Check Supabase connection
python -c "from supabase import create_client; client = create_client('URL', 'KEY'); print(client.table('analyses').select('*').limit(1).execute())"
```

### Out of memory:
- Increase Docker memory limit
- Reduce epoch count
- Process in batches

### Slow processing:
- Check CPU usage
- Reduce ICA components
- Use faster VM

---

## Next Steps

1. Choose deployment option (recommend VPS or Railway for starting)
2. Deploy worker service
3. Update Next.js API route
4. Test end-to-end
5. Add monitoring
6. Scale as needed
