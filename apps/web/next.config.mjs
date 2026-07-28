/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The realtime server runs on a separate process/port (ticket 0009) and is
  // fronted by the reverse proxy in compose.prod.yml. The editor connects to
  // it via a relative WS path that the proxy maps to apps/realtime.
  transpilePackages: [
    "@opennote/config",
    "@opennote/shared",
    "@opennote/db",
    "@opennote/auth",
    "@opennote/storage",
    "@opennote/ui",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
