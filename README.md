# THE BLOCK

**One city corner. Six decades. Walk through time.**

A real-time 3D scene of a single street corner — 5th & Vine — rendered six
times over: **1945, 1965, 1985, 2005, 2025 and 2055**. Drag the timeline at the
top of the screen and the block rebuilds itself around you: the buildings are
re-clad, the shops change hands, the cars change shape, the crowd changes
clothes, the light changes colour and the soundtrack changes decade.

Everything is generated in code at load time. There are no downloaded models,
no photographs and no audio files. The bricks, the neon, the sedans, the
pedestrians, the swing band on a shop radio and the hum of a 2055 delivery
drone are all synthesised in the browser.

```
  1945 ── 1965 ── 1985 ── 2005 ── 2025 ── 2055
   ▲                                        ▲
   Post-War Boom                  The Retrofit
```

---

## Play it

Open `index.html` from any static web server (it uses ES modules and an import
map, so `file://` will not work):

```bash
npx serve .          # or: python3 -m http.server 8000
```

Then visit the address it prints. It also deploys as-is to GitHub Pages or any
static host — three.js is vendored into `vendor/`, so there are no runtime
dependencies and no build step.

### Controls

| | |
|---|---|
| **Desktop** | `W A S D` move · mouse look (click to capture) · `Shift` sprint · `Z` crouch · `Space` jump · `E` interact · `1`–`6` jump to a decade · `Q`/`R` nudge time · `P` photo mode · `G` ghost overlay · `C` codex · `F` free-fly · `M` mute · `Esc` menu |
| **Touch / iOS** | Left stick to walk · drag anywhere else to look · tap the `◎` button to interact · `RUN` toggles sprint · pinch to zoom · everything is safe-area aware and there is a left-handed layout in Settings |
| **Gamepad** | Left stick move · right stick look · **A** interact · **LB**/**RB** change decade · **Start** menu |

---

## What's actually in here

### The block persists

The important design rule is that **the lots do not move**. A building that is
four storeys of brick in 1945 is still four storeys of brick in 2055 — it just
gets re-clad, re-signed, re-tenanted and re-grimed. That persistence is what
makes the transition read as *time passing* rather than as six unrelated
scenes.

Eight lots and one open corner, each with a story that runs the whole length of
the timeline:

| Lot | 1945 | 1965 | 1985 | 2005 | 2025 | 2055 |
|---|---|---|---|---|---|---|
| **500 Vine** | Palace Theatre | Palace Cinema | Video Vault | Mega Fitness 24 | The Palace (restored) | Palace Memory Archive |
| **508 Vine** | Schmidt's Drugs | Valu Drug | Check Cashing | Phone Zone | Oat + Arrow | Print-a-Meal |
| **520 Vine** | Hotel Vernon | Hotel Vernon | The Vernon (SRO) | Vernon Lofts (under scaffold) | Vernon Lofts | Vernon Co-Living |
| **41 Fifth** | Marconi & Sons | Super Market | Deli · Grocery | Pho & Bubble Tea | Refill | Vertical Farm Co-op |
| **55 Fifth** | Victory garden | Gas station | Parking lot | Construction site | Pocket park | The Grove |
| **60 Fifth** | Apollo Barber | Star-Lite Lanes | Galaxy Arcade | Cyber Café | Fifth St. Climbing | Repair Café |
| **70 Fifth** | First Merchants Bank | First Merchants | Bank + first ATM | Bank + vestibule | FOR LEASE | Climate Trust |
| **88 Fifth** | Woolton's 5¢ & 10¢ | Hi-Fi & Television | Ben's Records | DVD & Games | Green Leaf | Neuro-Spa |

### Threads

Some things run through all six decades and are only visible if you compare
them. The codex draws each one as a timeline:

- **The tree** — planted by neighbours in a 1945 victory garden, spared by a
  contractor's daughter in 1965, cut down in 1978 for two parking spaces (one of
  them is still empty), and replanted in 2021 by their grandchildren.
- **The tin box** — buried beside that sapling in September 1945. The 2007
  excavation missed it by four metres. It is still there in 2055.
- **KAI '85** — a tag in the alley. Painted once, covered twice, and eventually
  restored under a heritage designation from a photograph somebody's father took
  of somebody else's car.
- **The bank clock** — wound every Monday by a man named Pell, stopped at 4:07
  during a blackout, rewound eleven minutes fast in 1996.
- **The cat** — third floor of the Hotel Vernon, second window from the left. In
  every single decade. Which is not possible, and nobody who lives here finds it
  strange.

There are **24 secrets** in total.

### Quality-of-life

Photo mode with seven film stocks, focal length, depth of field, exposure, a
composition grid and PNG export · a ghost overlay that double-exposes the
adjacent decade over the live one · a guided tour · a time-of-day slider that
works inside every era · weather override · a minimap · a codex · a
four-minute-idle-proof adaptive quality governor · full accessibility options
(reduced motion, reduced flashing, larger interface, high contrast, subtitles,
left-handed touch layout) · localStorage progress.

---

## How it is built

```
index.html            import map + the whole interface as static DOM
styles/main.css       era-reactive chrome (JS writes --era-* custom properties)
src/
  core/
    engine.js         renderer, HDR targets, quality tiers, adaptive governor
    input.js          keyboard, pointer-lock, multi-touch, gamepad
    player.js         first-person controller, collision, head bob
    audio.js          the whole soundtrack, synthesised
    save.js           localStorage
    rng.js  mathx.js  seeded noise and maths
  data/
    eras.js           ★ the six eras — every visual, audio and narrative decision
    secrets.js        secrets, threads, places
  world/
    textures.js       Canvas2D detail maps, signage, posters, shop interiors
    materials.js      PBR library + the shared time-warp dissolve
    geom.js           geometry accumulation and merging
    buildings.js      the facade generator
    street.js         road, sidewalk, backdrop, street furniture
    vehicles.js       parametric vehicles + signalised traffic AI
    pedestrians.js    instanced crowd + behaviour
    sky.js            procedural sky, sun, PMREM environment
    city.js           era lifecycle, collision, interaction, light budget
  fx/
    post.js           hand-rolled HDR post stack
    weather.js        GPU particles
    timewarp.js       the transition
  ui/
    hud.js            all DOM
    tour.js           the guided tour
tools/                headless Chromium capture + verification harnesses
vendor/three/         three.js r169 (vendored — no CDN, no build step)
```

### A few things worth knowing

**Six eras of geometry is a lot of VRAM.** Eras are built on demand and the
least-recently-used ones are released past a cap that depends on the quality
tier. Unique textures (signage, shop interiors, murals) are additionally
generated at a fraction of the resolution on phones — see `setTextureScale`.

**The time warp is one number.** All era-owned materials share a global uniform
block and a dissolve injected via `onBeforeCompile`. The outgoing era's
surfaces are erased ahead of an expanding world-space front; the incoming era's
appear behind the same front, so the two decades interlock exactly. The screen
wipe in the composite pass rides the same radius and hides the frame where the
population swaps.

**The post stack is hand-rolled** rather than `EffectComposer` because this
pipeline needs the scene depth for AO and depth-of-field, a two-level bloom
rather than five, and one fused composite pass that also does the era colour
grade, the wipe and the ghost overlay. It ends up as fewer draws than chaining
addon passes.

**Nothing is downloaded at runtime.** Detail maps (brick, asphalt, plaster) are
generated once as grayscale and shared by every material that needs them; the
per-building colour is just `material.color`. The whole city runs on about a
dozen detail textures plus one small canvas per piece of signage.

**The crowd is instanced per body part**, not per person — forty animated
pedestrians cost about fifteen draw calls instead of four hundred.

---

## Development

```bash
npm install                 # three (vendored copy already committed) + playwright
node tools/verify.mjs       # end-to-end: desktop + iOS viewport, all six eras
node tools/shots.mjs OUT 0,2,5 palace,cornerlot,alley   # capture specific angles
node tools/probe.mjs        # quick boot check for console errors
```

The harnesses use the sandbox's pinned Chromium with SwiftShader, so they run
without a GPU — slowly, but pixel-accurately.

---

## Browser support

WebGL2 and Web Audio. Tested against Chromium; written against the quirks that
matter on iOS Safari (Pointer Events throughout, `gesturestart` suppression,
safe-area insets, audio unlocked inside a gesture and resumed on every
visibility change, and no reliance on pointer lock, which iOS does not have).

Renders at whatever resolution keeps the frame time inside budget — the
governor targets 60fps on desktop and a stable 45 on phones, trading render
scale rather than letting the frame rate oscillate.
