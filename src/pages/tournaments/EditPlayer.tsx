/**
 * Correcting a player on the roster: their name, and at a sanctioned event
 * their birth year, which the event needs to place them in a division. Once
 * play has started the server keeps them in the division they play in (see
 * checkedCorrection in shared/tournament/commands.ts) and says why here.
 */

import { createSignal, Show } from 'solid-js';
import { birthYear } from '../../../shared/tournament/divisions';
import type { Player } from '../../../shared/tournament/types';
import { t } from '../../lib/i18n';
import { ErrorLine, Field } from './Field';
import type { ManageState } from './manageState';
import { Modal } from './Modal';
import { birthDateFor } from './ProfileFields';

const yearOf = (player: Player) => String(birthYear(player.birthDate) ?? '');

export function EditPlayerDialog(props: {
  state: ManageState;
  player: Player;
  sanctioned: boolean;
  open: boolean;
  onClose: () => void;
}) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy taken when it opens
  const [first, setFirst] = createSignal(props.player.firstName);
  // eslint-disable-next-line solid/reactivity -- as above
  const [last, setLast] = createSignal(props.player.lastName);
  // eslint-disable-next-line solid/reactivity -- as above
  const [year, setYear] = createSignal(yearOf(props.player));
  const [tried, setTried] = createSignal(false);
  const yearMissing = () => props.sanctioned && !/^\d{4}$/.test(year());
  const ready = () => first().trim() !== '' && last().trim() !== '' && !yearMissing();
  async function save(event: Event) {
    event.preventDefault();
    if (!ready()) {
      return;
    }
    setTried(true);
    const ok = await props.state.send({
      type: 'editPlayer',
      id: props.player.id,
      firstName: first(),
      lastName: last(),
      // Only a sanctioned event asks for the year; elsewhere the one on record stays.
      birthDate: props.sanctioned ? birthDateFor(year()) : props.player.birthDate
    });
    if (ok) {
      props.onClose();
    }
  }
  return (
    <Modal open={props.open} title={t('Edit player')} class='tm-edit-player' onClose={props.onClose}>
      <form onSubmit={event => void save(event)}>
        <div class='tm-box-bar tm-modal-body'>
          <Field id='edit-first' label={t('First name')}>
            <input id='edit-first' class='tm-input' value={first()} onInput={e => setFirst(e.currentTarget.value)} />
          </Field>
          <Field id='edit-last' label={t('Last name')}>
            <input id='edit-last' class='tm-input' value={last()} onInput={e => setLast(e.currentTarget.value)} />
          </Field>
          <Show when={props.sanctioned}>
            <Field
              id='edit-year'
              label={t('Birth year')}
              error={yearMissing() ? t('Enter a four-digit year') : undefined}
            >
              {control => (
                <input
                  {...control}
                  class='tm-input'
                  inputmode='numeric'
                  maxLength={4}
                  value={year()}
                  onInput={e => setYear(e.currentTarget.value.replace(/\D/g, ''))}
                />
              )}
            </Field>
          </Show>
          <Show when={tried()}>
            <ErrorLine message={props.state.error()} />
          </Show>
        </div>
        <div class='tm-box-bar tm-modal-foot'>
          <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
            {t('Cancel')}
          </button>
          <button type='submit' class='btn btn-primary' disabled={props.state.busy() || !ready()}>
            {t('Save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
