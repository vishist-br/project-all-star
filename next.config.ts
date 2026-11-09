import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp (and its LGPL libvips binaries) is replaced by vendor/sharp-stub, so the
  // built-in image optimizer is off. Serve pre-sized images (e.g. tenant logos).
  images: { unoptimized: true },
};

export default nextConfig;
