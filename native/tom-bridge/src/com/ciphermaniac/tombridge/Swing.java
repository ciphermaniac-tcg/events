package com.ciphermaniac.tombridge;

import java.awt.Component;
import java.awt.Container;
import java.awt.Dialog;
import java.awt.Frame;
import java.awt.Window;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Predicate;
import javax.swing.AbstractButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JMenu;
import javax.swing.JMenuBar;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import javax.swing.text.JTextComponent;

/** Finds TOM's windows and controls by their visible text. Only touches java.desktop. */
final class Swing {
   private static final long EDT_TIMEOUT_MS = 5000;
   private static final long EDT_GRACE_MS = 2000;
   private static final int PENDING = 0;
   private static final int RUNNING = 1;
   private static final int EXPIRED = 2;

   private Swing() {
   }

   /**
    * What an event-thread task found, and what it does next in the same
    * task, once its caller has that answer: `next` may open a modal dialog,
    * which would hold the task, so the caller must not wait for it.
    */
   record Then<T>(T value, Runnable next) {
   }

   /** Runs on the event thread and waits, without ever hanging the caller. */
   static <T> T onEdt(Callable<T> task) throws NotReady {
      return onEdt(task, EDT_TIMEOUT_MS, EDT_GRACE_MS);
   }

   /** As onEdt, then runs the task's `next`, if any, in that same task. */
   static <T> T onEdtThen(Callable<Then<T>> task) throws NotReady {
      return run(task, EDT_TIMEOUT_MS, EDT_GRACE_MS);
   }

   /**
    * A task still queued when the wait runs out never runs: it may change TOM,
    * and its caller has already reported that it did not. A task that already
    * started gets `grace` more to finish; if it does not, what it did is
    * unknown and the caller hears Uncertain.
    */
   static <T> T onEdt(Callable<T> task, long timeout, long grace) throws NotReady {
      return run(() -> new Then<>(task.call(), null), timeout, grace);
   }

   private static <T> T run(Callable<Then<T>> task, long timeout, long grace) throws NotReady {
      CompletableFuture<T> result = new CompletableFuture<>();
      AtomicInteger state = new AtomicInteger(PENDING);
      SwingUtilities.invokeLater(() -> {
         if (!state.compareAndSet(PENDING, RUNNING)) {
            return;
         }
         Then<T> then;
         try {
            then = task.call();
         } catch (Throwable t) {
            result.completeExceptionally(t);
            return;
         }
         result.complete(then.value());
         if (then.next() != null) {
            then.next().run();
         }
      });
      try {
         return await(result, timeout);
      } catch (TimeoutException e) {
         if (state.compareAndSet(PENDING, EXPIRED)) {
            throw new NotReady("TOM is busy and did not respond.");
         }
         return finish(result, grace);
      }
   }

   private static <T> T finish(CompletableFuture<T> result, long grace) throws NotReady {
      try {
         return await(result, grace);
      } catch (TimeoutException e) {
         throw new Uncertain("TOM stopped responding partway through.");
      }
   }

   private static <T> T await(CompletableFuture<T> result, long millis) throws NotReady, TimeoutException {
      try {
         return result.get(millis, TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
         Thread.currentThread().interrupt();
         throw new Uncertain("The bridge was interrupted.");
      } catch (ExecutionException e) {
         throw unwrap(e.getCause());
      }
   }

   private static NotReady unwrap(Throwable cause) {
      if (cause instanceof NotReady notReady) {
         return notReady;
      }
      Bridge.log("event thread task failed: " + cause);
      return new NotReady("TOM's window could not be read.");
   }

   static void sleep(long millis) throws NotReady {
      try {
         Thread.sleep(millis);
      } catch (InterruptedException e) {
         Thread.currentThread().interrupt();
         throw new NotReady("The bridge was interrupted.");
      }
   }

   static List<Window> showing() {
      List<Window> out = new ArrayList<>();
      for (Window window : Window.getWindows()) {
         if (window.isShowing()) {
            out.add(window);
         }
      }
      return out;
   }

   static String title(Window window) {
      if (window instanceof Dialog dialog) {
         return dialog.getTitle() == null ? "" : dialog.getTitle();
      }
      if (window instanceof Frame frame) {
         return frame.getTitle() == null ? "" : frame.getTitle();
      }
      return "";
   }

   static Dialog dialog(String title) {
      for (Window window : showing()) {
         if (window instanceof Dialog dialog && title.equals(dialog.getTitle())) {
            return dialog;
         }
      }
      return null;
   }

   static <T> List<T> collect(Component root, Class<T> type) {
      List<T> out = new ArrayList<>();
      collectInto(root, type, out);
      return out;
   }

   private static <T> void collectInto(Component component, Class<T> type, List<T> out) {
      if (type.isInstance(component)) {
         out.add(type.cast(component));
      }
      Component[] children = component instanceof JMenu menu ? menu.getMenuComponents()
         : component instanceof Container container ? container.getComponents() : new Component[0];
      for (Component child : children) {
         collectInto(child, type, out);
      }
   }

   static AbstractButton button(Container root, Predicate<String> text) {
      for (AbstractButton button : collect(root, AbstractButton.class)) {
         if (button.getText() != null && text.test(button.getText().strip())) {
            return button;
         }
      }
      return null;
   }

   static JTextField editableField(Container root) {
      for (JTextField field : collect(root, JTextField.class)) {
         if (field.isEditable() && field.isEnabled()) {
            return field;
         }
      }
      return null;
   }

   /** A plain (non-submenu) item with this text in the frame's menu bar. */
   static JMenuItem menuItem(JFrame frame, String text) {
      JMenuBar bar = frame.getJMenuBar();
      return bar == null ? null : itemIn(bar, text);
   }

   private static JMenuItem itemIn(JMenuBar bar, String text) {
      for (JMenuItem item : collect(bar, JMenuItem.class)) {
         if (!(item instanceof JMenu) && text.equals(item.getText())) {
            return item;
         }
      }
      return null;
   }

   /** The text a message dialog shows, without Swing's HTML markup. */
   static String message(Dialog dialog) {
      return plain(rawMessage(dialog));
   }

   private static String plain(String html) {
      return html.replaceAll("<[^>]*>", " ").replaceAll("\\s+", " ").strip();
   }

   private static String rawMessage(Dialog dialog) {
      for (JOptionPane pane : collect(dialog, JOptionPane.class)) {
         if (pane.getMessage() instanceof String text) {
            return text;
         }
      }
      List<String> parts = new ArrayList<>();
      for (JLabel label : collect(dialog, JLabel.class)) {
         addText(parts, label.getText());
      }
      for (JTextComponent area : collect(dialog, JTextComponent.class)) {
         addText(parts, area.getText());
      }
      return String.join(" ", parts);
   }

   private static void addText(List<String> parts, String text) {
      if (text != null && !text.isBlank()) {
         parts.add(text.strip());
      }
   }
}
