export type TravelModeOption = "DRIVING" | "TWO_WHEELER" | "WALKING" | "TRANSIT";

export interface MapCommandPayload {
  mode: "search" | "directions";
  query?: string;
  origin?: string;
  destination?: string;
  travelMode?: TravelModeOption;
}
