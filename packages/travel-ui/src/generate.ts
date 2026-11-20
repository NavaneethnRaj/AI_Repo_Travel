import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LIBRARY_VERSION, schemaLibrary } from "./library.js";

export function generateArtifacts() {
  const example = 'root = Reply([card])\ncard = DestinationCard("lisbon", "Cafés and viewpoints", null, [4500, 7500], "EUR")';
  const prompt = schemaLibrary.prompt({
    preamble: "Suggest a destination using Wayfarer's bundled catalogue.",
    additionalRules: [
      "Set root explicitly to Reply. Use only literal values, registered components, and named children.",
      "Use null for omitted optional positional arguments. Use only known catalogue IDs.",
    ],
    examples: [example],
  });
  return {
    "prompt.txt": `${LIBRARY_VERSION}\n\n${prompt.trimEnd()}\n`,
    "schema.json": `${JSON.stringify({ libraryVersion: LIBRARY_VERSION, ...schemaLibrary.toJSONSchema() }, null, 2)}\n`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.OPENUI_TELEMETRY_DISABLED = "1";
  for (const [name, contents] of Object.entries(generateArtifacts())) {
    writeFileSync(new URL(`../generated/${name}`, import.meta.url), contents);
  }
}
