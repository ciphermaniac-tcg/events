package com.ciphermaniac.tombridge;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.Semaphore;

/**
 * Serves the line-delimited JSON protocol on an ephemeral loopback port. The
 * desktop app names a private folder as a system property; the request token
 * waits in its "token" file (never on the command line, which the JVM echoes),
 * and the port is written to its "handshake.json" once the socket is listening.
 */
final class Bridge {
   static final String DIR_PROPERTY = "cmevents.tombridge.dir";
   private static final int MIN_TOKEN_LENGTH = 32;
   static final int MAX_SESSIONS = 2;
   private static final int REQUEST_TIMEOUT_MS = 5000;

   private Bridge() {
   }

   static void runSafely() {
      try {
         run();
      } catch (Throwable t) {
         log("stopped: " + t);
      }
   }

   private static void run() throws IOException {
      String dir = System.getProperty(DIR_PROPERTY, "");
      String token = dir.isEmpty() ? "" : takeToken(Path.of(dir));
      if (token.length() < MIN_TOKEN_LENGTH) {
         log("not started: no token");
         return;
      }
      try (ServerSocket server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress())) {
         writeHandshake(Path.of(dir, "handshake.json"), server.getLocalPort());
         log("listening");
         serve(server, token, new Tom(), REQUEST_TIMEOUT_MS);
      }
   }

   /**
    * One request per connection, at most {@value #MAX_SESSIONS} at a time; a
    * client that has not sent its whole request within `requestTimeout`
    * milliseconds is dropped, so nothing can hold a session open.
    */
   static void serve(ServerSocket server, String token, Tom tom, int requestTimeout) throws IOException {
      Semaphore sessions = new Semaphore(MAX_SESSIONS);
      while (true) {
         Socket socket = server.accept();
         if (!sessions.tryAcquire()) {
            turnAway(socket);
            continue;
         }
         socket.setSoTimeout(requestTimeout);
         Thread thread = new Thread(() -> {
            try {
               new Session(socket, token, tom, requestTimeout).run();
            } finally {
               sessions.release();
            }
         }, BridgeProvider.NAME + "-session");
         thread.setDaemon(true);
         thread.start();
      }
   }

   private static void turnAway(Socket socket) {
      try (socket) {
         String busy = new Json.Obj().str("error", "busy").toString() + "\n";
         socket.getOutputStream().write(busy.getBytes(StandardCharsets.UTF_8));
      } catch (IOException e) {
         log("could not turn a client away: " + e);
      }
   }

   /** Reads the token and deletes its file, so it is on disk only until TOM starts. */
   static String takeToken(Path dir) throws IOException {
      Path file = dir.resolve("token");
      String token = Files.readString(file, StandardCharsets.UTF_8).strip();
      Files.delete(file);
      return token;
   }

   private static void writeHandshake(Path file, int port) throws IOException {
      Path partial = file.resolveSibling(file.getFileName() + ".partial");
      Files.writeString(partial, new Json.Obj().num("port", port).toString(), StandardCharsets.UTF_8);
      Files.move(partial, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
   }

   static void log(String message) {
      System.err.println("tom-bridge: " + message);
   }
}
