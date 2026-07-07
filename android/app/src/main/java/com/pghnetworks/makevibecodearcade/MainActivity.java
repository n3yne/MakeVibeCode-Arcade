package com.pghnetworks.makevibecodearcade;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.pghnetworks.makevibecodearcade.plugins.MakeCodeBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MakeCodeBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
