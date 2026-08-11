// The signed-out welcome screen.
//
// Uses Apple's SignInWithAppleButton (SwiftUI) so we get the official
// look-and-feel. Nonce lifecycle lives in the button's callbacks; the
// resulting ID token is passed to AuthManager which exchanges it for
// a Supabase session.

import SwiftUI
import AuthenticationServices

struct WelcomeView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 12) {
                Text("ConceptsOS")
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                Text("Your personal AI-native computer.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            Spacer()

            VStack(spacing: 12) {
                SignInWithAppleButton(
                    .signIn,
                    onRequest: { request in
                        auth.prepareAppleRequest(request)
                    },
                    onCompletion: { result in
                        auth.handleAppleCompletion(result)
                    }
                )
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .disabled(auth.isAuthenticating)
                .accessibilityIdentifier("signInWithAppleButton")

                if let msg = auth.errorMessage {
                    Text(msg)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Text("By signing in you agree to our Terms of Service.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .accessibilityIdentifier("welcomeView")
    }
}

#Preview {
    WelcomeView().environmentObject(AuthManager())
}
