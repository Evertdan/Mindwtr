import SwiftUI
import WidgetKit

private let mindwtrWidgetKind = "MindwtrTasksWidget"
private let mindwtrWidgetAppGroup = "group.tech.dongdongbh.mindwtr"
private let mindwtrWidgetPayloadKey = "mindwtr-ios-widget-payload"
private let mindwtrWidgetPayloadKeySmall = "mindwtr-ios-widget-payload-small"
private let mindwtrWidgetPayloadKeyMedium = "mindwtr-ios-widget-payload-medium"
private let mindwtrWidgetPayloadKeyLarge = "mindwtr-ios-widget-payload-large"
private let mindwtrWidgetPayloadKeyExtraLarge = "mindwtr-ios-widget-payload-extra-large"

struct MindwtrWidgetTaskItem: Decodable {
    let id: String
    let title: String
    let statusLabel: String?
}

struct MindwtrWidgetPalette: Decodable {
    let background: String
    let card: String
    let border: String
    let text: String
    let mutedText: String
    let accent: String
    let onAccent: String
}

extension MindwtrWidgetPalette {
    static let light = MindwtrWidgetPalette(
        background: "#F8FAFC",
        card: "#FFFFFF",
        border: "#CBD5E1",
        text: "#0F172A",
        mutedText: "#475569",
        accent: "#2563EB",
        onAccent: "#FFFFFF"
    )

    static let dark = MindwtrWidgetPalette(
        background: "#111827",
        card: "#1F2937",
        border: "#374151",
        text: "#F9FAFB",
        mutedText: "#CBD5E1",
        accent: "#2563EB",
        onAccent: "#FFFFFF"
    )
}

struct MindwtrTasksWidgetPayload: Decodable {
    let headerTitle: String
    let subtitle: String
    // Opcional: las cargas escritas antes de que existiera el campo aún pueden estar en caché.
    let focusedCount: Int?
    let items: [MindwtrWidgetTaskItem]
    let emptyMessage: String
    let captureLabel: String
    let focusUri: String
    let quickCaptureUri: String
    let themeMode: String?
    let palette: MindwtrWidgetPalette

    static var fallback: MindwtrTasksWidgetPayload {
        MindwtrTasksWidgetPayload(
            headerTitle: "Today",
            subtitle: "Inbox: 0",
            focusedCount: 0,
            items: [],
            emptyMessage: "No tasks",
            captureLabel: "Quick capture",
            focusUri: "mindwtr:///focus",
            quickCaptureUri: "mindwtr:///capture-quick?mode=text",
            themeMode: "system",
            palette: .light
        )
    }
}

struct MindwtrTasksWidgetEntry: TimelineEntry {
    let date: Date
    let payload: MindwtrTasksWidgetPayload
}

struct MindwtrTasksWidgetProvider: TimelineProvider {
    func placeholder(in _: Context) -> MindwtrTasksWidgetEntry {
        MindwtrTasksWidgetEntry(date: Date(), payload: .fallback)
    }

    func getSnapshot(in context: Context, completion: @escaping (MindwtrTasksWidgetEntry) -> Void) {
        completion(MindwtrTasksWidgetEntry(date: Date(), payload: loadPayload(for: context.family)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MindwtrTasksWidgetEntry>) -> Void) {
        let now = Date()
        let entry = MindwtrTasksWidgetEntry(date: now, payload: loadPayload(for: context.family))
        let refresh = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }

    private func loadPayload(for family: WidgetFamily) -> MindwtrTasksWidgetPayload {
        guard let defaults = UserDefaults(suiteName: mindwtrWidgetAppGroup) else {
            return .fallback
        }

        let payloadKeys = [payloadKey(for: family), mindwtrWidgetPayloadKey]
        for key in payloadKeys {
            guard
                let jsonString = defaults.string(forKey: key),
                let data = jsonString.data(using: .utf8)
            else {
                continue
            }

            do {
                return try JSONDecoder().decode(MindwtrTasksWidgetPayload.self, from: data)
            } catch {
                continue
            }
        }

        return .fallback
    }

    private func payloadKey(for family: WidgetFamily) -> String {
        switch family {
        case .systemSmall:
            return mindwtrWidgetPayloadKeySmall
        case .systemMedium:
            return mindwtrWidgetPayloadKeyMedium
        case .systemLarge:
            return mindwtrWidgetPayloadKeyLarge
        case .systemExtraLarge:
            return mindwtrWidgetPayloadKeyExtraLarge
        default:
            return mindwtrWidgetPayloadKey
        }
    }
}

private struct MindwtrWidgetMetrics {
    let headerSize: CGFloat
    let subtitleSize: CGFloat
    let taskSize: CGFloat
    let buttonSize: CGFloat
    let rowSpacing: CGFloat
    let sectionSpacing: CGFloat
    let padding: CGFloat
    let buttonVPadding: CGFloat
    let taskRowVPadding: CGFloat

    // Bloque de encabezado (título + subtítulo)
    // hold tasks, so reserve their height before deciding how many rows fit.
    var reservedHeight: CGFloat {
        padding * 2
            + headerSize + subtitleSize + rowSpacing
            + sectionSpacing * 2
            + buttonSize + buttonVPadding * 2
    }

    var rowHeight: CGFloat {
        taskSize + taskRowVPadding * 2 + rowSpacing
    }

    static func resolve(for family: WidgetFamily) -> MindwtrWidgetMetrics {
        switch family {
        case .systemExtraLarge:
            return MindwtrWidgetMetrics(
                headerSize: 18, subtitleSize: 13, taskSize: 14, buttonSize: 15,
                rowSpacing: 4, sectionSpacing: 9, padding: 16,
                buttonVPadding: 10, taskRowVPadding: 2
            )
        case .systemLarge:
            return MindwtrWidgetMetrics(
                headerSize: 18, subtitleSize: 12, taskSize: 14, buttonSize: 14,
                rowSpacing: 4, sectionSpacing: 8, padding: 14,
                buttonVPadding: 9, taskRowVPadding: 2
            )
        case .systemMedium:
            return MindwtrWidgetMetrics(
                headerSize: 17, subtitleSize: 12, taskSize: 14, buttonSize: 14,
                rowSpacing: 4, sectionSpacing: 7, padding: 14,
                buttonVPadding: 9, taskRowVPadding: 2
            )
        default:
            return MindwtrWidgetMetrics(
                headerSize: 15, subtitleSize: 11, taskSize: 13, buttonSize: 13,
                rowSpacing: 3, sectionSpacing: 6, padding: 12,
                buttonVPadding: 7, taskRowVPadding: 1
            )
        }
    }
}

private struct MindwtrTasksWidgetView: View {
    let entry: MindwtrTasksWidgetEntry
    @Environment(\.widgetFamily) private var widgetFamily
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let payload = entry.payload
        let palette = resolvePalette(payload)
        let metrics = MindwtrWidgetMetrics.resolve(for: widgetFamily)
        let columnCount = widgetFamily == .systemExtraLarge ? 2 : 1
        GeometryReader { geometry in
            let visibleTaskLimit = resolveTaskLimit(
                itemCount: payload.items.count,
                availableHeight: geometry.size.height,
                metrics: metrics,
                columns: columnCount
            )
            let visibleItems = Array(payload.items.prefix(visibleTaskLimit))
            VStack(alignment: .leading, spacing: metrics.sectionSpacing) {
                Link(destination: URL(string: payload.focusUri) ?? URL(fileURLWithPath: "/")) {
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
                }

                if payload.items.isEmpty {
                    TaskLineView(
                        title: payload.emptyMessage,
                        textColor: palette.mutedText,
                        fontSize: metrics.taskSize,
                        verticalPadding: metrics.taskRowVPadding,
                        focusUri: payload.focusUri
                    )
                } else if columnCount == 2 {
                    let leftCount = (visibleItems.count + 1) / 2
                    HStack(alignment: .top, spacing: metrics.padding) {
                        taskColumn(
                            Array(visibleItems.prefix(leftCount)),
                            palette: palette,
                            metrics: metrics,
                            focusUri: payload.focusUri
                        )
                        taskColumn(
                            Array(visibleItems.dropFirst(leftCount)),
                            palette: palette,
                            metrics: metrics,
                            focusUri: payload.focusUri
                        )
                    }
                } else {
                    taskColumn(
                        visibleItems,
                        palette: palette,
                        metrics: metrics,
                        focusUri: payload.focusUri
                    )
                }

                Spacer(minLength: metrics.sectionSpacing)

                Link(destination: URL(string: payload.quickCaptureUri) ?? URL(fileURLWithPath: "/")) {
                    Text(payload.captureLabel)
                        .font(.system(size: metrics.buttonSize, weight: .semibold))
                        .foregroundColor(hexColor(palette.onAccent))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, metrics.buttonVPadding)
                        .background(hexColor(palette.accent))
                        .clipShape(Capsule())
                }
            }
            .padding(metrics.padding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .mindwtrWidgetBackground(hexColor(palette.background))
        }
    }

    @ViewBuilder
    private func taskColumn(
        _ items: [MindwtrWidgetTaskItem],
        palette: MindwtrWidgetPalette,
        metrics: MindwtrWidgetMetrics,
        focusUri: String
    ) -> some View {
        VStack(alignment: .leading, spacing: metrics.rowSpacing) {
            ForEach(items, id: \.id) { item in
                TaskLineView(
                    title: "• \(item.title)",
                    textColor: palette.text,
                    fontSize: metrics.taskSize,
                    verticalPadding: metrics.taskRowVPadding,
                    focusUri: focusUri
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var familyTaskCap: Int {
        switch widgetFamily {
        case .systemExtraLarge:
            return 24
        case .systemLarge:
            return 12
        case .systemMedium:
            return 5
        default:
            return 3
        }
    }

    private func resolveTaskLimit(itemCount: Int, availableHeight: CGFloat, metrics: MindwtrWidgetMetrics, columns: Int) -> Int {
        guard itemCount > 0 else { return 0 }
        let minimumRows = min(3, itemCount)
        let perColumn = max(0, Int(floor((availableHeight - metrics.reservedHeight) / metrics.rowHeight)))
        let fitItems = perColumn * max(1, columns)
        if perColumn >= minimumRows {
            return min(itemCount, min(familyTaskCap, fitItems))
        }
        return min(itemCount, max(1, fitItems))
    }

    // La paleta de carga útil
    // apps/mobile/lib/widget-data.ts); Swift's job is to decode it, not to
    // re-classify it. Only 'system' (or a blank/legacy payload) needs Swift's
    // own colorScheme, since the JS side can't observe it ahead of render.
    private func resolvePalette(_ payload: MindwtrTasksWidgetPayload) -> MindwtrWidgetPalette {
        let mode = (payload.themeMode ?? "system")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if mode.isEmpty || mode == "system" {
            return colorScheme == .dark ? .dark : .light
        }

        return payload.palette
    }
}

private struct TaskLineView: View {
    let title: String
    let textColor: String
    let fontSize: CGFloat
    let verticalPadding: CGFloat
    let focusUri: String

    var body: some View {
        Link(destination: URL(string: focusUri) ?? URL(fileURLWithPath: "/")) {
            Text(title)
                .font(.system(size: fontSize))
                .foregroundColor(hexColor(textColor))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, verticalPadding)
        }
    }
}

private extension View {
    @ViewBuilder
    func mindwtrWidgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
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
        // Admite valores de carga de estilo CSS #RRGGBBAA.
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

struct MindwtrTasksWidget: Widget {
    let kind: String = mindwtrWidgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MindwtrTasksWidgetProvider()) { entry in
            MindwtrTasksWidgetView(entry: entry)
        }
        .configurationDisplayName("Mindwtr")
        .description("Inbox, focus, and quick capture")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}
