package com.ciphermaniac.tombridge;

import java.awt.AWTEvent;
import java.awt.Dialog;
import java.awt.GraphicsEnvironment;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.awt.Window;
import java.awt.event.AWTEventListener;
import java.awt.event.HierarchyEvent;

/**
 * Keeps the Speed Match Slip Entry form the helper opens out of the operator's
 * way: it never takes focus, and it sits off-screen from the moment it is
 * shown, before it first paints. TOM still takes codes there, since the helper
 * never needs the form focused or visible. Error dialogs TOM raises over it get
 * the same treatment. Only armed while the helper drives a form it opened.
 *
 * <p>Turned off by starting TOM with -Dcmevents.tombridge.showSlipForm=true.
 */
final class Stealth implements AWTEventListener {
   static final boolean ENABLED = !Boolean.getBoolean("cmevents.tombridge.showSlipForm");
   private static final int MARGIN = 2000;

   private volatile boolean armed;

   /** Registers for window hierarchy changes everywhere in TOM. */
   static Stealth install() {
      Stealth stealth = new Stealth();
      if (ENABLED) {
         Toolkit.getDefaultToolkit().addAWTEventListener(stealth, AWTEvent.HIERARCHY_EVENT_MASK);
      }
      return stealth;
   }

   void arm(boolean on) {
      armed = on && ENABLED;
   }

   @Override
   public void eventDispatched(AWTEvent event) {
      if (!armed || !(event instanceof HierarchyEvent change) || !(change.getChanged() instanceof Window window)) {
         return;
      }
      if (change.getComponent() != window || !ours(window)) {
         return;
      }
      long flags = change.getChangeFlags();
      if ((flags & HierarchyEvent.DISPLAYABILITY_CHANGED) != 0 && window.isDisplayable()) {
         // Before the first show: the window must not pull TOM to the front.
         window.setAutoRequestFocus(false);
      }
      if ((flags & HierarchyEvent.SHOWING_CHANGED) != 0 && window.isShowing()) {
         window.setLocation(offScreen(window));
      }
   }

   /** The slip form, or a dialog it owns (TOM's Error messages over it). */
   static boolean ours(Window window) {
      for (Window w = window; w != null; w = w.getOwner()) {
         if (w instanceof Dialog dialog && Tom.SLIP.equals(dialog.getTitle())) {
            return true;
         }
      }
      return false;
   }

   /** Just past the right edge of every screen together. */
   private static java.awt.Point offScreen(Window window) {
      Rectangle all = new Rectangle();
      for (var device : GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices()) {
         all = all.union(device.getDefaultConfiguration().getBounds());
      }
      return new java.awt.Point(all.x + all.width + MARGIN, all.y + Math.max(0, all.height - window.getHeight()) / 2);
   }
}
