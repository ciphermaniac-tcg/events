package com.ciphermaniac.tombridge;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.swing.SwingUtilities;

/**
 * Headless checks for the bridge's own logic. Run by `node build.mjs --test`:
 * every static method whose name starts with "test" runs; any throw fails.
 */
public final class BridgeTest {
   private BridgeTest() {
   }

   public static void main(String[] args) throws Exception {
      int failed = 0;
      for (Method method : BridgeTest.class.getDeclaredMethods()) {
         if (method.getName().startsWith("test") && Modifier.isStatic(method.getModifiers())) {
            failed += run(method);
         }
      }
      System.exit(failed == 0 ? 0 : 1);
   }

   private static int run(Method method) {
      try {
         method.invoke(null);
         System.out.println("ok   " + method.getName());
         return 0;
      } catch (ReflectiveOperationException e) {
         System.out.println("FAIL " + method.getName() + ": " + e.getCause());
         return 1;
      }
   }

   static void check(boolean condition, String message) {
      if (!condition) {
         throw new AssertionError(message);
      }
   }

   /** Holds the event thread until the returned latch is released. */
   private static CountDownLatch blockEdt() {
      CountDownLatch release = new CountDownLatch(1);
      SwingUtilities.invokeLater(() -> {
         try {
            release.await();
         } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
         }
      });
      return release;
   }

   private static void drainEdt() throws Exception {
      SwingUtilities.invokeAndWait(() -> { });
   }

   static void testTaskQueuedPastTheTimeoutNeverRuns() throws Exception {
      CountDownLatch release = blockEdt();
      AtomicBoolean ran = new AtomicBoolean();
      try {
         Swing.onEdt(() -> ran.getAndSet(true), 100, 100);
         check(false, "expected NotReady");
      } catch (Uncertain e) {
         check(false, "a task that never started is not uncertain");
      } catch (NotReady e) {
         check(e.getMessage().contains("busy"), e.getMessage());
      }
      release.countDown();
      drainEdt();
      check(!ran.get(), "the expired task ran after its caller gave up");
   }

   static void testTaskStillRunningPastTheGraceIsUncertain() throws Exception {
      CountDownLatch release = new CountDownLatch(1);
      try {
         Swing.onEdt(() -> release.await(5, TimeUnit.SECONDS), 100, 100);
         check(false, "expected Uncertain");
      } catch (Uncertain expected) {
         // what this test wants
      } finally {
         release.countDown();
         drainEdt();
      }
   }

   static void testSlowTaskThatFinishesWithinTheGraceStillAnswers() throws Exception {
      String answer = Swing.onEdt(() -> {
         Thread.sleep(200);
         return "done";
      }, 100, 2000);
      check("done".equals(answer), answer);
   }

   private static void expectUncertain(String text, long elapsed, String why) {
      try {
         Tom.judge(text, "21113", elapsed, 0);
         check(false, "accepted or kept waiting although " + why);
      } catch (NotReady expected) {
         // uncertain, as it should be
      }
   }

   static void testOnlyAnEmptiedFieldOnAnOpenFormCountsAsAccepted() throws Exception {
      check(Tom.judge("", "21113", 900, 900), "TOM emptied the field and showed no Error");
      check(!Tom.judge("", "21113", 100, 100), "too early to rule out an Error dialog");
      check(!Tom.judge("", "21113", 900, 50), "TOM stalled, then only just emptied the field");
      check(!Tom.judge("21113", "21113", 500, 0), "TOM has not handled the code yet");
      expectUncertain(null, 900, "the slip form closed");
      expectUncertain("9", 900, "someone typed in the field");
      expectUncertain("21113", 3500, "TOM never handled the code");
   }

   private static void expectNotReady(Callable<?> call, String why) throws Exception {
      try {
         call.call();
         check(false, "went ahead although " + why);
      } catch (NotReady expected) {
         // refused, as it should be
      }
   }

   static void testOnlyTheExpectedTournamentAloneIsDriven() throws Exception {
      String title = "Tournament Operations Manager (1.86.0) - Tournament: Spring Cup";
      check(Pods.checkTitles(List.of(title), "Spring Cup") == 0, "the expected tournament was refused");
      check(Pods.checkTitles(List.of(title), null) == 0, "no expectation should take the open tournament");
      expectNotReady(() -> Pods.checkTitles(List.of(title), "Fall Cup"), "TOM has another event open");
      expectNotReady(() -> Pods.checkTitles(List.of(title, title), "Spring Cup"), "two tournaments are open");
      expectNotReady(() -> Pods.checkTitles(List.of(), null), "no tournament is open");
   }

   static void testASinglePodOfAnotherCategoryIsRefused() throws Exception {
      Pods.Pod juniors = new Pods.Pod(0, 0, 1, Pods.State.PAIRED);
      Pods.Pod unknown = new Pods.Pod(0, null, 1, Pods.State.PAIRED);
      check(Pods.pick(List.of(juniors), 0) == juniors, "the named pod was refused");
      check(Pods.pick(List.of(juniors), null) == juniors, "the only pod was refused");
      check(Pods.pick(List.of(unknown), 2) == unknown, "an unnamed only pod was refused");
      expectNotReady(() -> Pods.pick(List.of(juniors), 2), "the only pod is Juniors, not Masters");
   }

   static void testStartRoundRefusesAPodOnAnotherRound() throws Exception {
      Pods.Pod second = new Pods.Pod(0, 2, 2, Pods.State.PAIRED);
      check(Pods.onRound(second, 2) == second, "the pod's own round was refused");
      check(Pods.onRound(second, null) == second, "no round should take the pod's");
      expectNotReady(() -> Pods.onRound(second, 1), "the site started round 1 and TOM has round 2 paired");
   }

   /**
    * Masters alone, round 1, without flights: table 10 seats players 101 and
    * 102, table 7 players 5 and 8, with `outcome7` at table 7 (0 pending).
    */
   private static Live.Layout masters(int flightDigits, Integer flight, int round, int outcome7) {
      List<Live.Match> matches = List.of(
         new Live.Match(flight, 0, 99, null, 4),
         new Live.Match(flight, 7, 5, 8, outcome7),
         new Live.Match(flight, 10, 101, 102, 0));
      return new Live.Layout(1, 2, flightDigits, round, matches);
   }

   private static Live.Layout masters(int flightDigits, Integer flight, int round) {
      return masters(flightDigits, flight, round, 0);
   }

   private static void expectRefused(Live.Layout live, Live.Slip want, String code, String why) throws Exception {
      expectNotReady(() -> {
         Live.confirm(live, want, code);
         return null;
      }, why);
   }

   static void testACodeGoesInOnlyOnTheLiveMatchTheSiteMeans() throws Exception {
      check(!Live.confirm(masters(0, null, 1), new Live.Slip(2, null, 1, 10, 1, "101", "102"), "211014"), "table 10");
      check(!Live.confirm(masters(0, null, 1), new Live.Slip(2, null, 1, 7, 1, "5", "8"), "21717"), "table 7");
      check(!Live.confirm(masters(1, 1, 1), new Live.Slip(2, 1, 1, 10, 1, "101", "102"), "2111011"), "flight 1");
   }

   static void testAResultTomAlreadyHoldsIsNotEnteredAgain() throws Exception {
      Live.Slip p1Wins = new Live.Slip(2, null, 1, 7, 1, "5", "8");
      check(Live.confirm(masters(0, null, 1, 1), p1Wins, "21717"), "TOM already has player 1 winning at table 7");
   }

   static void testADifferentResultInTomIsNeverOverwritten() throws Exception {
      Live.Slip p1Wins = new Live.Slip(2, null, 1, 7, 1, "5", "8");
      expectRefused(masters(0, null, 1, 3), p1Wins, "21717", "a judge entered a tie at table 7 in TOM");
   }

   static void testAnEventOfTheSameNameWithOtherPlayersIsRefused() throws Exception {
      Live.Slip lastWeek = new Live.Slip(2, null, 1, 10, 1, "201", "202");
      expectRefused(masters(0, null, 1), lastWeek, "211014", "TOM's table 10 seats other players");
   }

   static void testARePairedTableIsRefused() throws Exception {
      expectRefused(masters(0, null, 1), new Live.Slip(2, null, 1, 7, 1, "5", "9"), "21717", "table 7 was re-paired");
      expectRefused(masters(0, null, 1), new Live.Slip(2, null, 1, 7, 1, "8", "5"), "21717", "the seats were swapped");
      expectRefused(masters(0, null, 2), new Live.Slip(2, null, 1, 7, 1, "5", "8"), "21717", "TOM is on round 2");
   }

   static void testACodeThatTomWouldReadAsTableZeroIsRefused() throws Exception {
      // 211014 is round 1 table 10 without flights; with a flight digit TOM
      // reads flight 1, round 1, table 0, where the bye sits.
      Live.Slip unflighted = new Live.Slip(2, null, 1, 10, 1, "101", "102");
      expectRefused(masters(1, 1, 1), unflighted, "211014", "TOM now reads a flight digit");
      check(Live.target(masters(1, 1, 1), "211014") == null, "TOM's reading landed on table 0");
   }

   private static final String TOKEN = "0123456789abcdef0123456789abcdef";

   /** A bridge server on an ephemeral port; returns that port. */
   private static int startServer(int requestTimeout) throws IOException {
      ServerSocket server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
      Thread thread = new Thread(() -> {
         try {
            Bridge.serve(server, TOKEN, new Tom(), requestTimeout);
         } catch (IOException e) {
            Bridge.log("test server stopped: " + e);
         }
      });
      thread.setDaemon(true);
      thread.start();
      return server.getLocalPort();
   }

   private static Socket connect(int port) throws IOException {
      Socket socket = new Socket(InetAddress.getLoopbackAddress(), port);
      socket.setSoTimeout(3000);
      return socket;
   }

   private static String answer(Socket socket) throws IOException {
      BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
      return in.readLine();
   }

   static void testAThirdClientIsTurnedAwayWhileTwoAreConnected() throws Exception {
      int port = startServer(2000);
      List<Socket> idle = new ArrayList<>();
      for (int i = 0; i < Bridge.MAX_SESSIONS; i++) {
         idle.add(connect(port));
      }
      Thread.sleep(200);
      try (Socket third = connect(port)) {
         String reply = answer(third);
         check("{\"error\":\"busy\"}".equals(reply), "third client got " + reply);
      }
      for (Socket socket : idle) {
         socket.close();
      }
   }

   static void testAClientThatSendsNothingIsDropped() throws Exception {
      int port = startServer(300);
      try (Socket silent = connect(port)) {
         long start = System.currentTimeMillis();
         check(answer(silent) == null, "the silent client was answered");
         check(System.currentTimeMillis() - start < 2000, "the silent client was held too long");
      }
   }

   static void testAClientThatTricklesItsRequestIsDropped() throws Exception {
      int port = startServer(300);
      try (Socket slow = connect(port)) {
         OutputStream out = slow.getOutputStream();
         for (int i = 0; i < 8; i++) {
            out.write('{');
            out.flush();
            Thread.sleep(100);
         }
         out.write('\n');
         out.flush();
         check(answer(slow) == null, "a request that took too long was still served");
      } catch (IOException dropped) {
         // the server hung up mid-request, which is also right
      }
   }

   static void testEachConnectionServesOneRequest() throws Exception {
      int port = startServer(2000);
      try (Socket socket = connect(port)) {
         String request = "{\"token\":\"" + TOKEN + "\",\"op\":\"nothing\"}\n";
         OutputStream out = socket.getOutputStream();
         out.write((request + request).getBytes(StandardCharsets.UTF_8));
         out.flush();
         BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
         check("{\"error\":\"unknown op\"}".equals(in.readLine()), "first request not answered");
         check(in.readLine() == null, "a second request on the same connection was served");
      }
   }

   static void testTheTokenIsReadOnceFromItsFile() throws Exception {
      Path dir = Files.createTempDirectory("tom-bridge-test");
      Files.writeString(dir.resolve("token"), TOKEN + "\n");
      check(TOKEN.equals(Bridge.takeToken(dir)), "wrong token read");
      check(!Files.exists(dir.resolve("token")), "the token file was left behind");
      Files.delete(dir);
   }
}
