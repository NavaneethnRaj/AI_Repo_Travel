import { createLibrary, Renderer } from "@openuidev/react-lang";
import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { z } from "zod";
import { DestinationCard, Reply, libraryDefinition, readCardProps } from "./library.js";

type PlaceNames = Readonly<Record<string, string>>;

function ReplyView({ props, renderNode }: ComponentRenderProps<z.infer<typeof Reply.props>>) {
  return <section aria-label="Destination suggestions">{renderNode(props.children)}</section>;
}

function formatEstimate(range: readonly [number, number], currency: string): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  const fractionDigits = format.resolvedOptions().maximumFractionDigits ?? 0;
  return range.map((amount) => {
    if (fractionDigits === 0) return format.format(amount);
    const digits = String(amount).padStart(fractionDigits + 1, "0");
    // Passing decimal digits preserves the safe integer's minor units.
    const major = `${digits.slice(0, -fractionDigits)}.${digits.slice(-fractionDigits)}` as Intl.StringNumericLiteral;
    return format.format(major);
  }).join("–");
}

export function createTravelLibrary(places: PlaceNames) {
  return createLibrary({
    ...libraryDefinition,
    components: [
      { ...Reply, component: ReplyView },
      {
        ...DestinationCard,
        component({ props }: ComponentRenderProps<z.infer<typeof DestinationCard.props>>) {
          const card = readCardProps(props);
          if (!card.success) return null;
          const { placeId, why, costRangeMinor, currency } = card.data;
          const name = Object.hasOwn(places, placeId) ? places[placeId] : undefined;
          if (!name) return null;
          return (
            <article>
              <h2>{name}</h2>
              <p>{why}</p>
              {costRangeMinor && (
                <p>Estimate {formatEstimate(costRangeMinor, currency)} per person per day</p>
              )}
            </article>
          );
        },
      },
    ],
  });
}

export function TravelReply({
  library, response, isStreaming = false,
}: {
  library: ReturnType<typeof createTravelLibrary>;
  response: string | null;
  isStreaming?: boolean;
}) {
  return <Renderer library={library} response={response} isStreaming={isStreaming} publishObservability={false} />;
}
