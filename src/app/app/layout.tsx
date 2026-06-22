import { headers } from "next/headers";
import Web3Providers from "./providers";

// Wraps only the /app section in wallet providers (homepage bundle untouched).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = (await headers()).get("cookie");
  return <Web3Providers cookie={cookie}>{children}</Web3Providers>;
}
