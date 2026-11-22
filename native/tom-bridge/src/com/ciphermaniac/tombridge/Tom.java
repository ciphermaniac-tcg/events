package com.ciphermaniac.tombridge;

import java.awt.Dialog;
import java.awt.Window;
import java.awt.event.KeyEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
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
   private static final long CLOSE_TIMEOUT_MS = 3000;
   /** If the app never says a batch is over, the form closes this long after the last code. */
   private static final long IDLE_FINISH_MS = 2000;

   /** The slip form was opened by us, not the operator, so it is ours to close. */
   private boolean openedSlip;
   /** We ticked auto-save, so it is ours to untick: TOM keeps it for the whole session. */
   private boolean tickedAutosave;
   private ScheduledFuture<?> pendingFinish;
   private final Stealth stealth = Stealth.install();
   private final ScheduledExecutorService closer = Executors.newSingleThreadScheduledExecutor(task -> {
      Thread thread = new Thread(task, BridgeProvider.NAME + "-closer");
      thread.setDaemon(true);
      return thread;
   });

   /**
    * What the event thread saw on one poll: whether the thing being waited on
    * is there (the slip form, or a started round), and the message of an Error
    * dialog it dismissed.
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

   /**
    * `pod` and `round` say which round the code is for; without them no round
    * is started. `tournament` is the name TOM must have open; null takes any.
    */
   synchronized String submit(String code, Integer pod, Integer round, String tournament) {
      if (!code.matches(CODE_PATTERN)) {
         return new Json.Obj().str("error", "invalid code").toString();
      }
      cancelPendingFinish();
      try {
         startPodOf(pod, round, tournament);
         openSlipDialog(tournament);
         return enterAndObserve(code);
      } catch (NotReady e) {
         return notReady(e.getMessage());
      } finally {
         pendingFinish = closer.schedule(this::finish, IDLE_FINISH_MS, TimeUnit.MILLISECONDS);
      }
   }

   /**
    * Ends a batch: puts the slip form back as the operator left it, closing it
    * if we opened it and unticking auto-save if we ticked it.
    */
   synchronized String finish() {
      cancelPendingFinish();
      boolean closing = openedSlip;
      boolean untick = tickedAutosave;
      openedSlip = false;
      tickedAutosave = false;
      try {
         Swing.onEdt(() -> restoreSlip(closing, untick));
         awaitSlipClosed(closing);
         return new Json.Obj().str("result", "finished").toString();
      } catch (NotReady e) {
         return notReady(e.getMessage());
      } finally {
         stealth.arm(false);
      }
   }

   private void cancelPendingFinish() {
      if (pendingFinish != null) {
         pendingFinish.cancel(false);
         pendingFinish = null;
      }
   }

   private static Void restoreSlip(boolean close, boolean untick) {
      Dialog slip = Swing.dialog(SLIP);
      if (slip == null) {
         return null;
      }
      AbstractButton autosave = Swing.button(slip, text -> text.startsWith(AUTOSAVE));
      if (untick && autosave != null && autosave.isSelected()) {
         autosave.doClick(0);
      }
      AbstractButton closeButton = Swing.button(slip, "Close"::equals);
      if (close && closeButton != null) {
         // Closing ends the form's modal loop, so click after this task returns.
         SwingUtilities.invokeLater(() -> closeButton.doClick(0));
      } else if (close) {
         SwingUtilities.invokeLater(slip::dispose);
      }
      return null;
   }

   private void awaitSlipClosed(boolean closing) throws NotReady {
      long deadline = System.currentTimeMillis() + CLOSE_TIMEOUT_MS;
      while (closing && System.currentTimeMillis() < deadline) {
         Swing.sleep(POLL_MS);
         if (Swing.onEdt(() -> Swing.dialog(SLIP) == null)) {
            return;
         }
      }
      if (closing) {
         throw new NotReady(SLIP + " did not close.");
      }
   }

   /** Once the code may be in TOM's field, a lost answer is uncertain, not "not ready". */
   private String enterAndObserve(String code) {
      try {
         tickedAutosave |= Swing.onEdt(() -> enter(code));
      } catch (Uncertain e) {
         return uncertain(e.getMessage());
      } catch (NotReady e) {
         return notReady(e.getMessage());
      }
      try {
         return awaitOutcome(code);
      } catch (NotReady e) {
         return uncertain(e.getMessage());
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

   synchronized String startRound(Integer category, String tournament) {
      try {
         String result = startPod(category, tournament) ? "started" : "already_started";
         return new Json.Obj().str("result", result).toString();
      } catch (NotReady e) {
         return notReady(e.getMessage());
      }
   }

   /** Starts a pod's paired round; false when it had already started. */
   private boolean startPod(Integer category, String tournament) throws NotReady {
      Starting starting = Swing.onEdt(() -> clickStart(category, tournament));
      if (starting == null) {
         return false;
      }
      awaitStarted(starting);
      return true;
   }

   /** Never behind the slip form: it is modal, so the main window is not TOM's to act on. */
   private static Starting clickStart(Integer category, String tournament) throws NotReady {
      JFrame frame = requireIdle(false, tournament);
      JTabbedPane pane = Pods.podPane(frame);
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
   private void startPodOf(Integer category, Integer round, String tournament) throws NotReady {
      if (category != null && round != null && Swing.onEdt(() -> awaitingStart(category, round))) {
         if (openedSlip) {
            // Ours, from an earlier code in the batch: close it so the round can start.
            finish();
         }
         startPod(category, tournament);
      }
   }

   /**
    * Only the exact round the result is for: a late slip from an earlier round
    * must not start the next one, and a code for another pod must not start this one.
    */
   private static boolean awaitingStart(int category, int round) {
      JFrame frame = Pods.mainFrame();
      for (Pods.Pod pod : Pods.read(frame == null ? null : Pods.podPane(frame))) {
         if (Integer.valueOf(category).equals(pod.category()) && pod.round() == round) {
            return pod.state() == Pods.State.PAIRED;
         }
      }
      return false;
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

   /** TOM's tournament window, when nothing blocks it and it holds the expected tournament. */
   private static JFrame requireIdle(boolean allowSlip, String tournament) throws NotReady {
      Dialog dialog = blocker(allowSlip);
      if (dialog != null && ERROR.equals(dialog.getTitle())) {
         throw new NotReady("TOM is showing an error: " + Swing.message(dialog) + " Close it, then try again.");
      }
      if (dialog != null) {
         throw new NotReady("TOM has the \"" + Swing.title(dialog) + "\" window open. Close it, then try again.");
      }
      return Pods.requireFrame(tournament);
   }

   private static void clickMenu(JFrame frame, String text) throws NotReady {
      JMenuItem item = Swing.menuItem(frame, text);
      if (item == null) {
         throw new NotReady("TOM's \"" + text + "\" menu item was not found.");
      }
      // The item may open a modal dialog, so click it after this task returns.
      SwingUtilities.invokeLater(() -> item.doClick(0));
   }

   private static boolean startOpening(String tournament) throws NotReady {
      JFrame frame = requireIdle(true, tournament);
      if (Swing.dialog(SLIP) != null) {
         return false;
      }
      clickMenu(frame, SLIP);
      return true;
   }

   private void openSlipDialog(String tournament) throws NotReady {
      // Armed before the click, so the form is hidden from its first show.
      stealth.arm(true);
      if (!Swing.onEdt(() -> startOpening(tournament))) {
         stealth.arm(openedSlip);
         return;
      }
      openedSlip = true;
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

   /** Returns whether auto-save had to be ticked. */
   private static Boolean enter(String code) throws NotReady {
      Dialog slip = Swing.dialog(SLIP);
      if (slip == null) {
         throw new NotReady(SLIP + " closed before the code was sent.");
      }
      AbstractButton autosave = Swing.button(slip, text -> text.startsWith(AUTOSAVE));
      if (autosave == null) {
         throw new NotReady("The \"" + AUTOSAVE + "\" option was not found in " + SLIP + ".");
      }
      boolean ticking = !autosave.isSelected();
      if (ticking) {
         autosave.doClick(0);
      }
      JTextField field = Swing.editableField(slip);
      if (field == null) {
         throw new NotReady("The Result Code field was not found in " + SLIP + ".");
      }
      field.setText(code);
      // TOM may answer with a modal Error dialog, so press Enter after this task returns.
      SwingUtilities.invokeLater(() -> pressEnter(field));
      return ticking;
   }

   /** TOM acts on the release of Enter, so send both halves. */
   private static void pressEnter(JTextField field) {
      long now = System.currentTimeMillis();
      field.dispatchEvent(new KeyEvent(field, KeyEvent.KEY_PRESSED, now, 0, KeyEvent.VK_ENTER, '\n'));
      field.dispatchEvent(new KeyEvent(field, KeyEvent.KEY_RELEASED, now, 0, KeyEvent.VK_ENTER, '\n'));
   }

   /** What the slip form showed after Enter. `text` is null when the form or its field is gone. */
   private record Field(String text, String error) {
   }

   private static Field observe() {
      String error = dismissError();
      Dialog slip = Swing.dialog(SLIP);
      JTextField field = slip == null ? null : Swing.editableField(slip);
      return new Field(field == null ? null : field.getText().strip(), error);
   }

   /**
    * Accepted only on positive evidence: the form is still open and TOM has
    * emptied its field, with no Error for the settle time since it was first
    * seen empty (`emptyFor`). `elapsed` counts from Enter. False means keep
    * watching; anything else TOM may or may not have taken.
    */
   static boolean judge(String text, String code, long elapsed, long emptyFor) throws NotReady {
      if (text == null) {
         throw new NotReady(SLIP + " closed before TOM's answer could be seen.");
      }
      if (text.isEmpty()) {
         return emptyFor >= SETTLE_MS;
      }
      if (!text.equals(code)) {
         throw new NotReady("Something else was typed into TOM's Result Code field while the code was entered.");
      }
      if (elapsed >= RESPONSE_TIMEOUT_MS) {
         throw new NotReady("TOM did not respond to the code.");
      }
      return false;
   }

   private String awaitOutcome(String code) throws NotReady {
      long start = System.currentTimeMillis();
      long emptySince = -1;
      while (true) {
         Swing.sleep(POLL_MS);
         Field seen = Swing.onEdt(Tom::observe);
         if (seen.error() != null) {
            return new Json.Obj().str("result", "rejected").str("message", seen.error()).toString();
         }
         long now = System.currentTimeMillis();
         boolean empty = seen.text() != null && seen.text().isEmpty();
         emptySince = !empty ? -1 : emptySince < 0 ? now : emptySince;
         if (judge(seen.text(), code, now - start, empty ? now - emptySince : 0)) {
            return new Json.Obj().str("result", "accepted").toString();
         }
      }
   }

   private static Void clickSave() throws NotReady {
      clickMenu(requireIdle(true, null), "Save");
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

   private static String uncertain(String reason) {
      String advice = " TOM may or may not have recorded this code. Check TOM before sending it again.";
      return new Json.Obj().str("result", "uncertain").str("reason", reason + advice).toString();
   }

   private static String notReady(String reason) {
      return new Json.Obj().str("result", "not_ready").str("reason", reason).toString();
   }
}
