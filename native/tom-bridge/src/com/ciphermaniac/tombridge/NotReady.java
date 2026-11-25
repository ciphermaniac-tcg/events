package com.ciphermaniac.tombridge;

/**
 * TOM is not in a state where the request can run; the message says why.
 * `held` is TOM's own result for the match when that result is why, as TOM's
 * outcome code, and 0 otherwise.
 */
class NotReady extends Exception {
   private static final long serialVersionUID = 1L;

   final int held;

   NotReady(String reason) {
      this(reason, 0);
   }

   NotReady(String reason, int held) {
      super(reason, null, false, false);
      this.held = held;
   }
}
