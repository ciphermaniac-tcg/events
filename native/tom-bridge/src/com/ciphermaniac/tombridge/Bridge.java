package com.ciphermaniac.tombridge;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Serves the line-delimited JSON protocol on an ephemeral loopback port. The
 * desktop app passes a token and a handshake file path as system properties;
 * the port is written to that file once the socket is listening.
 */
final class Bridge {
   static final String TOKEN_PROPERTY = "cmevents.tombridge.token";
   static final String HANDSHAKE_PROPERTY = "cmevents.tombridge.handshake";
   private static final int MIN_TOKEN_LENGTH = 32;

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
      String token = System.getProperty(TOKEN_PROPERTY, "");
      String handshake = System.getProperty(HANDSHAKE_PROPERTY, "");
      if (token.length() < MIN_TOKEN_LENGTH || handshake.isEmpty()) {
         log("not started: token or handshake path missing");
         return;
      }
      Tom tom = new Tom();
      try (ServerSocket server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress())) {
         writeHandshake(Path.of(handshake), server.getLocalPort());
         log("listening");
         while (true) {
            Socket socket = server.accept();
            Thread thread = new Thread(new Session(socket, token, tom), BridgeProvider.NAME + "-session");
            thread.setDaemon(true);
            thread.start();
         }
      }
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
