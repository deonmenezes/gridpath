/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // react-leaflet v5 + @react-leaflet/core are ESM-only and can leave the
  // dynamic(ssr:false) chunk stuck on "Loading map…" in dev. Transpiling them
  // makes the lazy import resolve reliably in both dev and prod.
  transpilePackages: ["react-leaflet", "@react-leaflet/core"],
  webpack: (config) => {
    // Optional deps pulled by wallet SDKs (MetaMask/WalletConnect) that don't
    // exist on web — silence the harmless "module not found" warnings.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // Benign dynamic-require warning from `ox` (viem dep); narrowly ignored.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/ox\// },
    ];
    return config;
  },
};

export default nextConfig;
