package com.ciphermaniac.tombridge;

import java.awt.Dialog;
import java.awt.Window;
import java.awt.event.KeyEvent;
import java.util.ArrayList;
import java.util.List;
import javax.swing.AbstractButton;
import javax.swing.JFrame;
import javax.swing.JMenuItem;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;

/**
 * Drives TOM's Speed Match Slip Entry the way a scanner would, from inside
 * TOM's JVM. Requests are serialized: TOM handles one code at a time.
 */
final class Tom {
   static final String SLIP = "Speed Match Slip Entry";
   static final String ERROR = "Error";
   private static final String AUTOSAVE = "Automatically save valid scans";
   static final String TOURNAMENT_MARK = " - Tournament: ";
   private static final String CODE_PATTERN = "[0-9]{5,10}";
   private static final long POLL_MS = 50;
   private static final long OPEN_TIMEOUT_MS = 5000;
   private static final long ERROR_GRACE_MS = 1500;
   private static final long SETTLE_MS = 800;
   private static final long RESPONSE_TIMEOUT_MS = 3000;
   private static final long SAVE_SETTLE_MS = 1500;
   private static final long START_TIMEOUT_MS = 5000;

   /**
    * What the event thread saw on one poll: whether the thing being waited on
    * is there (the slip form, or a code TOM has not handled yet), and the
    * message of an Error dialog it dismissed.
    */
   private record Seen(boolean present, String error) {
   }

   /** A Start Round click in flight: which pod tab, and the tab to show again after. */
   private record Starting(int index, int previous) {
   }

   synchronized String status() {
      try {
         return Swing.onEdt(Tom::describe);
      } catch (NotReady e) {
         return new Json.Obj().str("error", e.getMessage()).toString();
      }
   }

   synchronized String submit(String code) {
      if (!code.matches(CODE_PATTERN)) {
         return new Json.Obj().str("error", "invalid code").toString();
      }
      try {
         startPodOf(code);
         openSlipDialog();
         Swing.onEdt(() -> enter(code));
         return awaitOutcome(code);
      } catch (NotReady e) {
         return notReady(e.getMessage());
      }
   }

   synchronized String save() {
      try {
         Swing.onEdt(Tom::clickSave);
         return awaitSave();
      } catch (NotReady e) {
         return notReady(e.getMessage());
      }
   }

   synchronized String startRound(Integer category) {
      try {
         String result = startPod(category) ? "started" : "already_started";
         return new Json.Obj().str("result", result).toString();
      } catch (NotReady e) {
         return notReady(e.getMessage());
      }
   }

   /** Starts a pod's paired round; false when it had already started. */
   private boolean startPod(Integer category) throws NotReady {
      Starting starting = Swing.onEdt(() -> clickStart(category));
      if (starting == null) {
         return false;
      }
      awaitStarted(starting);
      return true;
   }

   private static Starting clickStart(Integer category) throws NotReady {
      requireIdle(true);
      JFrame frame = Pods.mainFrame();
      JTabbedPane pane = frame == null ? null : Pods.podPane(frame);
      if (pane == null) {
         throw new NotReady("TOM's pod tabs were not found.");
      }
      Pods.Pod pod = Pods.pick(Pods.read(pane), category);
      if (pod.state().started()) {
         return null;
      }
      if (pod.state() != Pods.State.PAIRED) {
         throw new NotReady(Pods.notStartable(pod.state()));
      }
      int previous = pane.getSelectedIndex();
      AbstractButton start;
      try {
         start = Pods.prepareStart(frame, pane, pod);
      } catch (NotReady e) {
         pane.setSelectedIndex(previous);
         throw e;
      }
      SwingUtilities.invokeLater(() -> start.doClick(0));
      return new Starting(pod.index(), previous);
   }

   private void awaitStarted(Starting starting) throws NotReady {
      long deadline = System.currentTimeMillis() + START_TIMEOUT_MS;
      while (System.currentTimeMillis() < deadline) {
         Swing.sleep(POLL_MS);
         Seen seen = Swing.onEdt(() -> new Seen(podStarted(starting.index()), dismissError()));
         if (seen.error() != null) {
            throw new NotReady(seen.error());
         }
         if (seen.present()) {
            Swing.onEdt(() -> showTab(starting.previous()));
            return;
         }
      }
      throw new NotReady("TOM did not start the round.");
   }

   private static boolean podStarted(int index) {
      JFrame frame = Pods.mainFrame();
      List<Pods.Pod> pods = Pods.read(frame == null ? null : Pods.podPane(frame));
      return index < pods.size() && pods.get(index).state().started();
   }

   private static Void showTab(int index) {
      JFrame frame = Pods.mainFrame();
      JTabbedPane pane = frame == null ? null : Pods.podPane(frame);
      if (pane != null && index >= 0 && index < pane.getTabCount()) {
         pane.setSelectedIndex(index);
      }
      return null;
   }

   /**
    * TOM only takes results for a started round, so start the code's pod
    * first when TOM shows its round paired but not started.
    */
   private void startPodOf(String code) throws NotReady {
      Pods.Pod pod = Swing.onEdt(() -> pairedPodOf(code));
      if (pod != null) {
         startPod(pod.category());
      }
   }

   private static Pods.Pod pairedPodOf(String code) {
      JFrame frame = Pods.mainFrame();
      List<Pods.Pod> pods = Pods.read(frame == null ? null : Pods.podPane(frame));
      int category = code.startsWith("10") ? 10 : code.charAt(0) - '0';
      for (Pods.Pod pod : pods) {
         boolean mine = pods.size() == 1 || Integer.valueOf(category).equals(pod.category());
         if (mine && pod.state() == Pods.State.PAIRED) {
            return pod;
         }
      }
      return null;
   }

   private static String describe() {
      List<String> titles = new ArrayList<>();
      for (Window window : Swing.showing()) {
         String title = Swing.title(window);
         if (!title.isBlank()) {
            titles.add(title);
         }
      }
      JFrame frame = Pods.mainFrame();
      return new Json.Obj()
         .bool("tournamentOpen", tournamentOpen())
         .bool("slipDialogOpen", Swing.dialog(SLIP) != null)
         .strs("windows", titles)
         .objs("pods", Pods.toJson(Pods.read(frame == null ? null : Pods.podPane(frame))))
         .toString();
   }

   private static boolean tournamentOpen() {
      return Pods.mainFrame() != null;
   }

   /** A modal dialog other than the slip form, which would swallow our input. */
   private static Dialog blocker(boolean allowSlip) {
      for (Window window : Swing.showing()) {
         if (window instanceof Dialog dialog && dialog.isModal() && !(allowSlip && SLIP.equals(dialog.getTitle()))) {
            return dialog;
         }
      }
      return null;
   }

   private static void requireIdle(boolean allowSlip) throws NotReady {
      Dialog dialog = blocker(allowSlip);
      if (dialog != null && ERROR.equals(dialog.getTitle())) {
         throw new NotReady("TOM is showing an error: " + Swing.message(dialog) + " Close it, then try again.");
      }
      if (dialog != null) {
         throw new NotReady("TOM has the \"" + Swing.title(dialog) + "\" window open. Close it, then try again.");
      }
      if (!tournamentOpen()) {
         throw new NotReady("No tournament is open in TOM.");
      }
   }

   private static void clickMenu(String text) throws NotReady {
      JMenuItem item = Swing.menuItem(text);
      if (item == null) {
         throw new NotReady("TOM's \"" + text + "\" menu item was not found.");
      }
      // The item may open a modal dialog, so click it after this task returns.
      SwingUtilities.invokeLater(() -> item.doClick(0));
   }

   private static boolean startOpening() throws NotReady {
      requireIdle(true);
      if (Swing.dialog(SLIP) != null) {
         return false;
      }
      clickMenu(SLIP);
      return true;
   }

   private void openSlipDialog() throws NotReady {
      if (!Swing.onEdt(Tom::startOpening)) {
         return;
      }
      long deadline = System.currentTimeMillis() + OPEN_TIMEOUT_MS;
      String lastError = null;
      while (System.currentTimeMillis() < deadline) {
         Swing.sleep(POLL_MS);
         Seen seen = Swing.onEdt(() -> new Seen(Swing.dialog(SLIP) != null, dismissError()));
         if (seen.error() != null) {
            lastError = seen.error();
            deadline = Math.min(deadline, System.currentTimeMillis() + ERROR_GRACE_MS);
         } else if (seen.present()) {
            return;
         }
      }
      throw new NotReady(lastError != null ? lastError : SLIP + " did not open in TOM.");
   }

   /** Clicks OK on TOM's Error dialog; returns its message, or null when none is showing. */
   private static String dismissError() {
      Dialog error = Swing.dialog(ERROR);
      if (error == null) {
         return null;
      }
      String message = Swing.message(error);
      AbstractButton ok = Swing.button(error, "OK"::equals);
      if (ok != null) {
         ok.doClick(0);
      }
      return message.isEmpty() ? "TOM showed an error." : message;
   }

   private static Void enter(String code) throws NotReady {
      Dialog slip = Swing.dialog(SLIP);
      if (slip == null) {
         throw new NotReady(SLIP + " closed before the code was sent.");
      }
      AbstractButton autosave = Swing.button(slip, text -> text.startsWith(AUTOSAVE));
      if (autosave == null) {
         throw new NotReady("The \"" + AUTOSAVE + "\" option was not found in " + SLIP + ".");
      }
      if (!autosave.isSelected()) {
         autosave.doClick(0);
      }
      JTextField field = Swing.editableField(slip);
      if (field == null) {
         throw new NotReady("The Result Code field was not found in " + SLIP + ".");
      }
      field.setText(code);
      // TOM may answer with a modal Error dialog, so press Enter after this task returns.
      SwingUtilities.invokeLater(() -> pressEnter(field));
      return null;
   }

   /** TOM acts on the release of Enter, so send both halves. */
   private static void pressEnter(JTextField field) {
      long now = System.currentTimeMillis();
      field.dispatchEvent(new KeyEvent(field, KeyEvent.KEY_PRESSED, now, 0, KeyEvent.VK_ENTER, '\n'));
      field.dispatchEvent(new KeyEvent(field, KeyEvent.KEY_RELEASED, now, 0, KeyEvent.VK_ENTER, '\n'));
   }

   /** The code is still sitting in the field, so TOM has not handled it yet. */
   private static boolean pending(String code) {
      Dialog slip = Swing.dialog(SLIP);
      JTextField field = slip == null ? null : Swing.editableField(slip);
      return field != null && code.equals(field.getText().strip());
   }

   private static Void clearField() {
      Dialog slip = Swing.dialog(SLIP);
      JTextField field = slip == null ? null : Swing.editableField(slip);
      if (field != null) {
         field.setText("");
      }
      return null;
   }

   private String awaitOutcome(String code) throws NotReady {
      long start = System.currentTimeMillis();
      while (true) {
         Swing.sleep(POLL_MS);
         Seen seen = Swing.onEdt(() -> new Seen(pending(code), dismissError()));
         long elapsed = System.currentTimeMillis() - start;
         if (seen.error() != null) {
            return new Json.Obj().str("result", "rejected").str("message", seen.error()).toString();
         }
         if (!seen.present() && elapsed >= SETTLE_MS) {
            return new Json.Obj().str("result", "accepted").toString();
         }
         if (elapsed >= RESPONSE_TIMEOUT_MS) {
            Swing.onEdt(Tom::clearField);
            throw new NotReady("TOM did not respond to the code.");
         }
      }
   }

   private static Void clickSave() throws NotReady {
      requireIdle(true);
      clickMenu("Save");
      return null;
   }

   private String awaitSave() throws NotReady {
      long deadline = System.currentTimeMillis() + SAVE_SETTLE_MS;
      while (System.currentTimeMillis() < deadline) {
         Swing.sleep(POLL_MS);
         String error = Swing.onEdt(Tom::dismissError);
         if (error != null) {
            throw new NotReady(error);
         }
         if (Swing.onEdt(() -> blocker(true) != null)) {
            throw new NotReady("TOM is asking a question about saving. Answer it in TOM.");
         }
      }
      return new Json.Obj().str("result", "saved").toString();
   }

   private static String notReady(String reason) {
      return new Json.Obj().str("result", "not_ready").str("reason", reason).toString();
   }
}
