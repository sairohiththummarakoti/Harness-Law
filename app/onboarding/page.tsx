import { requireAppUser } from "../auth";
import Onboarding from "./setup";
import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { claimIntakeEntry } from "@/lib/intake-entry";
import { BrandLogo } from "@/components/brand-logo";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ edit?: string; welcome?: string }> }) {
  const [user, params] = await Promise.all([requireAppUser(), searchParams]);
  const explicitVisit = params.edit === "1";
  let destination: "intake" | "workspace";
  try {
    if (!env.DB) throw new Error("Account storage is unavailable.");
    destination = await claimIntakeEntry(env.DB, user.userId);
  } catch {
    return <main style={{ minHeight: "100svh", background: "var(--brand-paper)", padding: "clamp(24px, 7vw, 96px)", color: "var(--brand-ink)" }}>
      <BrandLogo /><h1 style={{ marginTop: 48 }}>We couldn’t open your intake.</h1>
      <p>Your saved answers are unchanged. Please try again in a moment.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 24 }}><a className="button primary" href={explicitVisit ? `/onboarding?edit=1${params.welcome === "1" ? "&welcome=1" : ""}` : "/onboarding"}>Try again</a><a className="button secondary" href="/workspace?view=overview">Back to Overview</a></div>
    </main>;
  }
  if (!explicitVisit) {
    if (destination === "workspace") redirect("/workspace");
    // A stable URL keeps refreshes in this first visit; future sign-ins arrive
    // without these parameters and go straight to the saved workspace.
    redirect("/onboarding?edit=1&welcome=1");
  }
  return <Onboarding accountId={user.userId} accountName={user.fullName || user.displayName} initialName={user.fullName ?? ""} initialEmail={user.email} signInPath="/signin" editMode={params.welcome !== "1"} />;
}
