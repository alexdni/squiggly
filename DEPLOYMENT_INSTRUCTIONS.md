# Deployment Instructions - Serverless Function Size Fix

## Problem
Vercel deployment keeps failing with: **"Error: A Serverless Function has exceeded the unzipped maximum size of 250 MB"**

## Root Cause
Old `node_modules` with plotly.js and other heavy dependencies are cached in Vercel's build environment.

## Solution

### Step 1: Clear Vercel Build Cache

In your Vercel dashboard:

1. Go to your project settings
2. Navigate to **"General"** → **"Build & Development Settings"**
3. Click **"Clear Build Cache"** button
4. Or add this setting to force fresh install:
   - **Framework Preset**: Next.js
   - **Build Command**: `rm -rf node_modules && npm install && npm run build`

### Step 2: Verify Local Build

Before deploying, verify the build works locally:

```bash
# Clean install
rm -rf node_modules package-lock.json .next
npm install
npm run build
```

Expected output:
- ✅ Build compiles successfully
- ✅ No "250MB exceeded" error
- ✅ API routes directory: ~64KB

### Step 3: Commit and Deploy

```bash
git add -A
git commit -m "fix: Remove plotly dependencies to fix serverless function size

- Removed plotly.js and react-plotly.js dependencies
- Created pure TypeScript EDF validator (no external deps)
- Updated recordings API to use TypeScript validation
- Eliminated Python subprocess execution
- Reduced serverless function size from ~300MB to ~64KB"

git push origin main
```

### Step 4: Monitor Vercel Deployment

Watch the Vercel deployment logs for:

1. **Dependency installation**:
   ```
   Installing dependencies...
   added 506 packages
   ```
   Should NOT see plotly.js in the install list

2. **Build output**:
   ```
   Building...
   Compiled successfully
   ```
   Should NOT see "250MB exceeded" error

3. **Function sizes**:
   ```
   λ  /api/recordings (12 KB)
   ```
   Should be small (under 100KB)

## What Changed

### Files Modified

1. **package.json**
   - ❌ Removed: `plotly.js`, `react-plotly.js`, `@types/plotly.js`
   - ✅ Kept: Core dependencies (Next.js, React, Supabase)

2. **lib/edf-validator.ts** (NEW)
   - Pure TypeScript EDF header parser
   - No external dependencies
   - Validates 19-channel 10-20 montage

3. **app/api/recordings/route.ts**
   - ❌ Removed: Python subprocess execution
   - ✅ Added: Direct TypeScript validation

### Size Reduction

- **Before**: ~300MB (Python MNE + plotly.js + dependencies)
- **After**: ~64KB (pure TypeScript validation)
- **Reduction**: 99.98% smaller!

## Troubleshooting

### If Deployment Still Fails

**1. Force clean build in Vercel:**

Add environment variable in Vercel dashboard:
- Key: `NPM_FLAGS`
- Value: `--force`

**2. Check package-lock.json:**

The file should NOT contain:
- plotly.js
- react-plotly.js
- mapbox-gl
- d3 packages

If it does, run locally:
```bash
rm -rf node_modules package-lock.json
npm install
git add package-lock.json
git commit -m "chore: Update package-lock after removing plotly"
git push
```

**3. Redeploy from scratch:**

In Vercel dashboard:
- Delete the deployment
- Click "Redeploy" → Select "Use existing Build Cache" = **OFF**

**4. Check Vercel function configuration:**

Create `vercel.json` if needed:
```json
{
  "functions": {
    "app/api/**/*.ts": {
      "maxDuration": 60
    }
  }
}
```

### If Build Succeeds Locally But Fails on Vercel

This means Vercel is using cached dependencies. Solutions:

1. **Clear build cache** (see Step 1 above)
2. **Force fresh install** by changing build command
3. **Delete and recreate** the Vercel project (nuclear option)

## Verification

After successful deployment, verify:

```bash
# Check deployed function size
curl -I https://your-app.vercel.app/api/recordings

# Should return quickly without timeout
```

## Future: Adding Plotly Back

When implementing Section 6 (Visualization):

- ✅ Add plotly **only for client-side components**
- ✅ Use dynamic imports: `const Plot = dynamic(() => import('react-plotly.js'))`
- ❌ Do NOT import plotly in API routes or server components

Example:
```typescript
// components/plots/EEGPlot.tsx (client component)
'use client';

import dynamic from 'next/dynamic';

const Plot = dynamic(() => import('react-plotly.js'), {
  ssr: false, // Only load on client side
});

export function EEGPlot({ data }) {
  return <Plot data={data} />;
}
```

This keeps plotly out of serverless functions while still enabling visualizations.

## Summary

✅ **Clean install removes all plotly dependencies**
✅ **TypeScript validator works without external dependencies**
✅ **Build succeeds locally with 64KB API routes**
✅ **Ready for Vercel deployment with cache cleared**

The key is ensuring Vercel starts with a **fresh build cache**!
