#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <stdbool.h>

// Quick add must take keyboard input WITHOUT activating Mindwtr: activating the
// app is what drags the main window forward and leaves it focused afterwards
// (#794). A normal NSWindow cannot do that — only a panel carrying
// NSWindowStyleMaskNonactivatingPanel can, which is the mechanism Spotlight and
// the launcher apps use. tao builds the window as a plain NSWindow subclass, so
// the panel behaviour is installed by re-assigning the instance's class, the
// documented public-runtime way to do it (object_setClass); everything here is
// public AppKit/Objective-C runtime API, nothing private.
@interface MindwtrQuickAddPanel : NSPanel
@end

@implementation MindwtrQuickAddPanel
// tao's TaoWindow overrode this to honour its `focusable` ivar; that override
// is gone once the class is swapped, and a borderless window returns NO by
// default, so the panel would never take the caret.
- (BOOL)canBecomeKeyWindow {
    return YES;
}
@end

// AppKit work has to happen on the main thread. Inline when we are already
// there (window creation, tray and hotkey callbacks) so the panel is ready
// before the caller shows it; queued otherwise, mirroring tao's own
// run_on_main.
static void mindwtr_quick_add_run_on_main(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
        return;
    }
    dispatch_async(dispatch_get_main_queue(), block);
}

// Returns false when the conversion cannot be applied, so the caller can keep
// the old activating show path rather than putting up a window that cannot be
// typed into.
bool mindwtr_macos_make_quick_add_panel(void *ns_window) {
    if (ns_window == NULL) {
        return false;
    }

    NSWindow *window = (__bridge NSWindow *)ns_window;
    Class panelClass = [MindwtrQuickAddPanel class];
    // NSPanel adds no ivars over NSWindow today, which is why swapping the
    // class of an allocated window is safe. If a future AppKit changes that,
    // refuse instead of writing past the allocation.
    if (class_getInstanceSize(panelClass) > class_getInstanceSize(object_getClass(window))) {
        return false;
    }

    mindwtr_quick_add_run_on_main(^{
        object_setClass(window, panelClass);
        [window setStyleMask:[window styleMask] | NSWindowStyleMaskNonactivatingPanel];
        // Panels default to hiding when their app deactivates — and this app is
        // never active while the panel is up, so the default would hide it the
        // moment it appears.
        [window setHidesOnDeactivate:NO];
        // Capture has to work from wherever the user is: the current space, and
        // over another app's full-screen space.
        [window setCollectionBehavior:[window collectionBehavior] |
                                      NSWindowCollectionBehaviorCanJoinAllSpaces |
                                      NSWindowCollectionBehaviorFullScreenAuxiliary];
    });

    return true;
}

// Ordering front from an inactive app needs orderFrontRegardless; makeKeyWindow
// then hands the panel the keyboard without NSApp ever activating. Returns
// false when the window is not a converted panel, which is the caller's signal
// to fall back to the activating focus path.
bool mindwtr_macos_present_quick_add_panel(void *ns_window) {
    if (ns_window == NULL) {
        return false;
    }

    NSWindow *window = (__bridge NSWindow *)ns_window;
    if (![window isKindOfClass:[MindwtrQuickAddPanel class]]) {
        return false;
    }

    mindwtr_quick_add_run_on_main(^{
        [window orderFrontRegardless];
        [window makeKeyWindow];
    });

    return true;
}
