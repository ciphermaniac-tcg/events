import { type JSX, type Resource, Show } from 'solid-js';
import { t } from '../../lib/i18n';
import { errorText } from '../../lib/tournament/api';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';

/** A labelled form control with an optional error line, the house form row; `errorAction` follows the error's words. */
export function Field(props: {
  id: string;
  label: string;
  error?: string | undefined;
  errorAction?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class='tm-field'>
      <label class='tm-label' for={props.id}>
        {props.label}
      </label>
      {props.children}
      <Show when={props.error}>
        <span class='tm-error' id={`${props.id}-error`}>
          {props.error} {props.errorAction}
        </span>
      </Show>
    </div>
  );
}

/** The one line a failed request leaves, where the action was, with the way on (`action`) when there is one. */
export function ErrorLine(props: { message: string | null | undefined; action?: JSX.Element }) {
  return (
    <Show when={props.message}>
      <p class='tm-error' role='alert'>
        {props.message} {props.action}
      </p>
    </Show>
  );
}

export function RetryError(props: { error: unknown; onRetry: () => void; small?: boolean }) {
  return (
    <>
      <ErrorLine message={errorText(props.error)} />
      <button
        type='button'
        class={props.small ? 'btn btn-secondary tm-small' : 'btn btn-secondary'}
        onClick={() => props.onRetry()}
      >
        {t('Try again')}
      </button>
    </>
  );
}

export function ResourceFallback(props: {
  resource: Resource<unknown>;
  onRetry: () => void;
  height?: string;
  small?: boolean;
}) {
  return (
    <Show when={props.resource.state === 'errored'} fallback={<Skeleton height={props.height ?? '160px'} />}>
      <RetryError error={props.resource.error} onRetry={() => props.onRetry()} small={props.small} />
    </Show>
  );
}
