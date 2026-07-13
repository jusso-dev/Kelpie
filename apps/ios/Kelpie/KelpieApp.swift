import SwiftUI

@main
struct KelpieApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = AppSession()
    @State private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(router)
                .task {
                    appDelegate.router = router
                    appDelegate.deviceTokenHandler = { token in
                        await session.registerDevice(token: token)
                    }
                    await session.restore()
                }
        }
    }
}
