/**
 * Centralized Configuration
 *
 * Provides validated configuration for the application based on deployment mode
 */

export type DeploymentMode = 'cloud' | 'docker';

export interface AppConfig {
  deploymentMode: DeploymentMode;
  database: {
    mode: 'supabase' | 'postgres';
    url?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    supabaseServiceRoleKey?: string;
  };
  storage: {
    mode: 'supabase' | 'local';
    path?: string;
    buckets: {
      recordings: string;
      visuals: string;
      exports: string;
    };
  };
  auth: {
    mode: 'supabase' | 'local';
    adminEmail?: string;
  };
  worker: {
    mode: 'mock' | 'http' | 'queue';
    serviceUrl?: string;
    authToken?: string;
    timeoutMs: number;
  };
  features: {
    ica: boolean;
    ruleEngine: boolean;
    export: boolean;
  };
  app: {
    url: string;
    maxUploadSize: number;
  };
}

function getDeploymentMode(): DeploymentMode {
  const mode = process.env.DEPLOYMENT_MODE;
  if (mode === 'docker') {
    return 'docker';
  }
  return 'cloud';
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

export function getConfig(): AppConfig {
  const deploymentMode = getDeploymentMode();

  return {
    deploymentMode,
    database: {
      mode: (process.env.DATABASE_MODE as 'supabase' | 'postgres') || 'supabase',
      url: process.env.DATABASE_URL,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    storage: {
      mode: (process.env.STORAGE_MODE as 'supabase' | 'local') || 'supabase',
      path: process.env.STORAGE_PATH || '/data/storage',
      buckets: {
        recordings: process.env.STORAGE_BUCKET_RECORDINGS || 'recordings',
        visuals: process.env.STORAGE_BUCKET_VISUALS || 'visuals',
        exports: process.env.STORAGE_BUCKET_EXPORTS || 'exports',
      },
    },
    auth: {
      mode: (process.env.AUTH_MODE as 'supabase' | 'local') || 'supabase',
      adminEmail: process.env.ADMIN_EMAIL,
    },
    worker: {
      mode: (process.env.WORKER_MODE as 'mock' | 'http' | 'queue') || 'mock',
      serviceUrl: process.env.WORKER_SERVICE_URL,
      authToken: process.env.WORKER_AUTH_TOKEN,
      timeoutMs: parseNumber(process.env.ANALYSIS_TIMEOUT_MS, 180000),
    },
    features: {
      ica: parseBoolean(process.env.ENABLE_ICA, true),
      ruleEngine: parseBoolean(process.env.ENABLE_RULE_ENGINE, true),
      export: parseBoolean(process.env.ENABLE_EXPORT, true),
    },
    app: {
      url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      maxUploadSize: parseNumber(process.env.MAX_UPLOAD_SIZE, 52428800),
    },
  };
}

export function validateDockerConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const config = getConfig();

  if (config.deploymentMode !== 'docker') {
    return { valid: true, errors: [] };
  }

  // In Docker mode, validate required configuration
  if (config.auth.mode === 'local' && !process.env.ADMIN_EMAIL) {
    errors.push('ADMIN_EMAIL is required in local auth mode');
  }

  if (config.auth.mode === 'local' && !process.env.ADMIN_PASSWORD) {
    errors.push('ADMIN_PASSWORD is required in local auth mode');
  }

  if (config.database.mode === 'postgres' && !config.database.url) {
    errors.push('DATABASE_URL is required in postgres database mode');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isDockerMode(): boolean {
  return getDeploymentMode() === 'docker';
}

export function isCloudMode(): boolean {
  return getDeploymentMode() === 'cloud';
}
