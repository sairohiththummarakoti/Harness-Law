import assert from "node:assert/strict";
import test from "node:test";
// @ts-ignore Explicit TypeScript extension for Node's test runner.
import { accountGreeting } from "../lib/account-greeting.ts";

test("account greetings use the provider name and preserve international names", () => {
  assert.equal(accountGreeting("  Sairohith   Thummarakoti  "), "Hi, Sairohith!");
  assert.equal(accountGreeting("María-José García"), "Hi, María-José!");
  assert.equal(accountGreeting("李明"), "Hi, 李明!");
});

test("account greetings do not expose email addresses or greet a generic account label", () => {
  for (const value of [undefined, null, "", "   ", "sairohith@example.com", "User", "Account", "Guest", "Your account"]) {
    assert.equal(accountGreeting(value), "Hi there!");
  }
});
