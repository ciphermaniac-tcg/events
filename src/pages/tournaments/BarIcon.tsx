/**
 * The phone tab bars' glyphs that the package's Icon set lacks yet, drawn to
 * its spec (24px grid, 1.5px stroke, round caps and joins, one path, the
 * colour of the text around it) at the bars' 20px. Each belongs in the
 * package's set; once there, its tab takes `Icon` instead.
 */

const PATHS = {
  /** Playing: two cards, one fanned behind the other. */
  cards:
    'M12 6h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM10 6.6 4.45 8.11a1.5 1.5 0 0 0-1.06 1.84l2.59 9.66a1.5 1.5 0 0 0 1.84 1.06L10 20.1',
  shield: 'M12 3l8 4v5c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V7z',
  /** Pairings: a round's tables, two seats to a row. */
  pairings: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M12 10v10',
  podium: 'M4 20v-9h5v9M9 20V5h6v15M15 20v-6h5v6',
  flag: 'M5 21V4M5 4h12l-2.5 4.5L17 13H5',
  settings:
    'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1'
} as const;

export function BarIcon(props: { name: keyof typeof PATHS }) {
  return (
    <svg
      class='icon'
      viewBox='0 0 24 24'
      width='20'
      height='20'
      fill='none'
      stroke='currentColor'
      stroke-width='1.5'
      stroke-linecap='round'
      stroke-linejoin='round'
      aria-hidden='true'
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}
