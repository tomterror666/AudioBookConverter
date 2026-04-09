#import "AppDelegate.h"

#import <React/RCTBridge.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTEventDispatcher.h>
#import <ReactCommon/RCTHost.h>

@interface RCTAppDelegate (AUBKLoadWindow)
- (void)loadReactNativeWindow:(NSDictionary *_Nullable)launchOptions;
@end

@implementation AppDelegate

static BOOL AUBKHasInstalledPythonInfoMenu = NO;

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"AudioBookConverter";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  [super applicationDidFinishLaunching:notification];
  [self aubk_installPythonInfoMenuIfNeeded];
}

static const CGFloat kAUBKInitialContentWidth = 850;
static const CGFloat kAUBKInitialContentHeight = 650;

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
