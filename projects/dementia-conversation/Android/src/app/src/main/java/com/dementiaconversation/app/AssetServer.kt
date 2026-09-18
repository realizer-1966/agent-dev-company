package com.dementiaconversation.app

import android.content.Context
import java.io.BufferedOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * APK assets 를 http://127.0.0.1:<port>/ 로 서빙하는 초소형 HTTP 서버.
 *
 * ## 왜 필요한가
 * WebView 에 assets 를 file:// 로 로드하면 페이지 origin 이 file://(=null) 이 되어
 *  1) 교차 출처 fetch 가 차단된다  -> "서버에 연결할 수 없다"
 *  2) getUserMedia 의 secure context 요건이 불안정하다 (마이크 불가)
 *
 * 127.0.0.1 은 브라우저가 "신뢰 가능한 출처(potentially trustworthy)" 로 취급하므로
 * 마이크가 확실히 허용되고, 서버 API(http://127.0.0.1:8912) 호출은 CORS 로 처리된다.
 * (서버는 --cors-origins "*" 로 띄운다)
 *
 * 의존성 없는 최소 구현 — GET 만 처리하면 충분하다.
 */
class AssetServer(
  private val context: Context,
  private val port: Int = DEFAULT_PORT
) {

  companion object {
    const val DEFAULT_PORT = 8765
  }

  @Volatile
  private var running = false
  private var server: ServerSocket? = null

  /**
   * 127.0.0.1 에만 바인딩한다 (외부 노출 금지).
   *
   * ServerSocket 을 **동기적으로** 만든다. 스레드 안에서 만들면 start() 가
   * 반환된 직후의 loadUrl() 이 리스닝 전에 실행되어 연결이 거부된다
   * (WebView 에 "서버에 연결할 수 없음" 으로 나타나는 경쟁 조건).
   */
  @Throws(Exception::class)
  fun start() {
    if (running) return
    val ss = ServerSocket(port, 8, InetAddress.getByName("127.0.0.1"))
    server = ss
    running = true
    // accept 루프만 백그라운드로 돌린다 (리스닝은 이미 확립됨)
    thread(isDaemon = true, name = "asset-server") {
      while (running) {
        val sock = try {
          ss.accept()
        } catch (_: Exception) {
          break
        }
        thread(isDaemon = true) { serve(sock) }
      }
    }
  }

  fun stop() {
    running = false
    try {
      server?.close()
    } catch (_: Exception) {
    }
    server = null
  }

  // ── 요청 처리 ─────────────────────────────────────────────
  private fun serve(sock: Socket) {
    try {
      sock.use { s ->
        val input = s.getInputStream()
        val head = readHead(input) ?: return
        val path = parsePath(head)
        val (body, mime, code) = loadAsset(path)
        writeResponse(BufferedOutputStream(s.getOutputStream()), code, mime, body)
      }
    } catch (_: Exception) {
      // 연결이 끊긴 경우 등 — 무시
    }
  }

  /** 헤더가 끝날 때까지(

) 읽는다. 최대 8KB. */
  private fun readHead(input: InputStream): String? {
    val buf = StringBuilder()
    var b: Int
    while (buf.length < 8192) {
      b = input.read()
      if (b == -1) break
      buf.append(b.toChar())
      if (buf.endsWith("\r\n\r\n") || buf.endsWith("\n\n")) break
    }
    return if (buf.isEmpty()) null else buf.toString()
  }

  /** "GET /index.html HTTP/1.1" 에서 경로만 뽑고 쿼리스트링을 제거한다. */
  private fun parsePath(head: String): String {
    val line = head.lineSequence().firstOrNull() ?: return "/"
    val parts = line.split(" ")
    var raw = if (parts.size >= 2) parts[1] else "/"
    if (raw.startsWith("/")) raw = raw.substring(1)
    val q = raw.indexOf("?")
    if (q >= 0) raw = raw.substring(0, q)
    if (raw.isEmpty()) raw = "index.html"
    return raw
  }

  /** assets 에서 파일을 읽는다. 없으면 index.html 로 폴백(SPA 라우팅). */
  private fun loadAsset(path: String): Triple<ByteArray, String, Int> {
    var name = path
    var bytes = readAsset(name)
    if (bytes == null) {
      name = "index.html"
      bytes = readAsset(name)
    }
    if (bytes == null) {
      return Triple("not found".toByteArray(), "text/plain", 404)
    }
    return Triple(bytes, mimeOf(name), 200)
  }

  private fun readAsset(name: String): ByteArray? = try {
    context.assets.open(name).use { it.readBytes() }
  } catch (_: Exception) {
    null
  }

  private fun mimeOf(name: String): String = when {
    name.endsWith(".html") -> "text/html; charset=utf-8"
    name.endsWith(".js") -> "application/javascript; charset=utf-8"
    name.endsWith(".json") -> "application/json; charset=utf-8"
    name.endsWith(".png") -> "image/png"
    name.endsWith(".css") -> "text/css; charset=utf-8"
    name.endsWith(".wav") -> "audio/wav"
    else -> "application/octet-stream"
  }

  private fun writeResponse(
    out: BufferedOutputStream,
    code: Int,
    mime: String,
    body: ByteArray
  ) {
    val status = if (code == 200) "200 OK" else "$code Not Found"
    val header = StringBuilder()
      .append("HTTP/1.1 ").append(status).append("\r\n")
      .append("Content-Type: ").append(mime).append("\r\n")
      .append("Content-Length: ").append(body.size).append("\r\n")
      .append("Cache-Control: no-store\r\n")
      .append("Connection: close\r\n")
      .append("\r\n")
      .toString()
    out.write(header.toByteArray())
    out.write(body)
    out.flush()
  }
}
