/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE BLOCK — era definitions
 * ════════════════════════════════════════════════════════════════════════
 *
 * One corner, 5th & Vine, described six times. Everything downstream — the
 * facade generator, the crowd wardrobe, the traffic mix, the colour grade, the
 * synthesiser — reads from here, so a change to a single field ripples through
 * the whole scene.
 *
 * The important design rule: the *lots do not move*. A building that is four
 * storeys of brick in 1945 is still four storeys of brick in 2055 unless the
 * story says otherwise; it just gets re-clad, re-signed, re-tenanted and
 * re-grimed. That persistence is what makes the transition read as time
 * passing rather than as six unrelated scenes.
 */

/* ═══════════════════════════ BLOCK LAYOUT ═══════════════════════════ */
/* Plan coordinates: +X east, +Z south, Y up. The block occupies a 60 m
   square centred on the origin; streets and far-side backdrops surround it. */

export const BLOCK = {
  half: 30,          // block half-width (facades sit on this line)
  sidewalk: 4.2,     // sidewalk depth outside the facade line
  road: 13.0,        // carriageway width
  farWalk: 4.0,      // sidewalk on the far side
  curbHeight: 0.16,
};

export const LOTS = [
  {
    id: 'palace', addr: '500 Vine', face: 'N',
    x0: 6, x1: 30, z0: -30, z1: -11,     // plan rect
    corner: 'NE', floors: 4, flagship: true,
    label: 'The Palace',
  },
  {
    id: 'drug', addr: '508 Vine', face: 'N',
    x0: -10, x1: 6, z0: -30, z1: -11,
    floors: 3, label: '508 Vine',
  },
  {
    id: 'hotel', addr: '520 Vine', face: 'N',
    x0: -30, x1: -10, z0: -30, z1: -11,
    corner: 'NW', floors: 5, label: 'Hotel Vernon',
  },
  {
    id: 'grocer', addr: '41 Fifth', face: 'W',
    x0: -30, x1: -11, z0: -11, z1: 8,
    floors: 3, label: '41 Fifth',
  },
  {
    id: 'lot', addr: '55 Fifth', face: 'W',
    x0: -30, x1: -11, z0: 8, z1: 30,
    corner: 'SW', floors: 0, open: true, label: 'The Corner Lot',
  },
  {
    id: 'arcade', addr: '60 Fifth', face: 'S',
    x0: -10, x1: 5, z0: 11, z1: 30,
    floors: 2, label: '60 Fifth',
  },
  /* alley gap: x 5 → 10 */
  {
    id: 'bank', addr: '70 Fifth', face: 'S',
    x0: 10, x1: 30, z0: 11, z1: 30,
    corner: 'SE', floors: 3, label: 'First Merchants',
  },
  {
    id: 'dime', addr: '88 Fifth', face: 'E',
    x0: 11, x1: 30, z0: -11, z1: 11,
    floors: 3, label: '88 Fifth',
  },
];

export const ALLEY = { x0: 5, x1: 10, z0: 11, z1: 30 };
export const COURTYARD = { x0: -10, x1: 10, z0: -11, z1: 11 };

/* ═══════════════════════════ SHARED VOCAB ═══════════════════════════ */

export const LAMP = {
  incandescent: { color: 0xffd8a0, intensity: 1.0, glass: 'globe', pole: 'fluted', height: 5.2 },
  mercury:      { color: 0xc8e0ff, intensity: 1.35, glass: 'cobra', pole: 'steel',  height: 8.0 },
  sodium:       { color: 0xffa542, intensity: 1.6, glass: 'cobra', pole: 'steel',  height: 8.4 },
  halide:       { color: 0xe8f0ff, intensity: 1.3, glass: 'shoebox', pole: 'steel', height: 8.2 },
  led:          { color: 0xdcecff, intensity: 1.15, glass: 'panel', pole: 'tapered', height: 7.6 },
  ledwarm:      { color: 0xffe6bd, intensity: 1.0, glass: 'panel', pole: 'slim', height: 7.2 },
};

/* ═══════════════════════════ THE SIX ERAS ═══════════════════════════ */

export const ERAS = [

/* ─────────────────────────────── 1945 ─────────────────────────────── */
{
  year: 1945, key: 'y1945',
  name: 'Post-War Boom',
  season: 'Autumn',
  caption: 'Post-War Boom · Autumn, 1945',
  accent: 0xe8b46a, accent2: 0xc98f5a,
  tagline: 'The war ended nine weeks ago and nobody has stopped grinning.',
  facts: [
    'Coal smoke is the smell of the city. Every one of these buildings burns it.',
    'The trolley on Fifth runs on rails laid in 1908. It has eleven years left.',
    'A sign painter charges $4 to letter a shop window in gold leaf.',
    'The tallest thing on the block is the Hotel Vernon\'s water tank.',
    'Nobody here has seen television. Two people on this street have heard of it.',
  ],

  sky: {
    top: 0x5a7ea8, horizon: 0xd8b98a, ground: 0x6b5a45,
    sunColor: 0xffd9a0, sunIntensity: 2.8, sunElev: 41, sunAzim: 132,
    ambSky: 0x9fb4cc, ambGround: 0x6a5a48, ambIntensity: 0.92,
    fog: 0xcbb193, fogNear: 40, fogFar: 235, haze: 0.55,
    clouds: 0.45, cloudColor: 0xe8dcc8, cloudSpeed: 0.012, stars: 0,
    smokestacks: true,
  },
  grade: {
    exposure: 1.26, lift: [0.030, 0.022, 0.014], gamma: [1.0, 1.0, 1.03],
    gain: [1.06, 1.0, 0.92], tint: [1.03, 1.0, 0.95],
    sat: 0.82, contrast: 1.10, temp: 0.22,
    vignette: 0.46, grain: 0.062, chroma: 0.18, halation: 0.05,
    sepia: 0.22, vhs: 0, bleach: 0, holo: 0, dust: 0.15,
    bloomStrength: 0.62, bloomThreshold: 1.12,
  },
  timeOfDay: 15 * 60 + 40,
  weather: 'soot',

  palette: {
    brick: [0x8a4634, 0x76392c, 0x9a5340, 0x6d3428, 0x8e4a30],
    stone: [0xbfae94, 0xa89a82, 0xd0c2a8],
    trim: [0x2c3a34, 0x3a2a22, 0x51402c, 0x1e2a2e],
    awning: [0x2f5c46, 0x7a2b26, 0x2b4a72, 0x6b5522],
    paint: [0x3b4a3c, 0x5c3b2c, 0x2f3d52, 0x6a5330],
    glass: 0x2a3038, glassTint: 0.06,
    metal: 0x4a4640, road: 0x6f6a61, walk: 0xa79c8c,
    roof: 0x413a33,
  },
  road: {
    markings: 'none', wear: 0.75, wet: 0.0, trolleyTracks: true,
    cobbleSeams: 0.5, potholes: 0.5, bikeLane: false, crosswalk: 'ladder-faint',
  },
  lamp: 'incandescent',
  streetLightsOn: 0.35,      // dusk fraction; drives auto-on threshold
  windowLit: 0.16, windowColor: 0xffd8a0, curtains: [0xd8c8a8, 0xa89878, 0xc0b090],

  vehicles: {
    density: 0.55, speed: 8.5,
    types: [
      { kind: 'sedan45', w: 5, colors: [0x1a1a1c, 0x2a2018, 0x24303a, 0x3a2a26, 0x1f2a24] },
      { kind: 'coupe45', w: 3, colors: [0x14181c, 0x30201a, 0x1e2830] },
      { kind: 'truck45', w: 2, colors: [0x3d4a35, 0x5a4a2a, 0x2a3540] },
      { kind: 'taxi45', w: 2, colors: [0xd8a020] },
      { kind: 'trolley', w: 1, colors: [0x6d3a2c] },
    ],
    bikes: 0.25, horn: 'ahooga',
  },
  peds: {
    density: 0.9, speed: 1.28,
    coats: [0x2e2a26, 0x3a3630, 0x4a3c30, 0x232a2e, 0x5a4a3a, 0x2a3a34, 0x6a5a44],
    shirts: [0xe8e0cc, 0xd8d0bc, 0xc8c0a8, 0xf0ead8],
    trousers: [0x2a2a2e, 0x3a3228, 0x44403a, 0x2e3a34],
    dress: [0x7a3d3a, 0x3d5a6a, 0x6a5a3a, 0x4a3a52, 0x2f5c46],
    skin: [0xe8c4a0, 0xd8ac84, 0xa87850, 0x8a5f3c, 0x6b4429, 0xf0d0b0],
    hair: [0x2a1f18, 0x1a1410, 0x5a3a20, 0x8a6a40, 0x3a2a20, 0xb0a090],
    hats: 0.86, hatKinds: ['fedora', 'flatcap', 'ladyhat', 'garrison'],
    accessories: ['briefcase', 'newspaper', 'shoppingbag', 'umbrella', 'none', 'none'],
    uniforms: 0.14,     // sailors & soldiers
    behaviours: ['stroll', 'window', 'chat', 'hurry', 'newsboy'],
  },
  props: [
    'trolleyPole', 'mailboxIron', 'newsstand', 'hydrantSquat', 'ashcan',
    'awningCrank', 'coalHatch', 'milkCrate', 'barberPole', 'phoneBoothWood',
    'parkingMeterEarly', 'sandwichBoard', 'fireEscape', 'waterTower', 'clothesline',
  ],
  ads: {
    wall: ['WAR BONDS — BUY YOUR SHARE', 'DRINK COCA — ICE COLD 5¢', 'CHESTERFIELD — THEY SATISFY'],
    board: 'VICTORY GARDENS · GROW YOUR OWN',
    posters: ['LOOSE LIPS SINK SHIPS', 'V-J DAY — THE LIGHTS COME ON', 'SAVE WASTE FATS'],
    tone: 'letterpress',
  },
  audio: {
    ambienceBed: { rumbleHz: 42, rumbleGain: 0.10, airGain: 0.045, airHz: 620 },
    layers: ['trolleyBell', 'propPlane', 'newsboy', 'factoryWhistle', 'crowdMurmurLow'],
    music: {
      style: 'bigband', bpm: 168, key: 'Bb', root: 233.08,
      scale: [0, 2, 4, 5, 7, 9, 11], swing: 0.62,
      voices: ['brassStab', 'walkingBass', 'brushKit', 'clarinet'],
      radioFilter: [420, 2600], radioNoise: 0.05, gain: 0.5,
    },
    trafficTone: { engineHz: 62, engineQ: 3, tireGain: 0.16 },
    footstep: { kind: 'leather', bright: 0.6 },
  },
  lots: {
    palace: {
      style: 'terracotta', floors: 4, facade: 0xc0a882, trim: 0xa8804a, condition: 0.12,
      shop: 'PALACE THEATRE', signType: 'marquee', signColor: 0xffe8b0, blade: 'PALACE',
      bladeColor: 0xd83a2a, marqueeText: ['THE LOST WEEKEND', 'MILDRED PIERCE', 'NEWS OF THE DAY'],
      bulbs: 96, awning: null, windows: 'arched', cornice: 'heavy',
      roof: ['watertank', 'chimneys', 'pigeons'],
      wallAd: 'PALACE — CONTINUOUS SHOWS FROM NOON',
      story: 'Opened 1927 as a vaudeville house. Two thousand seats, a Wurlitzer, and an usher who will still be here in 1965.',
    },
    drug: {
      style: 'brick', floors: 3, facade: 0x8a4634, trim: 0x2f5c46, condition: 0.2,
      shop: "SCHMIDT'S DRUGS", sub: 'SODA FOUNTAIN · PRESCRIPTIONS',
      signType: 'goldleaf', signColor: 0xd8b04a, neon: 'DRUGS', neonColor: 0x4ad8b0,
      awning: 0x2f5c46, awningStripe: 0xe8e0cc, windows: 'sash', cornice: 'brick-corbel',
      roof: ['chimneys', 'vent'],
      display: 'apothecary',
      story: 'Otto Schmidt mixes phosphates behind a marble counter. The fountain stools spin. He will not sell to a chain — yet.',
    },
    hotel: {
      style: 'brick', floors: 5, facade: 0x76392c, trim: 0x51402c, condition: 0.3,
      shop: 'HOTEL VERNON', sub: 'ROOMS 75¢ · WEEKLY RATES',
      signType: 'vertical', signColor: 0xe8503a, windows: 'sash', cornice: 'bracketed',
      fireEscape: true, roof: ['watertank', 'chimneys', 'clothesline', 'pigeons'],
      wallAd: 'HOTEL VERNON · CLEAN ROOMS · 75¢',
      story: 'Eighty rooms, four bathrooms, one telephone in the lobby. Half the guests are looking for work; half have just found it.',
    },
    grocer: {
      style: 'brick', floors: 3, facade: 0x9a5340, trim: 0x3b4a3c, condition: 0.18,
      shop: 'MARCONI & SONS', sub: 'FINE GROCERIES · FRESH PRODUCE',
      signType: 'painted', signColor: 0xe8dcc0, awning: 0x7a2b26, awningStripe: 0xe8e0cc,
      windows: 'sash', cornice: 'brick-corbel', display: 'produce',
      crates: true, roof: ['chimneys'],
      story: 'Sal Marconi stacks the good apples in front. His two sons came home in July; one of them stacks apples now too.',
    },
    lot: {
      style: 'open', use: 'victoryGarden', fence: 'picket', fenceColor: 0xa89878,
      tree: { h: 2.6, r: 1.1, kind: 'sapling' },
      sign: 'VICTORY GARDEN — 5TH ST. NEIGHBOURS',
      story: 'A tenement stood here until the fire in ’41. The block cleared the rubble themselves and planted cabbages. Somebody put a sapling in the north corner.',
    },
    arcade: {
      style: 'brick', floors: 2, facade: 0x8e4a30, trim: 0x2b4a72, condition: 0.22,
      shop: 'APOLLO BARBER SHOP', sub: 'WESTERN UNION · TELEGRAMS',
      signType: 'goldleaf', signColor: 0xd8b04a, awning: 0x2b4a72, awningStripe: 0xe8e0cc,
      barberPole: true, windows: 'sash', cornice: 'brick-corbel', display: 'barber',
      roof: ['vent'],
      story: 'Two chairs, one radio, and the only place on the block where you can send a telegram after six.',
    },
    bank: {
      style: 'limestone', floors: 3, facade: 0xbfae94, trim: 0x8a7a5c, condition: 0.08,
      shop: 'FIRST MERCHANTS BANK', sub: 'EST. 1889',
      signType: 'carved', columns: 6, clock: true, clockStopped: null,
      windows: 'tall-arched', cornice: 'dentil', roof: ['parapet', 'flagpole'],
      story: 'Limestone, because a bank that looks temporary is a bank nobody uses. The clock is wound every Monday by a man named Pell.',
    },
    dime: {
      style: 'brick', floors: 3, facade: 0x6d3428, trim: 0x6a5522, condition: 0.24,
      shop: "WOOLTON'S", sub: '5¢ · 10¢ · 25¢ STORE',
      signType: 'painted', signColor: 0xd83a2a, awning: 0x6b5522, awningStripe: 0xe8e0cc,
      windows: 'sash', cornice: 'brick-corbel', display: 'fivedime',
      roof: ['chimneys', 'vent'],
      story: 'Everything in the window costs less than a quarter. The lunch counter at the back serves 3,000 sandwiches a week.',
    },
  },
},

/* ─────────────────────────────── 1965 ─────────────────────────────── */
{
  year: 1965, key: 'y1965',
  name: 'Space Age',
  season: 'Summer',
  caption: 'Space Age · Summer, 1965',
  accent: 0xf06a6a, accent2: 0x40c4c8,
  tagline: 'Chrome, formica, and the absolute certainty that the future is going to be great.',
  facts: [
    'The trolley rails were paved over in 1956. You can still see the seams.',
    'Every sign on this block was replaced in the last eight years. Plastic is cheap now.',
    'The Palace shows one film for six weeks. The projectionist is the same man.',
    'Air conditioning arrived on this block in 1961 and everyone has an opinion.',
    'Nobody wears a hat anymore. Nobody can quite say when that happened.',
  ],

  sky: {
    top: 0x2f74c8, horizon: 0xa8d0ea, ground: 0x7a7062,
    sunColor: 0xfff2d8, sunIntensity: 3.3, sunElev: 58, sunAzim: 152,
    ambSky: 0x9fc4e8, ambGround: 0x7a6c56, ambIntensity: 0.95,
    fog: 0xbdd6ea, fogNear: 60, fogFar: 320, haze: 0.22,
    clouds: 0.3, cloudColor: 0xffffff, cloudSpeed: 0.02, stars: 0,
    contrails: true,
  },
  grade: {
    exposure: 1.18, lift: [0.004, 0.006, 0.014], gamma: [1.0, 1.0, 1.0],
    gain: [1.04, 1.02, 1.0], tint: [1.02, 1.0, 0.99],
    sat: 1.30, contrast: 1.12, temp: 0.10,
    vignette: 0.32, grain: 0.030, chroma: 0.22, halation: 0.03,
    sepia: 0, vhs: 0, bleach: 0, holo: 0, dust: 0.04,
    bloomStrength: 0.72, bloomThreshold: 1.2,
  },
  timeOfDay: 13 * 60 + 10,
  weather: 'clear',

  palette: {
    brick: [0x9a5340, 0x8a4634, 0xa86a4a],
    stone: [0xd8d0c0, 0xc4bcaa],
    panel: [0x2ea8b4, 0xe8663a, 0xe8c040, 0x6a9a4a, 0xe8e4d8, 0xd83a5a],
    trim: [0xc8c8cc, 0xe8e4d8, 0x2a2a2e],
    awning: [0x2ea8b4, 0xe8663a, 0xe8c040, 0xffffff],
    paint: [0x2ea8b4, 0xe8663a, 0xe8c040, 0x6a9a4a],
    glass: 0x3a5060, glassTint: 0.14,
    metal: 0xb8bcc0, road: 0x69696f, walk: 0xb0aca0,
    roof: 0x4a4a48,
  },
  road: {
    markings: 'white-dash', wear: 0.28, wet: 0, trolleyTracks: 'ghost',
    cobbleSeams: 0.15, potholes: 0.18, bikeLane: false, crosswalk: 'ladder',
  },
  lamp: 'mercury',
  streetLightsOn: 0.3,
  windowLit: 0.1, windowColor: 0xfff0d0, curtains: [0xe8c040, 0x2ea8b4, 0xe8e4d8, 0xe8663a],

  vehicles: {
    density: 1.0, speed: 12.5,
    types: [
      { kind: 'finSedan', w: 6, colors: [0x2ea8b4, 0xe8e4d8, 0xd83a3a, 0x2a3a6a, 0x6a9a4a, 0xe8c040, 0x1a1a1e] },
      { kind: 'wagon65', w: 3, colors: [0x8a6a4a, 0xe8e4d8, 0x3a5a7a, 0x6a8a5a] },
      { kind: 'muscle65', w: 2, colors: [0xd82a2a, 0x1a1a1e, 0x2a4aaa, 0xe8e4d8] },
      { kind: 'van65', w: 2, colors: [0xe8e4d8, 0x5a8ab0, 0xd8c8a0] },
      { kind: 'bus65', w: 1.4, colors: [0xd8dce0] },
      { kind: 'taxi65', w: 2.5, colors: [0xe8b820] },
      { kind: 'scooter65', w: 1.5, colors: [0xe8e4d8, 0x2ea8b4, 0xd83a5a] },
    ],
    bikes: 0.3, horn: 'brass',
  },
  peds: {
    density: 1.0, speed: 1.34,
    coats: [0x2ea8b4, 0xe8663a, 0xe8c040, 0x6a9a4a, 0xe8e4d8, 0xd83a5a, 0x2a3a6a],
    shirts: [0xffffff, 0xe8e4d8, 0xb8d8e8, 0xf0e0c0],
    trousers: [0x2a2a3a, 0x4a4a52, 0x6a5a3a, 0x2a3a4a],
    dress: [0xe8c040, 0x2ea8b4, 0xd83a5a, 0xe8663a, 0xffffff, 0x6a9a4a],
    skin: [0xe8c4a0, 0xd8ac84, 0xa87850, 0x8a5f3c, 0x6b4429, 0xf0d0b0],
    hair: [0x2a1f18, 0x1a1410, 0x8a6a40, 0xc8a860, 0x5a3a20, 0x3a2a20],
    hats: 0.22, hatKinds: ['pillbox', 'fedora', 'headscarf'],
    accessories: ['briefcase', 'shoppingbag', 'transistor', 'camera', 'none', 'none', 'none'],
    uniforms: 0.02,
    behaviours: ['stroll', 'window', 'chat', 'hurry', 'photograph'],
  },
  props: [
    'mailboxUSPS', 'hydrantSquat', 'parkingMeterChrome', 'phoneBoothGlass',
    'busShelter65', 'newsRack', 'cigMachine', 'trashCan65', 'plantersRound',
    'fireEscape', 'waterTower', 'fallout', 'acWindow', 'neonSign',
  ],
  ads: {
    wall: ['ENJOY THE PAUSE THAT REFRESHES', 'FLY THE FRIENDLY SKIES', 'PALL MALL — OUTSTANDING!'],
    board: 'THE NEW ’66s ARE HERE · SEE YOUR DEALER',
    posters: ['SEE THE U.S.A.', 'COLOR TV — NOW UNDER $400', 'GEMINI: MAN IN SPACE'],
    tone: 'offset',
  },
  audio: {
    ambienceBed: { rumbleHz: 55, rumbleGain: 0.13, airGain: 0.05, airHz: 900 },
    layers: ['busAir', 'jetHigh', 'radioSurf', 'crowdMurmur', 'construction'],
    music: {
      style: 'surfpop', bpm: 132, key: 'E', root: 164.81,
      scale: [0, 2, 4, 5, 7, 9, 11], swing: 0.5,
      voices: ['twangGuitar', 'organ', 'bass', 'kit', 'handclap'],
      radioFilter: [300, 4200], radioNoise: 0.03, gain: 0.5,
    },
    trafficTone: { engineHz: 78, engineQ: 4, tireGain: 0.2 },
    footstep: { kind: 'leather', bright: 0.7 },
  },
  lots: {
    palace: {
      style: 'refaced', floors: 4, facade: 0xd8d4c8, trim: 0xe8663a, condition: 0.18,
      shop: 'PALACE CINEMA', signType: 'marquee', signColor: 0xffffff, blade: 'PALACE',
      bladeColor: 0xe8663a, marqueeText: ['THUNDERBALL', 'DR. ZHIVAGO', 'CINEMASCOPE'],
      bulbs: 72, panelColor: 0xe8663a, windows: 'sealed', cornice: 'clipped',
      roof: ['watertank', 'acUnit', 'pigeons'],
      wallAd: 'PALACE CINEMA · AIR CONDITIONED · COOL INSIDE',
      story: 'The terracotta was clad over in 1958 because old looked poor. The marquee is plastic now, and lighter, and nobody misses the bulbs except the usher.',
    },
    drug: {
      style: 'panel', floors: 3, facade: 0xe8e4d8, trim: 0x2ea8b4, condition: 0.1,
      shop: 'VALU DRUG', sub: 'PRESCRIPTIONS · LUNCHEONETTE · SUNDRIES',
      signType: 'plastic', signColor: 0x2ea8b4, neon: 'DRUG', neonColor: 0xe8663a,
      awning: null, windows: 'picture', cornice: 'clipped', panelColor: 0x2ea8b4,
      roof: ['acUnit', 'vent'], display: 'sundries', starburst: true,
      story: 'Otto sold in ’57. The marble fountain went to a scrapyard in Newark. The new counter is formica and wipes clean.',
    },
    hotel: {
      style: 'brick', floors: 5, facade: 0x8a4634, trim: 0x6a5522, condition: 0.42,
      shop: 'HOTEL VERNON', sub: 'TV IN EVERY ROOM · $4 NIGHTLY',
      signType: 'vertical', signColor: 0xe8503a, windows: 'sash', cornice: 'bracketed',
      fireEscape: true, roof: ['watertank', 'antenna', 'clothesline', 'pigeons'],
      wallAd: 'HOTEL VERNON · TELEVISION · AIR COOLED',
      acUnits: 0.35,
      story: 'A television aerial for every window that can afford one. The lobby telephone is now a booth, and it has a door.',
    },
    grocer: {
      style: 'panel', floors: 3, facade: 0xe8e4d8, trim: 0xe8c040, condition: 0.14,
      shop: 'SUPER MARKET', sub: 'SELF SERVICE · SHOP & SAVE',
      signType: 'plastic', signColor: 0xe8663a, awning: null, windows: 'picture',
      cornice: 'clipped', panelColor: 0xe8c040, display: 'supermarket',
      roof: ['acUnit'], starburst: true,
      story: 'Self service. You take a cart and touch the food yourself, which struck a lot of people as unsanitary for about a year.',
    },
    lot: {
      style: 'open', use: 'gasStation', canopy: 0xe8e4d8, canopyTrim: 0xe8663a,
      pumps: 2, pumpColor: 0xd83a3a, sign: 'REGULAR 31.9 · ETHYL 35.9',
      tree: { h: 6.4, r: 2.6, kind: 'young' },
      story: 'The cabbages lost to a two-pump filling station in 1953. The sapling survived because the contractor’s daughter cried about it.',
    },
    arcade: {
      style: 'googie', floors: 2, facade: 0xe8e4d8, trim: 0x2ea8b4, condition: 0.08,
      shop: 'STAR-LITE LANES', sub: '12 LANES · AUTOMATIC PINSPOTTERS · COCKTAILS',
      signType: 'googie', signColor: 0xe8c040, neon: 'BOWL', neonColor: 0xd83a5a,
      windows: 'picture', cornice: 'angled', starburst: true, boomerang: true,
      roof: ['acUnit', 'neonPylon'], display: 'bowling',
      story: 'The barber retired and a man from Ohio put twelve lanes where the chairs were. On Fridays you can hear the pins from the corner.',
    },
    bank: {
      style: 'modernised', floors: 3, facade: 0xd8d0c0, trim: 0xb8bcc0, condition: 0.1,
      shop: 'FIRST MERCHANTS', sub: 'SAVINGS 4¼% · DRIVE-UP WINDOW',
      signType: 'aluminium', columns: 6, columnsClad: true, clock: true,
      windows: 'tall-arched', cornice: 'dentil', roof: ['parapet', 'flagpole', 'acUnit'],
      story: 'They clad the columns in aluminium to look forward-thinking. Underneath, the limestone is exactly where it was.',
    },
    dime: {
      style: 'panel', floors: 3, facade: 0xe8e4d8, trim: 0xd83a5a, condition: 0.12,
      shop: 'HI-FI & TELEVISION', sub: 'COLOR SETS · STEREO CONSOLES · EASY TERMS',
      signType: 'plastic', signColor: 0xd83a5a, neon: 'TV', neonColor: 0x2ea8b4,
      windows: 'picture', cornice: 'clipped', panelColor: 0xd83a5a, display: 'television',
      roof: ['antenna', 'acUnit'],
      story: 'Woolton’s closed in ’62. Eleven television sets in the window, all tuned to the same channel, all slightly out of sync.',
    },
  },
},

/* ─────────────────────────────── 1985 ─────────────────────────────── */
{
  year: 1985, key: 'y1985',
  name: 'Neon Decline',
  season: 'Winter',
  caption: 'Neon Decline · Winter, 1985',
  accent: 0xe264c8, accent2: 0x4ad8f0,
  tagline: 'The money left, the neon stayed, and the whole block runs on magenta.',
  facts: [
    'Rent on the corner store is $340 a month and the landlord cannot find a tenant.',
    'The Palace has been closed for six years. The marquee still spells most of a word.',
    'Every roll-down grate on this street was installed after 1979.',
    'The arcade takes $600 in quarters on a good Friday.',
    'Somebody has tagged the lot wall four times this year. The tag says KAI.',
  ],

  sky: {
    top: 0x14182c, horizon: 0x3a2a48, ground: 0x1a1620,
    sunColor: 0xff9a5a, sunIntensity: 0.55, sunElev: 4, sunAzim: 262,
    ambSky: 0x3a3a5c, ambGround: 0x241c28, ambIntensity: 0.5,
    fog: 0x261e34, fogNear: 22, fogFar: 165, haze: 0.72,
    clouds: 0.72, cloudColor: 0x3a3048, cloudSpeed: 0.03, stars: 0.35,
    neonBounce: 0.7,
  },
  grade: {
    exposure: 1.22, lift: [0.03, 0.012, 0.05], gamma: [1.0, 1.02, 0.97],
    gain: [1.02, 0.98, 1.1], tint: [1.02, 0.97, 1.1],
    sat: 1.24, contrast: 1.18, temp: -0.14,
    vignette: 0.54, grain: 0.052, chroma: 0.48, halation: 0.36,
    sepia: 0, vhs: 0.26, bleach: 0, holo: 0, dust: 0.04,
    bloomStrength: 1.5, bloomThreshold: 0.72,
  },
  timeOfDay: 19 * 60 + 55,
  weather: 'rain',

  palette: {
    brick: [0x5a3a30, 0x4a3028, 0x6a4438],
    stone: [0x8a8478, 0x767064],
    panel: [0x8a8070, 0xa89880, 0x6a6a6a],
    trim: [0x2a2a2e, 0x4a4444, 0x1a1a1e],
    awning: [0x2a3a5a, 0x5a2a2a, 0x2a4a3a],
    paint: [0x6a5a4a, 0x4a4a52, 0x7a6a5a],
    glass: 0x1a1e26, glassTint: 0.2,
    metal: 0x53504c, road: 0x4e4e58, walk: 0x6a6862,
    roof: 0x2a2a30,
    neon: [0xff2d95, 0x00e5ff, 0xffe500, 0x39ff6a, 0xff5d00, 0xb44dff],
  },
  road: {
    markings: 'yellow-double', wear: 0.68, wet: 0.85, trolleyTracks: 'ghost',
    cobbleSeams: 0.3, potholes: 0.7, bikeLane: false, crosswalk: 'ladder-worn',
    steamManhole: true,
  },
  lamp: 'sodium',
  streetLightsOn: 1.0,
  windowLit: 0.28, windowColor: 0xffb060, curtains: [0x8a4a2a, 0x4a4a5a, 0x6a3a4a],

  vehicles: {
    density: 0.85, speed: 11,
    types: [
      { kind: 'boxSedan', w: 6, colors: [0x8a8478, 0x5a6a7a, 0x7a2a2a, 0x2a3a4a, 0xd8d4c8, 0x3a4a3a] },
      { kind: 'woodWagon', w: 2, colors: [0x6a5a3a] },
      { kind: 'hatch85', w: 3, colors: [0xd82a4a, 0x2a5aaa, 0xe8e4d8, 0x3a3a3a] },
      { kind: 'pickup85', w: 2, colors: [0x2a4a7a, 0x7a1a1a, 0xd8d4c8] },
      { kind: 'taxi85', w: 2.5, colors: [0xf0c020] },
      { kind: 'van85', w: 1.6, colors: [0xd8d4c8, 0x5a6a7a] },
      { kind: 'delorean', w: 0.28, colors: [0xc8ccd0], secret: 'delorean' },
    ],
    bikes: 0.4, skaters: 0.35, horn: 'flat',
  },
  peds: {
    density: 0.78, speed: 1.3,
    coats: [0xff2d95, 0x00b8d4, 0xffe500, 0x39d46a, 0x2a2a3a, 0xd8d4c8, 0xb44dff, 0xff5d00],
    shirts: [0xffffff, 0xffe500, 0xff2d95, 0x00e5ff],
    trousers: [0x2a3a6a, 0x1a1a2a, 0x4a4a52, 0x6a2a4a],
    dress: [0xff2d95, 0xb44dff, 0x00e5ff, 0x2a2a3a],
    skin: [0xe8c4a0, 0xd8ac84, 0xa87850, 0x8a5f3c, 0x6b4429, 0xf0d0b0],
    hair: [0x2a1f18, 0x1a1410, 0x8a6a40, 0xd8b060, 0x5a3a20, 0x7a2a4a],
    hats: 0.14, hatKinds: ['beanie', 'cap', 'sweatband'],
    accessories: ['boombox', 'walkman', 'briefcase', 'skateboard', 'umbrella', 'none', 'none'],
    uniforms: 0,
    behaviours: ['hurry', 'chat', 'window', 'skate', 'busk', 'shelter'],
  },
  props: [
    'mailboxUSPS', 'hydrantModern', 'payphoneShell', 'newsRackTabloid', 'dumpster',
    'steamManhole', 'graffiti', 'chainlink', 'securityGrate', 'satelliteDish',
    'trashCan85', 'milkCrate', 'bikeChained', 'busShelter85', 'acWindow',
    'fireEscape', 'waterTower', 'neonSign', 'plywood', 'trafficCone',
  ],
  ads: {
    wall: ['NEW YORK IS BOOK COUNTRY', 'MARLBORO', 'DRINK COLA — THE CHOICE OF A NEW GENERATION'],
    board: 'NOW ON VIDEOCASSETTE · RENT TONIGHT',
    posters: ['GO METS', 'AEROBICS 6AM DAILY', 'MISSING: HAVE YOU SEEN THIS CAT'],
    tone: 'screenprint',
  },
  audio: {
    ambienceBed: { rumbleHz: 48, rumbleGain: 0.16, airGain: 0.07, airHz: 480 },
    layers: ['arcadeBleeps', 'boombox', 'carAlarm', 'steamHiss', 'subwayRumble', 'sirenDistant', 'rain'],
    music: {
      style: 'synthwave', bpm: 118, key: 'Am', root: 110.0,
      scale: [0, 2, 3, 5, 7, 8, 10], swing: 0.5,
      voices: ['sawPad', 'arpBass', 'gatedSnare', 'brassStab'],
      radioFilter: [140, 6500], radioNoise: 0.02, gain: 0.56,
    },
    trafficTone: { engineHz: 70, engineQ: 3, tireGain: 0.28 },
    footstep: { kind: 'wet', bright: 0.5 },
  },
  lots: {
    palace: {
      style: 'refaced', floors: 4, facade: 0xa89880, trim: 0x8a5a3a, condition: 0.72,
      shop: 'VIDEO VAULT', sub: 'VHS · BETA · NEW RELEASES 99¢',
      signType: 'marqueeBroken', signColor: 0xd8d0b0, blade: 'PAL CE',
      bladeColor: 0xe8503a, bladeBroken: true,
      marqueeText: ['C OSED', 'VIDEO VAULT NOW OPEN', 'BE KIND REWIND'],
      bulbs: 34, bulbsDead: 0.55, neon: 'VIDEO', neonColor: 0xff2d95,
      windows: 'boarded', cornice: 'clipped', boardedFrom: 2,
      roof: ['watertank', 'acUnit', 'satelliteDish', 'pigeons'],
      wallAd: 'PALACE — GHOST SIGN', wallAdFaded: 0.7,
      graffiti: true,
      story: 'The cinema closed in ’79. A man rents tapes out of the lobby now, under a marquee that has lost its A. Upstairs is plywood.',
    },
    drug: {
      style: 'panel', floors: 3, facade: 0x8a8070, trim: 0x2a2a2e, condition: 0.6,
      shop: 'CHECK CASHING', sub: 'GOLD BOUGHT · MONEY ORDERS · LOTTO',
      signType: 'plasticLit', signColor: 0xffe500, neon: 'CASH', neonColor: 0x39ff6a,
      grate: true, windows: 'picture', cornice: 'clipped',
      roof: ['acUnit', 'satelliteDish'], display: 'cashwindow',
      bars: true,
      story: 'The luncheonette closed in ’74. Bullet-resistant acrylic, a lazy susan tray, and a hand-lettered sign about the exact fee.',
    },
    hotel: {
      style: 'brick', floors: 5, facade: 0x4a3028, trim: 0x2a2a2e, condition: 0.86,
      shop: 'THE VERNON', sub: 'SINGLE ROOM OCCUPANCY',
      signType: 'verticalBroken', signColor: 0xe8503a, signDead: 0.6,
      windows: 'sash', cornice: 'bracketed', boarded: 0.35,
      fireEscape: true, roof: ['watertank', 'antenna', 'satelliteDish', 'pigeons'],
      wallAd: 'HOTEL VERNON', wallAdFaded: 0.85, graffiti: true, acUnits: 0.25,
      story: 'Two floors are empty and the city says that’s temporary. The neon V has been out since the blackout.',
    },
    grocer: {
      style: 'panel', floors: 3, facade: 0xa89880, trim: 0x2a4a3a, condition: 0.55,
      shop: 'DELI · GROCERY', sub: 'BEER · LOTTO · OPEN 24 HRS',
      signType: 'plasticLit', signColor: 0xd82a2a,
      neon: 'OPEN 24 HRS', neonColor: 0x00e5ff, beerNeon: true,
      awning: 0x2a4a3a, windows: 'picture', cornice: 'clipped', grate: 'half',
      roof: ['acUnit'], display: 'bodega',
      story: 'Three generations of Marconis and then, in 1981, a family from Seoul who kept the name on the awning because the block liked it.',
    },
    lot: {
      style: 'open', use: 'parking', fence: 'chainlink', asphalt: 0x2a2a2e,
      cracked: 0.8, sign: 'PARK $3 ALL DAY · NOT RESPONSIBLE',
      tree: { h: 0.6, r: 0.5, kind: 'stump' },
      graffitiWall: 'KAI ’85',
      parkedCars: 5,
      story: 'The pumps came out in ’78 when the tanks failed inspection. Somebody cut the tree down the same week, for the parking spaces.',
    },
    arcade: {
      style: 'googie', floors: 2, facade: 0x6a6a6a, trim: 0xff2d95, condition: 0.5,
      shop: 'GALAXY ARCADE', sub: '25¢ PLAY · OPEN TILL 2AM',
      signType: 'neonBox', signColor: 0xff2d95, neon: 'GALAXY', neonColor: 0x00e5ff,
      windows: 'tinted', cornice: 'angled', glowInterior: 0xb44dff,
      roof: ['acUnit', 'neonPylonDead'], display: 'arcade',
      cabinets: 8, graffiti: true,
      story: 'The lanes came out in ’81. Eight cabinets, a change machine that jams, and the best high score in the city taped to the wall.',
    },
    bank: {
      style: 'modernised', floors: 3, facade: 0x8a8478, trim: 0x53504c, condition: 0.4,
      shop: 'FIRST MERCHANTS', sub: '24-HOUR CASH MACHINE',
      signType: 'aluminium', columns: 6, columnsClad: true,
      clock: true, clockStopped: 4 * 60 + 7,
      atm: true, atmGlow: 0x39ff6a,
      windows: 'tall-arched', cornice: 'dentil', roof: ['parapet', 'acUnit'],
      story: 'The clock stopped at 4:07 during the blackout and nobody ever came to wind it. The new cash machine works, though, and it works all night.',
    },
    dime: {
      style: 'panel', floors: 3, facade: 0x8a8070, trim: 0xb44dff, condition: 0.48,
      shop: "BEN'S RECORDS", sub: "LP's · 45's · CASSETTES · CD's SOON",
      signType: 'handpainted', signColor: 0xff2d95, neon: 'RECORDS', neonColor: 0xffe500,
      windows: 'picture', cornice: 'clipped', display: 'records',
      roof: ['acUnit'], graffiti: true, posters: 12,
      story: 'Ben covered the window in gig flyers because the sun was bleaching the sleeves. Now the flyers are the display.',
    },
  },
},

/* ─────────────────────────────── 2005 ─────────────────────────────── */
{
  year: 2005, key: 'y2005',
  name: 'Broadband Years',
  season: 'Spring',
  caption: 'Broadband Years · Spring, 2005',
  accent: 0x9fb4c8, accent2: 0x5aa8d8,
  tagline: 'Silver plastic, beige everything, and a crane where the parking lot used to be.',
  facts: [
    'Every second person on this street is holding a phone that flips.',
    'The scaffolding on the Vernon has been up for fourteen months.',
    'There are four security cameras on this block. In 1985 there were none.',
    'The internet café charges a dollar an hour and is always full.',
    'Somebody painted over the KAI tag in 1998. You can still see it in the right light.',
  ],

  sky: {
    top: 0x8ea4b8, horizon: 0xc4ced6, ground: 0x7a7a76,
    sunColor: 0xf0f4ff, sunIntensity: 2.1, sunElev: 46, sunAzim: 176,
    ambSky: 0xb8c8d8, ambGround: 0x6a6a68, ambIntensity: 1.05,
    fog: 0xc0c8d0, fogNear: 55, fogFar: 290, haze: 0.35,
    clouds: 0.82, cloudColor: 0xd8dee4, cloudSpeed: 0.026, stars: 0,
    overcast: true,
  },
  grade: {
    exposure: 1.12, lift: [0.016, 0.018, 0.022], gamma: [1.0, 1.0, 1.0],
    gain: [0.99, 1.0, 1.02], tint: [0.98, 1.0, 1.03],
    sat: 0.92, contrast: 1.1, temp: -0.09,
    vignette: 0.3, grain: 0.022, chroma: 0.18, halation: 0,
    sepia: 0, vhs: 0, bleach: 0.34, holo: 0, dust: 0.02,
    bloomStrength: 0.5, bloomThreshold: 1.3,
  },
  timeOfDay: 11 * 60 + 25,
  weather: 'overcast',

  palette: {
    brick: [0x8a5a48, 0x7a4e3e, 0x9a6a52],
    stone: [0xb8b4ac, 0xa4a09a],
    panel: [0xb8bcc0, 0xd8d8d4, 0x8a9aa8, 0x6a7a86],
    trim: [0x9aa0a6, 0x4a4e52, 0xd8d8d4],
    awning: [0x2a4a6a, 0x6a2a2a, 0x3a5a3a],
    paint: [0xb8b4ac, 0x8a9aa8, 0xc8c4bc],
    glass: 0x2e3a44, glassTint: 0.3,
    metal: 0x9aa0a6, road: 0x5e5e66, walk: 0x8a8880,
    roof: 0x3a3a3e,
  },
  road: {
    markings: 'yellow-double', wear: 0.4, wet: 0.25, trolleyTracks: 'ghost',
    cobbleSeams: 0.2, potholes: 0.35, bikeLane: false, crosswalk: 'continental',
  },
  lamp: 'halide',
  streetLightsOn: 0.15,
  windowLit: 0.14, windowColor: 0xf0f4ff, curtains: [0xd8d8d4, 0x8a9aa8, 0xb8b4ac],

  vehicles: {
    density: 1.15, speed: 12,
    types: [
      { kind: 'suv05', w: 5, colors: [0xc8ccd0, 0x2a2a2e, 0x6a7280, 0x8a3030, 0xd8d8d4] },
      { kind: 'sedan05', w: 5, colors: [0xc8ccd0, 0x2a2a2e, 0x4a5a7a, 0xd8d8d4, 0x6a6a6a] },
      { kind: 'minivan05', w: 2.5, colors: [0x8a9aa8, 0xc8ccd0, 0x5a6a52] },
      { kind: 'hybrid05', w: 2, colors: [0x4a8a6a, 0xc8ccd0, 0x2a5a8a] },
      { kind: 'taxi05', w: 2.5, colors: [0xf0c020] },
      { kind: 'bus05', w: 1.4, colors: [0xd8dce0] },
      { kind: 'deliveryVan05', w: 2, colors: [0xd8d8d4, 0x8a4a2a] },
      { kind: 'moped05', w: 1.2, colors: [0x2a2a2e, 0xd82a4a] },
    ],
    bikes: 0.5, horn: 'beep',
  },
  peds: {
    density: 1.15, speed: 1.36,
    coats: [0x2a4a6a, 0x6a2a2a, 0x2a2a2e, 0xd8d8d4, 0x4a5a3a, 0x8a3a5a, 0x6a6a72],
    shirts: [0xffffff, 0xd8d8d4, 0x5a8ac8, 0xd8a840, 0x8a3a5a],
    trousers: [0x3a4a6a, 0x2a2a2e, 0x6a6252, 0x4a4a52],
    dress: [0x8a3a5a, 0x2a4a6a, 0x4a4a52, 0xd8d8d4],
    skin: [0xe8c4a0, 0xd8ac84, 0xa87850, 0x8a5f3c, 0x6b4429, 0xf0d0b0],
    hair: [0x2a1f18, 0x1a1410, 0x8a6a40, 0xd8c078, 0x5a3a20, 0x3a2a20],
    hats: 0.18, hatKinds: ['truckercap', 'beanie', 'cap'],
    accessories: ['flipphone', 'ipod', 'coffee', 'backpack', 'rollbag', 'none', 'none'],
    uniforms: 0.04,     // construction hi-vis
    behaviours: ['hurry', 'phone', 'chat', 'window', 'coffee', 'smoke'],
  },
  props: [
    'mailboxUSPS', 'hydrantModern', 'payphoneStub', 'newsRackFree', 'recycleBin',
    'bikeRack', 'meterKiosk', 'sidewalkShed', 'crane', 'securityCam',
    'trashCan05', 'busShelterAd', 'planterBox', 'acRooftop', 'cellAntenna',
    'fireEscape', 'waterTower', 'scaffold', 'sandwichBoard', 'trafficCone',
  ],
  ads: {
    wall: ['GET BROADBAND. GET GOING.', 'UNLIMITED NIGHTS & WEEKENDS', 'DRINK COLA ZERO'],
    board: '1,000 SONGS IN YOUR POCKET',
    posters: ['NOW HIRING — APPLY WITHIN', 'FREE WIFI INSIDE', 'GRAND OPENING'],
    tone: 'digital',
  },
  audio: {
    ambienceBed: { rumbleHz: 52, rumbleGain: 0.14, airGain: 0.06, airHz: 780 },
    layers: ['ringtonePoly', 'busAir', 'construction', 'crowdMurmur', 'skateboard', 'hybridWhine'],
    music: {
      style: 'popPunk', bpm: 154, key: 'D', root: 146.83,
      scale: [0, 2, 4, 5, 7, 9, 11], swing: 0.5,
      voices: ['distGuitar', 'bass', 'kit', 'palmMute'],
      radioFilter: [120, 8000], radioNoise: 0.008, gain: 0.46,
    },
    trafficTone: { engineHz: 82, engineQ: 5, tireGain: 0.3 },
    footstep: { kind: 'rubber', bright: 0.45 },
  },
  lots: {
    palace: {
      style: 'refaced', floors: 4, facade: 0xc8c4bc, trim: 0x2a4a6a, condition: 0.3,
      shop: 'MEGA FITNESS 24', sub: 'OPEN 24 HOURS · NO CONTRACT · $19/MO',
      signType: 'vinylBanner', signColor: 0x2a4a6a, blade: 'PALACE', bladeColor: 0x8a8478,
      bladeDead: true, marqueeText: ['MEGA FITNESS 24', 'JOIN TODAY', 'FREE TRIAL'],
      bulbs: 0, windows: 'gymGlass', cornice: 'clipped', ledScroll: true,
      roof: ['acRooftop', 'cellAntenna', 'pigeons'],
      wallAd: 'PALACE', wallAdFaded: 0.85,
      story: 'The tapes went to a landfill in 1998. Now there are treadmills in the balcony and the projection booth is a spin studio.',
    },
    drug: {
      style: 'panel', floors: 3, facade: 0xd8d8d4, trim: 0x5aa8d8, condition: 0.28,
      shop: 'PHONE ZONE', sub: 'UNLOCK ANY PHONE · PREPAID · ACCESSORIES',
      signType: 'ledScroll', signColor: 0x5aa8d8, scrollText: 'ANY PHONE UNLOCKED $20 · SIM CARDS · REPAIRS WHILE-U-WAIT',
      windows: 'picture', cornice: 'clipped', display: 'phones',
      roof: ['acRooftop', 'cellAntenna'], securityCam: true,
      story: 'Nine hundred phones behind the glass and not one of them will still work in twenty years.',
    },
    hotel: {
      style: 'brickClean', floors: 5, facade: 0x8a5a48, trim: 0x4a4e52, condition: 0.35,
      shop: 'VERNON LOFTS', sub: 'LUXURY RESIDENCES FROM $389,000',
      signType: 'developer', signColor: 0x2a4a6a, banner: 'NOW LEASING · MODEL UNIT OPEN',
      windows: 'newSash', cornice: 'bracketed', scaffold: true, sidewalkShed: true,
      roof: ['acRooftop', 'cellAntenna'], fireEscape: true,
      story: 'The SRO tenants were relocated, which is the word used. Fourteen months of scaffolding and a rendering on the hoarding of people who do not live here.',
    },
    grocer: {
      style: 'panel', floors: 3, facade: 0xd8d8d4, trim: 0x8a3030, condition: 0.3,
      shop: 'PHO & BUBBLE TEA', sub: 'LUNCH SPECIAL $6.95 · FREE WIFI',
      signType: 'plasticLit', signColor: 0x8a3030, awning: 0x6a2a2a,
      windows: 'picture', cornice: 'clipped', display: 'pho',
      roof: ['acRooftop'], wifiSign: true,
      story: 'The Kims sold in ’99. The awning finally lost the Marconi name, twenty-four years after the last Marconi.',
    },
    lot: {
      style: 'open', use: 'construction', hoarding: 0x2a4a6a,
      hoardingText: 'COMING 2007 · THE VERNON ANNEX · 42 LUXURY RESIDENCES',
      crane: true, excavation: true, tree: null,
      story: 'They found the gas tanks in March, which cost eight months. Under the tanks they found a wall, and in the wall they found a tin box, and nobody wrote down where it went.',
    },
    arcade: {
      style: 'googie', floors: 2, facade: 0xb8bcc0, trim: 0x5aa8d8, condition: 0.35,
      shop: 'CYBER CAFÉ', sub: 'INTERNET $1/HR · PRINT · FAX · CD BURNING',
      signType: 'plasticLit', signColor: 0x5aa8d8, windows: 'picture',
      cornice: 'angled', display: 'cybercafe', glowInterior: 0x6a9ad8,
      roof: ['acRooftop', 'cellAntenna'], securityCam: true,
      story: 'Twenty-two beige towers in rows. At any hour, at least one person is here doing something that will embarrass them later.',
    },
    bank: {
      style: 'modernised', floors: 3, facade: 0xb8b4ac, trim: 0x9aa0a6, condition: 0.25,
      shop: 'FIRST MERCHANTS', sub: 'ATM · OPEN SATURDAYS',
      signType: 'corporate', columns: 6, columnsClad: false,
      clock: true, atm: true, atmVestibule: true, atmGlow: 0x5aa8d8,
      windows: 'tall-arched', cornice: 'dentil', roof: ['parapet', 'acRooftop', 'securityCam'],
      story: 'Somebody finally rewound the clock in 1996. It has been eleven minutes fast ever since and the branch manager considers that character.',
    },
    dime: {
      style: 'panel', floors: 3, facade: 0xb8bcc0, trim: 0x8a3a5a, condition: 0.32,
      shop: 'DVD & GAMES', sub: 'BUY · SELL · TRADE · PRE-OWNED',
      signType: 'plasticLit', signColor: 0x8a3a5a, windows: 'picture',
      cornice: 'clipped', display: 'dvds', roof: ['acRooftop'], securityCam: true,
      story: 'Ben retired in 1994 and the vinyl went for forty cents a pound. The new owner has a wall of DVDs and a rumour about a format called Blu-ray.',
    },
  },
},

/* ─────────────────────────────── 2025 ─────────────────────────────── */
{
  year: 2025, key: 'y2025',
  name: 'Right Now',
  season: 'Late Summer',
  caption: 'Right Now · Late Summer, 2025',
  accent: 0x7fd6a0, accent2: 0xe8a24a,
  tagline: 'Black window frames, a mural on every blank wall, and three delivery bikes on the corner.',
  facts: [
    'Two storefronts on this block are dark. One has been for sale for three years.',
    'The pocket park exists because 400 people signed something in 2019.',
    'There are nineteen cameras on this block. Most of them are doorbells.',
    'Half the traffic on Fifth is somebody delivering food to somebody else.',
    'The tree in the corner lot was planted in 2021. It is not the original tree.',
  ],

  sky: {
    top: 0x2a5f9e, horizon: 0xf0c49a, ground: 0x6a6252,
    sunColor: 0xffd8a8, sunIntensity: 3.0, sunElev: 24, sunAzim: 288,
    ambSky: 0x9ab8dc, ambGround: 0x70604c, ambIntensity: 0.9,
    fog: 0xe0c0a0, fogNear: 48, fogFar: 280, haze: 0.34,
    clouds: 0.42, cloudColor: 0xf8dcc0, cloudSpeed: 0.018, stars: 0,
    goldenHour: true,
  },
  grade: {
    exposure: 1.16, lift: [0.012, 0.012, 0.02], gamma: [1.0, 1.0, 1.0],
    gain: [1.05, 1.0, 0.97], tint: [1.02, 1.0, 0.98],
    sat: 1.1, contrast: 1.1, temp: 0.14,
    vignette: 0.32, grain: 0.017, chroma: 0.16, halation: 0.1,
    sepia: 0, vhs: 0, bleach: 0, holo: 0, dust: 0.05,
    bloomStrength: 0.85, bloomThreshold: 1.05,
  },
  timeOfDay: 18 * 60 + 50,
  weather: 'clear',

  palette: {
    brick: [0x8a5a48, 0x6a4438, 0x9a6a52],
    stone: [0xc8c4bc, 0xb0aca4],
    panel: [0x2a2a2e, 0x4a4a4e, 0x8a9a7a, 0xc8a882, 0xd8d4cc],
    trim: [0x1a1a1e, 0x2a2a2e, 0xd8d4cc],
    awning: [0x2a2a2e, 0x6a8a5a, 0xc87a4a],
    paint: [0x8a9a7a, 0xc8a882, 0x2a2a2e, 0xd8d4cc],
    glass: 0x28323c, glassTint: 0.35,
    metal: 0x3a3a3e, road: 0x5a5a5e, walk: 0x8e8a82,
    roof: 0x2e2e30,
    mural: [0xe8663a, 0x2ea8b4, 0xe8c040, 0x7fd6a0, 0xb44dff],
  },
  road: {
    markings: 'yellow-double', wear: 0.32, wet: 0.05, trolleyTracks: 'ghost',
    cobbleSeams: 0.18, potholes: 0.3, bikeLane: true, bikeLaneColor: 0x2a7a4a,
    crosswalk: 'continental',
  },
  lamp: 'led',
  streetLightsOn: 0.5,
  windowLit: 0.22, windowColor: 0xffe0b8, curtains: [0xd8d4cc, 0x8a9a7a, 0x2a2a2e],

  vehicles: {
    density: 1.1, speed: 11.5,
    types: [
      { kind: 'ev25', w: 5, colors: [0xd8d8d8, 0x1a1a1e, 0x4a5a6a, 0x2a4a3a, 0x8a2a2a] },
      { kind: 'crossover25', w: 5, colors: [0xd8d8d8, 0x2a2a2e, 0x6a6a72, 0xb8b4ac] },
      { kind: 'cargoBike', w: 3, colors: [0xe8663a, 0x2a7a4a, 0x2a2a2e] },
      { kind: 'escooter', w: 3, colors: [0x2a2a2e, 0xe8c040] },
      { kind: 'rideshare25', w: 2.5, colors: [0x2a2a2e, 0xd8d8d8] },
      { kind: 'deliveryVan25', w: 2.5, colors: [0x9a9a96, 0xd8d8d8] },
      { kind: 'bus25', w: 1.2, colors: [0xd8dce0] },
      { kind: 'angularTruck', w: 0.5, colors: [0xb8bcc0], secret: 'angular' },
      { kind: 'lidarCar', w: 0.7, colors: [0xd8d8d8], secret: 'lidar' },
    ],
    bikes: 1.0, horn: 'beep',
  },
  peds: {
    density: 1.1, speed: 1.32,
    coats: [0x2a2a2e, 0x8a9a7a, 0xc8a882, 0xd8d4cc, 0x4a4a52, 0x6a3a3a, 0x2a4a5a],
    shirts: [0xd8d4cc, 0x2a2a2e, 0xffffff, 0x8a9a7a, 0xe8663a],
    trousers: [0x2a2a3a, 0x1a1a1e, 0x6a6a62, 0x4a4a52],
    dress: [0x8a9a7a, 0xc8a882, 0x2a2a2e, 0xd8d4cc],
    skin: [0xe8c4a0, 0xd8ac84, 0xa87850, 0x8a5f3c, 0x6b4429, 0xf0d0b0],
    hair: [0x2a1f18, 0x1a1410, 0x8a6a40, 0xd8c078, 0x5a3a20, 0x3a5a8a],
    hats: 0.2, hatKinds: ['cap', 'beanie', 'bucket'],
    accessories: ['phone', 'phone', 'coffee', 'totebag', 'earbuds', 'deliverybag', 'dog', 'none'],
    uniforms: 0.08,
    behaviours: ['phone', 'hurry', 'chat', 'coffee', 'dogwalk', 'film', 'deliver'],
  },
  props: [
    'mailboxUSPS', 'hydrantModern', 'bikeRackHoop', 'escooterCorral', 'parklet',
    'planterLarge', 'meterKiosk', 'recycleTrio', 'littleLibrary', 'evCharger',
    'bollard', 'securityCam', 'deliveryRobot', 'trashCan25', 'busShelterLED',
    'fireEscape', 'waterTower', 'solarRoof', 'greenRoof', 'qrPoster', 'sandwichBoard',
  ],
  ads: {
    wall: ['MURAL: THE CORNER, 1945–2025', 'STREAM EVERYTHING', 'GET 40% OFF YOUR FIRST ORDER'],
    board: 'DIGITAL — CYCLING',
    posters: ['LOST DOG — VERY FRIENDLY', 'BLOCK PARTY SAT 2PM', 'SCAN FOR MENU'],
    tone: 'flat',
  },
  audio: {
    ambienceBed: { rumbleHz: 46, rumbleGain: 0.11, airGain: 0.05, airHz: 700 },
    layers: ['evWhine', 'escooterHum', 'notification', 'crowdMurmur', 'espressoMachine', 'droneFar'],
    music: {
      style: 'lofi', bpm: 84, key: 'F', root: 174.61,
      scale: [0, 2, 3, 5, 7, 9, 10], swing: 0.56,
      voices: ['rhodes', 'subBass', 'dustKit', 'vinylCrackle'],
      radioFilter: [90, 9000], radioNoise: 0.012, gain: 0.42,
    },
    trafficTone: { engineHz: 120, engineQ: 8, tireGain: 0.3, electric: true },
    footstep: { kind: 'rubber', bright: 0.4 },
  },
  lots: {
    palace: {
      style: 'restored', floors: 4, facade: 0xc0a882, trim: 0xa8804a, condition: 0.14,
      shop: 'THE PALACE', sub: 'LIVE MUSIC · EST. 1927 · RESTORED 2019',
      signType: 'marqueeLED', signColor: 0xffd8a0, blade: 'PALACE', bladeColor: 0xd83a2a,
      marqueeText: ['TONIGHT: SOLD OUT', 'SAT: THE CORNER SESSIONS', 'EST. 1927'],
      bulbs: 96, windows: 'arched', cornice: 'heavy', heritage: true,
      roof: ['watertank', 'solarRoof', 'acRooftop', 'pigeons'],
      wallAd: 'MURAL', mural: true,
      story: 'A preservation fight that took nine years and three lawsuits. The terracotta underneath the 1958 cladding was almost perfect. Almost.',
    },
    drug: {
      style: 'timber', floors: 3, facade: 0xc8a882, trim: 0x2a2a2e, condition: 0.1,
      shop: 'OAT + ARROW', sub: 'COFFEE · PASTRY · NO WIFI ON WEEKENDS',
      signType: 'minimal', signColor: 0x2a2a2e, awning: 0x2a2a2e,
      windows: 'blackFrame', cornice: 'clipped', display: 'coffee',
      parklet: true, roof: ['solarRoof', 'greenRoof'], qr: true,
      story: 'Four dollars for a filter coffee, which the neighbourhood has strong feelings about, and a queue every morning that settles the argument.',
    },
    hotel: {
      style: 'brickClean', floors: 5, facade: 0x8a5a48, trim: 0x1a1a1e, condition: 0.16,
      shop: 'VERNON LOFTS', sub: 'RESIDENCES',
      signType: 'minimal', signColor: 0x2a2a2e, windows: 'blackFrame',
      cornice: 'bracketed', roof: ['greenRoof', 'solarRoof', 'acRooftop', 'deck'],
      fireEscape: true, planters: true,
      story: 'Two-bed, no lift, $1.1m. The fire escape is decorative now and structurally the most argued-about object on the block.',
    },
    grocer: {
      style: 'timber', floors: 3, facade: 0x8a9a7a, trim: 0x2a2a2e, condition: 0.12,
      shop: 'REFILL', sub: 'ZERO WASTE · BRING YOUR OWN JAR',
      signType: 'minimal', signColor: 0xd8d4cc, awning: 0x6a8a5a,
      windows: 'blackFrame', cornice: 'clipped', display: 'refill',
      roof: ['greenRoof'], planters: true, qr: true,
      story: 'Jars of oats and a laminated card explaining the tare weight. The owner grew up two blocks away and remembers the pho place.',
    },
    lot: {
      style: 'open', use: 'pocketPark', paving: 0x9a8e80,
      tree: { h: 7.2, r: 3.4, kind: 'young' },
      benches: 3, mural: true, muralText: 'THE CORNER · 1945–2025',
      library: true, sign: 'VINE STREET POCKET PARK · OPEN DAWN–DUSK',
      story: 'The Annex was never built; the 2008 crash killed it and the lot sat behind hoarding for eleven years. Four hundred signatures turned it into this.',
    },
    arcade: {
      style: 'panel', floors: 2, facade: 0x4a4a4e, trim: 0xe8663a, condition: 0.2,
      shop: 'FIFTH ST. CLIMBING', sub: 'BOULDERING · DAY PASS $28',
      signType: 'minimal', signColor: 0xe8663a, windows: 'blackFrame',
      cornice: 'angled', display: 'climbing', glowInterior: 0xe8a24a,
      roof: ['acRooftop', 'solarRoof'], qr: true,
      story: 'The googie roofline survived four tenants because it is load-bearing and removing it costs more than keeping it.',
    },
    bank: {
      style: 'modernised', floors: 3, facade: 0xb8b4ac, trim: 0x2a2a2e, condition: 0.3,
      shop: 'FOR LEASE', sub: '4,200 SQ FT · GROUND FLOOR · CALL',
      signType: 'forLease', signColor: 0xd82a2a, columns: 6, columnsClad: false,
      clock: true, ghostKitchen: true, vacant: true,
      windows: 'tall-arched', cornice: 'dentil', roof: ['parapet', 'acRooftop', 'cellAntenna'],
      story: 'The branch closed in 2021. Behind the boarded windows, four kitchens cook for four apps under four names that do not exist anywhere else.',
    },
    dime: {
      style: 'panel', floors: 3, facade: 0x4a4a4e, trim: 0x7fd6a0, condition: 0.28,
      shop: 'GREEN LEAF', sub: 'CANNABIS DISPENSARY · 21+ · ID REQUIRED',
      signType: 'led', signColor: 0x7fd6a0, windows: 'frosted',
      cornice: 'clipped', display: 'dispensary', securityCam: true,
      roof: ['acRooftop'], qr: true,
      story: 'Licence number in the window, guard on a stool, and the same floor tiles Woolton’s laid in 1931 under the vinyl.',
    },
  },
},

/* ─────────────────────────────── 2055 ─────────────────────────────── */
{
  year: 2055, key: 'y2055',
  name: 'The Retrofit',
  season: 'Warm Season',
  caption: 'The Retrofit · Warm Season, 2055',
  accent: 0x56d0e0, accent2: 0x9fe870,
  tagline: 'The block did not get replaced. It got re-grown.',
  facts: [
    'The facades grow food. Roughly 40% of what this block eats comes off its own walls.',
    'No vehicle on Fifth has a driver. Two of them still have steering wheels, for the look.',
    'The Palace marquee replays every marquee it ever wore, on a nine-minute loop.',
    'Street noise here is 18 decibels quieter than it was in 2025.',
    'The tree in the corner lot is thirty-four years old and has a legal designation.',
  ],

  sky: {
    top: 0x123448, horizon: 0x3e6a72, ground: 0x1a2a2a,
    sunColor: 0xffc890, sunIntensity: 1.15, sunElev: 8, sunAzim: 296,
    ambSky: 0x4a7a8c, ambGround: 0x24343a, ambIntensity: 0.72,
    fog: 0x28454e, fogNear: 32, fogFar: 240, haze: 0.6,
    clouds: 0.5, cloudColor: 0x3a5a64, cloudSpeed: 0.014, stars: 0.5,
    holoGlow: 0.8, airTaxis: true,
  },
  grade: {
    exposure: 1.16, lift: [0.014, 0.03, 0.036], gamma: [1.02, 1.0, 0.99],
    gain: [0.98, 1.03, 1.06], tint: [0.97, 1.02, 1.06],
    sat: 1.16, contrast: 1.12, temp: -0.12,
    vignette: 0.40, grain: 0.022, chroma: 0.30, halation: 0.16,
    sepia: 0, vhs: 0, bleach: 0, holo: 0.32, dust: 0.11,
    bloomStrength: 1.25, bloomThreshold: 0.88,
  },
  timeOfDay: 20 * 60 + 15,
  weather: 'haze',

  palette: {
    brick: [0x6a4a40, 0x5a3e36, 0x7a5a4a],
    stone: [0xa8a49c, 0x8e8a82],
    panel: [0x1e3a3e, 0x2a4a4a, 0x3a5a52, 0xd8dcd8, 0x4a6a5a],
    trim: [0x1a2a2e, 0x56d0e0, 0xd8dcd8],
    awning: [0x1e3a3e, 0x2a5a4a],
    paint: [0x2a4a4a, 0x3a5a52, 0x9fe870],
    glass: 0x1e3038, glassTint: 0.42,
    metal: 0x5a6a6a, road: 0x51565b, walk: 0x7a8480,
    roof: 0x24343a,
    bio: [0x3a7a4a, 0x5a9a5a, 0x2a6a3a, 0x9fe870],
    holo: [0x56d0e0, 0xe864c8, 0x9fe870, 0xffd070],
  },
  road: {
    markings: 'smart-lane', wear: 0.2, wet: 0.15, trolleyTracks: 'heritage',
    cobbleSeams: 0.12, potholes: 0.1, bikeLane: true, bikeLaneColor: 0x2a6a6a,
    crosswalk: 'lit', inductionPads: true,
  },
  lamp: 'ledwarm',
  streetLightsOn: 1.0,
  windowLit: 0.34, windowColor: 0xffd8b0, curtains: [0xd8dcd8, 0x3a5a52, 0x9fe870],

  vehicles: {
    density: 0.85, speed: 10,
    types: [
      { kind: 'pod55', w: 7, colors: [0xd8dcd8, 0x2a4a4a, 0x56d0e0, 0x3a5a52, 0xe0e4e0] },
      { kind: 'shuttle55', w: 2.5, colors: [0xd8dcd8, 0x3a6a6a] },
      { kind: 'cargoDrone', w: 3, colors: [0x3a4a4a, 0x56d0e0] },
      { kind: 'walkerBot', w: 2, colors: [0x8a9a9a, 0x56d0e0] },
      { kind: 'classicCar', w: 0.35, colors: [0xd83a2a], secret: 'classic' },
    ],
    bikes: 0.7, horn: 'chime',
  },
  peds: {
    density: 0.85, speed: 1.28,
    coats: [0x1e3a3e, 0x2a5a4a, 0xd8dcd8, 0x3a5a62, 0x56d0e0, 0x4a4a56, 0x9fe870],
    shirts: [0xd8dcd8, 0x2a4a4a, 0xe0e4e0, 0x56d0e0],
    trousers: [0x1a2a2e, 0x2a3a3e, 0x4a5a5a],
    dress: [0x56d0e0, 0x9fe870, 0xd8dcd8, 0x2a4a4a],
    skin: [0xe8c4a0, 0xd8ac84, 0xa87850, 0x8a5f3c, 0x6b4429, 0xf0d0b0],
    hair: [0x2a1f18, 0x1a1410, 0x8a6a40, 0xd8c078, 0x56d0e0, 0xe864c8],
    hats: 0.3, hatKinds: ['visor', 'hood', 'cap'],
    accessories: ['arvisor', 'arvisor', 'filtermask', 'petdrone', 'satchel', 'none', 'cane-exo'],
    uniforms: 0.06,
    behaviours: ['stroll', 'ar', 'chat', 'hurry', 'tend'],
    emissive: 0.35,     // trim lighting on garments
  },
  props: [
    'hydrantHeritage', 'bollardHolo', 'inductionPad', 'airPylon', 'mistArch',
    'hydroPlanter', 'cleanBot', 'droneDock', 'eInkSign', 'solarCanopy',
    'benchGlow', 'greenWall', 'fireEscape', 'waterReclaim', 'holoAd',
    'heritagePlaque', 'seedLibrary',
  ],
  ads: {
    wall: ['VERTICAL FARM CO-OP · MEMBER OWNED', 'CLIMATE CREDITS ACCEPTED HERE', 'OPT OUT'],
    board: 'HOLOGRAPHIC — PERSONALISED',
    posters: ['REPAIR, DON’T REPLACE', 'HERITAGE BLOCK · PROTECTED', 'SEED SWAP SUNDAY'],
    tone: 'holo',
  },
  audio: {
    ambienceBed: { rumbleHz: 34, rumbleGain: 0.07, airGain: 0.035, airHz: 1200 },
    layers: ['droneHum', 'airTaxi', 'arChime', 'birdSynth', 'mistHiss', 'crowdMurmurLow'],
    music: {
      style: 'ambient', bpm: 62, key: 'Dm', root: 146.83,
      scale: [0, 2, 3, 5, 7, 8, 10], swing: 0.5,
      voices: ['glassPad', 'subDrone', 'bellPluck', 'granular'],
      radioFilter: [60, 12000], radioNoise: 0.004, gain: 0.4,
    },
    trafficTone: { engineHz: 180, engineQ: 12, tireGain: 0.12, electric: true },
    footstep: { kind: 'soft', bright: 0.35 },
  },
  lots: {
    palace: {
      style: 'restored', floors: 4, facade: 0xb09878, trim: 0x56d0e0, condition: 0.2,
      shop: 'PALACE MEMORY ARCHIVE', sub: 'EVERY MARQUEE THIS BUILDING EVER WORE',
      signType: 'marqueeHolo', signColor: 0x56d0e0, blade: 'PALACE', bladeColor: 0xd83a2a,
      marqueeText: ['THE LOST WEEKEND', 'THUNDERBALL', 'BE KIND REWIND', 'MEGA FITNESS 24', 'THE CORNER SESSIONS'],
      marqueeCycles: true, bulbs: 96, windows: 'arched', cornice: 'heavy',
      heritage: true, holoProjector: true,
      roof: ['watertank', 'droneDock', 'solarRoof', 'pigeons'],
      wallAd: 'HOLO', greenWall: 0.3,
      story: 'It shows what it used to say. Nine minutes, then it starts again at 1927. People sit on the kerb and watch the whole loop.',
    },
    drug: {
      style: 'bio', floors: 3, facade: 0x2a4a4a, trim: 0x9fe870, condition: 0.14,
      shop: 'PRINT-A-MEAL', sub: 'PROTEIN · GRAIN · FAT · 90 SECONDS',
      signType: 'eInk', signColor: 0x9fe870, windows: 'oled',
      cornice: 'clipped', display: 'printmeal', greenWall: 0.55,
      roof: ['solarRoof', 'droneDock', 'waterReclaim'],
      story: 'The coffee place lasted until 2038. Nobody on the block will admit the printed croissant is fine, but the queue is the same length it always was.',
    },
    hotel: {
      style: 'bioRetrofit', floors: 6, facade: 0x6a4a40, trim: 0x56d0e0, condition: 0.2,
      shop: 'VERNON CO-LIVING', sub: '104 UNITS · MEMBER OWNED · EST. 1912',
      signType: 'eInk', signColor: 0xd8dcd8, windows: 'oled',
      cornice: 'bracketed', pods: true, greenWall: 0.75, louvres: true,
      fireEscape: true, roof: ['greenRoof', 'solarRoof', 'droneDock', 'waterReclaim', 'deck'],
      story: 'Two floors were added in 2041 as clip-on pods. The brick underneath is the same brick, and the fire escape is finally load-rated again.',
    },
    grocer: {
      style: 'bio', floors: 3, facade: 0x3a5a52, trim: 0x9fe870, condition: 0.12,
      shop: 'VERTICAL FARM CO-OP', sub: 'GROWN ON THIS WALL · MEMBER OWNED',
      signType: 'eInk', signColor: 0x9fe870, windows: 'growTube',
      cornice: 'clipped', display: 'farm', greenWall: 0.95, growLights: 0xff5aa0,
      roof: ['greenRoof', 'solarRoof', 'waterReclaim'],
      story: 'Eleven growing tiers up the front of a 1904 grocery. It sells to the block, and the block owns it, which took until 2044 to arrange.',
    },
    lot: {
      style: 'open', use: 'grove', paving: 0x6a7a70,
      tree: { h: 13.5, r: 7.2, kind: 'ancient' },
      benches: 4, mistArch: true, greenWalls: true,
      sign: 'THE GROVE · PROTECTED TREE No. 0114 · PLANTED 1945, REPLANTED 2021',
      story: 'Two trees, eighty years, one corner. The plaque names both. Under the roots is a tin box the 2007 excavation missed by four metres.',
    },
    arcade: {
      style: 'bio', floors: 2, facade: 0x2a4a4a, trim: 0x56d0e0, condition: 0.18,
      shop: 'REPAIR CAFÉ', sub: 'FIX IT HERE · TOOLS FREE · PARTS AT COST',
      signType: 'eInk', signColor: 0x56d0e0, windows: 'oled',
      cornice: 'angled', display: 'repair', glowInterior: 0x56d0e0, greenWall: 0.3,
      roof: ['solarRoof', 'droneDock'],
      story: 'The googie roof is a listed structure now, which the volunteers find extremely funny given what it is holding up.',
    },
    bank: {
      style: 'civic', floors: 3, facade: 0xa8a49c, trim: 0x56d0e0, condition: 0.16,
      shop: 'FIFTH ST. CLIMATE TRUST', sub: 'COOLING CENTRE · SEED BANK · OPEN TO ALL',
      signType: 'eInk', signColor: 0x56d0e0, columns: 6, columnsClad: false,
      clock: true, clockRestored: true, windows: 'tall-arched', cornice: 'dentil',
      roof: ['parapet', 'solarRoof', 'airPylon'], greenWall: 0.25,
      story: 'A bank for 132 years and then, in 2039, a room with a cold floor that the neighbourhood can walk into when it is 44 degrees outside.',
    },
    dime: {
      style: 'bio', floors: 3, facade: 0x3a5a52, trim: 0xe864c8, condition: 0.2,
      shop: 'NEURO-SPA', sub: 'SLEEP DEBT · FOCUS · 20 MIN SESSIONS',
      signType: 'holo', signColor: 0xe864c8, windows: 'frosted',
      cornice: 'clipped', display: 'spa', greenWall: 0.4,
      roof: ['solarRoof', 'acRooftop'],
      story: 'Woolton’s tile is still under there. Two renovations found it, photographed it, and covered it back up.',
    },
  },
},

];

/* ═══════════════════════════ HELPERS ═══════════════════════════ */

export const YEARS = ERAS.map((e) => e.year);
export const eraIndexOfYear = (y) => Math.max(0, YEARS.indexOf(y));
export const eraByYear = (y) => ERAS[eraIndexOfYear(y)];

/** Linear blend of the two grade objects flanking a fractional era index. */
export function blendGrade(fIndex) {
  const i = Math.max(0, Math.min(ERAS.length - 1, Math.floor(fIndex)));
  const j = Math.min(ERAS.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, fIndex - i));
  const a = ERAS[i].grade, b = ERAS[j].grade;
  const out = {};
  for (const k in a) {
    if (Array.isArray(a[k])) out[k] = a[k].map((v, n) => v + (b[k][n] - v) * t);
    else out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** Same, for the sky block (colours are lerped as ints by the sky module). */
export function blendSky(fIndex) {
  const i = Math.max(0, Math.min(ERAS.length - 1, Math.floor(fIndex)));
  const j = Math.min(ERAS.length - 1, i + 1);
  return { a: ERAS[i].sky, b: ERAS[j].sky, t: Math.max(0, Math.min(1, fIndex - i)) };
}

/** Lot record for a given lot id and era index, merged with its static plan. */
export function lotData(lotId, eraIndex) {
  const plan = LOTS.find((l) => l.id === lotId);
  const era = ERAS[eraIndex];
  return { ...plan, ...(era.lots[lotId] || {}) };
}
