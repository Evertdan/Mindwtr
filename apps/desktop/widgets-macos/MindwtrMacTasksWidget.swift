import SwiftUI
import WidgetKit

// Mirrors the visual shape of apps/mobile/widgets-ios/MindwtrTasksWidget.swift
// for the desktop app's macOS widget (#1054). Two deliberate differences from
// the iOS widget, both tracking decisions made for #1054:
//  - No `Link(destination:)` tap targets or capture button. The desktop app
//    registers no `mindwtr://` URL scheme, so the whole widget relies on
//    WidgetKit's default "tap opens the containing app" behavior.
//  - One generous item list (see macos-widget-data.ts) rather than five
//    per-size UserDefaults payloads; `familyTaskCap` below crops further.
private let mindwtrMacWidgetKind = "MindwtrMacTasksWidget"
private let mindwtrMacWidgetPayloadFileName = "widget-payload.json"
private let mindwtrMacWidgetRefreshMinutes = 15
// Placeholder for local/unsigned builds -- must match build.rs's own
// DEVTEAM fallback so an unsigned dev build's widget (if ever force-installed)
// fails the same way the Rust write command does: no container, no crash.
private let mindwtrMacWidgetDevAppGroup = "DEVTEAM.tech.dongdongbh.mindwtr"

struct MindwtrMacWidgetTaskItem: Decodable {
    let id: String
    let title: String
    let statusLabel: String?
}

struct MindwtrMacWidgetPalette: Decodable {
    let background: String
    let card: String
    let border: String
    let text: String
    let mutedText: String
    let accent: String
    let onAccent: String
}

extension MindwtrMacWidgetPalette {
    static let light = MindwtrMacWidgetPalette(
        background: "#F8FAFC",
        card: "#FFFFFF",
        border: "#CBD5E1",
        text: "#0F172A",
        mutedText: "#475569",
        accent: "#2563EB",
        onAccent: "#FFFFFF"
    )

    static let dark = MindwtrMacWidgetPalette(
        background: "#111827",
        card: "#1F2937",
        border: "#374151",
        text: "#F9FAFB",
        mutedText: "#CBD5E1",
        accent: "#2563EB",
        onAccent: "#FFFFFF"
    )
}

struct MindwtrMacTasksWidgetPayload: Decodable {
    let headerTitle: String
    let subtitle: String
    let focusedCount: Int?
    let items: [MindwtrMacWidgetTaskItem]
    let emptyMessage: String
    let captureLabel: String
    let themeMode: String?
    let palette: MindwtrMacWidgetPalette

    static var fallback: MindwtrMacTasksWidgetPayload {
        MindwtrMacTasksWidgetPayload(
            headerTitle: "Today",
            subtitle: "Inbox: 0",
            focusedCount: 0,
            items: [],
            emptyMessage: "No tasks",
            captureLabel: "Quick capture",
            themeMode: "system",
            palette: .light
        )
    }
}

struct MindwtrMacTasksWidgetEntry: TimelineEntry {
    let date: Date
    let payload: MindwtrMacTasksWidgetPayload
}

struct MindwtrMacTasksWidgetProvider: TimelineProvider {
    func placeholder(in _: Context) -> MindwtrMacTasksWidgetEntry {
        MindwtrMacTasksWidgetEntry(date: Date(), payload: .fallback)
    }

    func getSnapshot(in _: Context, completion: @escaping (MindwtrMacTasksWidgetEntry) -> Void) {
        completion(MindwtrMacTasksWidgetEntry(date: Date(), payload: loadPayload()))
    }

    func getTimeline(in _: Context, completion: @escaping (Timeline<MindwtrMacTasksWidgetEntry>) -> Void) {
        let now = Date()
        let entry = MindwtrMacTasksWidgetEntry(date: now, payload: loadPayload())
        // The desktop app best-effort calls WidgetCenter.reloadAllTimelines()
        // right after writing a fresh payload, but that in-process reload can't
        // be guaranteed from every build (#1054 decision 6), so the timeline
        // itself also refreshes on a short fixed cadence as the fallback.
        let refresh = Calendar.current.date(byAdding: .minute, value: mindwtrMacWidgetRefreshMinutes, to: now)
            ?? now.addingTimeInterval(TimeInterval(mindwtrMacWidgetRefreshMinutes * 60))
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }

    private var appGroupIdentifier: String {
        Bundle.main.object(forInfoDictionaryKey: "MindwtrAppGroupIdentifier") as? String ?? mindwtrMacWidgetDevAppGroup
    }

    private func loadPayload() -> MindwtrMacTasksWidgetPayload {
        guard
            let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier),
            let data = try? Data(contentsOf: containerURL.appendingPathComponent(mindwtrMacWidgetPayloadFileName)),
            let payload = try? JSONDecoder().decode(MindwtrMacTasksWidgetPayload.self, from: data)
        else {
            return .fallback
        }
        return payload
    }
}

private struct MindwtrMacWidgetMetrics {
    let headerSize: CGFloat
    let subtitleSize: CGFloat
    let taskSize: CGFloat
    let rowSpacing: CGFloat
    let sectionSpacing: CGFloat
    let padding: CGFloat

    static func resolve(for family: WidgetFamily) -> MindwtrMacWidgetMetrics {
        switch family {
        case .systemLarge:
            return MindwtrMacWidgetMetrics(headerSize: 18, subtitleSize: 12, taskSize: 14, rowSpacing: 4, sectionSpacing: 8, padding: 14)
        case .systemMedium:
            return MindwtrMacWidgetMetrics(headerSize: 17, subtitleSize: 12, taskSize: 14, rowSpacing: 4, sectionSpacing: 7, padding: 14)
        default:
            return MindwtrMacWidgetMetrics(headerSize: 15, subtitleSize: 11, taskSize: 13, rowSpacing: 3, sectionSpacing: 6, padding: 12)
        }
    }
}

private struct MindwtrMacTasksWidgetView: View {
    let entry: MindwtrMacTasksWidgetEntry
    @Environment(\.widgetFamily) private var widgetFamily
    @Environment(\.colorScheme) private var colorScheme

    // macOS has no systemExtraLarge family, so there is no second column to
    // account for -- unlike the iOS widget's iPad-only two-column layout.
    private var familyTaskCap: Int {
        switch widgetFamily {
        case .systemLarge: return 10
        case .systemMedium: return 5
        default: return 3
        }
    }

    var body: some View {
        let payload = entry.payload
        let palette = resolvePalette(payload)
        let metrics = MindwtrMacWidgetMetrics.resolve(for: widgetFamily)
        let visibleItems = Array(payload.items.prefix(familyTaskCap))

        VStack(alignment: .leading, spacing: metrics.sectionSpacing) {
            VStack(alignment: .leading, spacing: 2) {
                Text(payload.headerTitle)
                    .font(.system(size: metrics.headerSize, weight: .semibold))
                    .foregroundColor(hexColor(palette.text))
                    .lineLimit(1)
                Text(payload.subtitle)
                    .font(.system(size: metrics.subtitleSize))
                    .foregroundColor(hexColor(palette.mutedText))
                    .lineLimit(1)
            }

            if visibleItems.isEmpty {
                Text(payload.emptyMessage)
                    .font(.system(size: metrics.taskSize))
                    .foregroundColor(hexColor(palette.mutedText))
                    .lineLimit(1)
            } else {
                VStack(alignment: .leading, spacing: metrics.rowSpacing) {
                    ForEach(visibleItems, id: \.id) { item in
                        Text("• \(item.title)")
                            .font(.system(size: metrics.taskSize))
                            .foregroundColor(hexColor(palette.text))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(metrics.padding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .mindwtrMacWidgetBackground(hexColor(palette.background))
    }

    // The payload's palette is already the resolved light/dark colors (built
    // by apps/desktop/src/lib/macos-widget-data.ts); Swift's job is to decode
    // it, not re-classify it. Only 'system' (or a blank/legacy payload) needs
    // Swift's own colorScheme, since the TS side can't observe it ahead of render.
    private func resolvePalette(_ payload: MindwtrMacTasksWidgetPayload) -> MindwtrMacWidgetPalette {
        let mode = (payload.themeMode ?? "system")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if mode.isEmpty || mode == "system" {
            return colorScheme == .dark ? .dark : .light
        }

        return payload.palette
    }
}

private extension View {
    @ViewBuilder
    func mindwtrMacWidgetBackground(_ color: Color) -> some View {
        if #available(macOSApplicationExtension 14.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self.background(color)
        }
    }
}

private func hexColor(_ hex: String) -> Color {
    let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var int: UInt64 = 0
    Scanner(string: cleaned).scanHexInt64(&int)

    let r: UInt64
    let g: UInt64
    let b: UInt64
    let a: UInt64

    switch cleaned.count {
    case 3:
        (r, g, b, a) = ((int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17, 255)
    case 4:
        (r, g, b, a) = ((int >> 12) * 17, (int >> 8 & 0xF) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
    case 6:
        (r, g, b, a) = (int >> 16, int >> 8 & 0xFF, int & 0xFF, 255)
    case 8:
        (r, g, b, a) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
    default:
        (r, g, b, a) = (15, 23, 42, 255)
    }

    return Color(
        .sRGB,
        red: Double(r) / 255,
        green: Double(g) / 255,
        blue: Double(b) / 255,
        opacity: Double(a) / 255
    )
}

struct MindwtrMacTasksWidget: Widget {
    let kind: String = mindwtrMacWidgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MindwtrMacTasksWidgetProvider()) { entry in
            MindwtrMacTasksWidgetView(entry: entry)
        }
        .configurationDisplayName("Mindwtr")
        .description("Today's focus at a glance")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
