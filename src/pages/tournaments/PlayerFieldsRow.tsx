/**
 * What the event asks each player on entry, as a row of checkboxes. An
 * unsanctioned event paired here picks any of them, so long as the name or
 * the tag stays among them; a sanctioned or TOM event asks the name, birth
 * year and POP ID, fixed, and takes no tags.
 */

import { For, Show } from 'solid-js';
import { PLAYER_FIELDS, type PlayerField, SANCTIONED_FIELDS } from '../../../shared/tournament/view';
import { msg, t } from '../../lib/i18n';
import { SettingRow } from './SettingControls';
import { SettingInfo } from './SettingInfo';

const FIELD_LABELS: Record<PlayerField, string> = {
  name: msg('First and last name'),
  tag: msg('Player tag'),
  birthYear: msg('Year of birth'),
  popId: msg('POP ID')
};

const TAG_INFO = msg('An informal name a player chooses to go by that is not their name.');

/** Whether unchecking `field` would leave the player with no name and no tag to go by. */
const onlyWayToName = (field: PlayerField, value: readonly PlayerField[]) =>
  (field === 'name' || field === 'tag') && !value.includes(field === 'name' ? 'tag' : 'name');

export function PlayerFieldsRow(props: {
  value: readonly PlayerField[];
  /** A sanctioned or TOM event, whose fields are fixed. */
  fixed: boolean;
  onChange: (value: PlayerField[]) => void;
}) {
  const shown = () => (props.fixed ? SANCTIONED_FIELDS : PLAYER_FIELDS);
  const checked = (field: PlayerField) => props.fixed || props.value.includes(field);
  const locked = (field: PlayerField) => props.fixed || (checked(field) && onlyWayToName(field, props.value));
  function toggle(field: PlayerField, on: boolean) {
    props.onChange(PLAYER_FIELDS.filter(each => (each === field ? on : props.value.includes(each))));
  }
  return (
    <SettingRow label={t('Asked on entry')}>
      <div class='tm-field tm-setup-asked' role='group' aria-label={t('Asked on entry')}>
        <For each={shown()}>
          {field => (
            <span class='tm-set-inline'>
              <label class='tm-check'>
                <input
                  type='checkbox'
                  checked={checked(field)}
                  disabled={locked(field)}
                  onChange={e => toggle(field, e.currentTarget.checked)}
                />
                {t(FIELD_LABELS[field])}
              </label>
              <Show when={field === 'tag'}>
                <SettingInfo text={TAG_INFO} />
              </Show>
            </span>
          )}
        </For>
      </div>
    </SettingRow>
  );
}
