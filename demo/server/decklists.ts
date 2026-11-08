/**
 * The demo's players and their decklists. The lists are real ones from
 * Limitless (limitlesstcg.com/decks/list/<id>), named with the archetype
 * Limitless gives them, so the demo names every deck without reading any
 * archetype rules. The players are the home page's sample players.
 */

export interface DemoList {
  archetype: string;
  /** The list as a player pastes it from Pokémon TCG Live. */
  text: string;
}

/** The lists, by their Limitless list id. */
export const DEMO_LISTS: Readonly<Record<string, DemoList>> = {
  '30712': {
    archetype: 'Archaludon Zoroark',
    text: "Pokémon: 19\n4 N's Zorua JTG 97\n4 N's Zoroark ex JTG 98\n4 Duraludon SCR 106\n3 Archaludon ex SSP 130\n1 Archaludon SCR 107\n1 Meowth ex POR 62\n1 Mega Mawile ex MEG 94\n1 Relicanth TEF 84\n\nTrainer: 31\n4 Lillie's Determination MEG 119\n3 Boss's Orders MEG 114\n2 Black Belt's Training JTG 143\n2 Morty's Conviction TEF 155\n1 Ciphermaniac's Codebreaking TEF 145\n1 Judge POR 76\n4 Poké Pad POR 81\n4 Ultra Ball MEG 131\n4 Pokégear 3.0 SVI 186\n2 Night Stretcher ASC 196\n1 Switch MEG 130\n1 Special Red Card CRI 82\n1 Hero's Cape TEF 152\n1 Team Rocket's Watchtower DRI 180\n\nEnergy: 10\n10 Metal Energy MEE 16"
  },
  '30207': {
    archetype: 'Basic Box',
    text: "Pokémon: 19\n4 Mega Kangaskhan ex MEG 104\n3 Meowth ex POR 62\n2 Teal Mask Ogerpon ex TWM 25\n2 Latias ex SSP 76\n2 Lillie's Clefairy ex JTG 56\n1 Wellspring Mask Ogerpon ex TWM 64\n1 Chien-Pao SSP 56\n1 Raging Bolt ex TEF 123\n1 Fezandipiti ex ASC 142\n1 Iron Leaves ex TEF 25\n1 Bloodmoon Ursaluna ex TWM 141\n\nTrainer: 27\n4 Crispin SCR 133\n2 Boss's Orders MEG 114\n2 Cyrano SSP 170\n1 Ciphermaniac's Codebreaking TEF 145\n1 Judge POR 76\n4 Energy Switch MEG 115\n4 Ultra Ball MEG 131\n2 Night Stretcher ASC 196\n2 Glass Trumpet SCR 135\n1 Prime Catcher TEF 157\n4 Area Zero Underdepths SCR 131\n\nEnergy: 14\n6 Grass Energy MEE 9\n3 Psychic Energy MEE 13\n2 Lightning Energy MEE 12\n2 Fighting Energy MEE 14\n1 Water Energy MEE 11"
  },
  '31102': {
    archetype: "N's Zoroark",
    text: "Pokémon: 17\n4 N's Zorua JTG 97\n4 N's Zoroark ex JTG 98\n2 Munkidori TWM 95\n1 N's Purrloin JTG 96\n1 N's Reshiram JTG 116\n1 Pecharunt ex SFA 39\n1 Yveltal MEG 88\n1 Fezandipiti ex ASC 142\n1 N's Zekrom ASC 155\n1 Tatsugiri TWM 131\n\nTrainer: 35\n4 Lillie's Determination MEG 119\n3 Boss's Orders MEG 114\n3 Cyrano SSP 170\n1 Black Belt's Training JTG 143\n1 Judge POR 76\n1 Janine's Secret Art PRE 112\n4 Buddy-Buddy Poffin TEF 144\n4 Poké Pad POR 81\n3 N's PP Up JTG 153\n2 Night Stretcher ASC 196\n1 Special Red Card CRI 82\n1 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n2 Binding Mochi PRE 95\n2 Team Rocket's Watchtower DRI 180\n1 Gravity Mountain SSP 177\n1 N's Castle JTG 152\n\nEnergy: 8\n8 Darkness Energy MEE 15"
  },
  '29678': {
    archetype: 'Dragapult',
    text: "Pokémon: 19\n4 Dreepy TWM 128\n4 Drakloak TWM 129\n3 Dragapult ex TWM 130\n2 Munkidori TWM 95\n2 Budew ASC 16\n1 Dunsparce TEF 128\n1 Dudunsparce TEF 129\n1 Meowth ex POR 62\n1 Fezandipiti ex ASC 142\n\nTrainer: 32\n4 Lillie's Determination MEG 119\n3 Boss's Orders MEG 114\n2 Crispin SCR 133\n1 Rosa's Encouragement POR 84\n1 Judge POR 76\n4 Buddy-Buddy Poffin TEF 144\n4 Poké Pad POR 81\n4 Crushing Hammer POR 71\n3 Ultra Ball MEG 131\n3 Night Stretcher ASC 196\n1 Unfair Stamp TWM 165\n2 Risky Ruins MEG 127\n\nEnergy: 9\n3 Fire Energy MEE 10\n3 Psychic Energy MEE 13\n3 Darkness Energy MEE 15"
  },
  '31086': {
    archetype: 'Hydrapple',
    text: "Pokémon: 20\n4 Teal Mask Ogerpon ex TWM 25\n2 Applin TWM 17\n2 Dipplin TWM 18\n2 Hydrapple ex SCR 14\n2 Chikorita MEG 8\n2 Bayleef MEG 9\n2 Meganium MEG 10\n1 Meowth ex POR 62\n1 Fezandipiti ex ASC 142\n1 Tapu Bulu SFA 6\n1 Celebi MEG 12\n\nTrainer: 27\n4 Lillie's Determination MEG 119\n2 Boss's Orders MEG 114\n1 Judge POR 76\n1 Briar SCR 132\n1 Team Rocket's Petrel DRI 176\n1 Lana's Aid TWM 155\n1 Drayton SSP 174\n4 Ultra Ball MEG 131\n4 Bug Catching Set TWM 143\n2 Night Stretcher ASC 196\n1 Energy Retrieval SVI 171\n1 Poké Pad POR 81\n1 Unfair Stamp TWM 165\n3 Forest of Vitality MEG 117\n\nEnergy: 13\n13 Grass Energy MEE 9"
  },
  '31175': {
    archetype: 'Grimmsnarl Froslass',
    text: "Pokémon: 22\n4 Marnie's Impidimp DRI 134\n2 Marnie's Morgrem DRI 135\n2 Marnie's Grimmsnarl ex DRI 136\n4 Munkidori TWM 95\n3 Snorunt ASC 46\n3 Froslass TWM 53\n1 Tatsugiri TWM 131\n1 Budew ASC 16\n1 Yveltal MEG 88\n1 Shaymin DRI 10\n\nTrainer: 29\n4 Lillie's Determination MEG 119\n3 Boss's Orders MEG 114\n3 Gwynn PBL 78\n2 Team Rocket's Petrel DRI 176\n4 Poké Pad POR 81\n3 Night Stretcher ASC 196\n2 Buddy-Buddy Poffin TEF 144\n1 Energy Switch MEG 115\n1 Rare Candy MEG 125\n1 Unfair Stamp TWM 165\n1 Special Red Card CRI 82\n1 Air Balloon ASC 181\n3 Spikemuth Gym DRI 169\n\nEnergy: 9\n9 Darkness Energy MEE 15"
  },
  '31096': {
    archetype: 'Okidogi Barbaracle',
    text: "Pokémon: 16\n3 Solrock MEG 75\n3 Okidogi TWM 111\n2 Binacle POR 42\n2 Barbaracle POR 43\n2 Lunatone MEG 74\n1 Bloodmoon Ursaluna PRE 54\n1 Moltres PFL 14\n1 Patrat CRI 70\n1 Shaymin DRI 10\n\nTrainer: 31\n4 Lillie's Determination MEG 119\n3 Boss's Orders MEG 114\n2 Tarragon POR 85\n1 Morty's Conviction TEF 155\n1 Gwynn PBL 78\n1 Hassel TWM 151\n4 Poké Pad POR 81\n4 Fighting Gong MEG 116\n2 Night Stretcher ASC 196\n2 Pokégear 3.0 SVI 186\n1 Premium Power Pro MEG 124\n1 Energy Retrieval SVI 171\n2 Air Balloon ASC 181\n3 Battle Cage PFL 85\n\nEnergy: 13\n8 Fighting Energy MEE 14\n4 Prism Energy ASC 216\n1 Legacy Energy TWM 167"
  },
  '31134': {
    archetype: 'Lopunny Dudunsparce',
    text: "Pokémon: 17\n3 Buneary PFL 83\n2 Mega Lopunny ex PFL 84\n2 Dunsparce JTG 120\n1 Dunsparce TEF 128\n3 Dudunsparce TEF 129\n1 Lillie's Clefairy ex JTG 56\n1 Mew ex 30C 66\n1 Fan Rotom SCR 118\n1 Shaymin DRI 10\n1 Genesect SFA 40\n1 Moltres PFL 14\n\nTrainer: 36\n4 Hilda WHT 84\n4 Boss's Orders MEG 114\n3 Lillie's Determination MEG 119\n2 Wally's Compassion MEG 132\n4 Poké Pad POR 81\n4 Buddy-Buddy Poffin TEF 144\n3 Ultra Ball MEG 131\n2 Pokégear 3.0 SVI 186\n2 Night Stretcher ASC 196\n1 Special Red Card CRI 82\n4 Air Balloon ASC 181\n3 Battle Cage PFL 85\n\nEnergy: 7\n3 Mist Energy TEF 161\n2 Fire Energy MEE 10\n1 Telepathic Psychic Energy POR 88\n1 Enriching Energy SSP 191"
  },
  '31119': {
    archetype: 'Mew Box',
    text: "Pokémon: 22\n4 Mega Kangaskhan ex MEG 104\n3 Meowth ex POR 62\n3 Mew ex 30C 66\n2 Lillie's Clefairy ex JTG 56\n2 Latias ex SSP 76\n2 Wellspring Mask Ogerpon ex TWM 64\n1 Koraidon ex ASC 121\n1 Mega Latias ex MEG 100\n1 Fezandipiti ex ASC 142\n1 Iron Crown ex TEF 81\n1 Unown 30C 72\n1 Chien-Pao SSP 56\n\nTrainer: 25\n4 Crispin SCR 133\n2 Boss's Orders MEG 114\n2 Ciphermaniac's Codebreaking TEF 145\n1 Cyrano SSP 170\n1 Judge POR 76\n4 Ultra Ball MEG 131\n3 Dusk Ball SSP 175\n3 Wondrous Patch PFL 94\n1 Prime Catcher TEF 157\n4 Area Zero Underdepths SCR 131\n\nEnergy: 13\n4 Telepathic Psychic Energy POR 88\n4 Psychic Energy MEE 13\n2 Water Energy MEE 11\n2 Fire Energy MEE 10\n1 Fighting Energy MEE 14"
  },
  '30351': {
    archetype: 'Diancie Dusknoir',
    text: "Pokémon: 19\n3 Duskull PRE 35\n2 Dusclops PRE 36\n2 Dusknoir PRE 37\n2 Frillish WHT 44\n2 Jellicent ex WHT 45\n2 Lillie's Clefairy ex JTG 56\n2 Latias ex SSP 76\n2 Mega Diancie ex PFL 41\n1 Meowth ex POR 62\n1 Fezandipiti ex ASC 142\n\nTrainer: 30\n4 Lillie's Determination MEG 119\n2 Boss's Orders MEG 114\n2 Judge POR 76\n4 Wondrous Patch PFL 94\n3 Poké Pad POR 81\n2 Ultra Ball MEG 131\n2 Night Stretcher ASC 196\n2 Pokégear 3.0 SVI 186\n1 Rare Candy MEG 125\n1 Tool Scrapper ASC 212\n1 Special Red Card CRI 82\n1 Switch MEG 130\n1 Secret Box TWM 163\n1 Powerglass SFA 63\n1 Lillie's Pearl JTG 151\n2 Mystery Garden MEG 122\n\nEnergy: 11\n7 Psychic Energy MEE 13\n4 Telepathic Psychic Energy POR 88"
  },
  '30440': {
    archetype: 'Bloodmoon Ursaluna',
    text: "Pokémon: 13\n3 Solrock MEG 75\n2 Lunatone MEG 74\n2 Bloodmoon Ursaluna PRE 54\n2 Froakie CRI 20\n2 Mega Greninja ex CRI 22\n1 Fezandipiti ex ASC 142\n1 Genesect SFA 40\n\nTrainer: 37\n4 Lillie's Determination MEG 119\n3 Team Rocket's Petrel DRI 176\n2 Boss's Orders MEG 114\n1 Lana's Aid TWM 155\n1 Ciphermaniac's Codebreaking TEF 145\n4 Poké Pad POR 81\n4 Fighting Gong MEG 116\n3 Energy Retrieval SVI 171\n2 Rare Candy MEG 125\n2 Night Stretcher ASC 196\n2 Transformation Tome CRI 83\n1 Switch MEG 130\n1 Special Red Card CRI 82\n1 Secret Box TWM 163\n1 Ultra Ball MEG 131\n3 Air Balloon ASC 181\n2 Nighttime Mine ASC 197\n\nEnergy: 10\n7 Fighting Energy MEE 14\n3 Water Energy MEE 11"
  },
  '30540': {
    archetype: 'Festival Lead',
    text: "Pokémon: 20\n2 Applin TWM 126\n2 Applin TWM 17\n3 Dipplin TWM 18\n3 Grookey TWM 14\n4 Thwackey TWM 15\n2 Goldeen TWM 44\n1 Seaking PRE 21\n1 Rellor TEF 23\n1 Rabsca TEF 24\n1 Psyduck ASC 39\n\nTrainer: 35\n4 Lillie's Determination MEG 119\n2 Gladion's Final Battle PBL 77\n2 Boss's Orders MEG 114\n1 Kieran TWM 154\n1 Dawn PFL 87\n1 Lana's Aid TWM 155\n4 Poké Pad POR 81\n4 Buddy-Buddy Poffin TEF 144\n3 Ultra Ball MEG 131\n2 Night Stretcher ASC 196\n1 Secret Box TWM 163\n3 Air Balloon ASC 181\n2 Brave Bangle WHT 80\n4 Festival Grounds TWM 149\n1 Forest of Vitality MEG 117\n\nEnergy: 5\n3 Grass Energy MEE 9\n2 Growing Grass Energy POR 86"
  },
  '31089': {
    archetype: 'Dragapult Blaziken',
    text: "Pokémon: 21\n4 Dreepy TWM 128\n4 Drakloak TWM 129\n2 Dragapult ex TWM 130\n2 Torchic DRI 40\n1 Combusken DRI 41\n2 Blaziken ex JTG 24\n2 Munkidori TWM 95\n1 Budew ASC 16\n1 Chi-Yu TWM 39\n1 Fezandipiti ex ASC 142\n1 Meowth ex POR 62\n\nTrainer: 31\n4 Lillie's Determination MEG 119\n3 Boss's Orders MEG 114\n2 Crispin SCR 133\n2 Judge POR 76\n4 Buddy-Buddy Poffin TEF 144\n4 Poké Pad POR 81\n4 Ultra Ball MEG 131\n3 Rare Candy MEG 125\n2 Night Stretcher ASC 196\n1 Unfair Stamp TWM 165\n2 Team Rocket's Watchtower DRI 180\n\nEnergy: 8\n3 Fire Energy MEE 10\n3 Psychic Energy MEE 13\n2 Darkness Energy MEE 15"
  }
};

export interface DemoEntrant {
  name: string;
  birthYear: number;
  /** A key of DEMO_LISTS. */
  list: string;
}

/** The sample event's players, in the order the home page lists them. */
export const DEMO_ENTRANTS: readonly DemoEntrant[] = [
  { name: 'Annie Haberstroh', birthYear: 2003, list: '30712' },
  { name: 'Olivia Battaglia', birthYear: 2004, list: '30207' },
  { name: 'Lake Lubrano', birthYear: 2005, list: '31102' },
  { name: 'Andrew Hedrick', birthYear: 2000, list: '29678' },
  { name: 'Iris Morgan', birthYear: 2006, list: '31086' },
  { name: 'Sky Delsol', birthYear: 2005, list: '30207' },
  { name: 'Colby Rose', birthYear: 2001, list: '31175' },
  { name: 'James Musser', birthYear: 1987, list: '31096' },
  { name: 'Emma Hagen', birthYear: 1995, list: '31119' },
  { name: 'Jasmine Dickinson', birthYear: 2006, list: '31134' },
  { name: 'Reese Lundquist', birthYear: 2002, list: '30351' },
  { name: 'Macey Marlowe', birthYear: 2001, list: '30440' },
  { name: 'Cynthia Rodriguez', birthYear: 1999, list: '30540' },
  { name: 'Jessie Espinoza', birthYear: 2002, list: '31102' },
  { name: 'Kaycee Adams', birthYear: 2000, list: '30207' },
  { name: 'Jane Ester', birthYear: 2003, list: '31089' }
];
