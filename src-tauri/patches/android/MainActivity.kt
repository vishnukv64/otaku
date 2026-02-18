package com.otaku.player

import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var isInFullscreen = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // After Tauri creates its WebView, inject our JS bridge
    // decorView.post runs after the current layout pass, ensuring WebView exists
    window.decorView.post {
      findWebView(window.decorView as ViewGroup)?.let { webView ->
        webView.addJavascriptInterface(FullscreenBridge(), "OtakuBridge")
        // Allow loading HTTP resources (video server) from HTTPS origin
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
      }
    }
  }

  /**
   * Recursively find the WebView in the view hierarchy.
   * TauriActivity creates a WebView as part of its content view.
   */
  private fun findWebView(viewGroup: ViewGroup): WebView? {
    for (i in 0 until viewGroup.childCount) {
      val child = viewGroup.getChildAt(i)
      if (child is WebView) return child
      if (child is ViewGroup) {
        findWebView(child)?.let { return it }
      }
    }
    return null
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    // Re-apply immersive mode when window regains focus
    // (Android may restore system bars on focus change)
    if (hasFocus && isInFullscreen) {
      enterImmersiveMode()
    }
  }

  /**
   * JavaScript bridge exposed as `window.OtakuBridge` in the WebView.
   * Allows the frontend to trigger native immersive mode and orientation lock.
   */
  inner class FullscreenBridge {
    @JavascriptInterface
    fun enterFullscreen() {
      runOnUiThread {
        enterImmersiveMode()
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      }
    }

    @JavascriptInterface
    fun exitFullscreen() {
      runOnUiThread {
        exitImmersiveMode()
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
    }
  }

  private fun enterImmersiveMode() {
    isInFullscreen = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // API 30+: Use WindowInsetsController
      val controller = window.insetsController ?: return
      controller.hide(WindowInsets.Type.systemBars())
      controller.systemBarsBehavior =
        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    } else {
      // Legacy: Use system UI flags
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = (
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          or View.SYSTEM_UI_FLAG_FULLSCREEN
          or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
          or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
          or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
          or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
      )
    }
  }

  private fun exitImmersiveMode() {
    isInFullscreen = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val controller = window.insetsController ?: return
      controller.show(WindowInsets.Type.systemBars())
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
    }
  }
}
