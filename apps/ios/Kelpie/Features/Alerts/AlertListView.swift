import SwiftUI

struct AlertListView: View {
    @Environment(AppSession.self) private var session
    @State private var model = AlertListModel()
    @State private var searchText = ""

    private var filtered: [AlertRecord] {
        searchText.isEmpty ? model.alerts : model.alerts.filter {
            $0.title.localizedCaseInsensitiveContains(searchText) ||
            $0.source.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        Group {
            if model.isLoading {
                ProgressView("Loading alerts…")
            } else if filtered.isEmpty {
                ContentUnavailableView("No alerts need triage", systemImage: "checkmark.shield")
            } else {
                List(filtered) { alert in
                    NavigationLink(value: AppDestination.alertDetail(alert.id)) {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                OperationalBadge(text: alert.severity.rawValue, colour: alert.severity.colour)
                                OperationalBadge(text: alert.status.rawValue, colour: .blue)
                                Spacer()
                                Text(alert.createdAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                            }
                            Text(alert.title).font(.body.weight(.medium)).lineLimit(2)
                            Text(alert.source).font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                .refreshable { await model.load(using: session.client) }
            }
        }
        .navigationTitle("Alerts")
        .searchable(text: $searchText, prompt: "Title or source")
        .task { await model.load(using: session.client) }
        .alert("Couldn’t load alerts", isPresented: .constant(model.errorMessage != nil)) {
            Button("OK") { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
    }
}
