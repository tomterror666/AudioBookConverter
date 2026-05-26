#import <RCTAppDelegate.h>
#import <Cocoa/Cocoa.h>

@interface AppDelegate : RCTAppDelegate

/// App menu: **Settings ▸ Python Info…** (⌘, on the inner item) → `OpenPythonInfoModal` via `RCTHost` (bridgeless) or `RCTEventDispatcher`.
- (void)openPythonInfoFromMenu:(nullable id)sender;

/** File ▸ Open (⌘O) → `OpenFolderFromMenu` → same picker as tapping the folder field. */
- (void)openFolderFromMenu:(nullable id)sender;

/** Help menu: README help page — language follows chapter cue synced from JS/native. */
- (void)showAppHelp:(nullable id)sender;

/** Called from `DependencyStatus.syncChapterCueForHelp` when the Sprache/Language toggle changes (main thread). */
- (void)aubk_setChapterCueForHelp:(NSString *_Nullable)locale;

@end
