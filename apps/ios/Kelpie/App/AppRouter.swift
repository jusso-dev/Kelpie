import Observation
import SwiftUI

enum AppTab: Hashable { case cases, alerts, tasks, settings }

enum AppDestination: Hashable {
    case caseDetail(String)
    case alertDetail(String)
}

@Observable
@MainActor
final class AppRouter {
    var selectedTab: AppTab = .cases
    var casePath = NavigationPath()
    var alertPath = NavigationPath()

    func navigate(to destination: AppDestination) {
        switch destination {
        case .caseDetail:
            selectedTab = .cases
            casePath = NavigationPath()
            casePath.append(destination)
        case .alertDetail:
            selectedTab = .alerts
            alertPath = NavigationPath()
            alertPath.append(destination)
        }
    }
}
