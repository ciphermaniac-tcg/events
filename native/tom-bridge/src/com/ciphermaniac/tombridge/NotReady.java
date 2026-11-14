package com.ciphermaniac.tombridge;

/** TOM is not in a state where the request can run; the message says why. */
final class NotReady extends Exception {
   private static final long serialVersionUID = 1L;

   NotReady(String reason) {
      super(reason, null, false, false);
   }
}
