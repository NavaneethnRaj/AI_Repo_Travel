import { expect, it } from "vitest";
import { readConfig } from "../../apps/api/src/config.js";

it("uses the bundled Gemini model default without exposing an ambient key in mock mode", () => {
  const config = readConfig({ GEMINI_API_KEY: "ambient-test-value" });
  expect(config.GEMINI_MODEL).toBe("gemini-3.6-flash");
  expect(config.PROVIDER).toBe("mock");
  expect(config).not.toHaveProperty("GEMINI_API_KEY");
});

it("keeps an explicit model and the key only in Gemini mode", () => {
  const config = readConfig({ PROVIDER: "gemini", GEMINI_API_KEY: "test-only", GEMINI_MODEL: "fixture-model" });
  expect(config.GEMINI_MODEL).toBe("fixture-model");
  expect(config).toMatchObject({ GEMINI_API_KEY: "test-only" });
});

it("requires a key only when Gemini is selected", () => {
  expect(() => readConfig({ PROVIDER: "gemini" })).toThrow("GEMINI_API_KEY is required");
});
