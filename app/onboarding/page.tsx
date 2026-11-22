import { chatGPTSignInPath, requireChatGPTUser } from "../chatgpt-auth";
import Onboarding from "./setup";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireChatGPTUser("/onboarding");
  return <Onboarding initialName={user.fullName ?? ""} signInPath={chatGPTSignInPath("/onboarding")} />;
}
