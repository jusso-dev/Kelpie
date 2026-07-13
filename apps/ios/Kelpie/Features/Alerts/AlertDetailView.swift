import SwiftUI

struct AlertDetailView: View {
    let alertID: String
    @Environment(AppSession.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var model = AlertDetailModel()
    @State private var confirmDismiss = false

    var body: some View {
        Group {
            if model.isLoading || model.alert == nil {
                ProgressView("Loading alert…")
            } else if let alert = model.alert {
                List {
                    Section {
                        Text(alert.title).font(.title3.weight(.semibold))
                        HStack {
                            OperationalBadge(text: alert.severity.rawValue, colour: alert.severity.colour)
                            OperationalBadge(text: alert.status.rawValue, colour: .blue)
                        }
                        LabeledContent("Source", value: alert.source)
                        LabeledContent("Received") { Text(alert.createdAt, style: .relative) }
                    }
                    if let description = alert.description, !description.isEmpty {
                        Section("Description") { Text(description).textSelection(.enabled) }
                    }
                    if session.canTriageAlerts && (alert.status == .new || alert.status == .triaged) {
                        Section {
                            if alert.status == .new {
                                Button {
                                    Task { _ = await model.act(.acknowledge, id: alertID, using: session.client) }
                                } label: {
                                    Label("Acknowledge", systemImage: "checkmark.circle.fill")
                                        .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(model.isActing)
                            }
                            Button {
                                Task {
                                    if let caseID = await model.act(.promote, id: alertID, using: session.client) {
                                        router.navigate(to: .caseDetail(caseID))
                                    }
                                }
                            } label: { Label("Promote to case", systemImage: "folder.badge.plus") }
                            .disabled(model.isActing)
                            Button("Dismiss alert", role: .destructive) { confirmDismiss = true }
                                .disabled(model.isActing)
                        } header: {
                            Text("Triage")
                        } footer: {
                            Text("Acknowledge records triage without creating a case. Dismiss only when no investigation is required.")
                        }
                    }
                }
                .navigationTitle("Alert")
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        .task(id: alertID) { await model.load(id: alertID, using: session.client) }
        .confirmationDialog(
            "Dismiss this alert?",
            isPresented: $confirmDismiss,
            titleVisibility: .visible
        ) {
            Button("Dismiss alert", role: .destructive) {
                Task { _ = await model.act(.dismiss, id: alertID, using: session.client) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The alert will leave the active triage queue. This action remains auditable.") }
        .alert("Action failed", isPresented: .constant(model.errorMessage != nil)) {
            Button("OK") { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
    }
}
