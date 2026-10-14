import { useNavigate } from '@solidjs/router';
import { createSignal } from 'solid-js';
import { errorText } from '../../lib/tournament/api';
import { ErrorLine } from './Field';
import { leaveSession } from './session';

export function SignOutButton(props: { class?: string; onError?: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function leave() {
    setBusy(true);
    setError(null);
    try {
      await leaveSession();
      navigate('/');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      props.onError?.();
    }
  }
  return (
    <>
      <button type='button' class={props.class} disabled={busy()} onClick={() => void leave()}>
        Sign out
      </button>
      <ErrorLine message={error()} />
    </>
  );
}
