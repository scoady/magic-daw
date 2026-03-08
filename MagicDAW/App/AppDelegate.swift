import Cocoa
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var midiManager: MIDIManager?
    private var audioEngine: AudioEngine?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBar()
    }

    func applicationWillTerminate(_ notification: Notification) {
        audioEngine?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // MARK: - Menu Bar

    private func setupMenuBar() {
        let mainMenu = NSMenu()

        // Application menu
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Magic DAW", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Preferences...", action: #selector(showPreferences), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Magic DAW", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appMenuItem = NSMenuItem()
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // File menu
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "New Project", action: #selector(newProject), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Open...", action: #selector(openProject), keyEquivalent: "o")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Save", action: #selector(saveProject), keyEquivalent: "s")
        fileMenu.addItem(withTitle: "Save As...", action: #selector(saveProjectAs), keyEquivalent: "S")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Export Audio...", action: #selector(exportAudio), keyEquivalent: "e")
        let fileMenuItem = NSMenuItem()
        fileMenuItem.submenu = fileMenu
        mainMenu.addItem(fileMenuItem)

        // Edit menu
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editMenuItem = NSMenuItem()
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // View menu
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Toggle Mixer", action: #selector(toggleMixer), keyEquivalent: "m")
        viewMenu.addItem(withTitle: "Toggle Piano Roll", action: #selector(togglePianoRoll), keyEquivalent: "p")
        viewMenu.addItem(withTitle: "Toggle Node Editor", action: #selector(toggleNodeEditor), keyEquivalent: "g")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        let viewMenuItem = NSMenuItem()
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // Transport menu
        let transportMenu = NSMenu(title: "Transport")
        transportMenu.addItem(withTitle: "Play / Pause", action: #selector(togglePlayback), keyEquivalent: " ")
        transportMenu.addItem(withTitle: "Stop", action: #selector(stopPlayback), keyEquivalent: "\r")
        transportMenu.addItem(withTitle: "Record", action: #selector(toggleRecord), keyEquivalent: "r")
        transportMenu.addItem(.separator())
        transportMenu.addItem(withTitle: "Go to Beginning", action: #selector(goToBeginning), keyEquivalent: "\r")
        let transportMenuItem = NSMenuItem()
        transportMenuItem.submenu = transportMenu
        mainMenu.addItem(transportMenuItem)

        // Help menu
        let helpMenu = NSMenu(title: "Help")
        helpMenu.addItem(withTitle: "Magic DAW Help", action: #selector(showHelp), keyEquivalent: "?")
        let helpMenuItem = NSMenuItem()
        helpMenuItem.submenu = helpMenu
        mainMenu.addItem(helpMenuItem)

        NSApplication.shared.mainMenu = mainMenu
    }

    // MARK: - Menu Actions

    @objc private func showPreferences() {
        // Will open preferences window
    }

    @objc private func newProject() {
        NotificationCenter.default.post(name: .newProject, object: nil)
    }

    @objc private func openProject() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.init(filenameExtension: "magicdaw")].compactMap { $0 }
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.begin { response in
            if response == .OK, let url = panel.url {
                NotificationCenter.default.post(name: .openProject, object: url)
            }
        }
    }

    @objc private func saveProject() {
        NotificationCenter.default.post(name: .saveProject, object: nil)
    }

    @objc private func saveProjectAs() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.init(filenameExtension: "magicdaw")].compactMap { $0 }
        panel.begin { response in
            if response == .OK, let url = panel.url {
                NotificationCenter.default.post(name: .saveProjectAs, object: url)
            }
        }
    }

    @objc private func exportAudio() {
        NotificationCenter.default.post(name: .exportAudio, object: nil)
    }

    @objc private func toggleMixer() {
        NotificationCenter.default.post(name: .toggleMixer, object: nil)
    }

    @objc private func togglePianoRoll() {
        NotificationCenter.default.post(name: .togglePianoRoll, object: nil)
    }

    @objc private func toggleNodeEditor() {
        NotificationCenter.default.post(name: .toggleNodeEditor, object: nil)
    }

    @objc private func togglePlayback() {
        NotificationCenter.default.post(name: .togglePlayback, object: nil)
    }

    @objc private func stopPlayback() {
        NotificationCenter.default.post(name: .stopPlayback, object: nil)
    }

    @objc private func toggleRecord() {
        NotificationCenter.default.post(name: .toggleRecord, object: nil)
    }

    @objc private func goToBeginning() {
        NotificationCenter.default.post(name: .goToBeginning, object: nil)
    }

    @objc private func showHelp() {
        NSWorkspace.shared.open(URL(string: "https://github.com/scoady/magic-daw")!)
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let newProject = Notification.Name("com.magicdaw.newProject")
    static let openProject = Notification.Name("com.magicdaw.openProject")
    static let saveProject = Notification.Name("com.magicdaw.saveProject")
    static let saveProjectAs = Notification.Name("com.magicdaw.saveProjectAs")
    static let exportAudio = Notification.Name("com.magicdaw.exportAudio")
    static let toggleMixer = Notification.Name("com.magicdaw.toggleMixer")
    static let togglePianoRoll = Notification.Name("com.magicdaw.togglePianoRoll")
    static let toggleNodeEditor = Notification.Name("com.magicdaw.toggleNodeEditor")
    static let togglePlayback = Notification.Name("com.magicdaw.togglePlayback")
    static let stopPlayback = Notification.Name("com.magicdaw.stopPlayback")
    static let toggleRecord = Notification.Name("com.magicdaw.toggleRecord")
    static let goToBeginning = Notification.Name("com.magicdaw.goToBeginning")
}
