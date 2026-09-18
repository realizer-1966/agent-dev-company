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
 * 마음이 — 치매 대화 도우미.
 *
 * 번들된 WebUI(assets/index.html)를 WebView 로 띄우고,
 * 마이크(getUserMedia) 권한을 앱 권한과 연결해 준다.
 * 음성 추론은 전부 사용자가 지정한 로컬 서버에서 수행된다.
 */
class MainActivity : Activity() {

  private lateinit var web: WebView
  private var pending: PermissionRequest? = null

  private val reqCode = 1001

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)

    web = WebView(this)
    setContentView(web)

    val s = web.settings
    s.javaScriptEnabled = true
    s.domStorageEnabled = true        // localStorage (서버 주소 저장)
    s.databaseEnabled = true
    s.mediaPlaybackRequiresUserGesture = false   // 합성 음성 자동 재생
    s.allowFileAccess = true
    s.cacheMode = WebSettings.LOAD_DEFAULT

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

    web.loadUrl("file:///android_asset/index.html")
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
    web.destroy()
    super.onDestroy()
  }
}
