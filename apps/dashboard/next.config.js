/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@callyx/shared'],
  experimental: {
    esmExternals: 'loose',
  },
};

module.exports = nextConfig;
