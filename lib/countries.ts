/** ISO 3166-1 country/territory codes, with Kosovo offered separately as XK. */
const codes = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK`.split(' ');

const names = new Intl.DisplayNames(['en'], { type: 'region' });
const aliases: Record<string, string> = {
  BO: 'Bolivia', BN: 'Brunei', CD: 'Democratic Republic of the Congo', CG: 'Republic of the Congo',
  CI: 'Côte d’Ivoire', CZ: 'Czechia', FK: 'Falkland Islands', GB: 'United Kingdom',
  IR: 'Iran', KP: 'North Korea', KR: 'South Korea', LA: 'Laos', MD: 'Moldova',
  MK: 'North Macedonia', PS: 'Palestinian Territories', SY: 'Syria', TW: 'Taiwan',
  TZ: 'Tanzania', US: 'United States', VA: 'Vatican City', VE: 'Venezuela', VN: 'Vietnam', XK: 'Kosovo',
};

export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = codes
  .map(code => ({ code, name: aliases[code] ?? names.of(code) ?? code }))
  .sort((first, second) => first.name.localeCompare(second.name, 'en'));
export const BIRTH_COUNTRIES = [...COUNTRIES, { code: 'OTHER', name: 'Another / historical country or territory' }];
export const CITIZENSHIP_OPTIONS = [...COUNTRIES, { code: 'STATELESS', name: 'Stateless / no citizenship' }];
const countryCodes = new Set(codes);
export function isCountryCode(code: string): boolean { return countryCodes.has(code); }
export function isBirthCountryCode(code: string): boolean { return code === 'OTHER' || isCountryCode(code); }
export function isCitizenshipCode(code: string): boolean { return code === 'STATELESS' || isCountryCode(code); }
export function countryName(code: string): string {
  if (code === 'OTHER') return 'Another / historical country or territory';
  if (code === 'STATELESS') return 'Stateless / no citizenship';
  return COUNTRIES.find(country => country.code === code)?.name ?? code;
}
