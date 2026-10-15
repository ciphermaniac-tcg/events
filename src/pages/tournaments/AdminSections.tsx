/**
 * The Admin's sections, shared by /admin and the dashboard's Admin tab. Five
 * tabs: Applications (the queue to decide, see AdminApplications), Organizers
 * (every account with a role, and its access, see AdminOrganizers), POP IDs
 * (settling who holds one, see AdminPopIds), Events (every event on the
 * site, see AdminEvents) and Users (every account, see AdminUsers). The open section is kept in the address under
 * `param`, so a reload stays on it; the dashboard already uses `tab` for its
 * own tabs.
 */

import { useSearchParams } from '@solidjs/router';
import { Match, Switch } from 'solid-js';
import { TabPanel, Tabs } from '../../components/Tabs';
import { AdminApplications } from './AdminApplications';
import { AdminEvents } from './AdminEvents';
import { AdminOrganizers } from './AdminOrganizers';
import { AdminPopIds } from './AdminPopIds';
import { AdminUsers } from './AdminUsers';
import '../../styles/pages/tournament-admin.css';

type Section = 'applications' | 'organizers' | 'pop-ids' | 'events' | 'users';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'applications', label: 'Applications' },
  { value: 'organizers', label: 'Organizers' },
  { value: 'pop-ids', label: 'POP IDs' },
  { value: 'events', label: 'Events' },
  { value: 'users', label: 'Users' }
];

export function AdminSections(props: { param: 'tab' | 'section' }) {
  const [params, setParams] = useSearchParams<Record<string, string>>();
  const section = (): Section => SECTIONS.find(option => option.value === params[props.param])?.value ?? 'applications';
  return (
    <div class='tm-admin'>
      <Tabs
        id='admin'
        options={SECTIONS}
        selected={section()}
        onSelect={value => setParams({ [props.param]: value }, { replace: true })}
        ariaLabel='Admin sections'
      />
      <TabPanel tabs='admin' selected={section()}>
        <Switch>
          <Match when={section() === 'applications'}>
            <AdminApplications />
          </Match>
          <Match when={section() === 'organizers'}>
            <AdminOrganizers />
          </Match>
          <Match when={section() === 'pop-ids'}>
            <AdminPopIds />
          </Match>
          <Match when={section() === 'events'}>
            <AdminEvents />
          </Match>
          <Match when={section() === 'users'}>
            <AdminUsers />
          </Match>
        </Switch>
      </TabPanel>
    </div>
  );
}
