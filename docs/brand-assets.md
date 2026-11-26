# Harness Law puzzle mark

The approved mark is the complete interlocking puzzle in citrus green (`#d8ed94`), replacing the former H symbol. Keep every piece, notch, hole, and the approved perspective. Do not simplify the silhouette for smaller placements.

- Editable source asset: `assets/brand/puzzle-mark-master.png` (transparent raster master).
- Shared UI asset: `public/brand/puzzle-mark.webp` (256px, approximately 12 KB).
- Shared component: `components/brand-logo.tsx`.
- Browser icons: `public/favicon-{16,32,192}.png`, `public/favicon.ico`, `public/favicon.svg`.
- Apple touch icon: `public/apple-touch-icon.png`.

The lime mark has forest backing on light surfaces; inverse lockups retain transparent backing over the site's dark surfaces. Browser icons use forest backing for visibility in either browser theme. The wordmark remains live text for sharp rendering and accessible names.

Regenerate optimized assets with `node scripts/build-brand-assets.mjs` in the installed checkout. The script uses the existing Sharp installation to trim empty alpha margins, resize, and encode the approved image; it does not redraw or recolor the puzzle. Generated assets are checked in, so normal builds do not run this step.

## Asset provenance

Created with the built-in image generation tool, from the user's approved lime puzzle image. The final preparation prompt was:

> Background extraction only for production logo asset. Remove the dark forest green BACKGROUND from this approved lime puzzle image and make the background genuinely transparent. Preserve the EXACT existing lime puzzle object intact, every piece, hole, notch, proportion, orientation, overlap, color, soft material shading, and edge. No redraw, no simplification, no rearrangement, no missing pieces. Remove the background floor shadow outside the object. Leave natural inter-piece shading and self-shadowing on the object. The result must be a clean alpha cutout of this exact complete puzzle, full object with no cropping, with a small transparent margin. Keep the light lime #D8ED94 appearance and all 3D details exactly as approved. No text, no wordmark, no border, no additional object. Transparent outside the silhouette and through visible background gaps.
