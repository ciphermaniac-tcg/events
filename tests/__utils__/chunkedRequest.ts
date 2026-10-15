/** A chunked body: no Content-Length, and `pulled` counts the chunks actually read. */
export function chunkedRequest(
  url: string,
  method: string,
  chunks: Uint8Array[]
): { request: Request; pulled: () => number } {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    }
  });
  const request = new Request(url, { method, body: stream, duplex: 'half' } as RequestInit);
  return { request, pulled: () => index };
}
