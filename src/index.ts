export type PiiKind = 'kisi' | 'telefon' | 'eposta' | 'tc_no' | 'kart' | 'iban';

export const PII_PLACEHOLDER_NOTE =
  'Kişisel veriler köşeli parantezli yer tutucularla gösterildi ([kisi_1], [telefon_1], [eposta_1], [tc_no_1], [kart_1], [iban_1] gibi). '
  + 'Bunları olduğu gibi yaz ve araç çağrılarında olduğu gibi kullan; açmaya, değiştirmeye ya da tahmin etmeye çalışma.';

export interface PiiStreamRestorer {
  push(chunk: string): void;
  flush(): void;
}

export interface PiiVault {
  mask(text: string): string;
  unmask(text: string): string;
  unmaskJson(json: string): string;
  restorer(emit: (text: string) => void): PiiStreamRestorer;
  readonly size: number;
}

export interface PiiVaultOptions {
  names?: Iterable<string | null | undefined>;
}

const TOKEN_PATTERN = /\[(kisi|telefon|eposta|tc_no|kart|iban)_(\d{1,4})\]/gi;
const MAX_TOKEN_LENGTH = 16;
const MAX_NAMES = 5000;

const FOLD: Record<string, string> = {
  'İ': 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c',
  Â: 'a', â: 'a', Î: 'i', î: 'i', Û: 'u', û: 'u',
};

function foldChar(ch: string): string {
  const mapped = FOLD[ch];
  if (mapped) return mapped;
  const lower = ch.toLowerCase();
  return lower.length === ch.length ? lower : ch;
}

export function foldText(text: string): string {
  let out = '';
  for (const ch of text) out += foldChar(ch);
  return out;
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidTckn(digits: string): boolean {
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  const n = [...digits].map(Number);
  const odd = n[0] + n[2] + n[4] + n[6] + n[8];
  const even = n[1] + n[3] + n[5] + n[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== n[9]) return false;
  const sum = n.slice(0, 10).reduce((total, digit) => total + digit, 0);
  return sum % 10 === n[10];
}

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isValidIban(raw: string): boolean {
  const value = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  if (value.startsWith('TR') && value.length !== 26) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const chunk = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of chunk) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface NameIndex {
  pattern: RegExp | null;
  canonical: Map<string, string>;
}

function buildNameIndex(names: Iterable<string | null | undefined> | undefined): NameIndex {
  const canonical = new Map<string, string>();
  if (names) {
    for (const raw of names) {
      if (canonical.size >= MAX_NAMES) break;
      if (typeof raw !== 'string') continue;
      const cleaned = raw.replace(/\s+/g, ' ').trim();
      const parts = cleaned.split(' ');
      if (parts.length < 2 || parts.some((part) => [...part].filter((ch) => /\p{L}/u.test(ch)).length < 2)) continue;
      const key = foldText(cleaned);
      if (!canonical.has(key)) canonical.set(key, cleaned);
    }
  }
  if (canonical.size === 0) return { pattern: null, canonical };
  const alternatives = [...canonical.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.split(' ').map(escapeRegExp).join('\\s+'));
  return {
    pattern: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'gu'),
    canonical,
  };
}

type Replacer = (match: string) => string | null;

function replaceAll(text: string, pattern: RegExp, replacer: Replacer): string {
  return text.replace(pattern, (match) => replacer(match) ?? match);
}

const TR_IBAN = /\bTR\d{2}(?:[ ]?\d){22}\b/gi;
const OTHER_IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CARD = /(?<![\d])(?:\d[ -]?){14,15}\d(?![\d])/g;
const TCKN = /(?<![\d])[1-9]\d{10}(?![\d])/g;
const PHONE_INTL_TR = /(?<![\w+])(?:\+90|0090)[\s.-]?\(?0?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;
const PHONE_LOCAL = /(?<![\w+])\(?0[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;
const PHONE_MOBILE = /(?<![\w+])5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;
const PHONE_FOREIGN = /(?<![\w+])\+(?!90)\d{1,3}(?:[\s.-]?\d){6,13}(?!\d)/g;

export function createPiiVault(options: PiiVaultOptions = {}): PiiVault {
  const tokensByKey = new Map<string, string>();
  const valuesByToken = new Map<string, string>();
  const counters = new Map<PiiKind, number>();
  const names = buildNameIndex(options.names);

  function tokenFor(kind: PiiKind, key: string, original: string): string {
    const lookup = `${kind}:${key}`;
    const existing = tokensByKey.get(lookup);
    if (existing) return existing;
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    const token = `[${kind}_${next}]`;
    tokensByKey.set(lookup, token);
    valuesByToken.set(token.toLowerCase(), original);
    return token;
  }

  function phoneKey(match: string): string {
    const digits = digitsOf(match);
    if (digits.startsWith('0090')) return digits.slice(4).replace(/^0/, '');
    if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
    return digits;
  }

  function maskNames(text: string): string {
    if (!names.pattern) return text;
    const folded = foldText(text);
    let out = '';
    let last = 0;
    names.pattern.lastIndex = 0;
    for (const match of folded.matchAll(names.pattern)) {
      const start = match.index ?? 0;
      const key = match[0].replace(/\s+/g, ' ');
      const original = names.canonical.get(key) ?? text.slice(start, start + match[0].length);
      out += text.slice(last, start) + tokenFor('kisi', key, original);
      last = start + match[0].length;
    }
    return out + text.slice(last);
  }

  function mask(text: string): string {
    if (typeof text !== 'string' || text === '') return text;
    let out = text;
    out = replaceAll(out, TR_IBAN, (m) => (isValidIban(m) ? tokenFor('iban', m.replace(/\s+/g, '').toUpperCase(), m) : null));
    out = replaceAll(out, OTHER_IBAN, (m) => (isValidIban(m) ? tokenFor('iban', m.replace(/\s+/g, '').toUpperCase(), m) : null));
    out = replaceAll(out, EMAIL, (m) => tokenFor('eposta', m.toLowerCase(), m));
    out = replaceAll(out, CARD, (m) => {
      const digits = digitsOf(m);
      if (digits.length < 15 || digits.length > 16 || !/^[34569]/.test(digits) || !passesLuhn(digits)) return null;
      return tokenFor('kart', digits, m);
    });
    out = replaceAll(out, TCKN, (m) => (isValidTckn(m) ? tokenFor('tc_no', m, m) : null));
    for (const pattern of [PHONE_INTL_TR, PHONE_LOCAL, PHONE_MOBILE, PHONE_FOREIGN]) {
      out = replaceAll(out, pattern, (m) => tokenFor('telefon', phoneKey(m), m));
    }
    return maskNames(out);
  }

  function restore(text: string, encode: (value: string) => string): string {
    if (typeof text !== 'string' || text === '' || valuesByToken.size === 0) return text;
    return text.replace(TOKEN_PATTERN, (token) => {
      const value = valuesByToken.get(token.toLowerCase());
      return value === undefined ? token : encode(value);
    });
  }

  function unmask(text: string): string {
    return restore(text, (value) => value);
  }

  function unmaskJson(json: string): string {
    return restore(json, (value) => JSON.stringify(value).slice(1, -1));
  }

  function restorer(emit: (text: string) => void): PiiStreamRestorer {
    let pending = '';
    return {
      push(chunk: string) {
        pending += chunk;
        const open = pending.lastIndexOf('[');
        let cut = pending.length;
        if (open >= 0 && pending.indexOf(']', open) === -1 && pending.length - open < MAX_TOKEN_LENGTH) cut = open;
        const ready = pending.slice(0, cut);
        pending = pending.slice(cut);
        if (ready) emit(unmask(ready));
      },
      flush() {
        if (!pending) return;
        const rest = pending;
        pending = '';
        emit(unmask(rest));
      },
    };
  }

  return {
    mask,
    unmask,
    unmaskJson,
    restorer,
    get size() {
      return valuesByToken.size;
    },
  };
}
