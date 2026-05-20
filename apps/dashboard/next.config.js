/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@sokar/shared'],
  experimental: {
    esmExternals: 'loose',
  },
};

module.exports = nextConfig;
