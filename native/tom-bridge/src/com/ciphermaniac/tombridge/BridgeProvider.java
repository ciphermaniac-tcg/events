package com.ciphermaniac.tombridge;

import javax.accessibility.AccessibilityProvider;

/**
 * Entry point that java.awt.Toolkit loads when TOM starts with
 * -Djavax.accessibility.assistive_technologies=cmevents-tombridge.
 *
 * <p>A provider that throws here stops TOM from starting (AWTError), so
 * activate() only starts a daemon thread and swallows everything.
 */
public final class BridgeProvider extends AccessibilityProvider {
   static final String NAME = "cmevents-tombridge";

   @Override
   public String getName() {
      return NAME;
   }

   @Override
   public void activate() {
      try {
         Thread thread = new Thread(Bridge::runSafely, NAME);
         thread.setDaemon(true);
         thread.start();
      } catch (Throwable ignored) {
         // TOM must start even when the bridge cannot.
      }
   }
}
