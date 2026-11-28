import type * as NodeHttp from "node:http"

/**
 * Node surfaces late socket write failures (EPIPE, ECONNRESET,
 * ERR_STREAM_DESTROYED) as `"error"` events on response streams and upgraded
 * sockets. Without a listener, Node escalates the event into an uncaught
 * exception that terminates the server process.
 */
export function guardHttpResponseWriteErrors<T extends NodeHttp.Server>(
  server: T,
  onError?: (error: unknown) => void
): T {
  server.on("request", (_request, response) => {
    response.on("error", (error) => {
      onError?.(error)
    })
  })
  server.on("upgrade", (_request, socket) => {
    socket.on("error", (error) => {
      onError?.(error)
    })
  })
  return server
}
