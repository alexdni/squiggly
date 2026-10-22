// The OAuth consent and connected-apps pages carry Approve/Revoke controls: never let another site
// frame them (clickjacking).
const NO_FRAMING = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      { source: '/oauth/consent', headers: NO_FRAMING },
      { source: '/settings/connected-apps', headers: NO_FRAMING },
    ]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '200mb',
    },
    // The analysis engine is a private package: load it from node_modules at runtime instead of
    // bundling it, so it can never be pulled into client chunks (checked by
    // scripts/check-client-bundle.mjs after build).
    serverComponentsExternalPackages: ['@divergentneuro/biofeedback-core'],
    // The worker-thread bundle and the engine are loaded by path, so file tracing cannot see them.
    outputFileTracingIncludes: {
      '/api/analyses/[id]/process': [
        './.eeg-worker/**/*',
        './node_modules/@divergentneuro/biofeedback-core/**/*',
      ],
      '/api/projects/[id]/theraq-analysis': [
        './.eeg-worker/**/*',
        './node_modules/@divergentneuro/biofeedback-core/**/*',
      ],
    },
  },
  productionBrowserSourceMaps: false,
  images: {
    domains: ['supabase.co'],
  },
}

module.exports = nextConfig
