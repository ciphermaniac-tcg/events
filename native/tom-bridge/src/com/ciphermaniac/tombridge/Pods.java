package com.ciphermaniac.tombridge;

import java.awt.Window;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.swing.AbstractButton;
import javax.swing.JCheckBox;
import javax.swing.JFrame;
import javax.swing.JTabbedPane;

/**
 * Reads TOM's pod tabs ("Masters Division (1/4)", with a tooltip saying what
 * the current round is doing) and drives its main button for one pod. All of
 * it is read from the window as TOM shows it, in English.
 */
final class Pods {
   static final String START_ROUND = "Start Round";
   static final String VIEW_PAIRINGS = "View Pairings";
   private static final String TOURNAMENT_PREFIX = "Tournament: ";
   private static final Pattern TITLE = Pattern.compile("^(.*) \\((\\d+)/\\d+\\)$");
   private static final Map<String, Integer> CATEGORIES = Map.of(
      "Junior Division", 0,
      "Senior Division", 1,
      "Masters Division", 2,
      "Junior/Senior Divisions", 8,
      "Senior/Masters Divisions", 9);
   private static final Map<Integer, String> CHECKBOXES = Map.of(0, "JR", 1, "SR", 2, "MA", 8, "JR/SR", 9, "SR/MA");

   /** What a pod tab's tooltip says about the current round. */
   enum State {
      PAIRED("has been paired"),
      PLAYING("is being played"),
      PAUSED("is paused"),
      COMPLETE("is complete"),
      REPAIR("has unpaired players"),
      DONE("This pod is complete"),
      UNKNOWN("");

      private final String marker;

      State(String marker) {
         this.marker = marker;
      }

      static State of(String tooltip) {
         for (State state : values()) {
            if (tooltip != null && !state.marker.isEmpty() && tooltip.contains(state.marker)) {
               return state;
            }
         }
         return UNKNOWN;
      }

      boolean started() {
         return this == PLAYING || this == PAUSED || this == COMPLETE;
      }
   }

   /** One pod tab. `category` is null when the tab title is not one TOM uses in English. */
   record Pod(int index, Integer category, int round, State state) {
      Json.Obj toJson() {
         Json.Obj obj = new Json.Obj();
         if (category != null) {
            obj.num("category", category);
         }
         return obj.num("round", round).bool("started", state.started());
      }
   }

   private Pods() {
   }

   /** The open tournament's window; null when none, or more than one, is open. */
   static JFrame mainFrame() {
      List<JFrame> frames = tournamentFrames();
      return frames.size() == 1 ? frames.get(0) : null;
   }

   private static List<JFrame> tournamentFrames() {
      List<JFrame> frames = new ArrayList<>();
      for (Window window : Swing.showing()) {
         if (window instanceof JFrame frame && frame.getTitle() != null && frame.getTitle().contains(Tom.TOURNAMENT_MARK)) {
            frames.add(frame);
         }
      }
      return frames;
   }

   /**
    * The one open tournament's window, refused when it is not the expected
    * tournament. TOM titles it after the tournament's name; null expects any.
    */
   static JFrame requireFrame(String expected) throws NotReady {
      List<JFrame> frames = tournamentFrames();
      List<String> titles = new ArrayList<>();
      for (JFrame frame : frames) {
         titles.add(frame.getTitle());
      }
      return frames.get(checkTitles(titles, expected));
   }

   /** Which title is the expected tournament's: the only one, and named as expected. */
   static int checkTitles(List<String> titles, String expected) throws NotReady {
      if (titles.isEmpty()) {
         throw new NotReady("No tournament is open in TOM.");
      }
      if (titles.size() > 1) {
         throw new NotReady("More than one tournament is open in TOM. Leave only this event open.");
      }
      String title = titles.get(0);
      String open = title.substring(title.indexOf(Tom.TOURNAMENT_MARK) + Tom.TOURNAMENT_MARK.length()).strip();
      if (expected != null && !expected.strip().equals(open)) {
         throw new NotReady("TOM has \"" + open + "\" open, not this event.");
      }
      return 0;
   }

   /** The tab pane whose tabs are pods: each tab holds the pod's own round tabs. */
   static JTabbedPane podPane(JFrame frame) {
      for (JTabbedPane pane : Swing.collect(frame, JTabbedPane.class)) {
         if (pane.getTabCount() > 0 && pane.getComponentAt(0) instanceof JTabbedPane) {
            return pane;
         }
      }
      return null;
   }

   static List<Pod> read(JTabbedPane pane) {
      List<Pod> pods = new ArrayList<>();
      for (int i = 0; pane != null && i < pane.getTabCount(); i++) {
         Matcher title = TITLE.matcher(pane.getTitleAt(i));
         if (title.matches()) {
            String name = title.group(1);
            Integer category = name.startsWith(TOURNAMENT_PREFIX) ? Integer.valueOf(10) : CATEGORIES.get(name);
            pods.add(new Pod(i, category, Integer.parseInt(title.group(2)), State.of(pane.getToolTipTextAt(i))));
         }
      }
      return pods;
   }

   static List<String> toJson(List<Pod> pods) {
      List<String> out = new ArrayList<>();
      for (Pod pod : pods) {
         out.add(pod.toJson().toString());
      }
      return out;
   }

   /**
    * The pod a category names. With one pod, the category may be left out, or
    * name a pod whose tab title TOM did not show in English.
    */
   static Pod pick(List<Pod> pods, Integer category) throws NotReady {
      if (pods.isEmpty()) {
         throw new NotReady("No tournament is open in TOM.");
      }
      if (category == null) {
         if (pods.size() == 1) {
            return pods.get(0);
         }
         throw new NotReady("This event has " + pods.size() + " pods in TOM. Say which pod's round to start.");
      }
      for (Pod pod : pods) {
         if (category.equals(pod.category()) || (pod.category() == null && pods.size() == 1)) {
            return pod;
         }
      }
      throw new NotReady("TOM has no pod for category " + category + ".");
   }

   /** The pod, refused when it is not on `round`; null takes any round. */
   static Pod onRound(Pod pod, Integer round) throws NotReady {
      if (round != null && pod.round() != round) {
         throw new NotReady("TOM has round " + pod.round() + " in this pod, not round " + round + ".");
      }
      return pod;
   }

   static String notStartable(State state) {
      return switch (state) {
         case REPAIR -> "TOM has unpaired players in this pod. Pair them in TOM first.";
         case DONE -> "This pod is finished in TOM.";
         default -> "TOM shows no round to start for this pod.";
      };
   }

   /**
    * Shows the pod's tab and leaves only its checkbox ticked, so the main
    * button acts on this pod alone. Returns the button when it says Start Round.
    */
   static AbstractButton prepareStart(JFrame frame, JTabbedPane pane, Pod pod) throws NotReady {
      pane.setSelectedIndex(pod.index());
      String wanted = pod.category() == null ? null : CHECKBOXES.get(pod.category());
      for (JCheckBox box : Swing.collect(frame, JCheckBox.class)) {
         String text = box.getText() == null ? "" : box.getText().strip();
         if (CHECKBOXES.containsValue(text) && box.isSelected() != text.equals(wanted)) {
            box.setSelected(!box.isSelected());
         }
      }
      AbstractButton start = Swing.button(frame, START_ROUND::equals);
      if (start != null && start.isEnabled()) {
         return start;
      }
      if (Swing.button(frame, VIEW_PAIRINGS::equals) != null) {
         throw new NotReady("TOM's pairings for this round have not been viewed yet. Press View Pairings in TOM, then try again.");
      }
      throw new NotReady("TOM's Start Round button was not found.");
   }
}
