import { NextResponse } from 'next/server';

export async function GET() {
  const healthStatus = {
    status: 'healthy',
    service: 'squiggly',
    timestamp: new Date().toISOString(),
    mode: process.env.DEPLOYMENT_MODE || 'cloud',
  };

  return NextResponse.json(healthStatus);
}
