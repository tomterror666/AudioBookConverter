#import "AppDelegate.h"

#import <Carbon/Carbon.h>
#import <React/RCTBridge.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTEventDispatcher.h>
#import <ReactCommon/RCTHost.h>

@interface RCTAppDelegate (AUBKLoadWindow)
- (void)loadReactNativeWindow:(NSDictionary *_Nullable)launchOptions;
@end

@interface AppDelegate ()
@property(nonatomic, copy, nullable) NSString *aubkChapterCueMemo;
@end

/// Try the real Help Viewer bundle path. On some macOS versions `com.apple.helpviewer` maps to Tips, and
/// standalone `Help Viewer.app` may live under Cryptex. If none exist, `showAppHelp` falls back to the default
/// app for `.html` (usually Safari) so localized `index.html` still opens correctly.
static NSString *_Nullable AUBKResolvedHelpViewerAppPath(void)
{
  NSArray *candidates = @[
    @"/System/Library/CoreServices/Help Viewer.app",
    @"/System/Cryptexes/OS/System/Library/CoreServices/Help Viewer.app",
    @"/System/Cryptexes/App/System/Library/CoreServices/Help Viewer.app",
  ];
  NSFileManager *fm = [NSFileManager defaultManager];
  for (NSString *candidate in candidates) {
    BOOL isDir = NO;
    if ([fm fileExistsAtPath:candidate isDirectory:&isDir] && isDir) {
      return candidate;
    }
  }
  return nil;
}

@implementation AppDelegate

static BOOL AUBKHasInstalledPythonInfoMenu = NO;

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"AudioBookConverter";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  [super applicationDidFinishLaunching:notification];
  NSString *persisted =
      [[NSUserDefaults standardUserDefaults] stringForKey:@"AudioBookConverterChapterCue"];
  if ([persisted isEqualToString:@"en"] || [persisted isEqualToString:@"de"]) {
    self.aubkChapterCueMemo = persisted;
  }
  [self aubk_registerHelpBookIfNeeded];
  [self aubk_installPythonInfoMenuIfNeeded];
}

/// Registers the bundled .help book with Apple Help so Help Viewer opens index.html instead of generic macOS help.
- (void)aubk_registerHelpBookIfNeeded
{
  NSURL *helpURL = [[NSBundle mainBundle] URLForResource:@"AudioBookConverter" withExtension:@"help"];
  if (helpURL == nil) {
#if DEBUG
    NSLog(@"[AudioBookConverter] AudioBookConverter.help not found in app bundle (Copy Bundle Resources).");
#endif
    return;
  }
  OSStatus status = AHRegisterHelpBookWithURL((__bridge CFURLRef)helpURL);
#if DEBUG
  if (status != noErr) {
    NSLog(@"[AudioBookConverter] AHRegisterHelpBookWithURL failed: %d (path: %@)", (int)status, helpURL.path);
  }
#endif
  (void)status;
}

static const CGFloat kAUBKInitialContentWidth = 850;
/** Fixed content height; main form scrolls when “More settings” expands. Window is not resized from JS. */
static const CGFloat kAUBKInitialContentHeight = 530;

- (void)loadReactNativeWindow:(NSDictionary *)launchOptions
{
  [super loadReactNativeWindow:launchOptions];
  NSSize size = NSMakeSize(kAUBKInitialContentWidth, kAUBKInitialContentHeight);
  [self.window setContentSize:size];
  NSView *root = self.window.contentViewController.view;
  if (root != nil) {
    root.frame = NSMakeRect(0, 0, kAUBKInitialContentWidth, kAUBKInitialContentHeight);
  }
  [self.window center];
}

- (void)aubk_installPythonInfoMenuIfNeeded
{
  if (AUBKHasInstalledPythonInfoMenu) {
    return;
  }
  NSMenu *mainMenu = [NSApp mainMenu];
  if (mainMenu == nil || mainMenu.numberOfItems < 1) {
    return;
  }
  NSMenuItem *appMenuItem = [mainMenu itemAtIndex:0];
  NSMenu *appMenu = appMenuItem.submenu;
  if (appMenu == nil) {
    return;
  }

  const NSUInteger cmdCommaMask = NSEventModifierFlagCommand;

  // Strip template **Settings… (⌘,)**, flat Python rows, and any prior **Settings** submenu we added.
  NSArray<NSMenuItem *> *existing = [appMenu.itemArray copy];
  for (NSMenuItem *item in existing) {
    if ([item.keyEquivalent isEqualToString:@","] &&
        (item.keyEquivalentModifierMask & cmdCommaMask) == cmdCommaMask &&
        !item.hasSubmenu) {
      [appMenu removeItem:item];
      continue;
    }
    NSString *t = item.title;
    if (([t isEqualToString:@"Settings…"] || [t isEqualToString:@"Settings..."]) && !item.hasSubmenu) {
      [appMenu removeItem:item];
      continue;
    }
    if (!item.hasSubmenu && item.action == @selector(openPythonInfoFromMenu:)) {
      [appMenu removeItem:item];
      continue;
    }
    if (item.hasSubmenu && [item.title isEqualToString:@"Settings"]) {
      [appMenu removeItem:item];
    }
  }

  NSMenuItem *settingsRoot =
      [[NSMenuItem alloc] initWithTitle:@"Settings"
                                 action:nil
                          keyEquivalent:@""];
  NSMenu *settingsSub = [[NSMenu alloc] initWithTitle:@"Settings"];
  NSMenuItem *pythonInfo =
      [[NSMenuItem alloc] initWithTitle:@"Python Info…"
                                 action:@selector(openPythonInfoFromMenu:)
                          keyEquivalent:@","];
  pythonInfo.target = self;
  pythonInfo.keyEquivalentModifierMask = cmdCommaMask;
  [settingsSub addItem:pythonInfo];
  settingsRoot.submenu = settingsSub;

  NSInteger insertAt = MIN(1, (NSInteger)appMenu.numberOfItems);
  [appMenu insertItem:settingsRoot atIndex:insertAt];

  AUBKHasInstalledPythonInfoMenu = YES;
}

- (void)openPythonInfoFromMenu:(id)sender
{
  // New Architecture / bridgeless: there is no RCTBridge; events go through RCTHost (see RCTInstance).
  RCTHost *host = self.rootViewFactory.reactHost;
  if (host != nil) {
    [host callFunctionOnJSModule:@"RCTDeviceEventEmitter"
                          method:@"emit"
                            args:@[ @"OpenPythonInfoModal" ]];
    return;
  }
  RCTBridge *bridge = self.bridge;
  if (bridge == nil || !bridge.valid) {
    return;
  }
  RCTEventDispatcher *eventDispatcher = [bridge moduleForClass:[RCTEventDispatcher class]];
  if (eventDispatcher == nil) {
    return;
  }
  [eventDispatcher sendDeviceEventWithName:@"OpenPythonInfoModal" body:nil];
}

- (void)openFolderFromMenu:(id)sender
{
  RCTHost *host = self.rootViewFactory.reactHost;
  if (host != nil) {
    [host callFunctionOnJSModule:@"RCTDeviceEventEmitter"
                          method:@"emit"
                            args:@[ @"OpenFolderFromMenu" ]];
    return;
  }
  RCTBridge *bridge = self.bridge;
  if (bridge == nil || !bridge.valid) {
    return;
  }
  RCTEventDispatcher *eventDispatcher = [bridge moduleForClass:[RCTEventDispatcher class]];
  if (eventDispatcher == nil) {
    return;
  }
  [eventDispatcher sendDeviceEventWithName:@"OpenFolderFromMenu" body:nil];
}

- (void)aubk_setChapterCueForHelp:(NSString *)locale
{
  if ([locale isEqualToString:@"en"]) {
    self.aubkChapterCueMemo = @"en";
  } else if ([locale isEqualToString:@"de"]) {
    self.aubkChapterCueMemo = @"de";
  } else {
    self.aubkChapterCueMemo = nil;
  }
}

- (NSString *)aubk_resolvedChapterCueForHelp
{
  NSString *memo = self.aubkChapterCueMemo;
  if (memo.length == 0) {
    NSString *s =
        [[NSUserDefaults standardUserDefaults] stringForKey:@"AudioBookConverterChapterCue"];
    memo = ([s isEqualToString:@"en"] || [s isEqualToString:@"de"]) ? s : @"de";
    return memo;
  }
  return ([memo isEqualToString:@"en"]) ? @"en" : @"de";
}

- (void)showAppHelp:(id)sender
{
  NSString *cue = [self aubk_resolvedChapterCueForHelp];
  NSString *folder = [cue isEqualToString:@"en"] ? @"en.lproj" : @"de.lproj";

  NSString *helpPkg =
      [[NSBundle mainBundle] pathForResource:@"AudioBookConverter" ofType:@"help"];
  if (helpPkg.length == 0) {
    NSLog(@"[AudioBookConverter] showAppHelp: help package path nil");
    [NSApp sendAction:@selector(showHelp:) to:nil from:sender];
    return;
  }

  NSString *htmlPath =
      [[[[helpPkg stringByAppendingPathComponent:@"Contents"]
          stringByAppendingPathComponent:@"Resources"]
          stringByAppendingPathComponent:folder] stringByAppendingPathComponent:@"index.html"];

  if (![[NSFileManager defaultManager] isReadableFileAtPath:htmlPath]) {
    NSBundle *helpBundle = [NSBundle bundleWithPath:helpPkg];
    if (helpBundle != nil) {
      htmlPath = [helpBundle pathForResource:@"index" ofType:@"html" inDirectory:folder];
    }
  }

  if (htmlPath.length == 0 ||
      ![[NSFileManager defaultManager] isReadableFileAtPath:htmlPath]) {
    NSLog(@"[AudioBookConverter] showAppHelp: unreadable path=%@ (cue=%@ folder=%@)",
          htmlPath ?: @"(nil)",
          cue,
          folder);
    [NSApp sendAction:@selector(showHelp:) to:nil from:sender];
    return;
  }

  NSString *helpViewerAppPath = AUBKResolvedHelpViewerAppPath();
  NSURL *htmlFileURL = [NSURL fileURLWithPath:htmlPath isDirectory:NO];
  NSString *defaultHtmlHandlerPath = nil;
  if (@available(macOS 10.15, *)) {
    NSURL *u = [[NSWorkspace sharedWorkspace] URLForApplicationToOpenURL:htmlFileURL];
    defaultHtmlHandlerPath = u.path;
  }

  NSLog(
      @"[AudioBookConverter] showAppHelp cue=%@ htmlPath=%@ "
      @"helpViewerOnDisk=%@ defaultHtmlHandler=%@",
      cue,
      htmlPath,
      helpViewerAppPath ?: @"(missing)",
      defaultHtmlHandlerPath ?: @"(unknown)");

  BOOL opened = NO;
  if (helpViewerAppPath.length > 0) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    opened =
        [[NSWorkspace sharedWorkspace] openFile:htmlPath
                                 withApplication:helpViewerAppPath];
#pragma clang diagnostic pop
  }

  /// No Help Viewer: open `index.html` with the user's default `.html` app (Firefox, Safari…). This reliably
  /// respects `de.lproj`/`en.lproj` paths; `- (void)showHelp:` would still resolve the bundled book in English.
  if (!opened) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    opened = [[NSWorkspace sharedWorkspace] openFile:htmlPath];
#pragma clang diagnostic pop
  }

  if (!opened) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    @try {
      NSTask *task = [[NSTask alloc] init];
      task.launchPath = @"/usr/bin/open";
      task.arguments = @[ @"--", htmlPath ];
      [task launch];
      [task waitUntilExit];
      opened = ([task terminationStatus] == 0);
    } @catch (NSException *exc) {
      NSLog(@"[AudioBookConverter] showAppHelp: NSTask(/usr/bin/open) failed: %@", exc);
    }
#pragma clang diagnostic pop
  }

  if (!opened) {
    NSLog(@"[AudioBookConverter] showAppHelp: all open attempts failed → showHelp:");
    [NSApp sendAction:@selector(showHelp:) to:nil from:sender];
  }
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
