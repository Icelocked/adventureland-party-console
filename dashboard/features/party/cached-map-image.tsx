"use client";
import { mapImages } from "./map-images";
import { gameImageUrl } from './game-image-url';

export function cachedMapImage(url: string) {
  url = gameImageUrl(url);
  let image = mapImages.get(url);
  if (!image && typeof window !== "undefined") {
    image = new Image();
    image.src = url;
    mapImages.set(url, image);
  }
  return image;
}
