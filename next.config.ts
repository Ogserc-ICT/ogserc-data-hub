import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "bcryptjs"],
  // Uploads are capped at 4 MB in the action (Vercel's request limit is 4.5 MB); this leaves room for the other form fields.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
};

export default nextConfig;
