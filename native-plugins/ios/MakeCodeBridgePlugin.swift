import Foundation
import Capacitor
import WebKit

@objc(MakeCodeBridgePlugin)
public class MakeCodeBridgePlugin: CAPPlugin, WKNavigationDelegate, WKScriptMessageHandler {

    private var arcadeWebView: WKWebView?
    private var pendingScripts: [String: CAPPluginCall] = [:]
    private let lock = NSLock()

    // MARK: - show

    @objc func show(_ call: CAPPluginCall) {
        let urlString = call.getString("url") ?? "https://arcade.makecode.com"
        guard let url = URL(string: urlString) else {
            call.reject("Invalid URL: \(urlString)")
            return
        }

        DispatchQueue.main.async {
            if self.arcadeWebView != nil {
                // Already showing — just navigate if URL changed
                self.arcadeWebView?.load(URLRequest(url: url))
                call.resolve()
                return
            }

            let config = WKWebViewConfiguration()
            config.allowsInlineMediaPlayback = true
            config.mediaTypesRequiringUserActionForPlayback = []

            // Message handler for script return values
            config.userContentController.add(self, name: "makecodebridge")

            let wv = WKWebView(frame: .zero, configuration: config)
            wv.navigationDelegate = self
            wv.scrollView.bounces = false
            wv.isOpaque = false
            wv.backgroundColor = .clear
            if #available(iOS 15.0, *) {
                wv.underPageBackgroundColor = .clear
            }

            // Insert into the WINDOW, not viewController.view — Capacitor's
            // CAPBridgeViewController sets `view = webView` in loadView()
            // (see node_modules/@capacitor/ios/.../CAPBridgeViewController.swift),
            // so viewController.view IS the bridge's own WKWebView, not a
            // separate container. Inserting a subview into a WKWebView puts it
            // inside WebKit's own content hierarchy with no defined stacking
            // relative to the page WebKit is rendering, which is why the CSS
            // transparency trick alone could never reveal it. The window is a
            // real, distinct parent that the bridge webview sits inside as a
            // sibling, so inserting behind it there actually works.
            guard let window = self.bridge?.viewController?.view.window else {
                call.reject("No window")
                return
            }
            let safeTop = window.safeAreaInsets.top
            let frame = CGRect(
                x: 0,
                y: safeTop,
                width: window.bounds.width,
                height: window.bounds.height - safeTop - 56 // 56 = tab bar height
            )
            wv.frame = frame
            wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]

            window.insertSubview(wv, at: 0)
            self.arcadeWebView = wv
            wv.load(URLRequest(url: url))
            call.resolve()
        }
    }

    // MARK: - hide

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.arcadeWebView?.removeFromSuperview()
            self.arcadeWebView = nil
            call.resolve()
        }
    }

    // MARK: - executeScript

    @objc func executeScript(_ call: CAPPluginCall) {
        guard let script = call.getString("script") else {
            call.reject("Missing 'script' parameter")
            return
        }
        guard let wv = arcadeWebView else {
            call.reject("WebView not initialised — call show() first")
            return
        }

        let callId = UUID().uuidString
        lock.lock()
        pendingScripts[callId] = call
        lock.unlock()

        // Wrap the script so the return value is posted back via the message handler
        let wrapped = """
        (async function() {
          try {
            const _result = await (async function() {
              \(script)
            })();
            window.webkit.messageHandlers.makecodebridge.postMessage(
              JSON.stringify({ id: "\(callId)", value: JSON.stringify(_result ?? null) })
            );
          } catch (e) {
            window.webkit.messageHandlers.makecodebridge.postMessage(
              JSON.stringify({ id: "\(callId)", error: String(e.message || e) })
            );
          }
        })();
        """

        DispatchQueue.main.async {
            wv.evaluateJavaScript(wrapped) { _, err in
                if let err = err {
                    self.lock.lock()
                    self.pendingScripts.removeValue(forKey: callId)
                    self.lock.unlock()
                    call.reject("evaluateJavaScript failed: \(err.localizedDescription)")
                }
            }
        }
    }

    // MARK: - WKScriptMessageHandler

    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "makecodebridge",
              let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let callId = json["id"] as? String else { return }

        lock.lock()
        let call = pendingScripts.removeValue(forKey: callId)
        lock.unlock()

        guard let call = call else { return }

        if let error = json["error"] as? String {
            call.reject(error)
        } else {
            let value = json["value"] as? String ?? "null"
            call.resolve(["result": value])
        }
    }

    // MARK: - WKNavigationDelegate (optional — for future page-load events)

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        notifyListeners("pageLoaded", data: ["url": webView.url?.absoluteString ?? ""])
    }
}
