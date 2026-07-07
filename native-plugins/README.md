# MakeCodeBridge — Native Plugin

Custom Capacitor plugin that manages a native WKWebView (iOS) / WebView (Android) overlay
loading arcade.makecode.com and provides async JS execution with return values.

## Why a custom plugin?

Capacitor's Webview IS your app. To embed a second website (arcade.makecode.com) with the
ability to inject JavaScript and get return values back, you need a native WebView overlay.
This plugin provides that bridge, replicating Electron's `webview.executeJavaScript()`.

## iOS installation

After running `npx cap add ios`:

1. Copy `ios/MakeCodeBridgePlugin.swift` and `ios/MakeCodeBridgePlugin.m` into:
   `ios/App/App/Plugins/MakeCodeBridge/`

2. In Xcode, add both files to the `App` target (drag into the Project Navigator).

3. In `ios/App/App/AppDelegate.swift`, register the plugin:
   ```swift
   // In application(_:didFinishLaunchingWithOptions:)
   // No extra registration needed — CAP_PLUGIN macro in .m file handles it
   ```
   The `CAP_PLUGIN` macro in the `.m` file automatically registers the plugin.

4. Build and run on a simulator or device.

## Android installation

The Java plugin (`MakeCodeBridgePlugin.java`) is already placed in
`android/app/src/main/java/com/pghnetworks/makevibecodearcade/plugins/`
and `MainActivity.java` is already updated to register it.

If you regenerate the Android platform (`npx cap add android` on a clean tree):

1. Re-copy the Java plugin file into the plugins/ directory.

2. Re-add the `registerPlugin` call to `MainActivity.java`:
   ```java
   import com.pghnetworks.makevibecodearcade.plugins.MakeCodeBridgePlugin;

   public class MainActivity extends BridgeActivity {
       @Override
       public void onCreate(Bundle savedInstanceState) {
           registerPlugin(MakeCodeBridgePlugin.class);
           super.onCreate(savedInstanceState);
       }
   }
   ```

3. Add internet permission to `AndroidManifest.xml` if not already present:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   ```

4. Build and run on an emulator or device.

## Plugin API

```typescript
MakeCodeBridge.show({ url: 'https://arcade.makecode.com' })
  // Shows the native WebView overlay loading the given URL

MakeCodeBridge.hide()
  // Removes the native WebView from the screen

MakeCodeBridge.executeScript({ script: '...' })
  // Injects JS into the native WebView and awaits the return value
  // Returns: { result: string }  — JSON-stringified return value
```

## Layout

On iOS, the native WebView is inserted below the status bar and above a 56pt tab bar.
On Android, it fills the screen minus the 56dp tab bar.

Both platforms insert the WebView at z-index 0 (behind the Capacitor WebView), then
`platform.js` shows/hides the Capacitor WebView layer via the Editor/AI Chat tab buttons,
giving the illusion of switching between the two views.
