import { ResortData } from '../resort';

const mk = {
  id: '80007944',
  name: 'Magic Kingdom',
  icon: '🏰',
  geo: {
    n: 28.422,
    s: 28.415,
    e: -81.575,
    w: -81.586,
  },
  color: 'fuchsia',
};
const ep = {
  id: '80007838',
  name: 'EPCOT',
  icon: '🌐',
  geo: {
    n: 28.377,
    s: 28.366,
    e: -81.545,
    w: -81.555,
  },
  color: 'blue',
};
const hs = {
  id: '80007998',
  name: 'Hollywood Studios',
  icon: '🎬',
  geo: {
    n: 28.362,
    s: 28.353,
    e: -81.557,
    w: -81.564,
  },
  color: 'orange',
};
const ak = {
  id: '80007823',
  name: 'Animal Kingdom',
  icon: '🌳',
  geo: {
    n: 28.369,
    s: 28.354,
    e: -81.585,
    w: -81.597,
  },
  color: 'green',
};

export const parks: ResortData['parks'] = [mk, ep, hs, ak];

// Magic Kingdom - Lands
const mainStreet = {
  name: 'Main Street, USA',
  sort: 1,
  color: 'red',
  park: mk,
};
const adventureland = {
  name: 'Adventureland',
  sort: 2,
  color: 'green',
  park: mk,
};
const frontierland = {
  name: 'Frontierland',
  sort: 3,
  color: 'gold',
  park: mk,
};
const libertySquare = {
  name: 'Liberty Square',
  sort: 4,
  color: 'blue',
  park: mk,
};
const fantasyland = {
  name: 'Fantasyland',
  sort: 5,
  color: 'fuchsia',
  park: mk,
};
const tomorrowland = {
  name: 'Tomorrowland',
  sort: 6,
  color: 'cyan',
  park: mk,
};

// EPCOT - Lands
const celebration = {
  name: 'World Celebration',
  sort: 1,
  color: 'blue',
  park: ep,
};
const discovery = {
  name: 'World Discovery',
  sort: 2,
  color: 'fuchsia',
  park: ep,
};
const nature = {
  name: 'World Nature',
  sort: 3,
  color: 'green',
  park: ep,
};
const showcase = {
  name: 'World Showcase',
  sort: 4,
  color: 'gold',
  park: ep,
};

// Hollywood Studios - Lands
const hollywood = {
  name: 'Hollywood & Sunset',
  sort: 1,
  color: 'orange',
  park: hs,
};
const animation = {
  name: 'Animation Courtyard',
  sort: 2,
  color: 'fuchsia',
  park: hs,
};
const pixar = {
  name: 'Pixar Plaza',
  sort: 3,
  color: 'gold',
  park: hs,
};
const toyStory = {
  name: 'Toy Story Land',
  sort: 4,
  color: 'green',
  park: hs,
};
const starWars = {
  name: "Star Wars: Galaxy's Edge",
  sort: 5,
  color: 'gray',
  park: hs,
};
const commissary = {
  name: 'Commissary Lane',
  sort: 6,
  color: 'red',
  park: hs,
};
const echoLake = {
  name: 'Echo Lake',
  sort: 7,
  color: 'blue',
  park: hs,
};

// Animal Kingdom - Lands
const discIsland = {
  name: 'Discovery Island',
  sort: 1,
  color: 'green',
  park: ak,
};
const pandora = {
  name: 'Pandora',
  sort: 2,
  color: 'cyan',
  park: ak,
};
const africa = {
  name: 'Africa',
  sort: 3,
  color: 'gold',
  park: ak,
};
const conservation = {
  name: 'Conservation Station',
  sort: 4,
  color: 'purple',
  park: ak,
};
const asia = {
  name: 'Asia',
  sort: 5,
  color: 'red',
  park: ak,
};
const theaterInWild = {
  name: 'Theater in the Wild',
  sort: 6,
  color: 'blue',
  park: ak,
};

export const experiences: ResortData['experiences'] = {
  // Magic Kingdom - Attractions
  80010107: {
    name: 'Astro Orbiter',
    land: tomorrowland,
    type: 'A',
  },
  16491297: {
    name: 'Barnstormer',
    land: fantasyland,
    type: 'A',
    geo: [28.4208394, -81.5784733],
    avgWait: 13,
    priority: 4,
  },
  // Hardest Magic Kingdom Tier 1 since it reopened: sold out by 8:47am and
  // 9:07am on the two 2026 days sampled, well ahead of Tiana's.
  //
  // The 33 below is upstream's own measurement, adopted with the rest of its
  // data rather than invented here -- PLAN.md 3.5 and 9.11 both refuse a
  // fabricated average for this entry, and that still stands. It is low
  // against Jingle Cruise's 53, which is why the rank has to do the
  // separating rather than the tiebreak.
  80010110: {
    name: 'Big Thunder Mountain Railroad',
    land: frontierland,
    type: 'A',
    geo: [28.4197486, -81.5845092],
    tier: 1,
    priority: 1,
    highlight: true,
    avgWait: 33,
    // No drop times on purpose. These arrived with an upstream data merge and
    // every source since the 2026 reopening says the ride has no predictable
    // pop-up schedule. `park.dropTimes` is the union of every experience's, so
    // a fabricated entry puts the whole of Magic Kingdom into a 1.2s burst at
    // 08:47 for a drop nobody believes in -- and, worse, gives Big Thunder an
    // "upcoming drop" that has `shouldHoldTierSlot` decline an offered Tiana's
    // or Jingle Cruise to keep the Tier 1 slot free for it. If a schedule is
    // ever observed, the learner records it from real evidence.
  },
  80010114: {
    name: "Buzz Lightyear's Space Ranger Spin",
    land: tomorrowland,
    type: 'A',
    geo: [28.418446, -81.5796479],
    priority: 1.2,
    avgWait: 37,
    highlight: true,
  },
  80010232: {
    name: 'Carousel of Progress',
    land: tomorrowland,
    type: 'A',
  },
  80069748: {
    name: 'Country Bear Musical Jamboree',
    land: frontierland,
    type: 'A',
  },
  80010129: {
    name: 'Dumbo the Flying Elephant',
    land: fantasyland,
    type: 'A',
    geo: [28.4206047, -81.5789092],
    avgWait: 8,
    priority: 4,
  },
  16124144: {
    name: 'Enchanted Tiki Room',
    land: adventureland,
    type: 'A',
  },
  80069754: {
    name: 'Hall of Presidents',
    land: libertySquare,
    type: 'A',
  },
  80010208: {
    name: 'Haunted Mansion',
    land: libertySquare,
    type: 'A',
    geo: [28.4208771, -81.5830102],
    priority: 2,
    avgWait: 24,
    highlight: true,
  },
  80010149: {
    name: "it's a small world",
    land: fantasyland,
    type: 'A',
    geo: [28.4205055, -81.582156],
    avgWait: 15,
    priority: 4,
  },
  412010035: {
    name: 'Jingle Cruise',
    land: adventureland,
    type: 'A',
    geo: [28.4180339, -81.5834548],
    tier: 1,
    // Not 1: a tie with Big Thunder is resolved by `avgWait`, which Jingle
    // Cruise wins at 53 against 33 -- so the tie handed Magic Kingdom's single
    // Tier 1 selection to a re-themed Jungle Cruise, and `shouldHoldTierSlot`
    // (which needs a strictly better rank) held the slot for neither. This is
    // the renumbering PLAN.md 3.2 asks for; it was reverted by the wholesale
    // adoption of upstream's values in a474377.
    priority: 1.1,
    avgWait: 53,
    highlight: true,
    refillWindows: [{ start: '11:00', end: '14:30' }],
  },
  80010153: {
    name: 'Jungle Cruise',
    land: adventureland,
    type: 'A',
    geo: [28.4180339, -81.5834548],
    tier: 1,
    priority: 2.2,
    avgWait: 37,
    highlight: true,
    refillWindows: [{ start: '11:00', end: '14:30' }],
  },
  80010162: {
    name: 'Mad Tea Party',
    land: fantasyland,
    type: 'A',
    geo: [28.4200602, -81.5799004],
    avgWait: 8,
    priority: 4,
  },
  80010210: {
    name: 'Magic Carpets of Aladdin',
    land: adventureland,
    type: 'A',
    geo: [28.4183166, -81.5835006],
    avgWait: 11,
    priority: 4,
  },
  80010213: {
    name: 'Many Adventures of Winnie the Pooh',
    land: fantasyland,
    type: 'A',
    geo: [28.4202297, -81.5801966],
    priority: 1.3,
    avgWait: 31,
    highlight: true,
  },
  80010170: {
    name: "Mickey's PhilharMagic",
    land: fantasyland,
    type: 'A',
    geo: [28.4200575, -81.5814156],
    avgWait: 12,
  },
  136550: {
    name: 'Monsters Inc. Laugh Floor',
    land: tomorrowland,
    type: 'A',
    geo: [28.4179954, -81.5800854],
    avgWait: 10,
  },
  80010224: {
    name: 'PeopleMover',
    land: tomorrowland,
    type: 'A',
  },
  80010176: {
    name: "Peter Pan's Flight",
    land: fantasyland,
    type: 'A',
    geo: [28.4203332, -81.5818676],
    tier: 1,
    priority: 2.1,
    avgWait: 43,
    highlight: true,
    refillWindows: [{ start: '11:00', end: '14:30' }],
  },
  80010177: {
    name: 'Pirates of the Caribbean',
    land: adventureland,
    type: 'A',
    geo: [28.4180994, -81.5842719],
    priority: 3,
    avgWait: 19,
    highlight: true,
  },
  80010117: {
    name: 'Prince Charming Regal Carrousel',
    land: fantasyland,
    type: 'A',
  },
  16767284: {
    name: 'Seven Dwarfs Mine Train',
    land: fantasyland,
    type: 'A',
    geo: [28.4204112, -81.5805506],
    highlight: true,
  },
  80010190: {
    name: 'Space Mountain',
    land: tomorrowland,
    type: 'A',
    geo: [28.4187869, -81.5782063],
    tier: 1,
    avgWait: 39,
    highlight: true,
    priority: 3.1,
  },
  80010196: {
    name: 'Swiss Family Treehouse',
    land: adventureland,
    type: 'A',
  },
  412021364: {
    name: "Tiana's Bayou Adventure",
    land: frontierland,
    type: 'A',
    geo: [28.419418, -81.58498],
    tier: 1,
    priority: 1.1,
    avgWait: 47,
    highlight: true,
    dropTimes: [
      '09:47',
      '11:47',
      '13:47',
      '14:17',
      '15:47',
      '17:47',
      '19:47',
      '21:47',
    ],
  },
  80010222: {
    name: 'Tomorrowland Speedway',
    land: tomorrowland,
    type: 'A',
    geo: [28.4194062, -81.5793505],
    avgWait: 16,
    priority: 4,
  },
  411504498: {
    name: 'TRON Lightcycle / Run',
    land: tomorrowland,
    type: 'A',
    geo: [28.4202075, -81.577053],
    priority: 1,
    highlight: true,
  },
  16767263: {
    name: 'Under the Sea',
    land: fantasyland,
    type: 'A',
    geo: [28.4210351, -81.5799673],
    avgWait: 15,
    priority: 4,
  },

  // Magic Kingdom - Entertainment
  412577081: {
    name: "Jessie's Roundup",
    land: frontierland,
    type: 'E',
  },
  8074: {
    name: "Casey's Corner Pianist",
    land: mainStreet,
    type: 'E',
  },
  8075: {
    name: 'Dapper Dans',
    land: mainStreet,
    type: 'E',
  },
  411550122: {
    name: 'Disney Adventure Friends Cavalcade',
    land: mainStreet,
    type: 'E',
  },
  412328853: {
    name: 'Disney Starlight Parade',
    land: mainStreet,
    type: 'E',
  },
  17718925: {
    name: 'Festival of Fantasy Parade',
    land: mainStreet,
    type: 'E',
    geo: [28.4189018, -81.5812001],
  },
  7922: {
    name: 'Flag Retreat',
    land: mainStreet,
    type: 'E',
  },
  18672598: {
    name: 'Happily Ever After',
    land: mainStreet,
    type: 'E',
  },
  8336: {
    name: 'Let the Magic Begin',
    land: mainStreet,
    type: 'E',
  },
  8066: {
    name: 'Main Street Philharmonic',
    land: mainStreet,
    type: 'E',
  },
  18381020: {
    name: "Mickey's Magical Friendship Faire",
    land: mainStreet,
    type: 'E',
  },
  412478057: {
    name: "Nola's 8th Note",
    land: frontierland,
    type: 'E',
  },

  // Magic Kingdom - Characters
  16874126: {
    name: "Ariel (Ariel's Grotto)",
    land: fantasyland,
    type: 'C',
    geo: [28.4208803, -81.5796853],
  },
  8515: {
    name: 'Buzz/Stitch (Plaza Stage)',
    land: tomorrowland,
    type: 'C',
  },
  18498503: {
    name: 'Cinderella (Princess Fairytale Hall)',
    land: fantasyland,
    type: 'C',
    geo: [28.4199771, -81.5808316],
  },
  387133: {
    name: "Donald & Goofy (Pete's Silly Side Show)",
    land: fantasyland,
    type: 'C',
  },
  16767276: {
    name: 'Enchanted Tales with Belle',
    land: fantasyland,
    geo: [28.4207354, -81.5807867],
    type: 'C',
  },
  15850196: {
    name: 'Mickey (Town Square Theater)',
    land: mainStreet,
    type: 'C',
    geo: [28.4167334, -81.5803937],
  },
  15743682: {
    name: "Minnie & Daisy (Pete's Silly Side Show)",
    land: fantasyland,
    type: 'C',
  },
  411987382: {
    name: 'Mirabel (Fairytale Garden)',
    land: fantasyland,
    type: 'C',
  },
  17505397: {
    name: 'Tiana (Princess Fairytale Hall)',
    land: fantasyland,
    geo: [28.4199771, -81.5808316],
    type: 'C',
  },

  // Magic Kingdom - Holiday
  // New Year's Eve
  12248: {
    name: 'Fantasy in the Sky Fireworks',
    land: mainStreet,
    type: 'H',
  },
  // Fourth of July
  276291: {
    name: 'Fourth of July Fireworks',
    land: mainStreet,
    type: 'H',
  },

  // Magic Kingdom - Party
  // Halloween
  412734987: {
    name: "Captain Jack's Buccaneer Bash",
    land: adventureland,
    type: 'P',
  },
  412734988: {
    name: "Stitch's Masquerade Mashup",
    land: tomorrowland,
    type: 'P',
  },
  17506082: {
    name: 'Cadaver Dans Barbershop Quartet',
    land: frontierland,
    type: 'P',
  },
  18161751: {
    name: 'Hocus Pocus Villain Spelltacular',
    land: mainStreet,
    type: 'P',
  },
  8317: {
    name: "Mickey's Boo-To-You Parade",
    land: mainStreet,
    type: 'P',
  },
  61265: {
    name: 'Not-So-Spooky Spectacular',
    land: mainStreet,
    type: 'P',
  },
  411979827: {
    name: 'Rusty Cutlass Pirate Band',
    land: adventureland,
    type: 'P',
  },
  // Christmas
  //
  // Disney re-issued all three of these for 2026; the ids they replace are
  // listed under "Ignored" below. This is the December trip's own instance of
  // the re-theme problem in §1 of docs/PLAN.md -- a watch list built on the
  // old ids would match nothing, on the nights it matters most.
  412009394: {
    name: 'Frozen Holiday Surprise',
    land: mainStreet,
    type: 'P',
  },
  411854077: {
    name: "Mickey's Most Merriest Celebration",
    land: mainStreet,
    type: 'P',
  },
  411854078: {
    name: "Mickey's Once Upon a Christmastime Parade",
    land: mainStreet,
    type: 'P',
  },
  411854079: {
    name: "Minnie's Wonderful Christmastime Fireworks",
    land: mainStreet,
    type: 'P',
  },

  // EPCOT - Attractions
  19473173: {
    name: 'Awesome Planet',
    land: nature,
    type: 'A',
  },
  18269694: {
    name: 'Disney & Pixar Short Film Festival',
    land: celebration,
    type: 'A',
    geo: [28.3720463, -81.5508243],
  },
  18375495: {
    name: 'Frozen Ever After',
    land: showcase,
    type: 'A',
    geo: [28.3706716, -81.5465556],
    tier: 1,
    priority: 1.1,
    avgWait: 51,
    highlight: true,
  },
  207395: {
    name: 'Gran Fiesta Tour',
    land: showcase,
    type: 'A',
  },
  411499845: {
    name: 'Guardians of the Galaxy: Cosmic Rewind',
    land: discovery,
    type: 'A',
    geo: [28.3747479, -81.5478405],
    highlight: true,
  },
  80010152: {
    name: 'Journey Into Imagination',
    land: celebration,
    type: 'A',
    geo: [28.372896, -81.5512292],
    avgWait: 9,
    priority: 4,
  },
  411794307: {
    name: 'Journey of Water, Inspired by Moana',
    land: nature,
    type: 'A',
  },
  80010161: {
    name: 'Living with the Land',
    land: nature,
    type: 'A',
    geo: [28.3739368, -81.5526389],
    priority: 4,
    avgWait: 13,
  },
  412010036: {
    name: 'Living with the Land - Glimmering Greenhouses',
    land: nature,
    type: 'A',
    geo: [28.3739368, -81.5526389],
    priority: 2,
    avgWait: 35,
  },
  80010173: {
    name: 'Mission: SPACE',
    land: discovery,
    type: 'A',
    geo: [28.3739368, -81.5526389],
    priority: 2.1,
    avgWait: 17,
  },
  80010180: {
    name: 'Reflections of China',
    land: showcase,
    type: 'A',
  },
  19497835: {
    name: "Remy's Ratatouille Adventure",
    land: showcase,
    type: 'A',
    geo: [28.3680021, -81.5534178],
    tier: 1,
    priority: 1.2,
    avgWait: 46,
    highlight: true,
  },
  107785: {
    name: 'Seas with Nemo & Friends',
    land: nature,
    type: 'A',
    geo: [28.3748995, -81.5507208],
    avgWait: 11,
    priority: 4,
  },
  // One ride, three facility ids -- Disney serves whichever film is showing, so
  // all three are live rather than retired and none can be nulled. They carried
  // priority 3, 2 and 3, which made the ride's rank depend on the film
  // rotation: the same queue, the same 35-minute wait, ranked a whole band
  // lower on two days out of three, and low enough to be swapped away. Held
  // equal at the value the ride already had, because the film does not change
  // how much the Lightning Lane is worth.
  412577054: {
    name: "Soarin' Across America",
    land: nature,
    type: 'A',
    geo: [28.3735924, -81.5522783],
    priority: 2,
    avgWait: 35,
    highlight: true,
  },
  20194: {
    name: "Soarin' Around the World",
    land: nature,
    type: 'A',
    geo: [28.3735924, -81.5522783],
    priority: 2,
    avgWait: 35,
    highlight: true,
  },
  412001587: {
    name: "Soarin' Over California",
    land: nature,
    type: 'A',
    geo: [28.3735924, -81.5522783],
    priority: 2,
    avgWait: 35,
    highlight: true,
  },
  80010191: {
    name: 'Spaceship Earth',
    land: celebration,
    type: 'A',
    geo: [28.3754661, -81.5493961],
    priority: 3,
    avgWait: 15,
  },
  80010199: {
    name: 'Test Track',
    land: discovery,
    type: 'A',
    geo: [28.3733374, -81.5474931],
    tier: 1,
    priority: 1,
    avgWait: 74,
    highlight: true,
    dropTimes: ['8:47', '12:47', '14:47', '17:47'],
    refillWindows: [{ start: '09:00', end: '10:30' }],
  },
  62992: {
    name: 'Turtle Talk With Crush',
    land: nature,
    type: 'A',
    geo: [28.3753989, -81.5511449],
    avgWait: 15,
  },

  // EPCOT - Entertainment
  412442146: {
    name: 'Acrobatico (France)',
    land: showcase,
    type: 'E',
  },
  80010200: {
    name: 'American Adventure',
    land: showcase,
    type: 'E',
  },
  19496225: {
    name: 'Atlas Fusion (Morocco)',
    land: showcase,
    type: 'E',
  },
  19463785: {
    name: 'Beauty & the Beast Sing-Along',
    land: showcase,
    type: 'E',
  },
  80010174: {
    name: 'Canada Far and Wide',
    land: showcase,
    type: 'E',
  },
  19036653: {
    name: 'Canada Mill Stage Entertainment',
    land: showcase,
    type: 'E',
  },
  411702927: {
    name: 'Command Performance (UK)',
    land: showcase,
    type: 'E',
  },
  230077: {
    name: 'Eat to the Beat Concert Series',
    land: showcase,
    type: 'E',
  },
  412126654: {
    name: 'Encanto Celebration',
    land: celebration,
    type: 'E',
  },
  19258170: {
    name: 'Epcot Forever',
    land: showcase,
    type: 'E',
  },
  17198736: {
    name: 'Garden Rocks Concert Series',
    land: showcase,
    type: 'E',
  },
  19242311: {
    name: 'Germany Gazebo Entertainment',
    land: showcase,
    type: 'E',
  },
  13507: {
    name: 'Jammitors',
    land: celebration,
    type: 'E',
  },
  412008998: {
    name: 'Luminous: The Symphony of Us',
    land: showcase,
    type: 'E',
  },
  19322758: {
    name: 'Mariachi Cobre',
    land: showcase,
    type: 'E',
  },
  19277873: {
    name: 'Marimba de las Américas',
    land: showcase,
    type: 'E',
  },
  80010865: {
    name: 'Matsuriza (Japan)',
    land: showcase,
    type: 'E',
  },
  17490262: {
    name: 'Rose & Crown Pub Musician',
    land: showcase,
    type: 'E',
  },
  80010873: {
    name: 'Sergio (Italy)',
    land: showcase,
    type: 'E',
  },
  80010879: {
    name: 'Voices of Liberty',
    land: showcase,
    type: 'E',
  },

  // EPCOT - Characters
  412026226: {
    name: 'Asha (World Showcase Plaza)',
    land: showcase,
    type: 'C',
  },
  387139: {
    name: 'Donald Duck (Mexico)',
    land: showcase,
    type: 'C',
  },
  15695444: {
    name: 'Mary Poppins (UK)',
    land: showcase,
    type: 'C',
  },
  412126613: {
    name: 'Mickey & Friends',
    land: celebration,
    type: 'C',
  },
  268742: {
    name: 'Mulan (China)',
    land: showcase,
    type: 'C',
  },
  18416876: {
    name: 'Pluto (Main Entrance)',
    land: celebration,
    type: 'C',
  },
  15574092: {
    name: 'Princess Aurora (France)',
    land: showcase,
    type: 'C',
  },
  13625: {
    name: 'Winnie the Pooh (UK)',
    land: showcase,
    type: 'C',
  },

  // EPCOT - Holiday
  245275: {
    name: 'Canadian Holiday Voyageurs',
    land: showcase,
    type: 'H',
  },
  70684: {
    name: 'Candlelight Processional',
    land: showcase,
    type: 'H',
  },
  245272: {
    name: 'Chinese Lion Dancer',
    land: showcase,
    type: 'H',
  },
  245268: {
    name: 'Daruma Storyteller (Japan)',
    land: showcase,
    type: 'H',
  },
  245270: {
    name: 'Father Christmas (UK)',
    land: showcase,
    type: 'H',
  },
  17186496: {
    name: 'Hanukkah Storyteller (Between Morocco & France)',
    land: showcase,
    type: 'H',
  },
  3427049: {
    name: 'JOYFUL! A Celebration of the Season',
    land: celebration,
    type: 'H',
  },
  245263: {
    name: 'La Befana (Italy)',
    land: showcase,
    type: 'H',
  },
  245264: {
    name: 'Las Posadas Celebration (Mexico)',
    land: showcase,
    type: 'H',
  },
  19423795: {
    name: 'Mischievous Barn Santa (Norway)',
    land: showcase,
    type: 'H',
  },
  245274: {
    name: 'Père Noël (France)',
    land: showcase,
    type: 'H',
  },
  245271: {
    name: 'Santa (Odyssey Pavilion)',
    land: celebration,
    type: 'H',
  },
  411840597: {
    name: 'Si-Zhu Trio (China)',
    land: showcase,
    type: 'H',
  },
  178205: {
    name: 'Voice of Liberty',
    land: showcase,
    type: 'H',
  },

  // Hollywood Studios - Attractions
  18904172: {
    name: 'Alien Swirling Saucers',
    land: toyStory,
    type: 'A',
    geo: [28.3553702, -81.5624558],
    priority: 3.1,
    avgWait: 29,
  },
  19259335: {
    name: "Mickey & Minnie's Runaway Railway",
    land: hollywood,
    type: 'A',
    geo: [28.3567406, -81.5606842],
    tier: 1,
    priority: 3,
    avgWait: 41,
    highlight: true,
    refillWindows: [{ start: '11:00', end: '14:30' }],
  },
  19263735: {
    name: 'Millennium Falcon: Smugglers Run',
    land: starWars,
    type: 'A',
    geo: [28.353862, -81.5616967],
    tier: 1,
    // Ranked, but last of Hollywood Studios' Tier 1s. Two rules pull against
    // each other here. An unranked Tier 1 reads as Infinity to
    // `comparePriority` -- attempted last, never worth a Tier 1 hold, and the
    // preferred thing to give up in a swap -- which is why it carries a number
    // at all. But a number good enough to beat a real headliner has
    // `shouldHoldTierSlot` decline an offered one to keep the slot free for
    // this, which is what docs/PLAN.md section 9 refuted. At 3.1 it is below
    // Mickey & Minnie's Runaway Railway (3, and the harder get at 41 minutes
    // average against this ride's 37), so it can be held, attempted and
    // swapped sensibly without ever outranking something it should not.
    priority: 3.1,
    avgWait: 37,
    highlight: true,
    dropTimes: ['10:47', '15:47'],
  },
  19263736: {
    name: 'Rise of the Resistance',
    land: starWars,
    type: 'A',
    geo: [28.3548829, -81.5604682],
    highlight: true,
  },
  412573652: {
    name: "Rock 'n' Roller Coaster Starring The Muppets",
    land: hollywood,
    type: 'A',
    geo: [28.3597607, -81.5606022],
    tier: 1,
    priority: 1.2,
    avgWait: 61,
    highlight: true,
  },
  18904138: {
    name: 'Slinky Dog Dash',
    land: toyStory,
    type: 'A',
    geo: [28.3562472, -81.5628474],
    tier: 1,
    priority: 1,
    avgWait: 72,
    highlight: true,
    dropTimes: ['13:17', '15:47'],
    refillWindows: [{ start: '09:00', end: '10:30' }],
  },
  80010193: {
    name: 'Star Tours',
    land: echoLake,
    type: 'A',
    geo: [28.3557799, -81.5588696],
    avgWait: 8,
  },
  209857: {
    name: 'Toy Story Mania',
    land: toyStory,
    type: 'A',
    geo: [28.3563865, -81.5619019],
    priority: 1.1,
    avgWait: 44,
    highlight: true,
    dropTimes: ['13:17', '15:47'],
    refillWindows: [{ start: '09:00', end: '10:30' }],
  },
  80010218: {
    name: 'Twilight Zone Tower of Terror',
    land: hollywood,
    type: 'A',
    geo: [28.3595812, -81.5597695],
    priority: 1.3,
    avgWait: 42,
    highlight: true,
    dropTimes: ['13:17', '15:47'],
    refillWindows: [{ start: '09:00', end: '10:30' }],
  },

  // Hollywood Studios - Entertainment
  80010848: {
    name: 'Beauty & the Beast Live on Stage',
    land: hollywood,
    type: 'E',
    geo: [28.3591529, -81.5597641],
  },
  412521565: {
    name: 'Disney Jr. Mickey Mouse Clubhouse Live!',
    land: animation,
    type: 'E',
    geo: [28.3579409, -81.5607914],
  },
  18693119: {
    name: 'Disney Movie Magic',
    land: hollywood,
    type: 'E',
  },
  412328858: {
    name: 'Little Mermaid - A Musical Adventure',
    land: animation,
    type: 'E',
    geo: [28.3576612, -81.5609242],
  },
  412328859: {
    name: 'Disney Villains: Unfairly Ever After',
    land: hollywood,
    type: 'E',
  },
  80010887: {
    name: 'Fantasmic!',
    land: hollywood,
    type: 'E',
    geo: [28.3599166, -81.5592299],
  },
  411979428: {
    name: 'First Order Searches for the Resistance',
    land: starWars,
    type: 'E',
  },
  17842841: {
    name: 'Frozen Sing-Along',
    land: echoLake,
    type: 'E',
    geo: [28.3566155, -81.5594812],
  },
  19025720: {
    name: 'Green Army Drum Corps',
    land: toyStory,
    type: 'E',
  },
  412496861: {
    name: "Hollygroove Swingin'",
    land: hollywood,
    type: 'E',
  },
  136: {
    name: 'Indiana Jones Epic Stunt Spectacular',
    land: echoLake,
    type: 'E',
    geo: [28.3567464, -81.5588053],
  },
  412496812: {
    name: 'Record Setters',
    land: hollywood,
    type: 'E',
  },
  19260580: {
    name: 'Wonderful World of Animation',
    land: hollywood,
    type: 'E',
  },

  // Hollywood Studios - Characters
  411926516: {
    name: 'Ariel (Walt Disney Presents)',
    land: animation,
    type: 'C',
  },
  18189394: {
    name: 'Chewbacca (Launch Bay)',
    land: animation,
    type: 'C',
  },
  224093: {
    name: 'Disney Junior Pals',
    land: animation,
    type: 'C',
  },
  19205017: {
    name: 'Edna Mode',
    land: pixar,
    type: 'C',
  },
  411908664: {
    name: 'Joy',
    land: pixar,
    type: 'C',
  },
  18368386: {
    name: 'Mickey & Minnie (Red Carpet Dreams)',
    land: commissary,
    geo: [28.3560952, -81.5594433],
    type: 'C',
  },
  18368385: {
    name: 'Olaf (Celebrity Spotlight)',
    land: echoLake,
    geo: [28.3562836, -81.55906],
    type: 'C',
  },

  // Hollywood Studios - Party
  412017439: {
    name: 'Disney Holidays in Hollywood',
    land: hollywood,
    type: 'P',
  },
  412239078: {
    name: 'Glisten (Ice Skating Show)',
    land: hollywood,
    type: 'P',
  },
  412017741: {
    name: 'Jingle Bell, Jingle Bam',
    land: hollywood,
    type: 'P',
  },
  412017440: {
    name: 'Nightmare Before Christmas Sing-Along',
    land: hollywood,
    type: 'P',
  },
  412250286: {
    name: 'Pixar Disco',
    land: pixar,
    type: 'P',
  },

  // Animal Kingdom - Attractions
  19330300: {
    name: 'Animation Experience',
    land: conservation,
    type: 'A',
    geo: [28.3652134, -81.5885522],
  },
  18665186: {
    name: 'Avatar Flight of Passage',
    land: pandora,
    type: 'A',
    geo: [28.3555698, -81.592292],
    highlight: true,
  },
  80010123: {
    name: 'DINOSAUR',
    land: theaterInWild,
    type: 'A',
    geo: [28.3552805, -81.5884492],
    priority: 3.2,
    avgWait: 15,
    highlight: true,
  },
  26068: {
    name: 'Expedition Everest',
    land: asia,
    type: 'A',
    geo: [28.3584979, -81.587395],
    priority: 3.1,
    avgWait: 31,
    highlight: true,
    dropTimes: ['08:47', '12:47', '14:47', '15:47'],
  },
  80010175: {
    name: 'Gorilla Falls Exploration Trail',
    land: africa,
    type: 'A',
  },
  80010154: {
    name: 'Kali River Rapids',
    land: asia,
    type: 'A',
    geo: [28.3592076, -81.5883195],
    avgWait: 39,
    dropTimes: ['13:47'],
    // Selectable for most of the day and closed on cold ones, so it sits
    // below both headliners and below Zootopia rather than above all three.
    priority: 3.3,
  },
  80010157: {
    name: 'Kilimanjaro Safaris',
    land: africa,
    type: 'A',
    geo: [28.3592779, -81.5921478],
    // Animal Kingdom's best Multi Pass selection, and it collides with
    // Expedition Everest at the 12:47 drop -- the same-tick case
    // `orderByPriority` decides. An upstream merge had it at 4, below Everest,
    // below Kali and below DINOSAUR, so autopilot attempted the lesser ride
    // first and a held Safaris was the preferred thing to give up.
    priority: 3,
    avgWait: 24,
    highlight: true,
    dropTimes: ['09:47', '12:47'],
  },
  80010164: {
    name: 'Maharajah Jungle Trek',
    land: asia,
    type: 'A',
  },
  18665185: {
    name: "Na'vi River Journey",
    land: pandora,
    type: 'A',
    geo: [28.3551663, -81.591708],
    priority: 1,
    avgWait: 41,
    highlight: true,
    refillWindows: [{ start: '09:00', end: '10:30' }],
  },
  80010235: {
    name: 'Wildlife Express Train',
    land: africa,
    type: 'A',
  },
  412430582: {
    name: 'Zootopia: Better Zoogether',
    land: discIsland,
    type: 'A',
    // A real Multi Pass option that sorted last because it had no rank at all.
    // Below Everest, above Kali: a large-capacity show for a December trip.
    priority: 3.2,
    avgWait: 11,
  },

  // Animal Kingdom - Entertainment
  412604727: {
    name: "Bluey's Wild World",
    land: conservation,
    type: 'E',
  },
  412226163: {
    name: 'Beats and Strings',
    land: asia,
    type: 'E',
  },
  16235871: {
    name: 'Burudika',
    land: africa,
    type: 'E',
  },
  412380334: {
    name: 'Celebration Sing-Along',
    land: discIsland,
    type: 'E',
  },
  412226019: {
    name: "Songs You'll Dig - Dino Institute Intern",
    land: theaterInWild,
    type: 'E',
  },
  412303521: {
    name: 'Eco-Rhythmics',
    land: theaterInWild,
    type: 'E',
  },
  19581371: {
    name: 'Discovery Island Drummers Flotilla',
    land: discIsland,
    type: 'E',
  },
  19581372: {
    name: 'Feathered Friends in Flight',
    land: asia,
    type: 'E',
    geo: [28.3586675, -81.5900411],
  },
  12432: {
    name: 'Festival of the Lion King',
    land: africa,
    type: 'E',
    geo: [28.3581957, -81.5925823],
  },
  411550125: {
    name: 'Finding Nemo: The Big Blue and Beyond',
    land: theaterInWild,
    type: 'E',
    geo: [28.3574008, -81.5874145],
  },
  18425797: {
    name: 'Harambe Village Acrobats',
    land: africa,
    type: 'E',
  },
  18435910: {
    name: 'Kora Tinga Tinga',
    land: africa,
    type: 'E',
  },
  72877: {
    name: 'Tam Tam Drummers of Harambe',
    land: africa,
    type: 'E',
  },
  16629705: {
    name: 'Viva Gaia Street Band',
    land: discIsland,
    type: 'E',
  },
  17821434: {
    name: 'Winged Encounters - The Kingdom Takes Flight',
    land: discIsland,
    type: 'E',
  },

  // Animal Kingdom - Characters
  19205476: {
    name: 'Adventures with Kevin',
    land: discIsland,
    type: 'C',
  },
  412499185: {
    name: 'Judy Hopps & Nick Wilde',
    land: discIsland,
    type: 'C',
  },
  17421326: {
    name: 'Mickey & Minnie (Adventurers Outpost)',
    land: discIsland,
    type: 'C',
    geo: [28.3579455, -81.5898647],
  },
  411921961: {
    name: 'Moana (Character Landing)',
    land: discIsland,
    type: 'C',
  },

  // Animal Kingdom - Holiday
  18447293: {
    name: 'Tree of Life Awakenings',
    land: discIsland,
    type: 'H',
  },

  // Ignored
  //
  // Retired facility ids. Kept as null rather than deleted: that is what
  // suppresses the "Missing experience" warning if Disney serves one again,
  // and it records that the id was considered rather than overlooked.
  80010182: null, // -> 412573652, Rock 'n' Roller Coaster Starring The Muppets
  19583373: null, // -> 412521565, Disney Jr. Mickey Mouse Clubhouse Live!
  // The 2026 Christmas party re-issue. Only these three are nulled, because
  // only these three have a named replacement above. Upstream also dropped
  // DINOSAUR, Animation Experience, Discovery Island Drummers, Rusty Cutlass
  // and Songs You'll Dig from its data; those are left listed rather than
  // nulled, since an entry Disney never serves costs nothing while a nulled
  // one that Disney *does* serve is invisible and unbookable -- which is the
  // failure this whole section exists to record.
  8320: null, // -> 411854078, Mickey's Once Upon a Christmastime Parade
  18524056: null, // -> 411854077, Mickey's Most Merriest Celebration
  19336036: null, // -> 411854079, Minnie's Wonderful Christmastime Fireworks
  412380330: null,
  412380331: null,
  412380332: null,
  412380258: null,
};
