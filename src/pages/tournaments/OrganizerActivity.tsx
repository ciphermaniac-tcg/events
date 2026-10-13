import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import type { OrganizerActivity as Activity } from '../../../shared/accounts/types';
import { eventDay } from '../../lib/tournament/history';

const STATUS = { upcoming: 'Upcoming', live: 'In progress', finished: 'Finished' } as const;

export function OrganizerActivity(props: { entries: readonly Activity[] }) {
  return (
    <Show when={props.entries.length} fallback={<p class='muted tm-empty'>No organizer activity yet</p>}>
      <section class='tm-box tm-organizer-activity'>
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th>Event</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.entries}>
                {entry => (
                  <tr>
                    <td>
                      <A class='tm-hist-name tm-link-inline' href={`/t/${entry.code}`}>
                        {entry.name || entry.code}
                      </A>
                      <span class='tm-hist-sub'>
                        {[eventDay(entry.startsAt, entry.startDate), entry.format].filter(Boolean).join(' · ')}
                        <Show when={entry.store}>
                          {store => (
                            <>
                              {' '}
                              · <A href={`/stores/${store().id}`}>{store().name}</A>
                            </>
                          )}
                        </Show>
                      </span>
                    </td>
                    <td>{entry.role === 'organized' ? 'Organized' : 'Staffed'}</td>
                    <td>
                      <span class='tm-flag'>{STATUS[entry.status]}</span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    </Show>
  );
}
