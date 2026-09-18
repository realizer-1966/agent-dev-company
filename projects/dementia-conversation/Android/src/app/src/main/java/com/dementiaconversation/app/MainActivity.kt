package com.dementiaconversation.app

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * 마음이 - 치매 대화 도우미.
 *
 * 번들된 WebUI 를 WebView 로 띄우고, 마이크(getUserMedia) 권한을 앱 권한과 연결한다.
 * 음성 추론은 전부 사용자가 지정한 로컬 서버에서 수행된다.
 *
 * ## file:// 대신 내장 HTTP 서버를 쓰는 이유
 * assets 를 file:// 로 열면 페이지 origin 이 null 이 되어
 *  1) 교차 출처 fetch 가 차단된다      -> "서버에 연결할 수 없다"
 *  2) getUserMedia 의 secure context 요건이 불안정하다 (마이크 불가)
 * 127.0.0.1 은 potentially-trustworthy 로 취급되므로 두 문제가 모두 사라진다.
 */
class MainActivity : Activity() {

  private lateinit var web: WebView
  private var assets: AssetServer? = null
  private var pending: PermissionRequest? = null

  private val reqCode = 1001

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)

    // 1) assets 를 http://127.0.0.1:<port>/ 로 서빙
    //    start() 는 동기적으로 리스닝을 확립한다 (아래 loadUrl 이 바로 이어진다).
    val server = AssetServer(this)
    try {
      server.start()
      assets = server
    } catch (e: Exception) {
      // 포트 충돌 등으로 실패하면 사용자에게 원인을 보여준다.
      // 조용히 file:// 로 폴백하면 "서버에 연결할 수 없음" 으로만 보여 진단이 어렵다.
      Toast.makeText(
        this,
        "내부 서버 시작 실패: " + e.message,
        Toast.LENGTH_LONG
      ).show()
    }

    // 2) WebView 준비
    web = WebView(this)
    setContentView(web)

    val s = web.settings
    s.javaScriptEnabled = true
    s.domStorageEnabled = true                   // localStorage (서버 주소 저장)
    s.databaseEnabled = true
    s.mediaPlaybackRequiresUserGesture = false   // 합성 음성 자동 재생
    s.cacheMode = WebSettings.LOAD_DEFAULT
    // file:// 접근은 더 이상 필요하지 않다 (내장 서버가 대신 서빙)
    s.allowFileAccess = false

    web.webViewClient = WebViewClient()

    // getUserMedia(RECORD_AUDIO) 요청을 앱 권한으로 중계
    web.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        val ok = checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED
        if (ok) {
          request.grant(request.resources)
        } else {
          pending = request
          @Suppress("DEPRECATION")
          requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), reqCode)
        }
      }
    }

    web.loadUrl("http://127.0.0.1:" + AssetServer.DEFAULT_PORT + "/index.html")
  }

  @Deprecated("Deprecated in Java")
  override fun onRequestPermissionsResult(
    code: Int,
    perms: Array<out String>,
    result: IntArray
  ) {
    super.onRequestPermissionsResult(code, perms, result)
    if (code != reqCode) return
    val p = pending
    pending = null
    if (result.isNotEmpty() && result[0] == PackageManager.PERMISSION_GRANTED) {
      p?.grant(p.resources)
    } else {
      p?.deny()
      Toast.makeText(this, "마이크 권한이 필요합니다", Toast.LENGTH_LONG).show()
    }
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    if (web.canGoBack()) web.goBack() else {
      @Suppress("DEPRECATION")
      super.onBackPressed()
    }
  }

  override fun onDestroy() {
    assets?.stop()
    web.destroy()
    super.onDestroy()
  }
}
