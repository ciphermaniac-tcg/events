/** Best effort: unsupported browsers and power-saving restrictions can refuse the request. */
export function screenWakeLock(request: () => Promise<WakeLockSentinel>, visible: () => boolean) {
  let lock: WakeLockSentinel | null = null;
  let pending = false;
  let stopped = false;

  async function resume() {
    if (stopped || pending || lock || !visible()) {
      return;
    }
    pending = true;
    try {
      const acquired = await request();
      if (stopped || !visible()) {
        await acquired.release();
        return;
      }
      lock = acquired;
      acquired.addEventListener(
        'release',
        () => {
          lock = null;
        },
        { once: true }
      );
    } catch {
      // Best effort; a later visibility/focus change can ask again.
    } finally {
      pending = false;
    }
  }

  function stop() {
    stopped = true;
    void lock?.release().catch(() => undefined);
    lock = null;
  }
  return { resume, stop };
}
