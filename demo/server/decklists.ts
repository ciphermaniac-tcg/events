/**
 * The demo's decklists: real lists from the Regional Championship in Gdańsk
 * (October 31, 2026), the best-placing list of each of that event's sixteen
 * most-played archetypes, as Ciphermaniac's own data has them. The players'
 * names are not kept; the demo's players are fictional.
 */

export interface DemoList {
  archetype: string;
  /** Where the list finished in Gdańsk. */
  placement: number;
  /** The list as a player pastes it from Pokémon TCG Live. */
  text: string;
}

export const DEMO_LISTS: readonly DemoList[] = [
  {
    archetype: 'Dragapult',
    placement: 3,
    text: "Pokémon: 19\n2 Budew PRE 4\n3 Dragapult ex TWM 130\n4 Drakloak TWM 129\n4 Dreepy TWM 128\n1 Dudunsparce TEF 129\n1 Dunsparce TEF 128\n1 Fezandipiti ex SFA 38\n1 Meowth ex POR 62\n2 Munkidori TWM 95\n\nTrainer: 32\n3 Boss's Orders MEG 114\n4 Buddy-Buddy Poffin TEF 144\n2 Crispin SCR 133\n4 Crushing Hammer POR 71\n1 Judge DRI 167\n4 Lillie's Determination MEG 119\n3 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n2 Risky Ruins MEG 127\n1 Rosa's Encouragement POR 84\n3 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n\nEnergy: 9\n3 Darkness Energy MEE 7\n3 Fire Energy MEE 2\n3 Psychic Energy MEE 5"
  },
  {
    archetype: 'Basic Box',
    placement: 19,
    text: "Pokémon: 20\n1 Bloodmoon Ursaluna ex TWM 141\n1 Chien-Pao SSP 56\n1 Fezandipiti ex SFA 38\n1 Iron Leaves ex TEF 25\n1 Koraidon ex ASC 121\n2 Latias ex SSP 76\n2 Lillie's Clefairy ex JTG 56\n4 Mega Kangaskhan ex MEG 104\n4 Meowth ex POR 62\n2 Teal Mask Ogerpon ex TWM 25\n1 Wellspring Mask Ogerpon ex TWM 64\n\nTrainer: 27\n4 Area Zero Underdepths SCR 131\n3 Boss's Orders MEG 114\n1 Ciphermaniac's Codebreaking TEF 145\n4 Crispin SCR 133\n2 Cyrano SSP 170\n4 Energy Switch MEG 115\n1 Hero's Cape TEF 152\n1 Judge DRI 167\n2 Night Stretcher SFA 61\n1 Special Red Card CRI 82\n4 Ultra Ball MEG 131\n\nEnergy: 13\n2 Fighting Energy MEE 6\n7 Grass Energy MEE 1\n3 Psychic Energy MEE 5\n1 Water Energy MEE 3"
  },
  {
    archetype: 'Dhelmise',
    placement: 12,
    text: "Pokémon: 25\n4 Banette PBL 34\n1 Bloodmoon Ursaluna ex TWM 141\n4 Dhelmise PBL 39\n2 Dudunsparce TEF 129\n3 Dunsparce JTG 120\n1 Latias ex SSP 76\n2 Lillie's Clefairy ex JTG 56\n4 Poltchageist PBL 5\n2 Shuppet PBL 33\n2 Sinistcha PBL 6\n\nTrainer: 28\n1 Black Belt's Training PRE 96\n3 Boss's Orders MEG 114\n2 Explorer's Guidance TEF 147\n4 Gwynn PBL 78\n4 Lillie's Determination MEG 119\n3 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n3 Prism Tower CRI 80\n4 Ultra Ball MEG 131\n\nEnergy: 7\n1 Legacy Energy TWM 167\n2 Psychic Energy MEE 5\n4 Telepathic Psychic Energy POR 88"
  },
  {
    archetype: "N's Zoroark",
    placement: 38,
    text: "Pokémon: 17\n1 Fezandipiti ex SFA 38\n2 Munkidori TWM 95\n1 N's Purrloin JTG 96\n1 N's Reshiram JTG 116\n1 N's Zekrom ASC 155\n4 N's Zoroark ex ASC 137\n4 N's Zorua JTG 97\n1 Pecharunt ex SFA 39\n1 Tatsugiri TWM 131\n1 Yveltal MEG 88\n\nTrainer: 35\n2 Binding Mochi SFA 55\n1 Black Belt's Training PRE 96\n3 Boss's Orders MEG 114\n4 Buddy-Buddy Poffin TEF 144\n3 Cyrano SSP 170\n1 Gravity Mountain SSP 177\n1 Janine's Secret Art SFA 59\n1 Judge DRI 167\n4 Lillie's Determination MEG 119\n1 N's Castle JTG 152\n3 N's PP Up JTG 153\n2 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n1 Special Red Card CRI 82\n2 Team Rocket's Watchtower DRI 180\n1 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n\nEnergy: 8\n8 Darkness Energy MEE 7"
  },
  {
    archetype: 'Ogerpon Meganium Hydrapple',
    placement: 11,
    text: "Pokémon: 20\n2 Applin TWM 17\n2 Bayleef MEG 9\n1 Celebi MEG 12\n2 Chikorita MEG 8\n2 Dipplin TWM 18\n1 Fezandipiti ex SFA 38\n2 Hydrapple ex SCR 14\n2 Meganium MEG 10\n1 Meowth ex POR 62\n1 Tapu Bulu SFA 6\n4 Teal Mask Ogerpon ex TWM 25\n\nTrainer: 27\n2 Boss's Orders MEG 114\n1 Briar SCR 132\n4 Bug Catching Set TWM 143\n1 Drayton SSP 174\n1 Energy Retrieval WHT 82\n3 Forest of Vitality MEG 117\n1 Judge DRI 167\n1 Lana's Aid TWM 155\n4 Lillie's Determination MEG 119\n2 Night Stretcher SFA 61\n1 Poké Pad ASC 198\n1 Team Rocket's Petrel DRI 176\n4 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n\nEnergy: 13\n13 Grass Energy MEE 1"
  },
  {
    archetype: 'Dragapult Blaziken',
    placement: 14,
    text: "Pokémon: 21\n2 Blaziken ex JTG 24\n1 Budew PRE 4\n1 Chi-Yu TWM 39\n1 Combusken DRI 41\n2 Dragapult ex TWM 130\n4 Drakloak TWM 129\n4 Dreepy TWM 128\n1 Fezandipiti ex SFA 38\n1 Meowth ex POR 62\n2 Munkidori TWM 95\n2 Torchic DRI 40\n\nTrainer: 31\n3 Boss's Orders MEG 114\n4 Buddy-Buddy Poffin TEF 144\n2 Crispin SCR 133\n2 Judge DRI 167\n4 Lillie's Determination MEG 119\n2 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n3 Rare Candy MEG 125\n2 Team Rocket's Watchtower DRI 180\n4 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n\nEnergy: 8\n2 Darkness Energy MEE 7\n3 Fire Energy MEE 2\n3 Psychic Energy MEE 5"
  },
  {
    archetype: 'Slowking',
    placement: 1,
    text: "Pokémon: 22\n1 Fezandipiti ex SFA 38\n2 Kyurem SFA 47\n2 Latias ex SSP 76\n1 Lillie's Clefairy ex JTG 56\n4 Mega Kangaskhan ex MEG 104\n1 Meowth ex POR 62\n2 Metagross CRI 61\n1 Mew ex 30C 66\n3 Slowking SCR 58\n4 Slowpoke SCR 57\n1 Zeraora DRI 78\n\nTrainer: 28\n4 Academy at Night SFA 54\n4 Ciphermaniac's Codebreaking TEF 145\n4 Lillie's Determination MEG 119\n1 Lucky Helmet TWM 158\n2 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n1 Secret Box TWM 163\n1 Switch MEG 130\n4 Ultra Ball MEG 131\n3 Wondrous Patch PFL 94\n\nEnergy: 10\n2 Boomerang Energy TWM 166\n4 Psychic Energy MEE 5\n4 Telepathic Psychic Energy POR 88"
  },
  {
    archetype: 'Alakazam Dudunsparce',
    placement: 9,
    text: "Pokémon: 21\n4 Abra MEG 54\n3 Alakazam MEG 56\n2 Dudunsparce TEF 129\n3 Dunsparce JTG 120\n1 Elgyem BLK 40\n1 Fezandipiti ex SFA 38\n1 Flutter Mane TEF 78\n1 Genesect SFA 40\n4 Kadabra MEG 55\n1 Lillie's Clefairy ex JTG 56\n\nTrainer: 31\n1 Battle Cage PFL 85\n2 Boss's Orders MEG 114\n4 Buddy-Buddy Poffin TEF 144\n4 Dawn PFL 87\n1 Eri TEF 146\n1 Handheld Fan TWM 150\n3 Hilda WHT 84\n2 Lillie's Pearl JTG 151\n1 Night Stretcher SFA 61\n2 Nighttime Mine ASC 197\n4 Poké Pad ASC 198\n2 Rare Candy MEG 125\n1 Sacred Ash DRI 168\n1 Special Red Card CRI 82\n2 Wondrous Patch PFL 94\n\nEnergy: 8\n1 Enriching Energy SSP 191\n1 Mist Energy TEF 161\n2 Psychic Energy MEE 5\n4 Telepathic Psychic Energy POR 88"
  },
  {
    archetype: 'Festival Lead',
    placement: 30,
    text: "Pokémon: 20\n2 Applin TWM 17\n2 Applin TWM 126\n3 Dipplin TWM 18\n2 Goldeen TWM 44\n3 Grookey TWM 14\n1 Psyduck ASC 39\n1 Rabsca TEF 24\n1 Rellor TEF 23\n1 Seaking PRE 21\n4 Thwackey TWM 15\n\nTrainer: 35\n3 Air Balloon BLK 79\n2 Boss's Orders MEG 114\n2 Brave Bangle WHT 80\n4 Buddy-Buddy Poffin TEF 144\n1 Dawn PFL 87\n4 Festival Grounds TWM 149\n1 Forest of Vitality MEG 117\n2 Gladion's Final Battle PBL 77\n1 Kieran TWM 154\n1 Lana's Aid TWM 155\n4 Lillie's Determination MEG 119\n2 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n1 Secret Box TWM 163\n3 Ultra Ball MEG 131\n\nEnergy: 5\n3 Grass Energy MEE 1\n2 Growing Grass Energy POR 86"
  },
  {
    archetype: 'Mega Excadrill',
    placement: 37,
    text: "Pokémon: 18\n4 Beldum TEF 113\n3 Drilbur PBL 46\n1 Fezandipiti ex SFA 38\n2 Genesect ex BLK 67\n2 Mega Excadrill ex PBL 65\n1 Mega Skarmory ex POR 55\n1 Metagross CRI 61\n4 Metang TEF 114\n\nTrainer: 26\n2 Brock's Scouting JTG 146\n4 Buddy-Buddy Poffin TEF 144\n1 Energy Recycler DRI 164\n4 Judge DRI 167\n1 Jumbo Ice Cream PFL 91\n4 Pokégear 3.0 BLK 84\n1 Precious Trolley SSP 185\n1 Switch MEG 130\n4 Team Rocket's Petrel DRI 176\n4 Team Rocket's Watchtower DRI 180\n\nEnergy: 16\n16 Metal Energy MEE 8"
  },
  {
    archetype: 'Dragapult Dusknoir',
    placement: 10,
    text: "Pokémon: 20\n1 Budew PRE 4\n3 Dragapult ex TWM 130\n4 Drakloak TWM 129\n4 Dreepy TWM 128\n2 Dusclops SFA 19\n1 Dusknoir SFA 20\n2 Duskull SFA 18\n1 Fezandipiti ex SFA 38\n1 Meowth ex POR 62\n1 Munkidori TWM 95\n\nTrainer: 32\n3 Boss's Orders MEG 114\n4 Buddy-Buddy Poffin TEF 144\n2 Crispin SCR 133\n2 Dawn PFL 87\n4 Lillie's Determination MEG 119\n2 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n2 Rare Candy MEG 125\n1 Rosa's Encouragement POR 84\n1 Special Red Card CRI 82\n2 Team Rocket's Watchtower DRI 180\n4 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n\nEnergy: 8\n2 Darkness Energy MEE 7\n3 Fire Energy MEE 2\n3 Psychic Energy MEE 5"
  },
  {
    archetype: 'Crustle',
    placement: 4,
    text: "Pokémon: 10\n3 Crustle DRI 12\n3 Dwebble DRI 11\n4 Mega Kangaskhan ex MEG 104\n\nTrainer: 35\n4 Boss's Orders MEG 114\n2 Buddy-Buddy Poffin TEF 144\n3 Crispin SCR 133\n2 Eri TEF 146\n1 Festival Grounds TWM 149\n1 Hero's Cape TEF 152\n2 Hilda WHT 84\n4 Jumbo Ice Cream PFL 91\n3 Lillie's Determination MEG 119\n1 Lumiose City POR 77\n3 Pokégear 3.0 BLK 84\n1 Pokémon Center Lady MEG 123\n1 Prism Tower CRI 80\n1 Switch MEG 130\n4 Team Rocket's Petrel DRI 176\n1 Ultra Ball MEG 131\n1 Xerosic's Machinations SFA 64\n\nEnergy: 15\n1 Darkness Energy MEE 7\n1 Fighting Energy MEE 6\n1 Fire Energy MEE 2\n1 Grass Energy MEE 1\n4 Growing Grass Energy POR 86\n4 Mist Energy TEF 161\n1 Psychic Energy MEE 5\n2 Spiky Energy JTG 159"
  },
  {
    archetype: 'Sharpedo Toxtricity',
    placement: 91,
    text: "Pokémon: 19\n3 Carvanha PFL 60\n1 Fezandipiti ex SFA 38\n4 Mega Sharpedo ex PFL 61\n2 Munkidori TWM 95\n2 Pecharunt ex SFA 39\n2 Tatsugiri TWM 131\n2 Toxel PFL 67\n2 Toxtricity PFL 68\n1 Yveltal MEG 88\n\nTrainer: 32\n3 Binding Mochi SFA 55\n3 Boss's Orders MEG 114\n4 Buddy-Buddy Poffin TEF 144\n1 Gravity Mountain SSP 177\n3 Judge DRI 167\n4 Lillie's Determination MEG 119\n1 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n2 Team Rocket's Petrel DRI 176\n2 Team Rocket's Watchtower DRI 180\n4 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n\nEnergy: 9\n9 Darkness Energy MEE 7"
  },
  {
    archetype: 'Lopunny Dudunsparce',
    placement: 100,
    text: "Pokémon: 17\n3 Buneary PFL 83\n3 Dudunsparce TEF 129\n2 Dunsparce JTG 120\n1 Dunsparce TEF 128\n1 Fan Rotom SCR 118\n1 Genesect SFA 40\n1 Lillie's Clefairy ex JTG 56\n2 Mega Lopunny ex PFL 84\n1 Mew ex 30C 66\n1 Moltres PFL 14\n1 Shaymin DRI 10\n\nTrainer: 36\n4 Air Balloon BLK 79\n3 Battle Cage PFL 85\n4 Boss's Orders MEG 114\n4 Buddy-Buddy Poffin TEF 144\n4 Hilda WHT 84\n3 Lillie's Determination MEG 119\n2 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n2 Pokégear 3.0 BLK 84\n1 Special Red Card CRI 82\n3 Ultra Ball MEG 131\n2 Wally's Compassion MEG 132\n\nEnergy: 7\n1 Enriching Energy SSP 191\n2 Fire Energy MEE 2\n3 Mist Energy TEF 161\n1 Telepathic Psychic Energy POR 88"
  },
  {
    archetype: 'Alakazam Dusknoir',
    placement: 17,
    text: "Pokémon: 24\n3 Abra MEG 54\n1 Abra TWM 80\n3 Alakazam MEG 56\n2 Budew PRE 4\n2 Dusclops SFA 19\n2 Dusknoir SFA 20\n4 Duskull SFA 18\n1 Fezandipiti ex SFA 38\n4 Kadabra MEG 55\n1 Lillie's Clefairy ex JTG 56\n1 Shaymin DRI 10\n\nTrainer: 31\n3 Buddy-Buddy Poffin TEF 144\n3 Dawn PFL 87\n3 Gwynn PBL 78\n4 Hilda WHT 84\n2 Night Stretcher SFA 61\n4 Poké Pad ASC 198\n1 Prime Catcher PRE 119\n4 Rare Candy MEG 125\n1 Sacred Ash DRI 168\n2 Special Red Card CRI 82\n3 Strange Timepiece MEG 128\n1 Wondrous Patch PFL 94\n\nEnergy: 5\n1 Psychic Energy MEE 5\n4 Telepathic Psychic Energy POR 88"
  },
  {
    archetype: 'Lucario Hariyama',
    placement: 231,
    text: "Pokémon: 17\n2 Hariyama MEG 73\n2 Lunatone MEG 74\n2 Makuhita MEG 72\n3 Mega Lucario ex MEG 77\n1 Meowth ex POR 62\n3 Riolu MEG 76\n1 Shaymin DRI 10\n3 Solrock MEG 75\n\nTrainer: 33\n2 Air Balloon BLK 79\n2 Boss's Orders MEG 114\n1 Ciphermaniac's Codebreaking TEF 145\n4 Fighting Gong MEG 116\n2 Gravity Mountain SSP 177\n2 Judge DRI 167\n4 Lillie's Determination MEG 119\n1 Night Stretcher SFA 61\n2 Poké Pad ASC 198\n4 Premium Power Pro MEG 124\n1 Special Red Card CRI 82\n1 Switch MEG 130\n1 Team Rocket's Watchtower DRI 180\n4 Ultra Ball MEG 131\n1 Unfair Stamp TWM 165\n1 Wally's Compassion MEG 132\n\nEnergy: 10\n10 Fighting Energy MEE 6"
  }
];
