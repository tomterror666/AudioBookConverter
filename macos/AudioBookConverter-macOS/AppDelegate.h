#import <RCTAppDelegate.h>
#import <Cocoa/Cocoa.h>

@interface AppDelegate : RCTAppDelegate

/// App menu: **Settings ▸ Python Info…** (⌘, on the inner item) → `OpenPythonInfoModal` via `RCTHost` (bridgeless) or `RCTEventDispatcher`.
- (void)openPythonInfoFromMenu:(nullable id)sender;

@end
