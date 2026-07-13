import UIKit
import UserNotifications
import OSLog

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private let logger = Logger(subsystem: "dev.kelpie.mobile", category: "notifications")
    var router: AppRouter? {
        didSet {
            if let pendingDestination {
                router?.navigate(to: pendingDestination)
                self.pendingDestination = nil
            }
        }
    }
    var deviceTokenHandler: ((String) async -> Void)?
    private var pendingDestination: AppDestination?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let centre = UNUserNotificationCenter.current()
        centre.delegate = self
        centre.setNotificationCategories([
            UNNotificationCategory(
                identifier: "KELPIE_CRITICAL_ALERT",
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: "KELPIE_UPDATE",
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
        ])
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await deviceTokenHandler?(token) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        #if !targetEnvironment(simulator)
        logger.error("APNs registration failed: \(error.localizedDescription, privacy: .public)")
        #endif
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(0) }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge, .list]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        route(userInfo: response.notification.request.content.userInfo)
    }

    private func route(userInfo: [AnyHashable: Any]) {
        guard let type = userInfo["destination_type"] as? String,
              let id = userInfo["destination_id"] as? String else { return }
        let destination: AppDestination = type == "alert" ? .alertDetail(id) : .caseDetail(id)
        if let router { router.navigate(to: destination) } else { pendingDestination = destination }
    }
}
