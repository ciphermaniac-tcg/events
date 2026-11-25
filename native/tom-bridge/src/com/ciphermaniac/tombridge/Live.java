package com.ciphermaniac.tombridge;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import javax.swing.JFrame;

/**
 * TOM's live pairings, read from the tournament window's own data rather than
 * from the file TOM last saved, so a code goes in only when TOM would read it
 * as the match the site means. Read by reflection, on the event thread: the
 * helper is built without TOM's classes. The reading mirrors TOM's Speed
 * Match Slip Entry (SpeedMatchSlipEntryForm.findTheMatch in TOM 1.86.0).
 */
final class Live {
   private static final String MANAGER = "com.tcg.pokemon.op.tom.gui.ApplicationManager";
   /** A round type, and the stages of a pod's Swiss part, that TOM reads without a flight digit. */
   private static final int SINGLE_ELIMINATION = 1;
   private static final int TOP_CUT = 1;
   private static final int DAY_TWO = 3;

   /** What a code is meant to enter: its slip's parts, its outcome digit and both seats' TOM player IDs. */
   record Slip(int pod, Integer flight, int round, int table, int outcome, String p1, String p2) {
   }

   /**
    * One match of the pod's current round; `flight` is null when TOM gives it
    * none, `p2` for a bye. `outcome` is TOM's, 0 while pending.
    */
   record Match(Integer flight, int table, int p1, Integer p2, int outcome) {
   }

   /** How TOM reads a code now: digits for the pod and flight, the pod it names, its current round. */
   record Layout(int podDigits, int pod, int flightDigits, int round, List<Match> matches) {
   }

   /**
    * The event a request is for: `name` as TOM titles its window and `id`,
    * its tournament ID, when the site has one. Null takes any.
    */
   record Event(String name, String id) {
      static final Event ANY = new Event(null, null);
   }

   private Live() {
   }

   /** TOM's one tournament window, refused unless it holds `event`. Event thread only. */
   static JFrame frame(Event event) throws NotReady {
      JFrame frame = Pods.requireFrame(event.name());
      if (event.id() != null) {
         requireId(frame, event.id());
      }
      return frame;
   }

   private static void requireId(JFrame frame, String id) throws NotReady {
      String openId;
      String openName;
      try {
         Object data = call(tournamentOf(frame), "getData");
         openId = (String) call(data, "getTournamentId");
         openName = (String) call(data, "getName");
      } catch (ReflectiveOperationException | RuntimeException e) {
         Bridge.log("open event unreadable: " + e);
         throw new NotReady("The app could not read which event TOM has open, so nothing was sent.");
      }
      sameEvent(id, openId, openName);
   }

   /** Refuses unless TOM's open event, `openName`, has the tournament ID `id`. */
   static void sameEvent(String id, String openId, String openName) throws NotReady {
      if (openId == null || !id.strip().equals(openId.strip())) {
         throw new NotReady("TOM has \"" + openName + "\" open, not this event.");
      }
   }

   /**
    * Refuses unless TOM, as it is now, reads `code` as exactly the match
    * `want` names: same pod, flight, round and table, holding the same two
    * players in the same seats, with no other result. True when TOM already
    * holds `want`'s result there, so there is nothing to enter.
    */
   static boolean confirm(Layout live, Slip want, String code) throws NotReady {
      if (live.round() != want.round()) {
         throw Pods.otherRound(live.round(), want.round());
      }
      Match match = target(live, code);
      boolean same = match != null
         && live.pod() == want.pod()
         && Objects.equals(live.flightDigits() == 0 ? null : match.flight(), want.flight())
         && match.table() == want.table()
         && seat(want.p1(), match.p1())
         && seat(want.p2(), match.p2());
      String where = "Round " + want.round() + " table " + want.table();
      if (!same) {
         throw new NotReady(where + " in TOM has different players than the site.");
      }
      if (match.outcome() != 0 && match.outcome() != want.outcome()) {
         throw new NotReady(where + " already has a different result in TOM.", match.outcome());
      }
      return match.outcome() == want.outcome();
   }

   private static boolean seat(String want, Integer id) {
      return id != null && want != null && want.matches("[0-9]{1,10}") && Long.parseLong(want) == id;
   }

   /**
    * The match TOM would put this code's result on: the one at its table, in
    * its flight when TOM reads one. Null when TOM would take none, when that
    * is at table 0 (a bye or forced loss), or when the table holds more than one.
    */
   static Match target(Layout live, String code) {
      String body = code.substring(0, code.length() - 2);
      int at = live.podDigits();
      int flightEnd = at + live.flightDigits();
      int roundEnd = flightEnd + (live.round() > 9 ? 2 : 1);
      if (body.length() <= roundEnd || Integer.parseInt(body.substring(0, at)) != live.pod()
         || Integer.parseInt(body.substring(flightEnd, roundEnd)) != live.round()) {
         return null;
      }
      Integer flight = live.flightDigits() == 0 ? null : Integer.valueOf(body.substring(at, flightEnd));
      int table = Integer.parseInt(body.substring(roundEnd));
      List<Match> atTable = new ArrayList<>();
      for (Match match : live.matches()) {
         if (match.table() == table) {
            atTable.add(match);
         }
      }
      if (table == 0 || atTable.size() != 1) {
         return null;
      }
      Match match = atTable.get(0);
      return flight == null || flight.equals(match.flight()) ? match : null;
   }

   /** The layout TOM reads `code` with, from the tournament `frame` shows. Event thread only. */
   static Layout read(JFrame frame, String code) throws NotReady {
      try {
         return layout(tournamentOf(frame), code);
      } catch (ReflectiveOperationException | RuntimeException e) {
         Bridge.log("live pairings unreadable: " + e);
         throw new NotReady("The app could not read TOM's pairings, so nothing was sent.");
      }
   }

   /**
    * Where TOM saves the tournament `frame` shows; null when that cannot be
    * read. Only a read: whichever of TOM's windows `frame` is, active or not,
    * so a tournament TOM just opened counts before its window is ever active.
    * Event thread only.
    */
   static String file(JFrame frame) {
      try {
         return fileOf(shownIn(frame));
      } catch (ReflectiveOperationException | RuntimeException e) {
         return null;
      }
   }

   /** A tournament's .tdf, as TOM keeps it (TournamentData.getPersistenceFile in TOM 1.86.0). */
   static String fileOf(Object tournament) throws ReflectiveOperationException {
      return (String) call(call(tournament, "getData"), "getPersistenceFile");
   }

   /** The tournament of TOM's active window, which its slip form writes to; it must be `frame`. */
   private static Object tournamentOf(JFrame frame) throws ReflectiveOperationException {
      Object application = call(manager(), "getActiveInstance");
      if (application == null || call(application, "getWindow") != frame) {
         throw new IllegalStateException("the active TOM window is not the tournament's");
      }
      return Objects.requireNonNull(call(application, "getTournament"), "tournament");
   }

   /** The tournament of whichever of TOM's windows is `frame`, for reading only. */
   private static Object shownIn(JFrame frame) throws ReflectiveOperationException {
      for (Object application : (List<?>) call(manager(), "getRunningInstances")) {
         if (call(application, "getWindow") == frame) {
            return Objects.requireNonNull(call(application, "getTournament"), "tournament");
         }
      }
      throw new IllegalStateException("no TOM window is the tournament's");
   }

   private static Object manager() throws ReflectiveOperationException {
      Class<?> manager = Class.forName(MANAGER, false, ClassLoader.getSystemClassLoader());
      return manager.getMethod("getDefaultManager").invoke(null);
   }

   private static Layout layout(Object tournament, String code) throws ReflectiveOperationException {
      List<?> pods = (List<?>) call(tournament, "getPods");
      int podDigits = pods.size() == 1 ? String.valueOf(number(pods.get(0), "getCategory")).length() : 1;
      int category = Integer.parseInt(code.substring(0, podDigits));
      Object pod = Objects.requireNonNull(((Map<?, ?>) call(tournament, "getPodsTable")).get(category), "pod");
      Object round = Objects.requireNonNull(call(pod, "getCurrentRound"), "round");
      boolean flighted = flighted(round);
      int count = number(call(pod, "getData"), "getSubgroupCount");
      int flightDigits = !flighted || count <= 0 ? 0 : count > 9 ? 2 : 1;
      List<Match> matches = new ArrayList<>();
      for (Object match : (List<?>) call(round, "getMatches")) {
         matches.add(match(match));
      }
      return new Layout(podDigits, category, flightDigits, number(round, "getNumber"), matches);
   }

   /** Whether TOM reads a flight digit for this round, as its slip form decides. */
   private static boolean flighted(Object round) throws ReflectiveOperationException {
      Object pod = call(round, "getPod");
      Object regPod = pod.getClass().getSimpleName().equals("RegPod") ? pod : call(pod, "getRegPod");
      int stage = number(regPod, "getStage");
      List<?> flights = (List<?>) call(pod, "getSubGroups");
      return number(round, "getType") != SINGLE_ELIMINATION
         && stage != TOP_CUT
         && stage != DAY_TWO
         && flights != null
         && flights.size() > 1;
   }

   private static Match match(Object match) throws ReflectiveOperationException {
      Object flight = call(match, "getSubGroup");
      Object p2 = call(match, "getPlayer2");
      return new Match(
         flight == null ? null : number(flight, "getNumber"),
         number(match, "getTableNumber"),
         number(call(match, "getPlayer1"), "getId"),
         p2 == null ? null : number(p2, "getId"),
         number(match, "getOutcome"));
   }

   private static int number(Object target, String method) throws ReflectiveOperationException {
      return (Integer) call(target, method);
   }

   private static Object call(Object target, String method) throws ReflectiveOperationException {
      Method found = target.getClass().getMethod(method);
      return found.invoke(target);
   }
}
