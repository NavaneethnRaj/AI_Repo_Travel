import { z } from "zod";

export const weatherUnits = z.enum(["celsius", "fahrenheit"]);
export const weatherCodes = z.literal([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

export const osmAttribution = {
  attribution: "© OpenStreetMap contributors",
  attributionUrl: "https://www.openstreetmap.org/copyright",
} as const;

export const openMeteoSource = {
  name: "Open-Meteo",
  url: "https://open-meteo.com/",
  licence: "CC BY 4.0",
} as const;

export type WeatherUnits = z.infer<typeof weatherUnits>;
export type WeatherCode = z.infer<typeof weatherCodes>;
export type SeasonalWeather = { note: string; source: { name: string; url: string; licence?: string } };
export type WeatherDay = { date: string; code: WeatherCode } & (
  { lowC: number; highC: number } | { lowF: number; highF: number }
);
export type WeatherResult =
  | { status: "forecast" | "stale"; days: WeatherDay[]; asOf: string; source: typeof openMeteoSource }
  | ({ status: "seasonal" } & SeasonalWeather)
  | { status: "unavailable"; source: typeof openMeteoSource; reason: "DISABLED" | "UNKNOWN_PLACE" | "OUTSIDE_WINDOW" | "UPSTREAM_UNAVAILABLE" };

export type PlaceResult = {
  id: string;
  name: string;
  region?: string;
  country?: string;
  coordinates: [longitude: number, latitude: number];
  bounds?: [west: number, south: number, east: number, north: number];
};
