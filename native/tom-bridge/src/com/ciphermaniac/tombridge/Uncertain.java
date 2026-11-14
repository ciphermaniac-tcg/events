package com.ciphermaniac.tombridge;

/** Something may have changed in TOM, but whether it did cannot be told. */
final class Uncertain extends NotReady {
   private static final long serialVersionUID = 1L;

   Uncertain(String reason) {
      super(reason);
   }
}
