import SwiftUI

struct SignInView: View {
    @Environment(AppSession.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var isSigningIn = false

    var body: some View {
        @Bindable var session = session
        NavigationStack {
            Form {
                Section {
                    TextField("https://kelpie.example.com", text: $session.serverAddress)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                } header: {
                    Text("Connection")
                } footer: {
                    Text("Use the same account as your Kelpie web console. Production servers must use HTTPS.")
                }

                if let error = session.errorMessage {
                    Section { Text(error).foregroundStyle(.red) }
                }

                Section {
                    Button {
                        isSigningIn = true
                        Task {
                            await session.signIn(email: email, password: password)
                            isSigningIn = false
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if isSigningIn { ProgressView() } else { Text("Sign in").fontWeight(.semibold) }
                            Spacer()
                        }
                    }
                    .disabled(isSigningIn || email.isEmpty || password.isEmpty || session.serverAddress.isEmpty)
                }
            }
            .navigationTitle("Kelpie")
        }
    }
}
