import SwiftUI
import UserNotifications

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined

    var body: some View {
        List {
            Section("Account") {
                if let user = session.user {
                    LabeledContent("Name", value: user.name)
                    LabeledContent("Email", value: user.email)
                    LabeledContent("Role", value: user.role.replacingOccurrences(of: "_", with: " "))
                }
                LabeledContent("Server", value: session.serverAddress)
            }
            Section("Notifications") {
                LabeledContent("Permission", value: statusLabel)
                if notificationStatus == .denied {
                    Button("Open system settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                } else if notificationStatus == .notDetermined {
                    Button("Enable notifications") {
                        Task { notificationStatus = await NotificationService.requestPermission() }
                    }
                } else {
                    Text("Critical alerts, assigned-case SLA breaches and mentions can open directly in Kelpie.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
            }
        }
        .navigationTitle("Settings")
        .task { notificationStatus = await NotificationService.status() }
    }

    private var statusLabel: String {
        switch notificationStatus {
        case .authorized: "Allowed"
        case .denied: "Denied"
        case .provisional: "Provisional"
        case .ephemeral: "Temporary"
        case .notDetermined: "Not requested"
        @unknown default: "Unknown"
        }
    }
}
