/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Keep static generation to a single worker: the demo laptop has very little
  // commit headroom while the Spark service is running.
  experimental: {
    cpus: 1,
  },
};

module.exports = nextConfig;
