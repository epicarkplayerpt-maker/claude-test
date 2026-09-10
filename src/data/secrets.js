/**
 * Secrets, threads and places.
 *
 * The block rewards looking. Most discoveries are physical objects you have to
 * walk up to and inspect; a few are things you can only notice by comparing
 * decades, which is the whole point of a timeline you can drag.
 *
 * A *thread* is one object followed across all six eras — the tree, the cat,
 * the theatre marquee, the tag in the alley, the tin box in the wall. Finding
 * every bead on a thread is worth more than finding six unrelated things, and
 * the codex draws them as a timeline so the shape of the story is visible.
 */

export const SECRETS = [
  { id: 'secret:cat', era: null, icon: '🐈‍⬛', title: 'The cat', hint: 'Third floor of the Hotel Vernon. Every decade.', thread: 'cat' },
  { id: 'secret:capsule', era: 1945, icon: '🥫', title: 'The tin box', hint: 'Something is being buried in the victory garden.', thread: 'capsule' },
  { id: 'secret:usher', era: 1945, icon: '🎟️', title: 'The usher', hint: 'Somebody has worked at the Palace since it opened.', thread: 'palace' },
  { id: 'secret:fountain', era: 1945, icon: '🥤', title: 'The soda fountain', hint: 'Look through the drugstore window.', thread: null },
  { id: 'secret:pumps', era: 1965, icon: '⛽', title: 'Thirty-one nine', hint: 'Read the price board on the corner lot.', thread: 'tree' },
  { id: 'secret:tv', era: 1965, icon: '📺', title: 'Eleven televisions', hint: 'All tuned to the same channel. Almost.', thread: null },
  { id: 'secret:fallout', era: 1965, icon: '☢️', title: 'Fallout shelter', hint: 'A yellow-and-black sign, bolted to brick.', thread: null },
  { id: 'secret:tag', era: null, icon: '🎨', title: 'KAI ’85', hint: 'In the alley. It keeps coming back.', thread: 'tag' },
  { id: 'secret:stump', era: 1985, icon: '🪵', title: 'Forty-one rings', hint: 'Somebody cut something down for two parking spaces.', thread: 'tree' },
  { id: 'secret:highscore', era: 1985, icon: '🕹️', title: 'The high score', hint: 'Taped to the wall of the Galaxy Arcade.', thread: null },
  { id: 'secret:delorean', era: 1985, icon: '🚗', title: 'Stainless steel', hint: 'A car that does not rust, parked where it should not be.', thread: null },
  { id: 'secret:clock', era: 1985, icon: '🕓', title: 'Four minutes past four', hint: 'The bank clock stopped, and nobody came.', thread: 'clock' },
  { id: 'secret:dialup', era: 2005, icon: '💾', title: 'The handshake', hint: 'Stand outside the internet café and listen.', thread: null },
  { id: 'secret:hoarding', era: 2005, icon: '🏗️', title: 'Coming 2007', hint: 'Read what they promised to build here.', thread: 'tree' },
  { id: 'secret:library', era: 2025, icon: '📚', title: 'The guestbook', hint: 'The little free library holds more than books.', thread: 'capsule' },
  { id: 'secret:mural', era: 2025, icon: '🖼️', title: 'Six arches', hint: 'The mural counts something.', thread: null },
  { id: 'secret:seeds', era: 2055, icon: '🌱', title: 'The seed library', hint: 'One envelope has been passed along since 1945.', thread: 'capsule' },
  { id: 'secret:tree', era: 2055, icon: '🌳', title: 'Protected Tree No. 0114', hint: 'Two trees, one number.', thread: 'tree' },
  { id: 'secret:classic', era: 2055, icon: '🏎️', title: 'Still running', hint: 'One car on this street was built ninety years ago.', thread: null },
  { id: 'secret:archive', era: 2055, icon: '🎞️', title: 'The nine-minute loop', hint: 'Watch the Palace marquee long enough.', thread: 'palace' },
  { id: 'secret:sixeras', era: null, icon: '🕰️', title: 'All six', hint: 'Stand on this corner in every decade.', thread: null },
  { id: 'secret:konami', era: null, icon: '🎮', title: 'Up up down down', hint: 'An old code still works here.', thread: null },
  { id: 'secret:rooftop', era: null, icon: '🏙️', title: 'Above the block', hint: 'Get onto a roof. There is a way.', thread: null },
  { id: 'secret:nightwalk', era: null, icon: '🌙', title: 'Three in the morning', hint: 'Set the clock to the hour nobody is awake.', thread: null },
  { id: 'secret:threshold', era: null, icon: '🔤', title: 'The threshold', hint: 'Somebody’s name is still in the doorway of 88 Fifth.', thread: 'threshold' },
  { id: 'secret:cornerstone', era: null, icon: '🧱', title: 'The cornerstone', hint: 'Whoever built the Hotel Vernon signed it.', thread: null },
  { id: 'secret:feeder', era: null, icon: '🐦', title: 'Half past two', hint: 'The birds are not evenly spread. Find out why.', thread: null },
  { id: 'secret:deadbulb', era: null, icon: '💡', title: 'One bulb', hint: 'Count along the bottom rail of the marquee.', thread: null },
];

export const THREADS = [
  {
    id: 'tree', icon: '🌳', title: 'The tree on the corner',
    blurb: 'Planted by neighbours, cut down for parking, planted again by their grandchildren.',
    beads: [
      { year: 1945, label: 'A sapling in the victory garden', secret: 'secret:capsule' },
      { year: 1965, label: 'Spared by a contractor’s daughter', secret: 'secret:pumps' },
      { year: 1985, label: 'Cut down for two parking spaces', secret: 'secret:stump' },
      { year: 2005, label: 'Nothing here but a hoarding', secret: 'secret:hoarding' },
      { year: 2025, label: 'Replanted — not the same tree', secret: 'secret:mural' },
      { year: 2055, label: 'Protected Tree No. 0114', secret: 'secret:tree' },
    ],
  },
  {
    id: 'cat', icon: '🐈‍⬛', title: 'The cat in the window',
    blurb: 'Third floor of the Hotel Vernon, second window from the left. In every decade. Which is not possible.',
    beads: [
      { year: 1945, label: 'Watching the trolley' },
      { year: 1965, label: 'Watching the aerials go up' },
      { year: 1985, label: 'Watching the neon' },
      { year: 2005, label: 'Watching the scaffolding' },
      { year: 2025, label: 'Watching the couriers' },
      { year: 2055, label: 'Watching' },
    ],
    perEra: 'secret:cat',
  },
  {
    id: 'palace', icon: '🎭', title: 'The Palace',
    blurb: 'Vaudeville, cinema, video rental, gym, venue, archive. The building never moved.',
    beads: [
      { year: 1945, label: 'Two thousand seats and a Wurlitzer', secret: 'secret:usher' },
      { year: 1965, label: 'Clad in aluminium to look modern' },
      { year: 1985, label: 'Closed six years. Tapes in the lobby' },
      { year: 2005, label: 'Treadmills in the balcony' },
      { year: 2025, label: 'Restored after nine years of argument' },
      { year: 2055, label: 'It plays back every sign it ever wore', secret: 'secret:archive' },
    ],
  },
  {
    id: 'tag', icon: '🎨', title: 'KAI ’85',
    blurb: 'Painted once, covered twice, and eventually protected by law.',
    beads: [
      { year: 1945, label: '—' },
      { year: 1965, label: '—' },
      { year: 1985, label: 'Fresh. The drips are still tacky', secret: 'secret:tag' },
      { year: 2005, label: 'Grey paint. Coming back through' },
      { year: 2025, label: 'Faint, and left alone' },
      { year: 2055, label: 'Restored from a photograph' },
    ],
  },
  {
    id: 'capsule', icon: '🥫', title: 'The tin box',
    blurb: 'Put in the ground in 1945. The 2007 excavation missed it by four metres.',
    beads: [
      { year: 1945, label: 'Buried by the sapling', secret: 'secret:capsule' },
      { year: 1965, label: 'Under the forecourt' },
      { year: 1985, label: 'Under the asphalt' },
      { year: 2005, label: 'The dig misses it', secret: 'secret:hoarding' },
      { year: 2025, label: 'Under the new tree', secret: 'secret:library' },
      { year: 2055, label: 'Under the roots. Still there', secret: 'secret:seeds' },
    ],
  },
  {
    id: 'threshold', icon: '🔤', title: 'The threshold',
    blurb: 'A terrazzo doorway laid in 1931 for a shop that closed in 1937. Six tenants have laid a floor up to the edge of it and stopped.',
    beads: [
      { year: 1945, label: 'Eight years after Woolton’s folded' },
      { year: 1965, label: 'Records stacked on top of it' },
      { year: 1985, label: 'Under the video store’s carpet tiles' },
      { year: 2005, label: 'A rug over it. The corner shows' },
      { year: 2025, label: 'Uncovered again, and photographed' },
      { year: 2055, label: 'Listed. The only listed floor on the block' },
    ],
    perEra: 'secret:threshold',
  },
  {
    id: 'clock', icon: '🕓', title: 'The bank clock',
    blurb: 'Wound every Monday by a man named Pell, until it wasn’t.',
    beads: [
      { year: 1945, label: 'Wound every Monday' },
      { year: 1965, label: 'Still right' },
      { year: 1985, label: 'Stopped at 4:07 in the blackout', secret: 'secret:clock' },
      { year: 2005, label: 'Rewound in 1996. Eleven minutes fast' },
      { year: 2025, label: 'The branch closed. The clock stayed' },
      { year: 2055, label: 'Restored, and right again' },
    ],
  },
];

export const PLACES = [
  { id: 'palace', icon: '🎭', title: 'The Palace', addr: '500 Vine' },
  { id: 'drug', icon: '💊', title: '508 Vine', addr: 'Drugstore → coffee → printed food' },
  { id: 'hotel', icon: '🏨', title: 'Hotel Vernon', addr: '520 Vine' },
  { id: 'grocer', icon: '🥬', title: '41 Fifth', addr: 'Grocer → refill → vertical farm' },
  { id: 'lot', icon: '🌳', title: 'The corner lot', addr: '55 Fifth' },
  { id: 'arcade', icon: '🎳', title: '60 Fifth', addr: 'Barber → lanes → arcade → repair' },
  { id: 'bank', icon: '🏛️', title: 'First Merchants', addr: '70 Fifth' },
  { id: 'dime', icon: '🛍️', title: '88 Fifth', addr: 'Five-and-dime → records → spa' },
];

export const secretById = Object.fromEntries(SECRETS.map((s) => [s.id, s]));
export const TOTAL_SECRETS = SECRETS.length;
