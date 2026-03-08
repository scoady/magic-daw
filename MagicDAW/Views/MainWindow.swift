import SwiftUI
import WebKit

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
    }
}

// MARK: - ViewModel

@MainActor
final class MainWindowViewModel: ObservableObject {
    @Published var isLoaded = false
    let bridge = WebViewBridge()

    func markLoaded() {
        withAnimation {
            isLoaded = true
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
        config.userContentController = userContentController

        // Enable media playback
        config.mediaTypesRequiringUserActionForPlayback = []

        // Allow file access for local resources
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        #if DEBUG
        // Enable developer tools in debug builds
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif

        let webView = WKWebView(frame: .zero, configuration: config)
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
        let devURL = URL(string: "http://localhost:5173")!
        webView.load(URLRequest(url: devURL))
        #else
        // Production: load from embedded resources
        if let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "ui") {
            webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
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
