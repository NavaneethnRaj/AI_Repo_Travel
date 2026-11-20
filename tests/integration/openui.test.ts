import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTravelReply } from "../../apps/api/src/spike.js";
import { generateArtifacts } from "../../packages/travel-ui/src/generate.js";
import chunks from "../fixtures/split-card.json" with { type: "json" };

const bytes = Uint8Array.from(chunks.flat());
const program = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const expectedProgram = 'root = Reply([card])\ncard = DestinationCard("lisbon", "Cafés and viewpoints", null, [4500, 7500], "EUR")\n';

function accumulatedReplies() {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "";
  const replies = chunks.map((chunk) => {
    result += decoder.decode(Uint8Array.from(chunk), { stream: true });
    return result;
  });
  replies.push(result + decoder.decode());
  return replies;
}

describe("the OpenUI spike", () => {
  it("keeps the frozen prompt and parser schema in sync with the library", () => {
    const generated = new Map(Object.entries(generateArtifacts()));
    for (const [name, contents] of generated) {
      expect(readFileSync(new URL(`../../packages/travel-ui/generated/${name}`, import.meta.url), "utf8"))
        .toBe(contents);
    }
  });

  it("validates complete and split UTF-8 input to the same tree", () => {
    const replies = accumulatedReplies();
    expect(program).toBe(expectedProgram);
    expect(chunks.some((chunk, index) => chunk.at(-1) === 0xc3 && chunks[index + 1]?.[0] === 0xa9)).toBe(true);
    const whole = validateTravelReply(program);

    expect(whole).toMatchObject({
      ok: true,
      root: {
        typeName: "Reply",
        partial: false,
        props: { children: [{ typeName: "DestinationCard", props: { placeId: "lisbon", currency: "EUR" } }] },
      },
    });
    expect(validateTravelReply(replies.at(-1) ?? "")).toEqual(whole);
  });

  it("accepts only complete trees at every byte cut", () => {
    const whole = validateTravelReply(program);
    expect(whole.ok).toBe(true);
    for (let cut = 0; cut <= bytes.length; cut++) {
      const prefix = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, cut), { stream: true });
      const result = validateTravelReply(prefix, true);
      expect(result, `prefix at byte ${cut}`).toEqual(
        prefix.trimEnd() === program.trimEnd() ? whole : { ok: false, code: "INCOMPLETE" },
      );
    }
  });

  it.each([
    ["missing root", expectedProgram.split("\n")[1] + "\n", "MISSING_ROOT"],
    ["unknown component", expectedProgram.replace("DestinationCard", "Unregistered"), "UNKNOWN_COMPONENT"],
    ["unknown place", expectedProgram.replace("lisbon", "oslo"), "UNKNOWN_PLACE"],
    ["extra prop", expectedProgram.replace('"EUR")', '"EUR", "extra")'), "EXTRA_PROP"],
    ["over-long label", expectedProgram.replace("lisbon", "a".repeat(81)), "INVALID_PROP"],
    ["over-long note", expectedProgram.replace("Cafés and viewpoints", "a".repeat(401)), "INVALID_PROP"],
    ["duplicate definition", expectedProgram + "card = null\n", "DUPLICATE_DEFINITION"],
    ["unreachable definition", expectedProgram + "extra = null\n", "UNREACHABLE_DEFINITION"],
    ["unresolved reference", "root = Reply([missing])", "UNRESOLVED_REFERENCE"],
    ["cyclic reference", "root = Reply([root])", "CYCLIC_REFERENCE"],
    ["unconsumed trailing input", expectedProgram.trimEnd() + " @", "INVALID_SYNTAX"],
    ["expression", expectedProgram.replace("4500", "4000 + 500"), "INVALID_SYNTAX"],
    ["excessive depth", "root = Reply(" + "[".repeat(9) + "null" + "]".repeat(9) + ")", "LIMIT_EXCEEDED"],
    ["excessive node count", "root = Reply([" + "null,".repeat(512) + "null])", "LIMIT_EXCEEDED"],
    ["excessive UTF-8 size", "é".repeat(32769), "PROGRAM_TOO_LARGE"],
  ])("rejects %s", (_name, source, code) => {
    expect(validateTravelReply(source)).toEqual({ ok: false, code });
  });
});
