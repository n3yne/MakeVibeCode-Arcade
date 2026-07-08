#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Register the plugin with Capacitor's ObjC bridge
CAP_PLUGIN(MakeCodeBridgePlugin, "MakeCodeBridge",
    CAP_PLUGIN_METHOD(show, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(hide, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(executeScript, CAPPluginReturnPromise);
)
