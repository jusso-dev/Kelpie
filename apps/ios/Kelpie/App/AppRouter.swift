import Observation
import SwiftUI

enum AppTab: Hashable { case cases, tasks, settings }

enum AppDestination: Hashable {
    case caseDetail(String)
}

@Observable
@MainActor
final class AppRouter {
    var selectedTab: AppTab = .cases
    var casePath = NavigationPath()

    func navigate(to destination: AppDestination) {
        switch destination {
        case .caseDetail:
            selectedTab = .cases
            casePath = NavigationPath()
            casePath.append(destination)
        }
    }
}
