package com.ciphermaniac.tombridge;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.io.Writer;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

/** One client connection: authenticated requests, one JSON object per line. */
final class Session implements Runnable {
   private static final int MAX_LINE = 4096;

   private final Socket socket;
   private final byte[] token;
   private final Tom tom;

   Session(Socket socket, String token, Tom tom) {
      this.socket = socket;
      this.token = token.getBytes(StandardCharsets.UTF_8);
      this.tom = tom;
   }

   @Override
   public void run() {
      try (socket;
           Reader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
           Writer out = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8)) {
         serve(in, out);
      } catch (IOException | RuntimeException e) {
         Bridge.log("session ended: " + e);
      }
   }

   private void serve(Reader in, Writer out) throws IOException {
      for (String line = readLine(in); line != null; line = readLine(in)) {
         Map<String, String> request = parse(line);
         if (request == null || !authorized(request.get("token"))) {
            reply(out, new Json.Obj().str("error", request == null ? "bad request" : "unauthorized").toString());
            return;
         }
         reply(out, handle(request));
      }
   }

   private static Map<String, String> parse(String line) {
      try {
         return Json.parseFlat(line);
      } catch (IllegalArgumentException e) {
         return null;
      }
   }

   private boolean authorized(String given) {
      return given != null && MessageDigest.isEqual(token, given.getBytes(StandardCharsets.UTF_8));
   }

   private String handle(Map<String, String> request) {
      String op = request.getOrDefault("op", "");
      return switch (op) {
         case "status" -> tom.status();
         case "submit" -> submit(request);
         case "save" -> tom.save();
         case "start_round" -> startRound(request);
         default -> new Json.Obj().str("error", "unknown op").toString();
      };
   }

   private String submit(Map<String, String> request) {
      try {
         return tom.submit(request.getOrDefault("code", ""), number(request, "pod"), number(request, "round"));
      } catch (NumberFormatException e) {
         return new Json.Obj().str("error", "invalid pod or round").toString();
      }
   }

   private String startRound(Map<String, String> request) {
      try {
         return tom.startRound(number(request, "category"));
      } catch (NumberFormatException e) {
         return new Json.Obj().str("error", "invalid category").toString();
      }
   }

   /** An optional whole-number field, sent as a string. */
   private static Integer number(Map<String, String> request, String key) {
      String value = request.get(key);
      return value == null || value.isEmpty() ? null : Integer.valueOf(value);
   }

   private static void reply(Writer out, String json) throws IOException {
      out.write(json);
      out.write('\n');
      out.flush();
   }

   /** Reads one line without its terminator; null at end of stream. */
   static String readLine(Reader in) throws IOException {
      StringBuilder line = new StringBuilder();
      for (int c = in.read(); c != '\n'; c = in.read()) {
         if (c < 0) {
            return line.length() == 0 ? null : line.toString();
         }
         if (line.length() >= MAX_LINE) {
            throw new IOException("request line too long");
         }
         line.append((char) c);
      }
      return line.toString().strip();
   }
}
