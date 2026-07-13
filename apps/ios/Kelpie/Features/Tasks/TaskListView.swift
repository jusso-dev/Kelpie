import SwiftUI

struct TaskListView: View {
    @Environment(AppSession.self) private var session
    @State private var model = TaskListModel()
    @State private var mine = true

    var body: some View {
        Group {
            if model.isLoading {
                ProgressView("Loading tasks…")
            } else if model.tasks.isEmpty {
                ContentUnavailableView("No open tasks", systemImage: "checkmark.circle", description: Text(mine ? "You have no assigned work." : "The team task queue is clear."))
            } else {
                List(model.tasks) { task in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack {
                            Text(task.caseNumber ?? "Case").font(.caption.monospaced().weight(.semibold))
                            if let severity = task.caseSeverity { OperationalBadge(text: severity.rawValue, colour: severity.colour) }
                            Spacer()
                            if session.canWriteTasks {
                                Button("Done") { Task { await model.complete(task, using: session.client) } }
                                    .buttonStyle(.bordered)
                            }
                        }
                        Text(task.title).font(.body.weight(.medium))
                        if let caseTitle = task.caseTitle { Text(caseTitle).font(.caption).foregroundStyle(.secondary) }
                        if let due = task.dueAt {
                            Label { Text(due, style: .relative) } icon: { Image(systemName: "clock") }
                                .font(.caption)
                                .foregroundStyle(due < Date() ? .red : .secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .refreshable { await model.load(mine: mine, using: session.client) }
            }
        }
        .navigationTitle("Tasks")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("Task owner", selection: $mine) {
                    Text("Mine").tag(true)
                    Text("Team").tag(false)
                }
                .pickerStyle(.menu)
            }
        }
        .task(id: mine) { await model.load(mine: mine, using: session.client) }
        .alert("Action failed", isPresented: .constant(model.errorMessage != nil)) {
            Button("OK") { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
    }
}
