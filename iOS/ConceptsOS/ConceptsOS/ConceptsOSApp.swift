import SwiftUI

@main
struct ConceptsOSApp: App {
    @StateObject private var auth = AuthManager()
    @StateObject private var vmState = VMStateStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
                .environmentObject(vmState)
                .ignoresSafeArea()
        }
    }
}
