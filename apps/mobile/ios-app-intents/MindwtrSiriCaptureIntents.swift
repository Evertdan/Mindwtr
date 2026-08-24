import AppIntents
import CoreSpotlight
import UIKit
import UniformTypeIdentifiers

private enum MindwtrSiriCaptureLauncher {
    static func appURL(path: String, queryItems: [URLQueryItem]) -> URL? {
        var components = URLComponents()
        components.scheme = "mindwtr"
        components.host = ""
        components.path = path
        components.queryItems = queryItems
        return components.url
    }

    static func trimmed(_ value: String?) -> String? {
        let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmedValue.isEmpty ? nil : trimmedValue
    }

    static func normalizedCommaList(_ value: String?) -> String? {
        guard let value else { return nil }
        let items = value
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return items.isEmpty ? nil : items.joined(separator: ",")
    }

    static func captureURL(task: String, note: String?, tags: String?, project: String?) -> URL? {
        var queryItems = [
            URLQueryItem(name: "title", value: task),
            URLQueryItem(name: "requestId", value: UUID().uuidString)
        ]
        if let note = trimmed(note) {
            queryItems.append(URLQueryItem(name: "note", value: note))
        }
        if let tags = normalizedCommaList(tags) {
            queryItems.append(URLQueryItem(name: "tags", value: tags))
        }
        if let project = trimmed(project) {
            queryItems.append(URLQueryItem(name: "project", value: project))
        }

        return appURL(path: "/capture", queryItems: queryItems)
    }

    static func featureURL(feature: String) -> URL? {
        appURL(
            path: "/open-feature",
            queryItems: [URLQueryItem(name: "feature", value: feature)]
        )
    }

    @MainActor
    static func open(_ url: URL) {
        // React Native aún podría estar adjuntando su oyente de Enlace en un lanzamiento frío de Siri.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
    }

    @MainActor
    static func openCapture(task: String, note: String?, tags: String?, project: String?) {
        guard let url = captureURL(task: task, note: note, tags: tags, project: project) else {
            return
        }
        open(url)
    }

    @MainActor
    static func openFeature(feature: String) {
        guard let url = featureURL(feature: feature) else {
            return
        }
        open(url)
    }
}

@available(iOS 16.0, *)
enum MindwtrShortcutList: String, AppEnum {
    case inbox
    case focus
    case waiting
    case someday
    case projects
    case review
    case calendar

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Mindwtr List")
    static var caseDisplayRepresentations: [MindwtrShortcutList: DisplayRepresentation] = [
        .inbox: "Inbox",
        .focus: "Focus",
        .waiting: "Waiting",
        .someday: "Someday",
        .projects: "Projects",
        .review: "Review",
        .calendar: "Calendar"
    ]

    var featureValue: String {
        switch self {
        case .inbox:
            return "inbox"
        case .focus:
            return "focus"
        case .waiting:
            return "waiting"
        case .someday:
            return "someday"
        case .projects:
            return "projects"
        case .review:
            return "review"
        case .calendar:
            return "calendar"
        }
    }

    var dialogTitle: String {
        switch self {
        case .inbox:
            return "Inbox"
        case .focus:
            return "Focus"
        case .waiting:
            return "Waiting"
        case .someday:
            return "Someday"
        case .projects:
            return "Projects"
        case .review:
            return "Review"
        case .calendar:
            return "Calendar"
        }
    }
}

@available(iOS 16.0, *)
struct MindwtrSiriCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture to Mindwtr"
    static var description = IntentDescription("Captures a task into the Mindwtr Inbox for later processing.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        true
    }

    @Parameter(title: "Task")
    var task: String

    @Parameter(title: "Note")
    var note: String?

    @Parameter(title: "Tags")
    var tags: String?

    @Parameter(title: "Project")
    var project: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Capture \(\.$task)") {
            \.$note
            \.$tags
            \.$project
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmedTask = task.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTags = tags?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedProject = project?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTask.isEmpty else {
            return .result(dialog: "Tell Mindwtr what to capture.")
        }

        MindwtrSiriCaptureLauncher.openCapture(
            task: trimmedTask,
            note: trimmedNote?.isEmpty == false ? trimmedNote : nil,
            tags: trimmedTags?.isEmpty == false ? trimmedTags : nil,
            project: trimmedProject?.isEmpty == false ? trimmedProject : nil
        )
        return .result(dialog: "Review it in Mindwtr.")
    }
}

@available(iOS 16.0, *)
struct MindwtrOpenListIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Mindwtr List"
    static var description = IntentDescription("Opens a Mindwtr GTD list or workflow view.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        true
    }

    @Parameter(title: "List", default: MindwtrShortcutList.inbox)
    var list: MindwtrShortcutList

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$list)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        MindwtrSiriCaptureLauncher.openFeature(feature: list.featureValue)
        return .result(dialog: "Opening \(list.dialogTitle) in Mindwtr.")
    }
}

// Las capturas de fondo nunca tocan la base de datos de la aplicación desde Swift. La intención
// appends a JSON payload to Documents/pending-captures/ and the React Native
// side ingests it through the normal store/sync write path on next launch or
// foreground (#845).
private enum MindwtrPendingCaptureQueue {
    static let directoryName = "pending-captures"

    // Shortcuts' Date parameter always carries a time even when the user only
    // picked a day; serializing to a local calendar day here keeps due/start
    // dates queue-side date-only so the RN drain never has to guess (mirrors
    // the date-only handling pending-captures.ts applies on read, #755).
    static let dateOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        // Fixed-format dates need a fixed locale (Apple QA1480) -- without it
        // a device set to arabic-indic/extended-arabic digits would write
        // non-ASCII digits that the RN drain's ASCII-only date regex quietly
        // discards, silently dropping the picked date.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func directoryURL() -> URL? {
        FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    static func enqueue(
        task: String,
        note: String?,
        tags: String?,
        project: String?,
        dueDate: Date? = nil,
        startDate: Date? = nil
    ) -> Bool {
        guard let directory = directoryURL() else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let id = UUID().uuidString
            var payload: [String: Any] = [
                "id": id,
                "title": task,
                "createdAt": ISO8601DateFormatter().string(from: Date())
            ]
            if let note = MindwtrSiriCaptureLauncher.trimmed(note) {
                payload["note"] = note
            }
            if let tags = MindwtrSiriCaptureLauncher.normalizedCommaList(tags) {
                payload["tags"] = tags
            }
            if let project = MindwtrSiriCaptureLauncher.trimmed(project) {
                payload["project"] = project
            }
            if let dueDate {
                payload["dueDate"] = dateOnlyFormatter.string(from: dueDate)
            }
            if let startDate {
                payload["startDate"] = dateOnlyFormatter.string(from: startDate)
            }
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            try data.write(to: directory.appendingPathComponent("\(id).json"), options: [.atomic])
            return true
        } catch {
            return false
        }
    }
}

@available(iOS 16.0, *)
enum MindwtrBackgroundCaptureError: Error, CustomLocalizedStringResourceConvertible {
    case emptyTask
    case writeFailed

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .emptyTask:
            return "Tell Mindwtr what to add."
        case .writeFailed:
            return "Mindwtr could not save the task. Open the app and try again."
        }
    }
}

@available(iOS 16.0, *)
struct MindwtrBackgroundCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Mindwtr"
    static var description = IntentDescription("Silently adds a task to Mindwtr without opening the app. It can file into a project. The item appears the next time Mindwtr opens.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        false
    }

    @Parameter(title: "Task")
    var task: String

    @Parameter(title: "Note")
    var note: String?

    @Parameter(title: "Tags")
    var tags: String?

    @Parameter(title: "Project")
    var project: String?

    @Parameter(title: "Due date")
    var dueDate: Date?

    @Parameter(title: "Start date")
    var startDate: Date?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$task) to Mindwtr") {
            \.$note
            \.$tags
            \.$project
            \.$dueDate
            \.$startDate
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmedTask = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTask.isEmpty else {
            throw MindwtrBackgroundCaptureError.emptyTask
        }
        guard MindwtrPendingCaptureQueue.enqueue(
            task: trimmedTask,
            note: note,
            tags: tags,
            project: project,
            dueDate: dueDate,
            startDate: startDate
        ) else {
            throw MindwtrBackgroundCaptureError.writeFailed
        }
        // El/La
        // Respaldo de Bandeja de entrada), por lo que el diálogo nunca promete una ubicación específica.
        return .result(dialog: "Added to Mindwtr.")
    }
}

// MARK: - Shortcuts snapshot (Get Tasks + Spotlight)
//
// El/La
// alongside the widget payload (widget-service.ts `updateMobileWidgetFromData`
// -> `buildShortcutsSnapshot`) into the same shared App Group UserDefaults the
// widget already writes to. Background intents and Spotlight indexing here
// only ever READ this key; they never touch Mindwtr's on-device database,
// matching the pending-captures write-only rule for intents (#845, #980).
// Guarded because `items(forList:)` takes the iOS 16+ `MindwtrGetTasksList`
// (deployment target is iOS 15.1) -- every caller is already iOS 16+/18+.
@available(iOS 16.0, *)
private enum MindwtrShortcutsSnapshotStore {
    static let appGroup = "group.tech.dongdongbh.mindwtr"
    static let snapshotKey = "mindwtr-ios-shortcuts-snapshot"

    private static func rawSnapshot() -> [String: Any]? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let jsonString = defaults.string(forKey: snapshotKey),
              let data = jsonString.data(using: .utf8) else {
            return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// Todos los elementos de instantánea, deduplicados por id (una tarea puede aparecer tanto en su lista
    /// bucket and its project bucket).
    static func loadAllItems() -> [MindwtrShortcutsSnapshotItem] {
        guard let root = rawSnapshot() else { return [] }
        var items: [MindwtrShortcutsSnapshotItem] = []
        if let lists = root["lists"] as? [String: [[String: Any]]] {
            for entries in lists.values {
                items.append(contentsOf: entries.compactMap(MindwtrShortcutsSnapshotItem.init(dict:)))
            }
        }
        if let projects = root["projects"] as? [[String: Any]] {
            for project in projects {
                let entries = project["items"] as? [[String: Any]] ?? []
                items.append(contentsOf: entries.compactMap(MindwtrShortcutsSnapshotItem.init(dict:)))
            }
        }
        var seenIds = Set<String>()
        return items.filter { seenIds.insert($0.id).inserted }
    }

    static func items(forList list: MindwtrGetTasksList) -> [MindwtrShortcutsSnapshotItem] {
        guard let root = rawSnapshot(),
              let lists = root["lists"] as? [String: [[String: Any]]],
              let entries = lists[list.rawValue] else {
            return []
        }
        return entries.compactMap(MindwtrShortcutsSnapshotItem.init(dict:))
    }

    static func items(forProjectNamed name: String) -> [MindwtrShortcutsSnapshotItem] {
        let needle = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty,
              let root = rawSnapshot(),
              let projects = root["projects"] as? [[String: Any]],
              let match = projects.first(where: { ($0["name"] as? String)?.lowercased() == needle }) else {
            return []
        }
        let entries = match["items"] as? [[String: Any]] ?? []
        return entries.compactMap(MindwtrShortcutsSnapshotItem.init(dict:))
    }
}

struct MindwtrShortcutsSnapshotItem {
    let id: String
    let title: String
    let list: String
    let dueDate: String?
    let startDate: String?
    let projectId: String?
    let projectName: String?

    init?(dict: [String: Any]) {
        guard let id = dict["id"] as? String, !id.isEmpty,
              let title = dict["title"] as? String, !title.isEmpty else {
            return nil
        }
        self.id = id
        self.title = title
        self.list = dict["list"] as? String ?? ""
        self.dueDate = dict["dueDate"] as? String
        self.startDate = dict["startDate"] as? String
        self.projectId = dict["projectId"] as? String
        self.projectName = dict["projectName"] as? String
    }
}

@available(iOS 16.0, *)
enum MindwtrGetTasksList: String, AppEnum {
    case inbox
    case focus
    case next
    case waiting
    case someday

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Mindwtr Task List")
    static var caseDisplayRepresentations: [MindwtrGetTasksList: DisplayRepresentation] = [
        .inbox: "Inbox",
        .focus: "Focus",
        .next: "Next",
        .waiting: "Waiting",
        .someday: "Someday"
    ]

    var dialogTitle: String {
        switch self {
        case .inbox: return "Inbox"
        case .focus: return "Focus"
        case .next: return "Next"
        case .waiting: return "Waiting"
        case .someday: return "Someday"
        }
    }
}

// A task's stored dueDate can be date-only ("yyyy-MM-dd", e.g. from the
// Parámetros de fecha de Atajos arriba) o una fecha/hora ISO completa (desde cualquier otro lugar en
// the app). Display must not just interpolate whichever raw string it is --
// date-only stays date-only, a timed value renders a localized short
// date+time instead of raw ISO text.
private enum MindwtrTaskDueDateDisplay {
    private static let mediumDateOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    private static let shortDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    private static let isoDateTime: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func format(_ raw: String) -> String {
        if let dateOnly = MindwtrPendingCaptureQueue.dateOnlyFormatter.date(from: raw) {
            return mediumDateOnly.string(from: dateOnly)
        }
        if let dateTime = ISO8601DateFormatter().date(from: raw) ?? isoDateTime.date(from: raw) {
            return shortDateTime.string(from: dateTime)
        }
        return raw
    }

    static func date(_ raw: String) -> Date? {
        MindwtrPendingCaptureQueue.dateOnlyFormatter.date(from: raw)
            ?? ISO8601DateFormatter().date(from: raw)
            ?? isoDateTime.date(from: raw)
    }
}

// MindwtrTaskEntity itself stays a plain AppEntity available from iOS 16 --
// EntityStringQuery and Get Tasks results both need it there. IndexedEntity
// (iOS 18+) is added in a separate `@available` extension below with a manual
// `attributeSet`, because `@Property(indexingKey:)` on a stored property
// would raise this whole type's minimum availability past iOS 16.
@available(iOS 16.0, *)
struct MindwtrTaskEntity: AppEntity {
    let id: String
    let title: String
    let listLabel: String
    let dueDate: String?
    let openFeature: String

    static var typeDisplayRepresentation = TypeDisplayRepresentation(
        name: "Mindwtr Task",
        numericFormat: "\(placeholder: .int) tasks"
    )

    var displayRepresentation: DisplayRepresentation {
        if let dueDate, !dueDate.isEmpty {
            let formattedDueDate = MindwtrTaskDueDateDisplay.format(dueDate)
            return DisplayRepresentation(title: "\(title)", subtitle: "\(listLabel) · Due \(formattedDueDate)")
        }
        return DisplayRepresentation(title: "\(title)", subtitle: "\(listLabel)")
    }

    static var defaultQuery = MindwtrTaskEntityQuery()

    init(item: MindwtrShortcutsSnapshotItem) {
        id = item.id
        title = item.title
        dueDate = item.dueDate
        if let projectName = item.projectName, !projectName.isEmpty {
            listLabel = projectName
            openFeature = "projects"
        } else {
            listLabel = MindwtrGetTasksList(rawValue: item.list)?.dialogTitle ?? item.list.capitalized
            openFeature = item.list.isEmpty ? "inbox" : item.list
        }
    }
}

@available(iOS 16.0, *)
struct MindwtrTaskEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [MindwtrTaskEntity] {
        let idSet = Set(identifiers)
        return MindwtrShortcutsSnapshotStore.loadAllItems()
            .filter { idSet.contains($0.id) }
            .map(MindwtrTaskEntity.init(item:))
    }

    func entities(matching string: String) async throws -> [MindwtrTaskEntity] {
        let needle = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return [] }
        return MindwtrShortcutsSnapshotStore.loadAllItems()
            .filter { $0.title.lowercased().contains(needle) }
            .prefix(25)
            .map(MindwtrTaskEntity.init(item:))
    }
}

// Spotlight indexing (#980, Stage 3). Guarded to iOS 18+ where IndexedEntity
// and CSSearchableIndex.indexAppEntities(_:) are available; the base entity
// above stays usable from iOS 16 for Shortcuts/Get Tasks regardless.
@available(iOS 18.0, *)
extension MindwtrTaskEntity: IndexedEntity {
    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: .item)
        attributes.title = title
        attributes.contentDescription = listLabel
        if let dueDate, let parsedDueDate = MindwtrTaskDueDateDisplay.date(dueDate) {
            attributes.dueDate = parsedDueDate
        }
        // Reuses the same mindwtr:// scheme + open-feature route every other
        // deep link in this file already opens (#755) -- tapping a Spotlight
        // result opens Mindwtr to the task's containing list. A per-task open
        // route doesn't exist yet, so the containing list is the v2 target.
        attributes.contentURL = MindwtrSiriCaptureLauncher.featureURL(feature: openFeature)
        return attributes
    }
}

@available(iOS 16.0, *)
struct MindwtrGetTasksIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Mindwtr Tasks"
    static var description = IntentDescription("Reads up to 50 tasks from a Mindwtr list, as of the last time Mindwtr was open. When Project is set, it is read instead of the list. Never opens the app.")

#if compiler(>=6.0)
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes {
        .background
    }
#endif

    @available(*, deprecated, message: "Use supportedModes with newer App Intents SDKs.")
    static var openAppWhenRun: Bool {
        false
    }

    @Parameter(title: "List", default: MindwtrGetTasksList.next)
    var list: MindwtrGetTasksList

    @Parameter(title: "Project")
    var project: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Get tasks from \(\.$list), overridden by \(\.$project) if set")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<[MindwtrTaskEntity]> & ProvidesDialog {
        let trimmedProject = project?.trimmingCharacters(in: .whitespacesAndNewlines)
        let items: [MindwtrShortcutsSnapshotItem]
        if let trimmedProject, !trimmedProject.isEmpty {
            items = MindwtrShortcutsSnapshotStore.items(forProjectNamed: trimmedProject)
        } else {
            items = MindwtrShortcutsSnapshotStore.items(forList: list)
        }

        let entities = items.map(MindwtrTaskEntity.init(item:))
        guard !entities.isEmpty else {
            return .result(value: [], dialog: "No tasks found. Open Mindwtr to refresh this list.")
        }
        return .result(value: entities, dialog: "Found \(entities.count) task(s).")
    }
}

// Reindexing is driven by the app's own refresh path (AppDelegate launch,
// wired by the plugin -- see addSiriShortcutsRegistrationToAppDelegate in
// ios-widgets-and-shortcuts.js), never by an intent's perform(): intents stay
// read-only against the snapshot.
@available(iOS 18.0, *)
enum MindwtrShortcutsSpotlightIndexer {
    static func reindexIfNeeded() {
        let items = MindwtrShortcutsSnapshotStore.loadAllItems()
        let entities = items.map(MindwtrTaskEntity.init(item:))
        Task {
            // indexAppEntities only adds/updates -- a task that's completed,
            // deleted, or fell off the snapshot cap since the last launch
            // would otherwise stay searchable forever. Mindwtr indexes
            // nothing else in Spotlight, so a full clear-then-replace per
            // launch is simpler and cheap enough at this cap than tracking
            // which ids to remove.
            try? await CSSearchableIndex.default().deleteAllSearchableItems()
            guard !entities.isEmpty else { return }
            try? await CSSearchableIndex.default().indexAppEntities(entities)
        }
    }
}

@available(iOS 16.0, *)
struct MindwtrSiriCaptureShortcuts: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor {
        .blue
    }

    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: MindwtrSiriCaptureIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "Add to \(.applicationName)",
                "Create a task in \(.applicationName)"
            ],
            shortTitle: "Capture Task",
            systemImageName: "tray.and.arrow.down"
        )
        AppShortcut(
            intent: MindwtrOpenListIntent(),
            phrases: [
                "Open \(.applicationName)",
                "Open a list in \(.applicationName)",
                "Show \(.applicationName)"
            ],
            shortTitle: "Open List",
            systemImageName: "list.bullet"
        )
    }
}
