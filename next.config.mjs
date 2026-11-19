/** @type {import('next').NextConfig} */
const nextConfig = {
  // A self-contained server in .next/standalone, used by the Docker image.
  output: 'standalone',
  // Pin the project root (a package.json higher up in the home folder would otherwise confuse it).
  turbopack: { root: import.meta.dirname },
  reactStrictMode: true,
  devIndicators: false,
  // Types are checked with `npm run typecheck` (TypeScript 7), not during `next build`.
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [
      {
        source: '/mediapipe/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default nextConfig
