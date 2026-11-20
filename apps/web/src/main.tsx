import { createRoot } from "react-dom/client";
import { createTravelLibrary, TravelReply } from "@wayfarer/travel-ui/react";
import places from "../../../assets/catalog/places.json";
import chunks from "../../../tests/fixtures/split-card.json";

const decoder = new TextDecoder("utf-8", { fatal: true });
const response = chunks.map((chunk) => decoder.decode(Uint8Array.from(chunk), { stream: true })).join("")
  + decoder.decode();
const library = createTravelLibrary(places);
const app = document.getElementById("app");

if (!app) throw new Error("App container is missing");

createRoot(app).render(
  <main>
    <h1>Wayfarer</h1>
    <TravelReply library={library} response={response} />
  </main>,
);
