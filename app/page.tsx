import type { Metadata } from "next";
import Landing from "./landing";
import { getAppUser } from "./auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Harness Law — A clearer path for your talent",
  description: "Bring your experience, evidence, and working draft together. A thoughtful workspace for EB-1A preparation.",
};

export default async function Home() {
  const user = await getAppUser();
  return <Landing signedIn={!!user} />;
}
