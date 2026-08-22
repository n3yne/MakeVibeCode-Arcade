package com.pghnetworks.makevibecodearcade;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.pghnetworks.makevibecodearcade.plugins.MakeCodeBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MakeCodeBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // Make the bridge WebView transparent so MakeCodeBridge's native overlay
        // WebView (inserted behind it — see MakeCodeBridgePlugin#show) shows
        // through the #arcade-container hole in renderer/styles.css.
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
}
