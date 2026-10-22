/** The bar at the foot of a section of store settings that says how its save went (see createAction). */

import { type JSX, Show } from 'solid-js';
import { t } from '../../lib/i18n';
import { ErrorLine } from './Field';

/** Save at the foot of a section, then `children` (more actions): what it is waiting on, the error, or that it saved. */
export function SaveBar(props: {
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  error: string | null;
  reason?: string | null;
  children?: JSX.Element;
}) {
  return (
    <div class='tm-store-save'>
      <button type='submit' class='btn btn-primary' disabled={!props.dirty || props.busy || Boolean(props.reason)}>
        {t('Save')}
      </button>
      {props.children}
      <Show when={props.reason && props.dirty}>
        <span class='muted'>{props.reason}</span>
      </Show>
      <Show when={props.saved && !props.dirty}>
        <span class='muted' role='status'>
          {t('Saved')}
        </span>
      </Show>
      <ErrorLine message={props.error} />
    </div>
  );
}
