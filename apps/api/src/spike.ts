import { readFileSync } from "node:fs";
import { CatalogueId, ShortLabel } from "@wayfarer/contracts";
import { validateProgram } from "@wayfarer/travel-ui/validate";
import { z } from "zod";

const catalogue = z.record(CatalogueId, ShortLabel).parse(
  JSON.parse(readFileSync(new URL("../../../assets/catalog/places.json", import.meta.url), "utf8")),
);

export function validateTravelReply(source: string, isStreaming = false) {
  return validateProgram(source, catalogue, isStreaming);
}
