/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '200mb',
    },
  },
  images: {
    domains: ['supabase.co'],
  },
}

module.exports = nextConfig
