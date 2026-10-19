"use client";

export type RestockPolicy = {
  hp: { min: number; max: number; item: string };
  mp: { min: number; max: number; item: string };
  /** Elixirs the merchant keeps min..max spares of (bought from an NPC, or withdrawn from the bank). */
  elixirs?: { min: number; max: number; item: string }[];
  /** The elixir kept active unless the worn gear set names another; null keeps none. */
  keepElixir?: string | null;
};
