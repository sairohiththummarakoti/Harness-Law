import AuthEntry from "../auth-entry";
import { getAppUser, googleSignInEnabled } from "../auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  return <AuthEntry user={await getAppUser()} googleEnabled={googleSignInEnabled()} />;
}
