import type { Currency } from "@/lib/currency";

export const OBJECT_TYPES = [
  "apartment",
  "house",
  "commercial",
  "office",
  "land",
  "construction_site",
  "parking",
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const OBJECT_STATUSES = [
  "available",
  "reserved",
  "sold",
  "rented",
  "in_progress",
] as const;
export type ObjectStatus = (typeof OBJECT_STATUSES)[number];

// What this object is FOR, decided at creation, before any contract
// exists -- not derived from status the way 'rented' vs 'sold' is. This
// is what tells a vacant warehouse meant for rent apart from a vacant
// apartment meant for sale: the shakhmatka only ever shows 'sale'
// objects, the "Аренда" section on a building's page only 'rent' ones.
export const LISTING_TYPES = ["sale", "rent"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export type PropertyObject = {
  id: string;
  name: string;
  address: string | null;
  type: ObjectType;
  status: ObjectStatus;
  listing_type: ListingType;
  area: number | null;
  price: number | null;
  currency: Currency;
  description: string | null;
  building_id: string | null;
  block: string | null;
  floor: number | null;
  position_in_floor: number | null;
  plan_url: string | null;
  span: number;
  rooms: number | null;
  manual_reserved: boolean;
  created_at: string;
  updated_at: string;
};

export type PropertyObjectInput = {
  name: string;
  address: string;
  type: ObjectType;
  status: ObjectStatus;
  listing_type: ListingType;
  area: string;
  price: string;
  currency: Currency;
  description: string;
  plan_url: string;
  rooms: string;
};
