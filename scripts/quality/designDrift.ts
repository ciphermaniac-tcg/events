/**
 * The design-system drift rules, as pure checks over one sheet's text. The
 * command (scripts/check-design-drift.ts) runs them over every sheet and holds
 * the result against the baseline.
 * @module scripts/quality/designDrift
 */

/** Sizes on the named scale in tokens.css, plus those still pending a ruling. */
const SCALE = new Set([9, 10.5, 11, 12, 13, 15, 18, 22, 30]);
/** Not yet on the scale — tracked by the "Type scale" ruling, allowed for now. */
const PENDING_SIZES = new Set([14, 16, 17]);
/** One-off display sizes: hero overrides, the survey completion screen. */
const DISPLAY_SIZES = new Set([19, 20, 26, 28, 32, 40]);

/** Literal px values that have a radius token and should use it. */
const RADIUS_TOKENS: Record<string, string> = {
  '6px': '--radius-sm',
  '10px': '--radius-md',
  '14px': '--radius-lg',
  '999px': '--radius-pill'
};

/**
 * Colours that are someone else's to choose: the sign-in buttons are drawn to
 * Google's and Discord's own guidelines, and a QR code needs a white ground to
 * scan, in either mode.
 */
const OWN_COLOURS = /\.tm-sso\b|\.tm-qr\b/;

/** A form field, whose text iOS zooms into on focus when it is under 16px. */
const FIELD = /(^|[\s,>+~(])(input|select|textarea)\b|\.(tm-input|tm-select|search)\b/;

export interface CssRule {
  selector: string;
  body: string;
  line: number;
  /** The @media queries the rule sits in, joined, or null at the top level. */
  media: string | null;
}

/** Selectors in a sheet that take a ring on behalf of a descendant. */
export interface CheckContext {
  focusWithin: string[];
}

export interface Hit {
  rule: string;
  message: string;
}

type Check = (rule: CssRule, ctx: CheckContext) => Hit[];

/**
 * A sheet's style rules, each with the @media it sits in. At-rules other than
 * @media (font faces, keyframes) are passed over, as their bodies are not UI.
 */
export function parseRules(source: string): CssRule[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  const rules: CssRule[] = [];
  const open: string[] = [];
  const re = /([^{}]*)\{|\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    if (match[0] === '}') {
      open.pop();
      continue;
    }
    const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) {
      open.push(selector);
      continue;
    }
    const end = stripped.indexOf('}', re.lastIndex);
    const close = end === -1 ? stripped.length : end;
    if (selector) {
      const media = open.filter(prelude => prelude.startsWith('@media')).join(' and ');
      rules.push({
        selector,
        body: stripped.slice(re.lastIndex, close),
        line: stripped.slice(0, match.index).split('\n').length,
        media: media || null
      });
    }
    re.lastIndex = close + 1;
  }
  return rules;
}

export function decl(body: string, prop: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  return re.exec(body)?.[1]?.trim();
}

/** Every declaration in a rule's body, as property and value. */
function declarations(body: string): [string, string][] {
  return body.split(';').flatMap(part => {
    const colon = part.indexOf(':');
    return colon === -1 ? [] : [[part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()]];
  });
}

const CHECKS: Check[] = [
  // Ruling: "Type scale". One named scale; no eyeballed half-steps.
  rule => {
    const value = decl(rule.body, 'font-size');
    if (!value || value.includes('var(') || value.includes('clamp(') || value.includes('em') || value === 'inherit') {
      return [];
    }
    const px = Number.parseFloat(value);
    if (Number.isNaN(px) || SCALE.has(px) || PENDING_SIZES.has(px) || DISPLAY_SIZES.has(px)) {
      return [];
    }
    if (/\bimg\b/.test(rule.selector)) {
      return []; // sizes alt text when the image 404s, not typography
    }
    return [
      {
        rule: 'type-scale',
        message: `font-size: ${value} is off the scale (tokens.css names 9/10.5/11/12/13/15/18/22/30)`
      }
    ];
  },

  // Ruling: "Floating layers". Depth in the page is drawn with an edge and a
  // fill, never cast; a menu, popover, sheet or dialog casts the one
  // --shadow-float. The focus ring, hairlines and state rings are box-shadows
  // by mechanism, not elevation, and keep their own checks.
  rule => {
    const value = decl(rule.body, 'box-shadow');
    if (!value || value === 'none' || value.includes('var(--focus-ring') || value === 'var(--shadow-float)') {
      return [];
    }
    if (/^\s*inset\b/.test(value) || value.includes('0 0 0')) {
      return []; // hairlines and rings, handled by their own checks
    }
    if (/-?\d+px\s+-?\d+px\s+0\s+0/.test(value)) {
      return [
        {
          rule: 'offset-shadow',
          message: `flat offset shadow "${value}" — only a floating layer casts a shadow, and it is var(--shadow-float)`
        }
      ];
    }
    // A shadow's third length is its blur radius.
    const lengths = value.split(/\s+/).filter(part => /^-?\d*\.?\d+(px|rem|em)?$/.test(part));
    const blur = lengths[2];
    if (blur !== undefined && Number.parseFloat(blur) !== 0) {
      return [
        {
          rule: 'no-blur-shadow',
          message: `blurred shadow "${value}" — only a floating layer casts a shadow, and it is var(--shadow-float)`
        }
      ];
    }
    return [];
  },

  // Ruling: "Chip shape" / shape tokens. A literal that has a token must use it.
  rule => {
    const value = decl(rule.body, 'border-radius');
    if (!value || value.includes('var(')) {
      return [];
    }
    const token = RADIUS_TOKENS[value.trim()];
    return token ? [{ rule: 'radius-token', message: `border-radius: ${value} — use var(${token})` }] : [];
  },

  // Ruling: "Focus indicator". One ring, one opacity, via the token.
  (rule, ctx) => {
    const found: Hit[] = [];
    const shadow = decl(rule.body, 'box-shadow');
    if (shadow && /0 0 0 3px color-mix/.test(shadow)) {
      found.push({ rule: 'focus-ring-token', message: 'hand-rolled focus ring — use var(--focus-ring)' });
    }
    const outline = decl(rule.body, 'outline');
    const base = rule.selector.replace(/:focus(-visible)?\b.*$/, '').trim();
    const ancestorRings = ctx.focusWithin.some(sel => base.startsWith(sel) && base !== sel);
    // A target focus is moved to by script (tabindex -1) is no control, and takes no ring.
    const moved = rule.selector.includes("[tabindex='-1']");
    if (outline === 'none' && !shadow && !/:focus-within/.test(rule.selector) && !ancestorRings && !moved) {
      found.push({ rule: 'focus-suppressed', message: 'outline: none with no replacement ring' });
    }
    return found;
  },

  // Ruling: "Focus indicator", again: one weight of ring everywhere. A page
  // that wants a heavier one sets --focus-width rather than its own outline.
  rule => {
    if (!/:focus/.test(rule.selector)) {
      return [];
    }
    const outline = decl(rule.body, 'outline') ?? decl(rule.body, 'outline-width');
    if (!outline || /^(none|0)\b/.test(outline) || outline.includes('var(--focus-width)')) {
      return [];
    }
    return [{ rule: 'focus-width-token', message: `focus outline "${outline}" — draw it at var(--focus-width)` }];
  },

  // Ruling: colour comes from tokens. A literal outside a custom property
  // forks the palette, and misses dark mode.
  rule => {
    if (OWN_COLOURS.test(rule.selector)) {
      return [];
    }
    return declarations(rule.body)
      .filter(
        ([prop, value]) =>
          !prop.startsWith('--') && !prop.startsWith('mask') && /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i.test(value)
      )
      .map(([prop, value]) => ({ rule: 'colour-literal', message: `${prop}: ${value} — use a colour token` }));
  },

  // Ruling: "Phones: inputs at 16px". iOS zooms into a smaller field on any
  // touch screen, landscape phones and tablets included, so the 16px rule
  // goes by pointer as well as width, as the package's own does.
  rule => {
    const narrowOnly = rule.media !== null && /max-width/.test(rule.media) && !/pointer:\s*coarse/.test(rule.media);
    if (!narrowOnly || !FIELD.test(rule.selector) || !/^16px\b/.test(decl(rule.body, 'font-size') ?? '')) {
      return [];
    }
    return [
      {
        rule: 'touch-field-size',
        message: '16px fields by width alone — use @media (max-width: 640px), (pointer: coarse)'
      }
    ];
  },

  // Ruling: "No caps". Labels, captions and column heads are set in sentence
  // case and take their rank from weight and size. The canvas-export sheets
  // are exempt, as for every ruling.
  rule => {
    if (decl(rule.body, 'text-transform') !== 'uppercase') {
      return [];
    }
    return [
      { rule: 'no-caps', message: 'text-transform: uppercase — set the label in sentence case; weight carries rank' }
    ];
  },

  // Ruling: disabled state. One opacity, one cursor.
  rule => {
    if (!/:disabled|\[disabled\]|\[aria-disabled='true'\]|\.disabled\b/.test(rule.selector)) {
      return [];
    }
    const opacity = decl(rule.body, 'opacity');
    if (!opacity || opacity === '0.4') {
      return [];
    }
    return [{ rule: 'disabled-state', message: `disabled opacity ${opacity} — the house value is 0.4` }];
  }
];

/** Every rule a sheet breaks, rule by rule. */
export function checkSheet(source: string): { rule: CssRule; hit: Hit }[] {
  const rules = parseRules(source);
  const ctx: CheckContext = {
    focusWithin: rules
      .filter(r => r.selector.includes(':focus-within'))
      .map(r => r.selector.replace(':focus-within', '').trim())
  };
  return rules.flatMap(rule => CHECKS.flatMap(check => check(rule, ctx).map(hit => ({ rule, hit }))));
}
