import type { PlayerProfile } from '../../../shared/tournament/profile';
import { type JSX, Show, splitProps } from 'solid-js';
import { t } from '../../lib/i18n';
import { Field } from './Field';

/**
 * TOM keeps only a birth year and writes every birth date as 02/27 of it, so
 * the form asks for the year and stores it the same way.
 */
export const birthYearOf = (birthDate: string) => birthDate.slice(-4);
export const birthDateFor = (year: string) => (/^\d{4}$/.test(year.trim()) ? `02/27/${year.trim()}` : year.trim());

type DigitsProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onInput'> & {
  value: string;
  onValue: (digits: string) => void;
};

/** An input that keeps the digits typed or pasted, up to `max`, and shows only those. */
function DigitsInput(props: DigitsProps & { max: number }) {
  const [own, rest] = splitProps(props, ['value', 'onValue', 'max', 'class']);
  return (
    <input
      {...rest}
      class={own.class ?? 'tm-input'}
      inputmode='numeric'
      value={own.value}
      onInput={e => {
        const input = e.currentTarget;
        const digits = input.value.replace(/\D/g, '').slice(0, own.max);
        // Set here as well: a stray letter leaves the value unchanged, so nothing else would take it out.
        input.value = digits;
        own.onValue(digits);
      }}
    />
  );
}

/**
 * A Player ID field's input, the same on every form that asks for one: digits
 * only, so a pasted "POP-12345" keeps its number, up to the ten an ID has,
 * with the number pad on phones.
 */
export function PlayerIdInput(props: DigitsProps) {
  return <DigitsInput autocomplete='off' {...props} max={10} />;
}

/** A birth year field's input, the same on every form that asks for one: four digits, filled in by the browser where it can. */
export function BirthYearInput(props: DigitsProps) {
  return <DigitsInput autocomplete='bday-year' {...props} max={4} />;
}

export function emptyProfile(user?: Partial<Record<keyof PlayerProfile, string | null>> | null): PlayerProfile {
  return {
    popId: user?.popId ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    birthDate: user?.birthDate ?? ''
  };
}

type Problems = Partial<Record<keyof PlayerProfile, string>>;

/** Each field's id after the form's prefix, in the order the form shows them. */
const FIELD_IDS: [keyof PlayerProfile, string][] = [
  ['firstName', 'first'],
  ['lastName', 'last'],
  ['popId', 'pop'],
  ['birthDate', 'year']
];

/** Moves focus to the first field with a problem, as a save that was refused leaves it. */
export function focusFirstProblem(idPrefix: string, problems: Problems): void {
  const first = FIELD_IDS.find(([key]) => problems[key]);
  if (first) {
    document.getElementById(`${idPrefix}-${first[1]}`)?.focus();
  }
}

/**
 * POP ID, name and birth year: what an organizer's player list knows a player
 * by. An unsanctioned event knows them by name alone. A field with a problem
 * is marked invalid and described by it; `popIdAction` follows a Player ID
 * problem only the site can settle.
 */
export function ProfileFields(props: {
  idPrefix: string;
  value: PlayerProfile;
  sanctioned?: boolean;
  errors: Problems;
  popIdAction?: JSX.Element;
  onChange: (profile: PlayerProfile) => void;
}) {
  const set = (key: keyof PlayerProfile, value: string) => props.onChange({ ...props.value, [key]: value });
  const id = (key: string) => `${props.idPrefix}-${key}`;
  const error = (key: keyof PlayerProfile) => {
    const text = props.errors[key];
    return text ? t(text) : undefined;
  };
  const problem = (key: keyof PlayerProfile, field: string) =>
    props.errors[key] ? { 'aria-invalid': true, 'aria-describedby': `${id(field)}-error` } : {};
  return (
    <div class='tm-grid-fields tm-profile-fields'>
      <Field id={id('first')} label={t('First name')} error={error('firstName')}>
        <input
          id={id('first')}
          {...problem('firstName', 'first')}
          class='tm-input'
          autocomplete='given-name'
          value={props.value.firstName}
          onInput={e => set('firstName', e.currentTarget.value)}
        />
      </Field>
      <Field id={id('last')} label={t('Last name')} error={error('lastName')}>
        <input
          id={id('last')}
          {...problem('lastName', 'last')}
          class='tm-input'
          autocomplete='family-name'
          value={props.value.lastName}
          onInput={e => set('lastName', e.currentTarget.value)}
        />
      </Field>
      <Show when={props.sanctioned !== false}>
        <Field id={id('pop')} label={t('Player ID')} error={error('popId')} errorAction={props.popIdAction}>
          <PlayerIdInput
            id={id('pop')}
            {...problem('popId', 'pop')}
            value={props.value.popId}
            onValue={value => set('popId', value)}
          />
        </Field>
        <Field id={id('year')} label={t('Birth year')} error={error('birthDate')}>
          <BirthYearInput
            id={id('year')}
            {...problem('birthDate', 'year')}
            value={birthYearOf(props.value.birthDate)}
            onValue={value => set('birthDate', birthDateFor(value))}
          />
        </Field>
      </Show>
    </div>
  );
}
