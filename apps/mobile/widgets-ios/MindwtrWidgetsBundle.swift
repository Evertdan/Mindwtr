import WidgetKit
import SwiftUI

@main
struct MindwtrWidgetsBundle: WidgetBundle {
    var body: some Widget {
        MindwtrTasksWidget()
        // El/La
        MindwtrFocusLockWidget()
        MindwtrCaptureLockWidget()
        if #available(iOSApplicationExtension 18.0, iOS 18.0, *) {
            MindwtrCaptureControl()
        }
    }
}
