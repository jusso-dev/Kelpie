# Kelpie for iOS

Kelpie for iOS is the triage-first companion for the self-hosted Kelpie web app. It targets iOS 26 and uses SwiftUI, Swift Concurrency, Keychain Services and UserNotifications without third-party dependencies.

## Run

1. Open `Kelpie.xcodeproj` in Xcode 26 or newer.
2. Select the `Kelpie` scheme and an iPhone simulator.
3. Sign in with the URL and credentials from the same Kelpie deployment used by the web console. Local development accepts `http://localhost:3000`; production connections require HTTPS.

The app provides open cases, case detail, comments, task completion, alert acknowledge/dismiss/promote, and notification deep links. Bearer sessions are stored with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and removed on sign out.

## Push notifications

Enable the Push Notifications capability for your signing team. The app uploads the current APNs token on every registration callback and unregisters it on sign out. Notification permission is requested from Settings; APNs registration itself is independent of alert permission.

For simulator deep-link testing:

```bash
xcrun simctl push booted dev.kelpie.mobile Kelpie/Resources/critical-alert.apns
```
