import { requireAppUser } from "../auth";
import Onboarding from "./setup";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireAppUser();
  return <Onboarding accountId={user.userId} initialName={user.fullName ?? ""} initialEmail={user.email} signInPath="/signin" />;
}
