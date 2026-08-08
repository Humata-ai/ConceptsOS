import SwiftUI

struct ContentView: View {
    // Dan's dev machine on the LAN. Change this if your IP moves.
    private let url = URL(string: "http://192.168.1.230:3000")!

    var body: some View {
        WebView(url: url)
            .ignoresSafeArea()
    }
}

#Preview {
    ContentView()
}
