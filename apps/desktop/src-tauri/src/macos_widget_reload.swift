import WidgetKit

/// Called from Rust after a fresh widget payload lands in the App Group
/// container, so WidgetKit refreshes visible widgets immediately instead of
/// waiting for the timeline's own periodic refresh policy (#1054). Exposed as
/// a C symbol because `WidgetCenter` has no Objective-C/C bridge of its own --
/// this is the only Swift file linked into the Rust binary, compiled to a
/// static library by build.rs.
///
/// Guarded by availability rather than raising the app's own deployment
/// target: the app still supports macOS versions before WidgetKit existed, so
/// this simply does nothing pre-macOS 11 (there is nothing to reload).
@_cdecl("mindwtr_reload_widgets")
public func mindwtr_reload_widgets() {
    if #available(macOS 11.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
