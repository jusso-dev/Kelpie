import SwiftUI

struct CaseListView: View {
    @Environment(AppSession.self) private var session
    @State private var model = CaseListModel()
    @State private var searchText = ""

    private var filteredCases: [CaseRecord] {
        guard !searchText.isEmpty else { return model.cases }
        return model.cases.filter {
            $0.caseNumber.localizedCaseInsensitiveContains(searchText) ||
            $0.title.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        Group {
            if model.isLoading {
                ProgressView("Loading cases…")
            } else if filteredCases.isEmpty {
                ContentUnavailableView(
                    searchText.isEmpty ? "No open cases" : "No matching cases",
                    systemImage: "folder",
                    description: Text(searchText.isEmpty ? "The active case queue is clear." : "Try another case number or title.")
                )
            } else {
                List(filteredCases) { item in
                    NavigationLink(value: AppDestination.caseDetail(item.id)) {
                        CaseRow(item: item)
                    }
                }
                .refreshable { await model.load(using: session.client) }
            }
        }
        .navigationTitle("Cases")
        .searchable(text: $searchText, prompt: "Case number or title")
        .task { await model.load(using: session.client) }
        .alert("Couldn’t load cases", isPresented: .constant(model.errorMessage != nil)) {
            Button("Try again") { Task { await model.load(using: session.client) } }
            Button("Cancel", role: .cancel) { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
    }
}

private struct CaseRow: View {
    let item: CaseRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(item.caseNumber).font(.caption.monospaced().weight(.semibold))
                Spacer()
                OperationalBadge(text: item.severity.rawValue, colour: item.severity.colour)
                OperationalBadge(text: item.status.rawValue, colour: .blue)
            }
            Text(item.title).font(.body.weight(.medium)).lineLimit(2)
            HStack {
                Text(item.classification.replacingOccurrences(of: "_", with: " "))
                Spacer()
                Text(item.updatedAt, style: .relative)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
