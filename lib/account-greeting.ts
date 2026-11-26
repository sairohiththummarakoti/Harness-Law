/** A welcome for the signed-in person, never a name inferred from their email. */
export function accountGreeting(name: string | null | undefined): string {
  const normalized = name?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized || normalized.includes("@") || /^(?:account|user|guest|new user|your account)$/i.test(normalized)) {
    return "Hi there!";
  }
  return `Hi, ${normalized.split(" ")[0]}!`;
}
