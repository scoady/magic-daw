.PHONY: build build-ui build-app bundle dmg dev dev-ui clean release

APP_NAME := Magic DAW
BUNDLE_ID := com.scoady.magic-daw
VERSION := 0.1.0
BUILD_DIR := .build/release
APP_BUNDLE := dist/$(APP_NAME).app
DMG_NAME := MagicDAW-$(VERSION).dmg

# Build everything
build: build-ui build-app

# Build web UI
build-ui:
	cd MagicDAW-UI && npm install && npm run build

# Build Swift app
build-app:
	swift build -c release

# Create .app bundle
bundle: build
	@echo "Creating $(APP_NAME).app bundle..."
	rm -rf "$(APP_BUNDLE)"
	mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	mkdir -p "$(APP_BUNDLE)/Contents/Resources/ui"
	mkdir -p "$(APP_BUNDLE)/Contents/Resources/DemoInstruments"
	# Copy binary
	cp $(BUILD_DIR)/MagicDAW "$(APP_BUNDLE)/Contents/MacOS/MagicDAW"
	# Copy web UI
	cp -R MagicDAW-UI/dist/* "$(APP_BUNDLE)/Contents/Resources/ui/"
	# Copy bundled demo instruments
	cp -R DemoInstruments/* "$(APP_BUNDLE)/Contents/Resources/DemoInstruments/"
	# Copy Info.plist
	cp Info.plist "$(APP_BUNDLE)/Contents/Info.plist"
	# Copy icon if it exists
	@if [ -f Resources/AppIcon.icns ]; then \
		cp Resources/AppIcon.icns "$(APP_BUNDLE)/Contents/Resources/AppIcon.icns"; \
	fi
	@echo "Built: $(APP_BUNDLE)"

# Create DMG
dmg: bundle
	@echo "Creating $(DMG_NAME)..."
	rm -f "dist/$(DMG_NAME)"
	hdiutil create -volname "$(APP_NAME)" \
		-srcfolder "$(APP_BUNDLE)" \
		-ov -format UDZO \
		"dist/$(DMG_NAME)"
	@echo "Built: dist/$(DMG_NAME)"

# Full release build
release: dmg
	@echo "Release complete: dist/$(DMG_NAME)"

# Development
dev-ui:
	cd MagicDAW-UI && npm run dev

dev:
	swift run & cd MagicDAW-UI && npm run dev

# Clean
clean:
	swift package clean
	rm -rf MagicDAW-UI/dist MagicDAW-UI/node_modules dist
