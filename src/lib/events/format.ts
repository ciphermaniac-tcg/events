import { intlLocale } from '../i18n';

/**
 * Currency for each country Pokedata lists. Admission arrives as a bare number
 * ("10") or hand-typed ("$10.00", "7€") with no currency code, so the country
 * decides.
 */
const CURRENCY: Record<string, string> = {
  AE: 'AED',
  AR: 'ARS',
  AT: 'EUR',
  AU: 'AUD',
  BE: 'EUR',
  BO: 'BOB',
  BR: 'BRL',
  CA: 'CAD',
  CH: 'CHF',
  CL: 'CLP',
  CO: 'COP',
  CR: 'CRC',
  CZ: 'CZK',
  DE: 'EUR',
  DK: 'DKK',
  DO: 'DOP',
  EC: 'USD',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GB: 'GBP',
  GG: 'GBP',
  GR: 'EUR',
  GT: 'GTQ',
  HU: 'HUF',
  IE: 'EUR',
  IM: 'GBP',
  IT: 'EUR',
  JE: 'GBP',
  LU: 'EUR',
  MT: 'EUR',
  MX: 'MXN',
  NI: 'NIO',
  NL: 'EUR',
  NO: 'NOK',
  NZ: 'NZD',
  PA: 'USD',
  PE: 'PEN',
  PL: 'PLN',
  PR: 'USD',
  PT: 'EUR',
  PY: 'PYG',
  RO: 'RON',
  SE: 'SEK',
  SK: 'EUR',
  SV: 'USD',
  TT: 'TTD',
  US: 'USD',
  UY: 'UYU',
  ZA: 'ZAR'
};

const US_STATES: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Puerto Rico': 'PR',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY'
};

/** Short words that stay lower case inside a title-cased name. */
const MINOR_WORDS = new Set(['a', 'an', 'and', 'at', 'de', 'del', 'di', 'da', 'du', 'la', 'le', 'of', 'on', 'the']);
/** Upper-case tokens that stay upper case. */
const ACRONYMS = new Set(['TCG', 'CCG', 'LLC', 'HQ', 'USA', 'UK', 'VGC', 'II', 'III', 'IV']);

const regionNames = new Map<string, Intl.DisplayNames | null>();

function namesIn(tag: string): Intl.DisplayNames | null {
  if (!regionNames.has(tag)) {
    try {
      regionNames.set(tag, new Intl.DisplayNames([tag], { type: 'region' }));
    } catch {
      regionNames.set(tag, null);
    }
  }
  return regionNames.get(tag) ?? null;
}

function regionName(cc: string, tag: string): string {
  try {
    return namesIn(tag)?.of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
}

/** Country name in the language shown, or the code when the runtime has no names. */
export function countryName(cc: string): string {
  return regionName(cc, intlLocale());
}
const US_STATE_CODES = new Set(Object.values(US_STATES));

/**
 * State, province, and territory codes that sit in front of a postcode in an
 * address ("AUSTIN, TX 78701", "MOUNT OMMANEY QLD 4074"). Title casing would
 * turn them into "Tx" and "Qld".
 */
const REGION_CODES = new Set([
  ...US_STATE_CODES,
  ...['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'],
  ...['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA']
]);

function titleWord(word: string, index: number): string {
  if (/^\d+(?:st|nd|rd|th)$/i.test(word)) {
    return word.toLowerCase();
  }
  if (/\d/.test(word) || ACRONYMS.has(word.toUpperCase())) {
    return word.toUpperCase();
  }
  const lower = word.toLowerCase();
  if (index > 0 && MINOR_WORDS.has(lower)) {
    return lower;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Title case for names typed in all capitals ("DRAGON'S LAIR" → "Dragon's
 * Lair"). Anything already in mixed case is left exactly as the store wrote
 * it — "iPlay", "McKinney", and "eSports" are spelled that way on purpose.
 */
export function titleCase(value: string): string {
  if (value !== value.toUpperCase() || value === value.toLowerCase()) {
    return value;
  }
  let index = 0;
  return value.replace(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu, word => titleWord(word, index++));
}

/** The address without the country on the end. */
function withoutCountry(address: string, cc: string): string {
  const country = [...new Set([regionName(cc, 'en'), countryName(cc)])]
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const code = cc.replace(/[^A-Za-z]/g, '');
  return address
    .replace(new RegExp(`,\\s*(US|USA|UK|United Kingdom|${country}${code ? `|${code}` : ''})\\s*$`, 'i'), '')
    .trim();
}

/** Title case that keeps state and province codes in capitals ("Austin, TX 78701"). */
const titleAddress = (value: string) =>
  titleCase(value).replace(/\b(\p{L}{2,3})(?=\s+[\p{L}\d-]*\d)/gu, word =>
    REGION_CODES.has(word.toUpperCase()) ? word.toUpperCase() : word
  );

/** Street address without the country on the end, which the page already shows. */
export function addressLine(address: string, cc: string): string {
  return titleAddress(withoutCountry(address, cc));
}

/** A postal code after a region or city: a US ZIP, a Canadian or British postcode, or four or five digits. */
const POSTAL_AFTER = String.raw`\d{4,5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}`;
/** A postal code before a city: Swedish, Dutch, Polish, Portuguese, or four or five digits. */
const POSTAL_BEFORE = String.raw`\d{3} \d{2}|\d{4} ?[A-Z]{2}|\d{2}-\d{3}|\d{4}-\d{3}|\d{4,5}`;
const PLACE = String.raw`\p{L}[\p{L} .'-]*?`;
/** "TX 78201", "LOMBARDIA 20126", "HOLBÆK 4300": a region or city, then its postal code. */
const PLACE_POSTAL = new RegExp(String.raw`^(${PLACE})\s+(${POSTAL_AFTER})$`, 'iu');
/** "3008 BERN", "8442 BL HEERENVEEN": a postal code, then its city. */
const POSTAL_PLACE = new RegExp(String.raw`^(${POSTAL_BEFORE})\s+(${PLACE})$`, 'iu');

export interface AddressParts {
  street: string;
  city: string;
  /** '' when the address names none. */
  region: string;
  postal: string;
}

type Shape = (segments: readonly string[]) => AddressParts | null;

const parts = (street: readonly string[], city = '', region = '', postal = ''): AddressParts | null =>
  street.length > 0 && city ? { street: street.join(', '), city, region, postal } : null;

/** "…, SAN ANTONIO, TX 78201". */
const cityThenRegionPostal: Shape = segments => {
  const match = PLACE_POSTAL.exec(segments.at(-1) ?? '');
  return match && parts(segments.slice(0, -2), segments.at(-2), match[1], match[2]);
};

/** "…, HOLBÆK 4300". */
const cityPostal: Shape = segments => {
  const match = PLACE_POSTAL.exec(segments.at(-1) ?? '');
  return match && parts(segments.slice(0, -1), match[1], '', match[2]);
};

/** "…, 3008 BERN". */
const postalCity: Shape = segments => {
  const match = POSTAL_PLACE.exec(segments.at(-1) ?? '');
  return match && parts(segments.slice(0, -1), match[2], '', match[1]);
};

/** "…, 31520 CUAUHTÉMOC, CHIH.". */
const postalCityThenRegion: Shape = segments => {
  const region = segments.at(-1) ?? '';
  const match = /\d/.test(region) ? null : POSTAL_PLACE.exec(segments.at(-2) ?? '');
  return match && parts(segments.slice(0, -2), match[2], region, match[1]);
};

const SHAPES: readonly Shape[] = [cityThenRegionPostal, cityPostal, postalCity, postalCityThenRegion];

/**
 * A one-line address as pokemon.com lists it ("4522 FREDERICKSBURG RD SUITE
 * B64, SAN ANTONIO, TX 78201, US") split into its street, city, region and
 * postal code, each cased for a form; null when it ends in none of the
 * shapes addresses take.
 */
export function addressParts(address: string, cc: string): AddressParts | null {
  const segments = withoutCountry(address, cc)
    .split(',')
    .map(segment => segment.trim())
    .filter(Boolean);
  for (const shape of SHAPES) {
    const found = shape(segments);
    if (found) {
      const region = found.region.length <= 3 ? found.region.toUpperCase() : titleCase(found.region);
      return {
        street: titleAddress(found.street),
        city: titleCase(found.city),
        region: REGION_CODES.has(region.toUpperCase()) ? region.toUpperCase() : region,
        postal: found.postal.toUpperCase()
      };
    }
  }
  return null;
}

/** The currency an event in the country takes its fee in: US dollars where the country's is not known. */
export const currencyOf = (cc: string): string => CURRENCY[cc.trim().toUpperCase()] ?? 'USD';

/** An entry fee in the event's currency, as the reader writes money ("$10.00", "R$ 25,00"). */
export function formatFee(amount: number, cc: string): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency: currencyOf(cc),
    currencyDisplay: 'narrowSymbol'
  }).format(amount);
}

/** The symbol of the country's currency as fees are shown ("$", "€", "£"); null for a country with none known. */
export function currencySymbol(cc: string): string | null {
  const currency = CURRENCY[cc.trim().toUpperCase()];
  if (!currency) {
    return null;
  }
  const parts = new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol'
  }).formatToParts(0);
  return parts.find(part => part.type === 'currency')?.value ?? null;
}
