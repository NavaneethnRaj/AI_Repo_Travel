import { request } from "undici";
import { expect, it } from "vitest";

it("blocks an external fetch and direct Undici request before connecting", async () => {
  const url = "https://example.com";
  await expect(fetch(url)).rejects.toThrow("outside loopback");
  await expect(request(url)).rejects.toThrow("outside loopback");
});
