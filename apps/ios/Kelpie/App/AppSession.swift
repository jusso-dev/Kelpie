import Observation
import SwiftUI

@Observable
@MainActor
final class AppSession {
    enum Phase { case restoring, signedOut, signedIn }

    private let credentials: any CredentialStore
    @ObservationIgnored private(set) var client: KelpieAPIClient?
    private(set) var phase: Phase = .restoring
    private(set) var user: APIUser?
    private(set) var scopes: Set<String> = []
    var errorMessage: String?
    var serverAddress = UserDefaults.standard.string(forKey: "kelpie.server_url") ?? ""
    private var deviceToken: String?

    init(credentials: any CredentialStore = KeychainStore()) {
        self.credentials = credentials
    }

    var canTriageAlerts: Bool { scopes.contains("alerts:write") }
    var canWriteTasks: Bool { scopes.contains("tasks:write") }
    var canComment: Bool { scopes.contains("comments:write") }

    func restore() async {
        guard let baseURL = validatedURL(serverAddress),
              (try? await credentials.readToken()) != nil else {
            phase = .signedOut
            return
        }
        let client = KelpieAPIClient(baseURL: baseURL, credentials: credentials)
        do {
            let response = try await client.me()
            guard let user = response.user else { throw APIError.unauthenticated }
            self.client = client
            self.user = user
            scopes = Set(response.token.scopes)
            phase = .signedIn
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            try? await credentials.deleteAll()
            phase = .signedOut
        }
    }

    func signIn(email: String, password: String) async {
        errorMessage = nil
        guard let baseURL = validatedURL(serverAddress) else {
            errorMessage = APIError.invalidServerURL.localizedDescription
            return
        }
        do {
            let response = try await KelpieAPIClient.signIn(
                baseURL: baseURL,
                email: email,
                password: password
            )
            try await credentials.saveToken(response.token)
            UserDefaults.standard.set(baseURL.absoluteString, forKey: "kelpie.server_url")
            serverAddress = baseURL.absoluteString
            client = KelpieAPIClient(baseURL: baseURL, credentials: credentials)
            user = response.user
            scopes = Set(response.scopes)
            phase = .signedIn
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        if let token = deviceToken { try? await client?.unregisterDevice(token: token) }
        try? await client?.signOut()
        try? await credentials.deleteAll()
        client = nil
        user = nil
        scopes = []
        phase = .signedOut
    }

    func registerDevice(token: String) async {
        deviceToken = token
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        try? await client?.registerDevice(token: token, environment: environment)
    }

    private func validatedURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed),
              let host = components.host,
              components.scheme == "https" ||
                (components.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)) else {
            return nil
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return components.url
    }
}
