# Third-party notices

## ThreeUI Community (MIT)

Portions of the landing hero (`src/components/landing/`) adapt techniques and
small code fragments from **ThreeUI** by the ThreeUI Community
(© Meng To / Design+Code) — https://github.com/MengTo/threeui — used under the
MIT licence. Nothing from the package is installed as a dependency; the
fragments are vendored and reworked in place. Adapted sources:

- **KoiStudies** (`public/synthralos-halftone.html`) — the tile-dissolve
  reveal: per-cell hash noise, decaying pointer trail, smoothstep entry.
  Adapted in `src/components/landing/dissolveCore.ts`.
- **UplinkLoader** (`src/shaders/uplink-loader/uplink-loader.html`) — the
  instrumentation dressing: dual procedural grain textures, scanlines,
  corner-bracket markers with pulsing diamond, notched readout plates, neon
  text glow, light haze. Adapted in `src/components/landing/HeroScene.tsx`
  and `src/styles.css` keyframes.
- **Sketchbook** (`src/shaders/sketchbook/sketchbookDocument.js`) — the
  loupe's annulus bezel mask and glass shadow treatment. Adapted in
  `src/components/landing/HeroScene.tsx`.

### MIT License

Copyright (c) Meng To / Design+Code (ThreeUI Community)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
