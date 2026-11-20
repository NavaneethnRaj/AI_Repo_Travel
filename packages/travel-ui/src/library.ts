import { createLibrary, defineComponent } from "@openuidev/lang-core";
import { CatalogueId, CurrencyCode, MinorAmount, NoteText } from "@wayfarer/contracts";
import { z } from "zod";

export const LIBRARY_VERSION = "wayfarer-travel-ui/1";
export const ROOT_COMPONENT = "Reply";

const CostRange = z.tuple([MinorAmount, MinorAmount]).refine(([low, high]) => low <= high);

export const DestinationCard = defineComponent({
  name: "DestinationCard",
  description: "A curated destination and an optional daily cost estimate in minor currency units.",
  props: z.strictObject({
    placeId: CatalogueId,
    why: NoteText,
    bestMonths: z.array(z.int().min(1).max(12)).min(1).max(12).optional(),
    costRangeMinor: CostRange.optional(),
    currency: CurrencyCode,
  }),
  component: null,
});

export function readCardProps(props: Record<string, unknown>) {
  const { bestMonths, costRangeMinor, ...required } = props;
  return DestinationCard.props.safeParse({
    ...required,
    bestMonths: bestMonths ?? undefined,
    costRangeMinor: costRangeMinor ?? undefined,
  });
}

export const Reply = defineComponent({
  name: ROOT_COMPONENT,
  description: "The required root with one to 24 destination cards.",
  props: z.strictObject({ children: z.array(DestinationCard.ref).min(1).max(24) }),
  component: null,
});

export const libraryDefinition = {
  id: LIBRARY_VERSION,
  root: ROOT_COMPONENT,
  components: [Reply, DestinationCard],
};

export const schemaLibrary = createLibrary(libraryDefinition);
