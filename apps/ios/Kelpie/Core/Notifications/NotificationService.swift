import UIKit
import UserNotifications

@MainActor
enum NotificationService {
    static func requestPermission() async -> UNAuthorizationStatus {
        let centre = UNUserNotificationCenter.current()
        let current = await centre.notificationSettings().authorizationStatus
        if current == .notDetermined {
            _ = try? await centre.requestAuthorization(options: [.alert, .sound, .badge])
        }
        UIApplication.shared.registerForRemoteNotifications()
        return await centre.notificationSettings().authorizationStatus
    }

    static func status() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}
