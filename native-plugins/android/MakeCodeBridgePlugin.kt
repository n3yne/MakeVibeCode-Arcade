package com.pghnetworks.makevibecodearcade.plugins

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(name = "MakeCodeBridge")
class MakeCodeBridgePlugin : Plugin() {

    private var webView: WebView? = null
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()

    // MARK: - show

    @PluginMethod
    @SuppressLint("SetJavaScriptEnabled")
    fun show(call: PluginCall) {
        val url = call.getString("url") ?: "https://arcade.makecode.com"

        activity.runOnUiThread {
            if (webView != null) {
                webView!!.loadUrl(url)
                call.resolve()
                return@runOnUiThread
            }

            val wv = WebView(context).apply {
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowContentAccess = true
                    allowFileAccess = true
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    mediaPlaybackRequiresUserGesture = false
                    useWideViewPort = true
                    loadWithOverviewMode = true
                }
                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient()
                addJavascriptInterface(BridgeInterface(), "MakeCodeAndroidBridge")
            }

            // Insert behind the Capacitor WebView, full-width with room for the tab bar
            val rootView = bridge.webView.parent as? ViewGroup ?: run {
                call.reject("Cannot find root layout")
                return@runOnUiThread
            }

            val displayMetrics = context.resources.displayMetrics
            val screenHeight = displayMetrics.heightPixels
            val tabBarDp = 56
            val tabBarPx = (tabBarDp * displayMetrics.density).toInt()
            val params = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                screenHeight - tabBarPx
            )
            rootView.addView(wv, 0, params)
            webView = wv
            wv.loadUrl(url)
            call.resolve()
        }
    }

    // MARK: - hide

    @PluginMethod
    fun hide(call: PluginCall) {
        activity.runOnUiThread {
            webView?.let { wv ->
                (wv.parent as? ViewGroup)?.removeView(wv)
                webView = null
            }
            call.resolve()
        }
    }

    // MARK: - executeScript

    @PluginMethod
    fun executeScript(call: PluginCall) {
        val script = call.getString("script") ?: run {
            call.reject("Missing 'script' parameter")
            return
        }
        val wv = webView ?: run {
            call.reject("WebView not initialised — call show() first")
            return
        }

        val callId = UUID.randomUUID().toString()
        pendingCalls[callId] = call

        val escaped = script.replace("\\", "\\\\").replace("`", "\\`")
        val wrapped = """
            (async function() {
              try {
                const _result = await (async function() {
                  $script
                })();
                window.MakeCodeAndroidBridge.postResult(
                  "$callId",
                  JSON.stringify(_result ?? null),
                  null
                );
              } catch (e) {
                window.MakeCodeAndroidBridge.postResult(
                  "$callId",
                  null,
                  String(e.message || e)
                );
              }
            })();
        """.trimIndent()

        activity.runOnUiThread {
            wv.evaluateJavascript(wrapped, null)
        }
    }

    // MARK: - JavascriptInterface for result callbacks

    inner class BridgeInterface {
        @JavascriptInterface
        fun postResult(callId: String, value: String?, error: String?) {
            val call = pendingCalls.remove(callId) ?: return
            if (error != null) {
                call.reject(error)
            } else {
                val result = JSObject()
                result.put("result", value ?: "null")
                call.resolve(result)
            }
        }
    }
}
