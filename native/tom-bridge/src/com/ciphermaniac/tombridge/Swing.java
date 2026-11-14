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

   private Swing() {
   }

   /** Runs on the event thread and waits, without ever hanging the caller. */
   static <T> T onEdt(Callable<T> task) throws NotReady {
      CompletableFuture<T> result = new CompletableFuture<>();
      SwingUtilities.invokeLater(() -> {
         try {
            result.complete(task.call());
         } catch (Throwable t) {
            result.completeExceptionally(t);
         }
      });
      try {
         return result.get(EDT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
      } catch (TimeoutException e) {
         throw new NotReady("TOM is busy and did not respond.");
      } catch (InterruptedException e) {
         Thread.currentThread().interrupt();
         throw new NotReady("The bridge was interrupted.");
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

   /** A plain (non-submenu) item with this text in any showing frame's menu bar. */
   static JMenuItem menuItem(String text) {
      for (Window window : showing()) {
         JMenuBar bar = window instanceof JFrame frame ? frame.getJMenuBar() : null;
         JMenuItem item = bar == null ? null : itemIn(bar, text);
         if (item != null) {
            return item;
         }
      }
      return null;
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
