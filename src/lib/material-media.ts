// Example photos for each material, shown as small swatches next to the material's
// name. They are generic stock photos (Unsplash License: free for commercial use,
// no credit required; credited in docs/IMAGE-CREDITS.md), not pictures of a Con Z
// supplier's stock, so they are never captioned as such.

export type MaterialPhoto = { src: string; photographer: string; source: string };

export const MATERIAL_PHOTOS: Record<string, MaterialPhoto> = {
  river_sand: {
    src: "/materials/river_sand.webp",
    photographer: "jim gade",
    source: "https://unsplash.com/photos/focus-photo-of-brown-sand-eYWNaMffWHI",
  },
  pit_sand: {
    src: "/materials/pit_sand.webp",
    photographer: "Jan Kopřiva",
    source: "https://unsplash.com/photos/golden-sand-ripples-with-flowing-patterns-IfHAeNOOGQ0",
  },
  quarry_dust: {
    src: "/materials/quarry_dust.webp",
    photographer: "Yan Ots",
    source: "https://unsplash.com/photos/close-up-of-gray-sand-texture--4Q0Zx_po_0",
  },
  crusher_run: {
    src: "/materials/crusher_run.webp",
    photographer: "Wolfgang Hasselmann",
    source:
      "https://unsplash.com/photos/close-up-of-small-rocks-and-gravel-on-the-ground-9g7z3e2trRk",
  },
  gravel: {
    src: "/materials/gravel.webp",
    photographer: "Hitaishi Ramani",
    source: "https://unsplash.com/photos/Mfcq_FcOEhw",
  },
  stones: {
    src: "/materials/stones.webp",
    photographer: "Wolfgang Weiser",
    source: "https://unsplash.com/photos/iZwfQUCxJjY",
  },
  top_soil: {
    src: "/materials/top_soil.webp",
    photographer: "Avinash Kumar",
    source: "https://unsplash.com/photos/dark-brown-soil-with-stones-rEIDzqczN7s",
  },
  filling_soil: {
    src: "/materials/filling_soil.webp",
    photographer: "AJOY DAS",
    source: "https://unsplash.com/photos/close-up-of-dry-soil-with-scattered-pebbles-0ldAi89gjx4",
  },
};

/** The swatch for a material, or null (custom materials have none). */
export function materialPhoto(material: string | null | undefined): MaterialPhoto | null {
  return (material && MATERIAL_PHOTOS[material]) || null;
}
