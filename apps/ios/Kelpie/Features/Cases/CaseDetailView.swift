import SwiftUI

struct CaseDetailView: View {
    let caseID: String
    @Environment(AppSession.self) private var session
    @State private var model = CaseDetailModel()
    @State private var comment = ""
    @State private var isPosting = false

    var body: some View {
        Group {
            if model.isLoading || model.item == nil {
                ProgressView("Loading case…")
            } else if let item = model.item {
                List {
                    Section {
                        Text(item.title).font(.title3.weight(.semibold))
                        HStack {
                            OperationalBadge(text: item.severity.rawValue, colour: item.severity.colour)
                            OperationalBadge(text: item.status.rawValue, colour: .blue)
                            OperationalBadge(text: "TLP \(item.tlp)", colour: .orange)
                        }
                    }
                    if let summary = item.summary, !summary.isEmpty {
                        Section("Summary") { Text(summary) }
                    }
                    Section("Tasks") {
                        if item.tasks?.isEmpty != false { Text("No tasks").foregroundStyle(.secondary) }
                        ForEach(item.tasks ?? []) { task in
                            HStack(alignment: .top) {
                                VStack(alignment: .leading) {
                                    Text(task.title)
                                    if let due = task.dueAt { Text(due, style: .relative).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                if task.status == .done {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                } else if session.canWriteTasks {
                                    Button("Done") { Task { await model.complete(task, using: session.client) } }
                                        .buttonStyle(.bordered)
                                }
                            }
                        }
                    }
                    Section("Observables") {
                        if item.observables?.isEmpty != false { Text("No observables").foregroundStyle(.secondary) }
                        ForEach(item.observables ?? []) { observable in
                            VStack(alignment: .leading) {
                                Text(observable.type.uppercased()).font(.caption).foregroundStyle(.secondary)
                                Text(observable.value).font(.body.monospaced()).textSelection(.enabled)
                            }
                        }
                    }
                    Section("Comments") {
                        ForEach(model.comments) { value in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(value.body)
                                Text(value.createdAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if session.canComment {
                            TextField("Add a concise update", text: $comment, axis: .vertical)
                                .lineLimit(2...5)
                            Button(isPosting ? "Posting…" : "Post comment") {
                                isPosting = true
                                Task {
                                    if await model.postComment(comment, caseID: caseID, using: session.client) { comment = "" }
                                    isPosting = false
                                }
                            }
                            .disabled(isPosting || comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }
                .refreshable { await model.load(id: caseID, using: session.client) }
                .navigationTitle(item.caseNumber)
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        .task(id: caseID) { await model.load(id: caseID, using: session.client) }
        .alert("Action failed", isPresented: .constant(model.errorMessage != nil)) {
            Button("OK") { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
    }
}
