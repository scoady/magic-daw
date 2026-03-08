import SwiftUI

@main
struct MagicDAWApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            MainWindow()
                .frame(minWidth: 1280, minHeight: 800)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1920, height: 1080)
    }
}
