import SwiftUI

struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        switch session.phase {
        case .restoring:
            ProgressView("Opening Kelpie…")
        case .signedOut:
            SignInView()
        case .signedIn:
            MainTabView()
        }
    }
}

private struct MainTabView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            Tab("Cases", systemImage: "folder", value: AppTab.cases) {
                NavigationStack(path: $router.casePath) {
                    CaseListView()
                        .navigationDestination(for: AppDestination.self) { destination in
                            if case .caseDetail(let id) = destination { CaseDetailView(caseID: id) }
                        }
                }
            }
            Tab("Alerts", systemImage: "exclamationmark.triangle", value: AppTab.alerts) {
                NavigationStack(path: $router.alertPath) {
                    AlertListView()
                        .navigationDestination(for: AppDestination.self) { destination in
                            if case .alertDetail(let id) = destination { AlertDetailView(alertID: id) }
                            if case .caseDetail(let id) = destination { CaseDetailView(caseID: id) }
                        }
                }
            }
            Tab("Tasks", systemImage: "checklist", value: AppTab.tasks) {
                NavigationStack { TaskListView() }
            }
            Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack { SettingsView() }
            }
        }
        .tint(.blue)
    }
}
