.PHONY: build build-ui build-app dev dev-ui clean

# Build everything
build: build-ui build-app

# Build web UI
build-ui:
	cd MagicDAW-UI && npm install && npm run build

# Build Swift app
build-app:
	swift build -c release

# Development
dev-ui:
	cd MagicDAW-UI && npm run dev

dev:
	swift run & cd MagicDAW-UI && npm run dev

# Clean
clean:
	swift package clean
	rm -rf MagicDAW-UI/dist MagicDAW-UI/node_modules
