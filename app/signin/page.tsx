import AuthEntry from "../auth-entry";
import { getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function SigninPage() {
  return <AuthEntry user={await getChatGPTUser()} mode="signin" />;
}
