import SwiftUI
import WebKit

/// WKWebView subclass that suppresses the native right-click context menu,
/// allowing JavaScript `contextmenu` events to fire normally.
class NoContextMenuWebView: WKWebView {
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        menu.removeAllItems()
    }
    override func menu(for event: NSEvent) -> NSMenu? {
        return nil
    }
}

struct MainWindow: View {
    @StateObject private var viewModel = MainWindowViewModel()

    var body: some View {
        ZStack {
            WebViewContainer(viewModel: viewModel)
                .opacity(viewModel.isLoaded ? 1.0 : 0.0)
                .animation(.easeIn(duration: 0.3), value: viewModel.isLoaded)

            if !viewModel.isLoaded {
                SplashView()
                    .transition(.opacity)
            }
        }
        .background(Color.black)
        .onAppear {
            viewModel.subscribeToMenuNotifications()
            viewModel.checkAutoRecovery()
        }
    }
}

// MARK: - ViewModel

@MainActor
final class MainWindowViewModel: ObservableObject {
    @Published var isLoaded = false
    let bridge = WebViewBridge()

    private let projectManager = ProjectManager.shared

    /// Notification observers that need to be retained.
    private var observers: [NSObjectProtocol] = []

    func markLoaded() {
        withAnimation {
            isLoaded = true
        }
    }

    // MARK: - Menu Notification Wiring

    func subscribeToMenuNotifications() {
        let nc = NotificationCenter.default

        observers.append(nc.addObserver(forName: .newProject, object: nil, queue: .main) { [weak self] _ in
            self?.handleNewProject()
        })

        observers.append(nc.addObserver(forName: .openProject, object: nil, queue: .main) { [weak self] note in
            if let url = note.object as? URL {
                self?.bridge.loadProject(from: url)
            }
        })

        observers.append(nc.addObserver(forName: .saveProject, object: nil, queue: .main) { [weak self] _ in
            self?.handleSave()
        })

        observers.append(nc.addObserver(forName: .saveProjectAs, object: nil, queue: .main) { [weak self] note in
            if let url = note.object as? URL {
                self?.bridge.saveProject(to: url)
            }
        })

        observers.append(nc.addObserver(forName: .openRecentProject, object: nil, queue: .main) { [weak self] note in
            if let url = note.object as? URL {
                self?.bridge.loadProject(from: url)
            }
        })
    }

    // MARK: - Project Actions

    private func handleNewProject() {
        bridge.newProject()
    }

    private func handleSave() {
        // If the project already has a file URL, save in place.
        // Otherwise, show Save As dialog.
        if !bridge.saveCurrentProject() {
            showSaveAsPanel()
        }
    }

    private func showSaveAsPanel() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.init(filenameExtension: "magicdaw")].compactMap { $0 }
        panel.nameFieldStringValue = bridge.currentProject?.name ?? "Untitled"
        panel.begin { [weak self] response in
            if response == .OK, let url = panel.url {
                self?.bridge.saveProject(to: url)
            }
        }
    }

    // MARK: - Auto-Recovery

    func checkAutoRecovery() {
        let autoSaves = projectManager.recoverAutoSaves()
        guard !autoSaves.isEmpty else { return }

        // Show alert on next run loop tick so the window is visible
        DispatchQueue.main.async { [weak self] in
            self?.showAutoRecoveryAlert(autoSaves: autoSaves)
        }
    }

    private func showAutoRecoveryAlert(autoSaves: [URL]) {
        let alert = NSAlert()
        alert.messageText = "Recover Unsaved Project?"
        let count = autoSaves.count
        alert.informativeText = count == 1
            ? "An auto-saved project was found. Would you like to restore it?"
            : "\(count) auto-saved projects were found. Would you like to restore the most recent one?"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Restore")
        alert.addButton(withTitle: "Discard")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn, let newest = autoSaves.first {
            bridge.loadProject(from: newest)
        } else {
            // Clean up all auto-saves
            for url in autoSaves {
                projectManager.deleteAutoSave(at: url)
            }
        }
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}

// MARK: - WebView Container

struct WebViewContainer: NSViewRepresentable {
    let viewModel: MainWindowViewModel

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()

        // Register the bridge message handler
        userContentController.add(viewModel.bridge, name: "magicdaw")

        // Suppress native context menu so JS contextmenu events fire
        let noContextMenuScript = WKUserScript(
            source: "document.addEventListener('contextmenu', function(e) { e.preventDefault(); }, true);",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        userContentController.addUserScript(noContextMenuScript)

        config.userContentController = userContentController

        // Enable media playback
        config.mediaTypesRequiringUserActionForPlayback = []

        // Allow file access for local resources
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        #if DEBUG
        // Enable developer tools in debug builds
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif

        let webView = NoContextMenuWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")

        // Store reference in bridge for sending messages to JS
        viewModel.bridge.webView = webView

        // Load the UI
        loadUI(in: webView)

        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // No updates needed
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    private func loadUI(in webView: WKWebView) {
        #if DEBUG
        // Development: load from Vite dev server
        let devURL = URL(string: "http://localhost:5180")!
        webView.load(URLRequest(url: devURL))
        #else
        // Production: load from embedded resources
        // Try Bundle.main first (Xcode builds), then fall back to executable-relative path (SPM builds)
        let htmlURL: URL? = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "ui")
            ?? {
                let execURL = Bundle.main.executableURL ?? URL(fileURLWithPath: ProcessInfo.processInfo.arguments[0])
                let resourcesDir = execURL
                    .deletingLastPathComponent()       // Contents/MacOS/
                    .deletingLastPathComponent()       // Contents/
                    .appendingPathComponent("Resources")
                    .appendingPathComponent("ui")
                let candidate = resourcesDir.appendingPathComponent("index.html")
                return FileManager.default.fileExists(atPath: candidate.path) ? candidate : nil
            }()

        if let htmlURL {
            webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
        } else {
            print("[MainWindow] ERROR: Could not find ui/index.html in bundle or resources")
        }
        #endif
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate {
        let viewModel: MainWindowViewModel

        init(viewModel: MainWindowViewModel) {
            self.viewModel = viewModel
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in
                viewModel.markLoaded()
                // Start MIDI after the UI is loaded so JS handlers are registered
                viewModel.bridge.startMIDI()

                // Auto-create a blank project if none exists so the Arrange view starts from an empty slate.
                if viewModel.bridge.currentProject == nil {
                    viewModel.bridge.newProject()
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[MainWindow] Navigation failed: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[MainWindow] Provisional navigation failed: \(error.localizedDescription)")
            #if DEBUG
            // In dev mode, retry after a short delay (Vite might still be starting)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                let devURL = URL(string: "http://localhost:5173")!
                webView.load(URLRequest(url: devURL))
            }
            #endif
        }
    }
}
