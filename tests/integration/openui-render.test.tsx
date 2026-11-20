// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createTravelLibrary, TravelReply } from "@wayfarer/travel-ui/react";
import places from "../../assets/catalog/places.json" with { type: "json" };
import frozenSchema from "../../packages/travel-ui/generated/schema.json" with { type: "json" };
import chunks from "../fixtures/split-card.json" with { type: "json" };

const library = createTravelLibrary(places);
afterEach(cleanup);

it("exposes the same schema in React as the server", () => {
  const { libraryVersion, ...schema } = frozenSchema;
  expect(library.id).toBe(libraryVersion);
  expect(library.toJSONSchema()).toEqual(schema);
});

it("renders the same card during streaming and when complete", () => {
  const view = render(<TravelReply library={library} response="" isStreaming />);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let program = "";
  for (const chunk of chunks) {
    program += decoder.decode(Uint8Array.from(chunk), { stream: true });
    view.rerender(<TravelReply library={library} response={program} isStreaming />);
  }
  expect(screen.getByRole("heading", { name: "Lisbon" })).toBeTruthy();

  program += decoder.decode();
  view.rerender(<TravelReply library={library} response={program} />);
  expect(screen.getByRole("heading", { name: "Lisbon" })).toBeTruthy();
  expect(screen.getByText("Cafés and viewpoints")).toBeTruthy();
  expect(screen.getByText("Estimate €45.00–€75.00 per person per day")).toBeTruthy();
});
