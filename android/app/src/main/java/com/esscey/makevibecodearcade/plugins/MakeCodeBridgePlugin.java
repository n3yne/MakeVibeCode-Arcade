package com.esscey.makevibecodearcade.plugins;

import android.annotation.SuppressLint;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "MakeCodeBridge")
public class MakeCodeBridgePlugin extends Plugin {

    private WebView webView;
    private final ConcurrentHashMap<String, PluginCall> pendingCalls = new ConcurrentHashMap<>();

    // ── show ─────────────────────────────────────────────────────────────────

    @PluginMethod
    @SuppressLint("SetJavaScriptEnabled")
    public void show(PluginCall call) {
        String url = call.getString("url", "https://arcade.makecode.com");

        getActivity().runOnUiThread(() -> {
            if (webView != null) {
                webView.loadUrl(url);
                call.resolve();
                return;
            }

            WebView wv = new WebView(getContext());
            WebSettings settings = wv.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccess(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);

            wv.setWebViewClient(new WebViewClient());
            wv.setWebChromeClient(new WebChromeClient());
            wv.addJavascriptInterface(new BridgeInterface(), "MakeCodeAndroidBridge");

            // Insert behind the Capacitor WebView
            ViewGroup rootView = (ViewGroup) getBridge().getWebView().getParent();
            if (rootView == null) {
                call.reject("Cannot find root layout");
                return;
            }

            float density = getContext().getResources().getDisplayMetrics().density;
            int screenHeight = getContext().getResources().getDisplayMetrics().heightPixels;
            int tabBarPx = (int) (56 * density);

            ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                screenHeight - tabBarPx
            );
            rootView.addView(wv, 0, params);
            webView = wv;
            wv.loadUrl(url);
            call.resolve();
        });
    }

    // ── hide ─────────────────────────────────────────────────────────────────

    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (webView != null) {
                ViewGroup parent = (ViewGroup) webView.getParent();
                if (parent != null) parent.removeView(webView);
                webView = null;
            }
            call.resolve();
        });
    }

    // ── executeScript ─────────────────────────────────────────────────────────

    @PluginMethod
    public void executeScript(PluginCall call) {
        String script = call.getString("script");
        if (script == null) {
            call.reject("Missing 'script' parameter");
            return;
        }
        if (webView == null) {
            call.reject("WebView not initialised — call show() first");
            return;
        }

        String callId = UUID.randomUUID().toString();
        pendingCalls.put(callId, call);

        String wrapped =
            "(async function() {\n" +
            "  try {\n" +
            "    const _result = await (async function() {\n" +
            script + "\n" +
            "    })();\n" +
            "    window.MakeCodeAndroidBridge.postResult('" + callId + "', JSON.stringify(_result != null ? _result : null), null);\n" +
            "  } catch (e) {\n" +
            "    window.MakeCodeAndroidBridge.postResult('" + callId + "', null, String(e.message || e));\n" +
            "  }\n" +
            "})();";

        getActivity().runOnUiThread(() -> webView.evaluateJavascript(wrapped, null));
    }

    // ── JavascriptInterface ───────────────────────────────────────────────────

    public class BridgeInterface {
        @JavascriptInterface
        public void postResult(String callId, String value, String error) {
            PluginCall call = pendingCalls.remove(callId);
            if (call == null) return;
            if (error != null) {
                call.reject(error);
            } else {
                JSObject result = new JSObject();
                result.put("result", value != null ? value : "null");
                call.resolve(result);
            }
        }
    }
}
