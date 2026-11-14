package com.ciphermaniac.tombridge;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Just enough JSON for the bridge: flat string-valued requests in, small objects out. */
final class Json {
   private Json() {
   }

   /** Parses an object whose values are all strings. Throws IllegalArgumentException otherwise. */
   static Map<String, String> parseFlat(String text) {
      Reader reader = new Reader(text);
      Map<String, String> out = new HashMap<>();
      reader.expect('{');
      if (!reader.consume('}')) {
         do {
            String key = reader.string();
            reader.expect(':');
            out.put(key, reader.string());
         } while (reader.consume(','));
         reader.expect('}');
      }
      reader.end();
      return out;
   }

   static String quote(String value) {
      StringBuilder out = new StringBuilder(value.length() + 2).append('"');
      for (char c : value.toCharArray()) {
         appendEscaped(out, c);
      }
      return out.append('"').toString();
   }

   private static void appendEscaped(StringBuilder out, char c) {
      switch (c) {
         case '"' -> out.append("\\\"");
         case '\\' -> out.append("\\\\");
         case '\n' -> out.append("\\n");
         case '\r' -> out.append("\\r");
         case '\t' -> out.append("\\t");
         default -> {
            if (c < 0x20) {
               out.append(String.format("\\u%04x", (int) c));
            } else {
               out.append(c);
            }
         }
      }
   }

   /** Builds one JSON object, fields in insertion order. */
   static final class Obj {
      private final StringBuilder body = new StringBuilder();

      Obj str(String key, String value) {
         return raw(key, quote(value));
      }

      Obj bool(String key, boolean value) {
         return raw(key, String.valueOf(value));
      }

      Obj num(String key, int value) {
         return raw(key, String.valueOf(value));
      }

      Obj strs(String key, List<String> values) {
         StringBuilder list = new StringBuilder("[");
         for (String value : values) {
            if (list.length() > 1) {
               list.append(',');
            }
            list.append(quote(value));
         }
         return raw(key, list.append(']').toString());
      }

      private Obj raw(String key, String json) {
         if (body.length() > 0) {
            body.append(',');
         }
         body.append(quote(key)).append(':').append(json);
         return this;
      }

      @Override
      public String toString() {
         return "{" + body + "}";
      }
   }

   private static final class Reader {
      private final String text;
      private int pos;

      Reader(String text) {
         this.text = text;
      }

      void expect(char c) {
         if (!consume(c)) {
            throw new IllegalArgumentException("expected " + c + " at " + pos);
         }
      }

      boolean consume(char c) {
         skipSpace();
         if (pos < text.length() && text.charAt(pos) == c) {
            pos++;
            return true;
         }
         return false;
      }

      void end() {
         skipSpace();
         if (pos != text.length()) {
            throw new IllegalArgumentException("trailing data at " + pos);
         }
      }

      String string() {
         expect('"');
         StringBuilder out = new StringBuilder();
         for (char c = next(); c != '"'; c = next()) {
            out.append(c == '\\' ? escape() : c);
         }
         return out.toString();
      }

      private char escape() {
         char c = next();
         return switch (c) {
            case '"', '\\', '/' -> c;
            case 'b' -> '\b';
            case 'f' -> '\f';
            case 'n' -> '\n';
            case 'r' -> '\r';
            case 't' -> '\t';
            case 'u' -> unicode();
            default -> throw new IllegalArgumentException("bad escape at " + pos);
         };
      }

      private char unicode() {
         if (pos + 4 > text.length()) {
            throw new IllegalArgumentException("short unicode escape");
         }
         char c = (char) Integer.parseInt(text.substring(pos, pos + 4), 16);
         pos += 4;
         return c;
      }

      private char next() {
         if (pos >= text.length()) {
            throw new IllegalArgumentException("unterminated string");
         }
         return text.charAt(pos++);
      }

      private void skipSpace() {
         while (pos < text.length() && Character.isWhitespace(text.charAt(pos))) {
            pos++;
         }
      }
   }
}
