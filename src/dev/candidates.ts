// Candidate asset sets for the development comparison gallery (compare.html).
//
// Each set is a coherent collection that could cover one visual category of the game.
// Sets are compared as wholes, never as one-off models:
//   status 'production'  — what the game ships today (files under public/assets/models)
//   status 'local'       — CC0, publicly downloadable; fetched by `npm run candidates:fetch`
//                          into dev-assets/candidates (gitignored) and rendered live here
//   status 'external'    — cannot be fetched here (account, manual download or purchase);
//                          shown with the creator's own published preview images, clearly labelled
//
// Nothing in this file is imported by the game. It is a review aid only, and no set listed
// here is approved for production until the decision recorded in docs/ASSET_WISHLIST.md.

export type Category = 'capital' | 'ships' | 'heroes' | 'villains';
export type Status = 'production' | 'local' | 'external';

export interface CandidateItem {
  /** Role this model would fill, e.g. "Citadel keep", "Destroyer", "Governor". */
  role: string;
  /** URL path served by the dev server (/assets/... for production, /candidates/... for local). */
  file: string;
  /** Lay out each top-level child of the file as its own item (multi-model files). */
  split?: boolean;
  /** Animation clip to play, by exact name or substring. */
  clip?: string;
  /** Extra uniform scale applied after set-level normalisation. */
  scale?: number;
}

export interface CandidateSet {
  id: string;
  category: Category;
  title: string;
  creator: string;
  license: string;
  source: string;
  status: Status;
  /** How models are sized: one factor for the whole set (keeps relative scale), or per item. */
  fit: { mode: 'set' | 'item'; size: number; axis: 'height' | 'length' };
  items?: CandidateItem[];
  /** For external sets: preview images published by the creator or marketplace. */
  previews?: { url: string; caption: string }[];
  /** Verified facts: polygon budget, rigging, formats, file size, price, access route. */
  facts: string[];
  /** Assessment against the brief. */
  verdict: string;
}

const C = '/candidates';
const USK = `${C}/q-ultimate-space-kit`;
const KSK = `${C}/k-space-kit/Models/GLTF format`;
const KST = `${C}/k-space-station-kit/Models/GLB format`;
const KMS = `${C}/k-modular-space-kit/Models/GLB format`;
const SFE = `${C}/q-sci-fi-essentials/glTF`;
const UAL = `${C}/q-universal-animation/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb`;
const POSED = `${C}/q-posed-humans/Posed Background Characters by @Quaternius`;
const M = '/assets/models';

const usk = (n: string, role: string): CandidateItem => ({ role, file: `${USK}/${n}.glb` });
const ksk = (n: string, role: string): CandidateItem => ({ role, file: `${KSK}/${n}.glb` });
const kst = (n: string, role: string): CandidateItem => ({ role, file: `${KST}/${n}.glb` });
const kms = (n: string, role: string): CandidateItem => ({ role, file: `${KMS}/${n}.glb` });
const sfe = (n: string, role: string): CandidateItem => ({ role, file: `${SFE}/${n}.gltf` });
const ual = (clip: string, role: string): CandidateItem => ({ role, file: UAL, clip });

export const CANDIDATE_SETS: CandidateSet[] = [
  // ------------------------------------------------------------------ capital
  {
    id: 'capital-production', category: 'capital', status: 'production',
    title: 'Current production: Kenney City Kits with Quaternius and Kenney space parts',
    creator: 'Kenney; Quaternius', license: 'CC0 1.0', source: 'docs/ASSET_CATALOG.md',
    fit: { mode: 'set', size: 9, axis: 'height' },
    items: [
      { role: 'Citadel keep', file: `${M}/city/c_building-skyscraper-e.glb` },
      { role: 'Citadel wing', file: `${M}/city/c_building-skyscraper-c.glb` },
      { role: 'Throne hall', file: `${M}/city/c_building-m.glb` },
      { role: 'Treasury', file: `${M}/city/c_building-k.glb` },
      { role: 'Refinery', file: `${M}/city/i_building-g.glb` },
      { role: 'Shipyard', file: `${M}/space/k_hangar_largeA.glb` },
      { role: 'Research dome', file: `${M}/space/geodesic_dome.glb` },
      { role: 'Observatory', file: `${M}/space/k_satelliteDish_large.glb` },
      { role: 'Bastion gate', file: `${M}/space/k_gate_complex.glb` },
    ],
    facts: ['Shown here at native file scale; the game rescales each part to its plot', 'Ships today. 1.2–14k triangles per part, one shared colour atlas per Kenney kit', 'Sits on a procedural grassy plateau with stone-style walls and a shield dome'],
    verdict: 'Not approved as final. The Kenney city buildings read as a present-day downtown, and they mix poorly with the rounded Quaternius domes and the grassy plateau. There is no imperial or monumental character.',
  },
  {
    id: 'capital-q-space-colony', category: 'capital', status: 'local',
    title: 'Quaternius Ultimate Space Kit (full) with Sci-Fi Essentials props',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://opengameart.org/content/ultimate-space-kit-by-quaternius',
    fit: { mode: 'set', size: 6, axis: 'height' },
    items: [
      usk('Base Large', 'Citadel core'), usk('Building L', 'Ministry block'), usk('Geodesic Dome', 'Research institute'),
      usk('House Cylinder', 'Habitat tower'), usk('House Long', 'Barracks'), usk('House Open', 'Hangar hall'), usk('House Pod', 'Residential pod'),
      usk('Connector', 'Skyway'), usk('Solar Panel Structure', 'Power array'), usk('Roof Radar', 'Sensor mast'), usk('Roof Antenna', 'Antenna'),
      usk('Metal Support', 'Monument plinth'), usk('Spaceship', 'Landed shuttle'), sfe('Prop_SatelliteDish', 'Deep-space dish'),
    ],
    facts: ['87 GLB models, 5.8 MB in total; buildings are 0.3–4k triangles with flat materials', 'Sci-Fi Essentials free tier: 37 glTF models with 1–2k px PBR textures (167 MB download)'],
    verdict: 'Coherent, clean and futuristic, but it is a small frontier outpost kit. Buildings are one to two storeys with no monumental pieces, so it cannot carry a Citadel at level 30 or a dense imperial capital.',
  },
  {
    id: 'capital-k-space-base', category: 'capital', status: 'local',
    title: 'Kenney Space Kit 2.0: hangars, gates, generators and monorail',
    creator: 'Kenney', license: 'CC0 1.0', source: 'https://opengameart.org/content/space-kit-remade',
    fit: { mode: 'set', size: 6, axis: 'height' },
    items: [
      ksk('hangar_largeA', 'Shipyard hangar'), ksk('hangar_largeB', 'Dry dock'), ksk('hangar_roundGlass', 'Observatory'), ksk('hangar_roundA', 'Assembly dome'),
      ksk('gate_complex', 'Bastion gate'), ksk('structure_detailed', 'Industrial frame'), ksk('machine_generatorLarge', 'Stellar forge'),
      ksk('satelliteDish_large', 'Deep-space array'), ksk('rocket_baseA', 'Launch pad'), ksk('turret_double', 'Defence battery'),
      ksk('chimney_detailed', 'Refinery stack'), ksk('monorail_trainPassenger', 'Transit line'), ksk('platform_large', 'Landing platform'),
    ],
    facts: ['153 models, 6.7 MB zip; 0.1–3k triangles each, one 512 px colour atlas', 'GLB, glTF, FBX, OBJ, DAE and STL included'],
    verdict: 'Good for spaceport and industrial districts, and already used for the shipyard and gate. Toy-like proportions and no tall civic or palace architecture, so it can only support a capital, not define one.',
  },
  {
    id: 'capital-k-station', category: 'capital', status: 'local',
    title: 'Kenney Space Station Kit and Modular Space Kit',
    creator: 'Kenney', license: 'CC0 1.0', source: 'https://opengameart.org/content/space-station-kit',
    fit: { mode: 'set', size: 4, axis: 'height' },
    items: [
      kst('structure', 'Frame'), kst('structure-panel', 'Panel frame'), kst('wall-window-banner', 'Facade with banner'), kst('wall-door-wide-banner', 'Grand doorway'),
      kst('container-tall', 'Cargo tower'), kst('display-wall-wide', 'Display wall'), kms('room-large', 'Station hall'), kms('corridor-wide', 'Wide corridor'),
      kms('gate-door-window', 'Blast gate'), kms('stairs-wide', 'Ceremonial stair'),
    ],
    facts: ['Space Station Kit: 97 models; Modular Space Kit: 40 models; both GLB, FBX and OBJ, single atlas', 'All pieces are interior-scale (walls, rooms, corridors)'],
    verdict: 'Rejected for the capital exterior: these are interior kits. They could serve a throne-room or council-chamber interior scene later.',
  },
  {
    id: 'capital-q-downtown', category: 'capital', status: 'external',
    title: 'Quaternius Downtown City MegaKit',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://quaternius.itch.io/downtown-city-megakit',
    fit: { mode: 'set', size: 9, axis: 'height' },
    previews: [
      { url: 'https://img.itch.zone/aW1hZ2UvNDU5NTY4MS8yNzM3OTMzOS5wbmc=/original/xrTHTF.png', caption: 'Creator preview (itch.io)' },
      { url: 'https://img.itch.zone/aW1hZ2UvNDU5NTY4MS8yNzM3OTM0Mi5wbmc=/original/5LpcyG.png', caption: 'Creator preview (itch.io)' },
    ],
    facts: ['Free Standard tier, 223 MB (name-your-own-price, $0 minimum)', 'Downloadable only through itch.io in a browser; automated download refused here'],
    verdict: 'A large, polished modular city in the same style family as the ships, but it is a present-day downtown, not futuristic or imperial. Same problem as the current Kenney buildings.',
  },
  {
    id: 'capital-kaykit-space-base', category: 'capital', status: 'external',
    title: 'KayKit Space Base Bits',
    creator: 'Kay Lousberg', license: 'CC0 1.0', source: 'https://kaylousberg.itch.io/space-base-bits',
    fit: { mode: 'set', size: 6, axis: 'height' },
    previews: [
      { url: 'https://img.itch.zone/aW1hZ2UvMjIwOTA3MS8xMzA2MzI4My5wbmc=/original/IKM9EU.png', caption: 'Creator preview (itch.io)' },
      { url: 'https://img.itch.zone/aW1hZ2UvMjIwOTA3MS8xMzA2MzI4NC5wbmc=/original/RGBdSR.png', caption: 'Creator preview (itch.io)' },
    ],
    facts: ['48+ models on a single 1024 px gradient atlas; free tier 5.2 MB', 'Downloadable only through itch.io in a browser'],
    verdict: 'Charming mining-colony base pieces in a chunky toy style. Good for colony worlds, too small and playful for an imperial capital.',
  },
  {
    id: 'capital-fab-island-city', category: 'capital', status: 'external',
    title: 'Low Poly Flying Sci Fi Island City (Fab, free)',
    creator: 'Mnostva Art', license: 'Fab Standard License (free listing)', source: 'https://www.fab.com/listings/81e34e7d-d23a-43c3-a9e0-b44265a21d3f',
    fit: { mode: 'set', size: 9, axis: 'height' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/269ca0c7-601a-40f0-8043-81372db5d405/23c3ff9b-4b34-4fd7-a9a9-c1d84f67aa19.png', caption: 'Marketplace preview (Fab)' }],
    facts: ['53 meshes; GLB, FBX, OBJ, Blender, Unity and Unreal formats', 'Free, but needs a Fab (Epic) account to download', 'Fab Standard License: may ship inside a game, may not be redistributed as standalone files; web builds expose GLBs, so this needs a licence check'],
    verdict: 'Closest free match to a floating futuristic capital, in a stylised low-poly look that would sit well beside the Quaternius ships. Worth a manual download to evaluate.',
  },
  {
    id: 'capital-synty-scifi', category: 'capital', status: 'external',
    title: 'Synty POLYGON Sci-Fi Cyber City and Sci-Fi Worlds (paid)',
    creator: 'Synty Studios', license: 'Synty / Fab Standard License (paid)', source: 'https://www.fab.com/listings/dad680a5-fcaf-4863-b080-f9b4fdc2ac5e',
    fit: { mode: 'set', size: 9, axis: 'height' },
    previews: [
      { url: 'https://media.fab.com/image_previews/gallery_images/af9dc8aa-2f63-4a9e-9107-c843bcf8b548/60d7881c-df8e-4b1a-9337-bcb786d333d3.png', caption: 'Sci-Fi Cyber City (Fab)' },
      { url: 'https://media.fab.com/image_previews/gallery_images/b0534dc3-6e15-4c5e-8f05-da4926cb6827/5af1dc0c-62f8-4990-a153-19cf8ca9bc0f.png', caption: 'Sci-Fi Worlds (Fab)' },
    ],
    facts: ['Sci-Fi Cyber City: 926 meshes, $199.99. Sci-Fi Worlds: 1,285 meshes including characters, $499.99', 'Fab copies are Unreal-only; Synty’s own store sells FBX/Unity source', 'One coherent style across city, ships, characters, aliens and mechs'],
    verdict: 'The most complete coherent commercial option: one art style for every category in this milestone. Cost and the web-distribution licence terms need your decision.',
  },
  {
    id: 'capital-justcreate-base', category: 'capital', status: 'external',
    title: 'Low Poly Sci-Fi Planet Base - Space Station (paid)',
    creator: 'JustCreate', license: 'Fab Standard License (paid)', source: 'https://www.fab.com/listings/6c0316ae-9192-4c09-a461-7593cef4ee41',
    fit: { mode: 'set', size: 9, axis: 'height' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/705aa1ed-ac02-4476-bc79-24c2937bd7ab/1c78765b-367f-46d5-9305-4f574df6c352.png', caption: 'Marketplace preview (Fab)' }],
    facts: ['211 meshes; GLB and FBX available directly', '$49.99'],
    verdict: 'Affordable, ships as GLB, and the planetary-base look fits a capital world. Less monumental than Synty.',
  },
  {
    id: 'capital-sketchfab-ccby', category: 'capital', status: 'external',
    title: 'Sketchfab CC BY singles (not a coherent set)',
    creator: 'Various', license: 'CC BY 4.0 (attribution required)', source: 'https://sketchfab.com',
    fit: { mode: 'set', size: 9, axis: 'height' },
    previews: [
      { url: 'https://media.sketchfab.com/models/d885fdb25ed846779fc711917fbeeed2/thumbnails/888b0f4547854d768698f8f81f161ce3/227ec4add54947a880dfadce50052946.jpeg', caption: 'Sci-Fi Future Building 2: Simple Dome, nenkea, 47.9k faces' },
      { url: 'https://media.sketchfab.com/models/c271103cd2f84ed3992baeda6416bbb0/thumbnails/e890332d197646cca942aa3295b25f0f/640x360.jpeg', caption: 'Sci-Fi Tower, Jonathan, 3.4k faces' },
      { url: 'https://media.sketchfab.com/models/b9639a88b981451f9c8b2440361dbb31/thumbnails/3a58567f2c0649abacadafaacf854f49/379ccaffe2154e6aa18a3e35441df775.jpeg', caption: 'Futuristic City Chunk, LxNazarov, 119.5k faces' },
    ],
    facts: ['Metadata from the Sketchfab API; downloads need a Sketchfab login', 'Each model is by a different artist, with different texel density and lighting'],
    verdict: 'Individually attractive, but mixing them would not produce a coherent capital. Useful only as a hero centrepiece inside a coherent kit.',
  },

  // ------------------------------------------------------------------ ships
  {
    id: 'ships-production', category: 'ships', status: 'production',
    title: 'Current production: Quaternius Ultimate Spaceships',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://opengameart.org/content/lowpoly-spaceships-pack',
    fit: { mode: 'item', size: 3, axis: 'length' },
    items: [
      ['Bob', 'Scout'], ['Omen', 'Corvette'], ['Challenger', 'Frigate'], ['Striker', 'Destroyer'], ['Dispatcher', 'Cruiser'], ['Spitfire', 'Battlecruiser'],
      ['Imperial', 'Battleship'], ['Pancake', 'Carrier'], ['Insurgent', 'Dreadnought'], ['Zenith', 'Logistics tender'], ['Executioner', 'Troop transport'],
      ['colony_pod', 'Colony ship'], ['constructor_tug', 'Construction ship'],
    ].map(([f, role]) => ({ role, file: `${M}/ships/${f}.glb` })),
    facts: ['11 hulls, 1–6k triangles, one 1024 px texture each', 'Colony and construction ships come from the Ultimate Space Kit in a brighter style'],
    verdict: 'Coherent and readable, but all hulls are fighter-sized: the dreadnought and battleship do not read as capital ships. The civilian hulls clash in style, and there are no mining, cargo, science or diplomatic vessels.',
  },
  {
    id: 'ships-majadroid', category: 'ships', status: 'local',
    title: 'Majadroid LowPoly Spaceships and Components',
    creator: 'Majadroid (Maik Hoffmann)', license: 'CC0 1.0', source: 'https://opengameart.org/content/3d-lowpoly-spaceships-and-components',
    fit: { mode: 'item', size: 3, axis: 'length' },
    items: [{ role: 'Ready-to-fly hull', file: `${C}/majadroid-ships/LowPoly-Spaceships-By-Majadroid/LowPoly Spaceships ReadyToFly.fbx`, split: true }],
    facts: ['3 FBX files: ready-made hulls, components and accessories for kitbashing; 6.8 MB zip', 'Flat colour materials, no textures'],
    verdict: 'Kitbash parts could produce many classes with one look, but the ready-made hulls are small fighters and assembling a full fleet is design work this milestone must not do without approval.',
  },
  {
    id: 'ships-kenney-craft', category: 'ships', status: 'local',
    title: 'Kenney Space Kit craft, including civilian hulls',
    creator: 'Kenney', license: 'CC0 1.0', source: 'https://opengameart.org/content/space-kit-remade',
    fit: { mode: 'item', size: 3, axis: 'length' },
    items: [
      ksk('craft_speederA', 'Scout'), ksk('craft_speederB', 'Corvette'), ksk('craft_speederC', 'Frigate'), ksk('craft_speederD', 'Destroyer'), ksk('craft_racer', 'Interceptor'),
      ksk('craft_miner', 'Mining vessel'), ksk('craft_cargoA', 'Cargo hauler'), ksk('craft_cargoB', 'Bulk freighter'), ksk('rover', 'Surface rover'),
    ],
    facts: ['0.3–1.5k triangles, single atlas', 'Has explicit mining and cargo hulls'],
    verdict: 'Rejected for warships (blocky, toy-like). The mining and cargo hulls are the only CC0 civilian hulls found that match the Kenney structures.',
  },
  {
    id: 'ships-civilian-mixed', category: 'ships', status: 'local',
    title: 'Civilian gap fillers from mixed CC0 sources',
    creator: 'Quaternius; g2od', license: 'CC0 1.0', source: 'https://opengameart.org/content/cargo-spaceship-0',
    fit: { mode: 'item', size: 3, axis: 'length' },
    items: [
      usk('Spaceship', 'Diplomatic courier'), usk('Spaceship-u105mYHLHU', 'Science vessel'), usk('Spaceship-VSxUAFhzbA', 'Survey ship'),
      { role: 'Cargo hauler', file: `${C}/g2od-cargo/cargo.obj` },
    ],
    facts: ['Ultimate Space Kit ships: 1–2k triangles, flat colours', 'g2od cargo ship: OBJ with one texture, 112 KB'],
    verdict: 'Fills the gap only nominally. Three different styles, and none matches the Ultimate Spaceships warships.',
  },
  {
    id: 'ships-synty-space', category: 'ships', status: 'external',
    title: 'Synty POLYGON Sci-Fi Space (paid)',
    creator: 'Synty Studios', license: 'Synty / Fab Standard License (paid)', source: 'https://www.fab.com/listings/85cfe617-0c52-4dec-857d-43e786a80c2e',
    fit: { mode: 'item', size: 3, axis: 'length' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/518836bd-1135-49d1-94c5-560c7417b841/09163f6c-1f19-424c-af0b-59dd3fd5ed06.png', caption: 'Marketplace preview (Fab)' }],
    facts: ['602 meshes: modular ships, stations, characters; $149.99', 'Same style family as the Synty city and character packs'],
    verdict: 'Recommended commercial fleet if Synty is chosen for the capital: capital-ship scale hulls plus civilian craft in one style.',
  },
  {
    id: 'ships-stellar-armada', category: 'ships', status: 'external',
    title: 'Stellar Armada: Sci-Fi Spaceship Fleet (paid)',
    creator: 'Ultima Store', license: 'Fab Standard License (paid)', source: 'https://www.fab.com/listings/030838a9-26f1-48b2-a3dd-e3e9d33a534d',
    fit: { mode: 'item', size: 3, axis: 'length' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/c74e810a-4348-4607-ae1b-df875d9d1186/ee37f30b-9657-47a5-ba94-5fa7698b4208.jpg', caption: 'Marketplace preview (Fab)' }],
    facts: ['32 meshes, Unreal format only; $49.99'],
    verdict: 'Realistic PBR fleet with distinct class silhouettes; Unreal-only delivery needs conversion, and the realistic look would clash with stylised characters.',
  },
  {
    id: 'ships-ebal-creator', category: 'ships', status: 'external',
    title: 'Ebal Studios Hi-Rez Spaceships Creator (paid)',
    creator: 'Ebal Studios', license: 'Fab Standard License (paid)', source: 'https://www.fab.com/listings/730d24f1-4622-4625-8791-1f8b2d0b4ca5',
    fit: { mode: 'item', size: 3, axis: 'length' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/604374d2-cc73-42e3-aecc-1e6570af20a1/a6105a93-ed59-44af-8b93-2e1b6c7c9bf7.png', caption: 'Marketplace preview (Fab)' }],
    facts: ['134 meshes; Blender, FBX, OBJ; $99.99', 'Modular parts designed to assemble consistent fleets'],
    verdict: 'Strong option for a whole fleet in one look, including civilian hulls, delivered in web-friendly formats.',
  },
  {
    id: 'ships-sketchfab-ccby', category: 'ships', status: 'external',
    title: 'Sketchfab CC BY singles',
    creator: 'Various', license: 'CC BY 4.0 (attribution required)', source: 'https://sketchfab.com',
    fit: { mode: 'item', size: 3, axis: 'length' },
    previews: [
      { url: 'https://media.sketchfab.com/models/b8001c7cf83240f383ccdbe75094e468/thumbnails/26287de85dcb49d0ba25bc1d87c6f37d/1140742fe1724e21a3023c497c1ea19f.jpeg', caption: 'Luminaris Starship, iggy-design, 4.2k faces' },
      { url: 'https://media.sketchfab.com/models/c508be042d9a4d358359623f6be34bc3/thumbnails/8ee687fa39cd4654be295120726a41ad/4e21066dda304a2c8130c72d24a6282a.jpeg', caption: 'Space Battleship Aquamarine, Kai Xiang, 113k faces' },
      { url: 'https://media.sketchfab.com/models/e9faa887c3684271b67be00649e11dcf/thumbnails/18542bb1e8a24bb0b8adcf4a45c9c9d1/56645cb950d64eb584cd7f766fd3830f.jpeg', caption: 'SPACESHIP - CARGO, Kerem Kavalci, 53k faces' },
      { url: 'https://media.sketchfab.com/models/86d336e0fa6f40329de8cda4a71d8a17/thumbnails/4728dc58dba74bd599d67f528fe891fa/428dba453ce54d8895661335631f4afa.jpeg', caption: 'Heavy VTOL gunship, Kai Xiang, 46.7k faces' },
    ],
    facts: ['Downloads need a Sketchfab login', 'Franchise fan-art (Star Wars, The Expanse) and AI-generated models were excluded'],
    verdict: 'Mismatched styles and polygon budgets; unsuitable as a fleet.',
  },

  // ------------------------------------------------------------------ heroes
  {
    id: 'heroes-production', category: 'heroes', status: 'production',
    title: 'Current production: Quaternius Ultimate Animated Character Pack',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://opengameart.org/content/animated-characters-pack',
    fit: { mode: 'item', size: 1.8, axis: 'height' },
    items: [
      ['OldClassy_Male', 'Governor'], ['BlueSoldier_Female', 'Admiral'], ['Soldier_Male', 'General'], ['Doctor_Female_Young', 'Scientist'],
      ['Suit_Male', 'Diplomat'], ['Worker_Female', 'Industrialist'], ['Casual_Male', 'Explorer'], ['Ninja_Male', 'Spymaster'],
    ].map(([f, role]) => ({ role, file: `${M}/chars/${f}.glb`, clip: 'Idle' })),
    facts: ['Rigged, 11 animations, 2–4k triangles', 'Chibi proportions: head about a third of body height'],
    verdict: 'Not approved: the chibi proportions undercut rulers and commanders, and the costumes are present-day.',
  },
  {
    id: 'heroes-ual-mannequin', category: 'heroes', status: 'local',
    title: 'Quaternius Universal Animation Library mannequin (proxy for Universal Base Characters)',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://opengameart.org/content/universal-animation-library',
    fit: { mode: 'item', size: 1.8, axis: 'height' },
    items: [
      ual('Idle_Loop', 'Sovereign at rest'), ual('Idle_Talking_Loop', 'Council speaker'), ual('Walk_Formal_Loop', 'Formal procession'),
      ual('Pistol_Idle_Loop', 'Officer on guard'), ual('Interact', 'Engineer'), ual('Sitting_Talking_Loop', 'Seated minister'),
    ],
    facts: ['13.7k triangles, standard humanoid skeleton, 46 animations in one 6.5 MB GLB', 'Faceless mannequin on the same skeleton and proportions as Universal Base Characters'],
    verdict: 'Shows the realistic proportions and the animation set (formal walk, talking, sitting, pistol) that the rulers and commanders need. The mannequin itself is not presentable; it needs the Universal Base Characters bodies and outfits.',
  },
  {
    id: 'heroes-q-posed', category: 'heroes', status: 'local',
    title: 'Quaternius Posed Background Characters',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://opengameart.org/content/lowpoly-posed-humans',
    fit: { mode: 'item', size: 1.8, axis: 'height' },
    items: [
      { role: 'Standing (male)', file: `${POSED}/Male/Male Poses/OBJ/Male_Standing.obj` },
      { role: 'Hands on hips (male)', file: `${POSED}/Male/Male Poses/OBJ/Male_Standing_Hips.obj` },
      { role: 'Standing (female)', file: `${POSED}/Female/Female Poses/OBJ/Female_Standing.obj` },
      { role: 'Waving (female)', file: `${POSED}/Female/Female Poses/OBJ/Woman_Standing_Waving.obj` },
    ],
    facts: ['Realistic proportions, static poses, not rigged; hair as separate meshes', 'Flat colours, 1–2k triangles'],
    verdict: 'Rejected: static and very low detail. Only usable as distant crowds.',
  },
  {
    id: 'heroes-q-ubc', category: 'heroes', status: 'external',
    title: 'Quaternius Universal Base Characters',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://quaternius.itch.io/universal-base-characters',
    fit: { mode: 'item', size: 1.8, axis: 'height' },
    previews: [
      { url: 'https://img.itch.zone/aW1hZ2UvMzgyMjI1OS8yMjgzNDE5MS5wbmc=/original/ykS%2F9D.png', caption: 'Creator preview (itch.io)' },
      { url: 'https://img.itch.zone/aW1hZ2UvMzgyMjI1OS8yMjgzNDE5NC5wbmc=/original/kyyHxd.png', caption: 'Creator preview (itch.io)' },
    ],
    facts: ['Free Standard tier, 122 MB (name-your-own-price, $0 minimum)', 'Standard humanoid rig, compatible with the Universal Animation Library above', 'itch.io browser download only; the automated download was refused here'],
    verdict: 'Recommended CC0 route for heroes: realistic proportions, same style family as the ships, and the full animation library already verified above. Needs one manual browser download. Outfits beyond the base bodies are limited (the outfit pack is fantasy-themed).',
  },
  {
    id: 'heroes-synty-sidekick', category: 'heroes', status: 'external',
    title: 'Synty Sci-Fi Civilians, Sidekick modular characters (paid)',
    creator: 'Synty Studios', license: 'Synty / Fab Standard License (paid)', source: 'https://www.fab.com/listings/ec421d4d-0764-4895-98f6-9cccd7b04a1c',
    fit: { mode: 'item', size: 1.8, axis: 'height' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/e581116d-e59d-41a1-a759-6e29363617f9/a63f4acd-581e-4535-9c76-bda163b4d170.png', caption: 'Marketplace preview (Fab)' }],
    facts: ['Modular heads, outfits and equipment; $199.99', 'Matches the Synty city and space packs'],
    verdict: 'Best outfit and equipment variety found (officers, civilians, armour). Commercial, and stylised rather than realistic.',
  },
  {
    id: 'heroes-justcreate', category: 'heroes', status: 'external',
    title: 'Stylized Modular Sci-Fi Characters (paid)',
    creator: 'JustCreate', license: 'Fab Standard License (paid)', source: 'https://www.fab.com/listings/c1c622b5-b461-454d-8180-be6ce01c7689',
    fit: { mode: 'item', size: 1.8, axis: 'height' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/5498b2f7-cdc7-49c6-94a2-f6e6ec07c90d/3a192e0f-b23a-47b4-8d6a-9d3b02c80c40.png', caption: 'Marketplace preview (Fab)' }],
    facts: ['FBX; $49.99', 'Same creator as the Planet Base capital candidate'],
    verdict: 'Lower-cost commercial pairing with the JustCreate capital base.',
  },
  {
    id: 'heroes-sketchfab-ccby', category: 'heroes', status: 'external',
    title: 'Sketchfab CC BY singles',
    creator: 'Various', license: 'CC BY 4.0 (attribution required)', source: 'https://sketchfab.com',
    fit: { mode: 'item', size: 1.8, axis: 'height' },
    previews: [
      { url: 'https://media.sketchfab.com/models/de876bfdce1c47a4aa67670faee7208e/thumbnails/dfdbf9612a31441aa9b1b8989b8696a5/1929bf08851c4a5587f707ac44e2b8fe.jpeg', caption: 'Sci-Fi Soldier, ART_LOLL, 30.8k faces, not rigged' },
      { url: 'https://media.sketchfab.com/models/663a72dec48a415cb6777dfc02b6dd96/thumbnails/71292ee719ea4a0db84244d8e0090d0a/12ca157239284a12b42ef3d187083eda.jpeg', caption: 'Sci-Fi Female Warrior, liamoliphant, 31.8k faces, not rigged' },
    ],
    facts: ['Not rigged; downloads need a Sketchfab login'],
    verdict: 'Unrigged singles; would need rigging and still not match each other.',
  },

  // ------------------------------------------------------------------ villains
  {
    id: 'villains-production', category: 'villains', status: 'production',
    title: 'Current catalogue: Quaternius Animated Mech Pack and Ultimate Space Kit aliens',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://opengameart.org/content/animated-mech-pack',
    fit: { mode: 'item', size: 2.2, axis: 'height' },
    items: [
      { role: 'War machine', file: `${M}/villains/Mech_Mike.glb`, clip: 'Idle' }, { role: 'Mercenary mech', file: `${M}/villains/Mech_Stan.glb`, clip: 'Idle' },
      { role: 'Heavy walker', file: `${M}/villains/Mech_George.glb`, clip: 'Idle' }, { role: 'Raider mech', file: `${M}/villains/Mech_Leela.glb`, clip: 'Idle' },
      { role: 'Alien brute', file: `${M}/villains/alien_brute.glb` }, { role: 'Alien scout', file: `${M}/villains/alien_scout.glb` }, { role: 'Alien flyer', file: `${M}/villains/alien_flyer.glb` },
    ],
    facts: ['Catalogued but not used in any gameplay view', 'Mechs: rigged, 18 animations; aliens: static'],
    verdict: 'The mechs are good mechanical antagonists. The aliens are cute critters, not leaders; there is no rival-sovereign or alien-commander figure.',
  },
  {
    id: 'villains-q-scifi', category: 'villains', status: 'local',
    title: 'Quaternius Sci-Fi Essentials enemies and Ultimate Space Kit hostiles',
    creator: 'Quaternius', license: 'CC0 1.0', source: 'https://opengameart.org/content/sci-fi-essentials-kit',
    fit: { mode: 'item', size: 2.2, axis: 'height' },
    items: [
      sfe('Enemy_EyeDrone', 'Surveillance drone'), sfe('Enemy_QuadShell', 'Siege walker'), sfe('Enemy_Trilobite', 'Swarm creature'),
      usk('Enemy Large', 'Hive brute'), usk('Enemy Small', 'Hive drone'), usk('Enemy Flying', 'Hive flyer'), usk('Mech', 'Sentinel mech'),
    ],
    facts: ['Sci-Fi Essentials enemies: PBR textured, 2–5k triangles, animated in the Pro tier only', 'Ultimate Space Kit hostiles: flat colours, some rigged'],
    verdict: 'Good rank-and-file threats in the ship style family; still no leader characters.',
  },
  {
    id: 'villains-misc', category: 'villains', status: 'local',
    title: 'Other CC0 creatures and robots',
    creator: 'cdmir; pixelmannen', license: 'CC0 1.0', source: 'https://opengameart.org/content/alien-bug-animated',
    fit: { mode: 'item', size: 2.2, axis: 'height' },
    items: [
      { role: 'Alien bug', file: `${C}/cdmir-alien-bug/alien-bug.glb`, clip: 'Idle' },
      { role: 'Combat robot', file: `${C}/pixelmannen-robots/Model/BaseModel.dae` },
      { role: 'Scout robot', file: `${C}/pixelmannen-robots/Model/SmallerModel.dae` },
    ],
    facts: ['Alien bug: 1.2k triangles, rigged, 4 animations, 3 textures', 'Robots: Collada, textured, not rigged'],
    verdict: 'Rejected: different styles from each other and from the ships.',
  },
  {
    id: 'villains-synty-mech', category: 'villains', status: 'external',
    title: 'Synty POLYGON Mech Pack (paid)',
    creator: 'Synty Studios', license: 'Synty / Fab Standard License (paid)', source: 'https://www.fab.com/listings/c1f623be-f74f-46d8-809c-1b5566e6c6db',
    fit: { mode: 'item', size: 2.2, axis: 'height' },
    previews: [{ url: 'https://media.fab.com/image_previews/gallery_images/cb0cdb8c-b262-45b2-99ba-d9063d9472d4/ca8335ba-9788-4421-996e-b208b2b845fd.png', caption: 'Marketplace preview (Fab)' }],
    facts: ['162 meshes; $99.99; Sci-Fi Worlds bundle adds alien characters'],
    verdict: 'Fits the Synty route; Synty Sci-Fi Worlds also includes alien characters that could serve as rival sovereigns.',
  },
  {
    id: 'villains-fab-alien', category: 'villains', status: 'external',
    title: 'Alien Character (Fab, free) and Aliens Warrior pack (paid)',
    creator: 'Luci3D; Bugrimov Maksim', license: 'Fab Standard License', source: 'https://www.fab.com/listings/39c1d5ef-2fb4-4f1d-afbd-20d958189ef4',
    fit: { mode: 'item', size: 2.2, axis: 'height' },
    previews: [
      { url: 'https://media.fab.com/image_previews/gallery_images/f660038f-a2eb-4795-a215-6d69dcf35353/174f22f1-6120-4a4e-b782-2f237559445c.jpeg', caption: 'Alien Character, Luci3D (free, FBX)' },
      { url: 'https://media.fab.com/image_previews/gallery_images/5fbe1226-6c0a-4c2d-ad8b-d81279cdb5ad/4c96e518-4aaa-4316-94a4-892dd8f42d67.jpg', caption: 'Alien Warrior 01, Bugrimov Maksim (paid, 134k triangles)' },
    ],
    facts: ['Alien Warrior 01: 134,356 triangles with 4K textures, far over a browser budget without decimation'],
    verdict: 'Realistic sculpts that would clash with a stylised game; the free alien is worth a look only if a realistic direction is chosen.',
  },
  {
    id: 'villains-sketchfab-ccby', category: 'villains', status: 'external',
    title: 'Sketchfab CC BY rigged creatures (DM-913 and others)',
    creator: 'DM-913; 3DMAN; nodoxi; MooKorea', license: 'CC BY 4.0 (attribution required)', source: 'https://sketchfab.com/DM-913',
    fit: { mode: 'item', size: 2.2, axis: 'height' },
    previews: [
      { url: 'https://media.sketchfab.com/models/01323e4b2563430f9da85cd255b6e176/thumbnails/6e9c619806d7474a8ae981a81028bb11/d04dcfcafedf403abe55c1ab6778a229.jpeg', caption: 'Insectoid Monster Rig, DM-913, 13.2k faces, rigged' },
      { url: 'https://media.sketchfab.com/models/2d8b32f0864644b5980b81b571b1838f/thumbnails/1efc871b7fa5450c9f1dc1eb903d2be1/449fa36a12554dd29b43e8fcc888022a.jpeg', caption: 'Umbra Marauder Rig, DM-913, 109.8k faces, 3 animations' },
      { url: 'https://media.sketchfab.com/models/18408da4643543df942e645353841c83/thumbnails/d046ab8b15ee4b4494ff61156cefedce/cc03e5e3da624e6e9785965bf3b0df39.jpeg', caption: 'Alien RIG, 3DMAN, 6.5k faces' },
      { url: 'https://media.sketchfab.com/models/54b5ded4a49442adb9233752b542cbee/thumbnails/cdde5ba985164b23958586a23dc8c98f/366955a7a4174b988edc0ab7922817a9.jpeg', caption: 'Lurker, MooKorea, 4.1k faces, 8 animations' },
    ],
    facts: ['Downloads need a Sketchfab login; attribution must appear in the game credits'],
    verdict: 'Distinctive creature antagonists, mostly from one artist (DM-913). Could form a hostile-alien faction if attribution is acceptable.',
  },
];

export const CATEGORY_LABEL: Record<Category, string> = {
  capital: 'Capital and architecture', ships: 'Spacecraft', heroes: 'Heroes and commanders', villains: 'Villains and antagonists',
};
