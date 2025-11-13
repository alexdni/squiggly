/**
 * Worker Client
 *
 * Utility for calling Python EEG analysis workers
 * Supports multiple deployment options
 */

export interface WorkerConfig {
  mode: 'mock' | 'http' | 'queue';
  workerUrl?: string;
  authToken?: string;
  queueUrl?: string;
}

export interface AnalysisJobData {
  analysisId: string;
  filePath: string;
  eoStart: number;
  eoEnd: number;
  ecStart: number;
  ecEnd: number;
  config?: Record<string, any>;
}

export interface AnalysisJob {
  analysis_id: string;
  file_path: string;
  eo_start: number;
  eo_end: number;
  ec_start: number;
  ec_end: number;
  supabase_url: string;
  supabase_key: string;
  config?: Record<string, any>;
}

/**
 * Get worker configuration from environment
 */
export function getWorkerConfig(): WorkerConfig {
  const mode = (process.env.WORKER_MODE || 'mock') as WorkerConfig['mode'];

  return {
    mode,
    workerUrl: process.env.WORKER_SERVICE_URL,
    authToken: process.env.WORKER_AUTH_TOKEN,
    queueUrl: process.env.QUEUE_URL,
  };
}

/**
 * Submit analysis job to worker
 */
export async function submitAnalysisJob(
  jobData: AnalysisJobData,
  config?: WorkerConfig
): Promise<{ success: boolean; message: string }> {
  const workerConfig = config || getWorkerConfig();

  switch (workerConfig.mode) {
    case 'http':
      return submitHttpJob(jobData, workerConfig);

    case 'queue':
      return submitQueueJob(jobData, workerConfig);

    case 'mock':
    default:
      return {
        success: true,
        message: 'Running in mock mode (development only)',
      };
  }
}

/**
 * Submit job via HTTP webhook to worker service
 */
async function submitHttpJob(
  jobData: AnalysisJobData,
  config: WorkerConfig
): Promise<{ success: boolean; message: string }> {
  if (!config.workerUrl) {
    throw new Error('WORKER_SERVICE_URL not configured');
  }

  const job: AnalysisJob = {
    analysis_id: jobData.analysisId,
    file_path: jobData.filePath,
    eo_start: jobData.eoStart,
    eo_end: jobData.eoEnd,
    ec_start: jobData.ecStart,
    ec_end: jobData.ecEnd,
    supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    config: jobData.config,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.authToken) {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }

  try {
    const response = await fetch(`${config.workerUrl}/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify(job),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Worker service returned ${response.status}: ${error}`);
    }

    return {
      success: true,
      message: 'Analysis job submitted to worker service',
    };
  } catch (error: any) {
    console.error('Failed to submit job to worker:', error);
    throw new Error(`Failed to submit job: ${error.message}`);
  }
}

/**
 * Submit job to queue (Redis, Supabase Queue, etc.)
 */
async function submitQueueJob(
  jobData: AnalysisJobData,
  config: WorkerConfig
): Promise<{ success: boolean; message: string }> {
  // This would integrate with your queue system (Redis, SQS, etc.)
  // For now, returning a placeholder

  if (!config.queueUrl) {
    throw new Error('QUEUE_URL not configured');
  }

  // Example with Redis (would need ioredis package)
  // const Redis = require('ioredis');
  // const redis = new Redis(config.queueUrl);
  // await redis.lpush('analysis_queue', JSON.stringify({
  //   analysis_id: jobData.analysisId,
  //   timestamp: Date.now()
  // }));

  console.log('Queue mode not fully implemented yet');

  return {
    success: true,
    message: 'Analysis job submitted to queue',
  };
}

/**
 * Check if worker is available (health check)
 */
export async function checkWorkerHealth(
  config?: WorkerConfig
): Promise<boolean> {
  const workerConfig = config || getWorkerConfig();

  if (workerConfig.mode === 'mock') {
    return true; // Mock mode always "healthy"
  }

  if (workerConfig.mode === 'http' && workerConfig.workerUrl) {
    try {
      const response = await fetch(`${workerConfig.workerUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Worker health check failed:', error);
      return false;
    }
  }

  return false;
}
