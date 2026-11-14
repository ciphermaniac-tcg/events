package com.ciphermaniac.tombridge;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
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
}
