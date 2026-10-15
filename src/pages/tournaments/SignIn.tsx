import { createSignal, For, type JSX, Show } from 'solid-js';
import { type OAuthProvider, type Provider, type SignInOffer, signInUrl } from '../../lib/tournament/api';
import { UsernameForm } from './PasswordForm';

/*
 * The providers' own marks, unaltered: Google's standard-colour G (its
 * guidelines forbid recolouring or resizing it) and Discord's symbol in white
 * on Blurple.
 */
const GoogleG = () => (
  <svg viewBox='0 0 48 48' aria-hidden='true'>
    <path
      fill='#EA4335'
      d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'
    />
    <path
      fill='#4285F4'
      d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'
    />
    <path
      fill='#FBBC05'
      d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'
    />
    <path
      fill='#34A853'
      d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'
    />
  </svg>
);

const DiscordMark = () => (
  <svg viewBox='0 0 127.14 96.36' aria-hidden='true'>
    <path
      fill='#ffffff'
      d='M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z'
    />
  </svg>
);

const PROVIDERS: Record<OAuthProvider, { label: string; Mark: () => JSX.Element }> = {
  google: { label: 'Sign in with Google', Mark: GoogleG },
  discord: { label: 'Sign in with Discord', Mark: DiscordMark }
};

/** Google first, so it is at least as prominent as any other provider (its branding rules). */
const ORDER: OAuthProvider[] = ['google', 'discord'];

/** A name-only sign-in, offered by a local server with DEV_LOGIN on, for testing. */
function DevSignIn(props: { next: string }) {
  const [devName, setDevName] = createSignal('');
  return (
    <form
      class='tm-inline-form'
      onSubmit={event => {
        event.preventDefault();
        window.location.href = signInUrl('dev', props.next, devName());
      }}
    >
      <input
        class='tm-input'
        placeholder='Test user name'
        aria-label='Test user name'
        value={devName()}
        onInput={event => setDevName(event.currentTarget.value)}
      />
      <button type='submit' class='btn btn-ghost'>
        Dev sign-in
      </button>
    </form>
  );
}

const oauthOf = (providers: readonly Provider[]) => ORDER.filter(p => providers.includes(p));

/**
 * Sign-in buttons for whichever providers the server has configured, drawn to
 * each provider's branding guidelines and the same size. `stacked` puts them
 * one over the other at full width. `dev` adds the local test sign-in.
 */
function ProviderButtons(props: { providers: readonly Provider[]; next: string; stacked?: boolean; dev: boolean }) {
  return (
    <div class='tm-signin' classList={{ 'is-stacked': props.stacked }}>
      <For each={oauthOf(props.providers)}>
        {provider => (
          <a class={`tm-sso tm-sso-${provider}`} href={signInUrl(provider, props.next)} rel='external'>
            {PROVIDERS[provider].Mark()}
            <span>{PROVIDERS[provider].label}</span>
          </a>
        )}
      </For>
      <Show when={props.dev}>
        <DevSignIn next={props.next} />
      </Show>
      <Show when={props.providers.length === 0}>
        <p class='muted'>Sign-in is not set up on this server.</p>
      </Show>
    </div>
  );
}

/**
 * The username and password form, behind a button of its own under the
 * providers: those are the way in to prefer, so the form takes no room until
 * someone asks for it. It opens in place, focused, with the way back.
 */
function PasswordOption(props: { publishableKey: string; next: string }) {
  const [open, setOpen] = createSignal(false);
  let opener: HTMLButtonElement | undefined;
  return (
    <Show
      when={open()}
      fallback={
        <button type='button' class='tm-signin-other' ref={opener} onClick={() => setOpen(true)}>
          Sign in with username and password
        </button>
      }
    >
      <div class='tm-signin-reveal'>
        <UsernameForm publishableKey={props.publishableKey} next={props.next} focus />
        <button
          type='button'
          class='tm-signin-swap tm-signin-back'
          onClick={() => {
            setOpen(false);
            queueMicrotask(() => opener?.focus());
          }}
        >
          Back
        </button>
      </div>
    </Show>
  );
}

/**
 * Every way in the server offers, one over the other: the providers, then
 * username and password (PasswordOption), open from the start when there is
 * no provider to prefer. The local test sign-in gets a row of its own beneath.
 */
export function SignIn(props: { offer: SignInOffer; next: string; stacked?: boolean }) {
  const providers = () => props.offer.providers;
  const clerkKey = () => (providers().includes('clerk') ? (props.offer.clerkKey ?? null) : null);
  const dev = () => providers().includes('dev');
  const buttons = () => oauthOf(providers()).length > 0;
  return (
    <Show
      when={clerkKey()}
      fallback={<ProviderButtons providers={providers()} next={props.next} stacked={props.stacked} dev={dev()} />}
    >
      {key => (
        <div class='tm-signin-split'>
          <Show when={buttons()} fallback={<UsernameForm publishableKey={key()} next={props.next} />}>
            <div class='tm-signin-ways'>
              <ProviderButtons providers={providers()} next={props.next} stacked dev={false} />
              <PasswordOption publishableKey={key()} next={props.next} />
            </div>
          </Show>
          <Show when={dev()}>
            <div class='tm-signin-dev'>
              <DevSignIn next={props.next} />
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
