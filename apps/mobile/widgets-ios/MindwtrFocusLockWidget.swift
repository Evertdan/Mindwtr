import SwiftUI
import WidgetKit

private let mindwtrFocusLockWidgetKind = "MindwtrFocusLockWidget"

// Widget de pantalla de bloqueo (familia de accesorios) que muestra la tarea enfocada actual (#821).
// Reutiliza MindwtrTasksWidgetProvider
// default payload key, whose items mirror the app's Today's Focus list.
// Las familias de accesorios son iOS 16+; en iOS 15 el widget no ofrece familias.
struct MindwtrFocusLockWidget: Widget {
    let kind: String = mindwtrFocusLockWidgetKind

    private var families: [WidgetFamily] {
        if #available(iOSApplicationExtension 16.0, *) {
            return [.accessoryRectangular, .accessoryInline, .accessoryCircular]
        }
        return []
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MindwtrTasksWidgetProvider()) { entry in
            MindwtrFocusLockWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Focus")
        .description("Current focused task")
        .supportedFamilies(families)
    }
}

private struct MindwtrFocusLockWidgetEntryView: View {
    let entry: MindwtrTasksWidgetEntry

    var body: some View {
        if #available(iOSApplicationExtension 16.0, *) {
            MindwtrFocusLockView(entry: entry)
        } else {
            EmptyView()
        }
    }
}

// Los widgets de pantalla de bloqueo se renderizan
// theme palette deliberately does not apply here.
@available(iOSApplicationExtension 16.0, *)
private struct MindwtrFocusLockView: View {
    let entry: MindwtrTasksWidgetEntry
    @Environment(\.widgetFamily) private var widgetFamily

    private var focusedTitle: String? {
        entry.payload.items.first?.title
    }

    var body: some View {
        content
            .widgetURL(URL(string: entry.payload.focusUri) ?? URL(fileURLWithPath: "/"))
            .mindwtrLockWidgetBackground()
    }

    @ViewBuilder
    private var content: some View {
        switch widgetFamily {
        case .accessoryInline:
            Text(focusedTitle ?? entry.payload.emptyMessage)

        case .accessoryCircular:
            // El conteo de estrellas marca
            // display list — items.count is capped by the payload's maxItems.
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11, weight: .semibold))
                    Text("\(entry.payload.focusedCount ?? entry.payload.items.count)")
                        .font(.system(size: 16, weight: .bold))
                }
            }

        default:
            // accessoryRectangular fits ~3 text rows: caption + two task lines.
            // A single task keeps the two-line title; with more, the top two
            // starred tasks get one line each (the circular ★N carries the rest).
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.payload.headerTitle)
                    .font(.system(size: 12, weight: .medium))
                    .opacity(0.75)
                    .lineLimit(1)
                if entry.payload.items.count > 1 {
                    ForEach(entry.payload.items.prefix(2), id: \.id) { item in
                        Text(item.title)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                    }
                } else {
                    Text(focusedTitle ?? entry.payload.emptyMessage)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

private extension View {
    @ViewBuilder
    func mindwtrLockWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}
