# Otaku — Build targets for desktop, Android, and iOS
#
# Usage:
#   make dev            — Run desktop dev server
#   make build          — Build desktop release
#   make android        — Build Android APK (aarch64)
#   make android-dev    — Run Android dev on connected device
#   make android-init   — (Re)generate Android project scaffolding
#   make ios            — Build iOS IPA (requires Xcode + signing)
#   make ios-dev        — Run iOS dev in simulator
#   make ios-init       — (Re)generate iOS project scaffolding
#   make setup          — Install all build prerequisites
#   make clean          — Remove build artifacts

# ─── Environment ─────────────────────────────────────────────────
ANDROID_HOME     ?= /opt/homebrew/share/android-commandlinetools
NDK_VERSION      ?= 27.1.12297006
NDK_HOME         := $(ANDROID_HOME)/ndk/$(NDK_VERSION)
NDK_TOOLCHAIN   := $(NDK_HOME)/toolchains/llvm/prebuilt/darwin-x86_64
JAVA_HOME        ?= /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
ANDROID_API      ?= 30

# Output directories
APK_OUTPUT       := src-tauri/gen/android/app/build/outputs/apk
IPA_OUTPUT       := src-tauri/gen/apple/build

# App version (read from package.json)
VERSION          := $(shell node -p "require('./package.json').version")

# Final artifact directory
DIST_DIR         := dist

# NDK cross-compilation env (needed for rquickjs-sys bindgen + C deps)
export ANDROID_HOME
export NDK_HOME
export JAVA_HOME
export CC_aarch64_linux_android        := $(NDK_TOOLCHAIN)/bin/aarch64-linux-android$(ANDROID_API)-clang
export AR_aarch64_linux_android        := $(NDK_TOOLCHAIN)/bin/llvm-ar
export BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android := --sysroot=$(NDK_TOOLCHAIN)/sysroot
export CC_armv7_linux_androideabi      := $(NDK_TOOLCHAIN)/bin/armv7a-linux-androideabi$(ANDROID_API)-clang
export AR_armv7_linux_androideabi      := $(NDK_TOOLCHAIN)/bin/llvm-ar
export BINDGEN_EXTRA_CLANG_ARGS_armv7_linux_androideabi := --sysroot=$(NDK_TOOLCHAIN)/sysroot
export CC_x86_64_linux_android         := $(NDK_TOOLCHAIN)/bin/x86_64-linux-android$(ANDROID_API)-clang
export AR_x86_64_linux_android         := $(NDK_TOOLCHAIN)/bin/llvm-ar
export BINDGEN_EXTRA_CLANG_ARGS_x86_64_linux_android := --sysroot=$(NDK_TOOLCHAIN)/sysroot
export CC_i686_linux_android           := $(NDK_TOOLCHAIN)/bin/i686-linux-android$(ANDROID_API)-clang
export AR_i686_linux_android           := $(NDK_TOOLCHAIN)/bin/llvm-ar
export BINDGEN_EXTRA_CLANG_ARGS_i686_linux_android := --sysroot=$(NDK_TOOLCHAIN)/sysroot

TAURI := pnpm exec tauri

# ─── Desktop ─────────────────────────────────────────────────────
.PHONY: dev build

dev:
	$(TAURI) dev

build:
	$(TAURI) build

# ─── Android ─────────────────────────────────────────────────────
.PHONY: android android-dev android-init android-debug android-install android-install-debug

## Build release APK (aarch64)
android:
	$(TAURI) android build --apk true --target aarch64
	@mkdir -p $(DIST_DIR)
	@APK=$$(find $(APK_OUTPUT) -name "*release*.apk" -type f | head -1); \
	if [ -n "$$APK" ]; then \
		cp "$$APK" "$(DIST_DIR)/otaku_$(VERSION)_aarch64.apk"; \
		echo ""; \
		echo "── APK built ──"; \
		echo "  $(DIST_DIR)/otaku_$(VERSION)_aarch64.apk ($$(du -h "$$APK" | cut -f1))"; \
		echo ""; \
	else \
		echo ""; \
		echo "── APK built ──"; \
		find $(APK_OUTPUT) -name "*.apk" -type f 2>/dev/null | while read f; do \
			echo "  $$f ($$(du -h "$$f" | cut -f1))"; \
		done; \
		echo ""; \
	fi

## Build debug APK (faster, no optimizations)
android-debug:
	$(TAURI) android build --apk true --target aarch64 --debug
	@mkdir -p $(DIST_DIR)
	@APK=$$(find $(APK_OUTPUT) -name "*debug*.apk" -type f | head -1); \
	if [ -n "$$APK" ]; then \
		cp "$$APK" "$(DIST_DIR)/otaku_$(VERSION)_aarch64_debug.apk"; \
		echo ""; \
		echo "── Debug APK built ──"; \
		echo "  $(DIST_DIR)/otaku_$(VERSION)_aarch64_debug.apk ($$(du -h "$$APK" | cut -f1))"; \
		echo ""; \
	else \
		echo ""; \
		echo "── Debug APK built ──"; \
		find $(APK_OUTPUT) -name "*.apk" -type f 2>/dev/null | while read f; do \
			echo "  $$f ($$(du -h "$$f" | cut -f1))"; \
		done; \
		echo ""; \
	fi

## Run on connected device / emulator
android-dev:
	$(TAURI) android dev

## (Re)generate Android project (run after changing bundle identifier)
android-init:
	rm -rf src-tauri/gen/android
	$(TAURI) android init

## Install APK on connected device via adb
android-install:
	@APK=$$(find $(APK_OUTPUT) -name "*release*.apk" -type f | head -1); \
	if [ -z "$$APK" ]; then echo "No release APK found. Run 'make android' first."; exit 1; fi; \
	echo "Installing $$APK ..."; \
	adb install "$$APK"

android-install-debug:
	@APK=$$(find $(APK_OUTPUT) -name "*debug*.apk" -type f | head -1); \
	if [ -z "$$APK" ]; then echo "No debug APK found. Run 'make android-debug' first."; exit 1; fi; \
	echo "Installing $$APK ..."; \
	adb install "$$APK"

# ─── iOS ─────────────────────────────────────────────────────────
.PHONY: ios ios-dev ios-init ios-debug

## Build iOS release archive (requires Apple Developer signing)
ios:
	$(TAURI) ios build
	@echo ""
	@echo "── iOS build complete ──"
	@find $(IPA_OUTPUT) -name "*.ipa" -type f 2>/dev/null | while read f; do \
		echo "  IPA: $$f ($$(du -h "$$f" | cut -f1))"; \
	done
	@find $(IPA_OUTPUT) -name "*.xcarchive" -type d 2>/dev/null | while read f; do \
		echo "  Archive: $$f"; \
	done
	@echo ""

## Build iOS debug (faster, for simulator testing)
ios-debug:
	$(TAURI) ios build --debug
	@echo ""
	@echo "── iOS debug build complete ──"
	@find $(IPA_OUTPUT) -name "*.xcarchive" -type d 2>/dev/null | while read f; do \
		echo "  Archive: $$f"; \
	done
	@echo ""

## Run in iOS simulator
ios-dev:
	$(TAURI) ios dev

## (Re)generate iOS project (run after changing bundle identifier)
ios-init:
	rm -rf src-tauri/gen/apple
	$(TAURI) ios init

# ─── Setup ───────────────────────────────────────────────────────
.PHONY: setup setup-rust-targets setup-check

## Install all prerequisites for cross-compilation
setup: setup-rust-targets setup-check
	@echo ""
	@echo "Setup complete. You can now run:"
	@echo "  make android       — Build Android APK"
	@echo "  make ios-dev       — Run in iOS simulator"
	@echo ""

setup-rust-targets:
	rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
	rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim

## Verify build environment
setup-check:
	@echo "── Checking build environment ──"
	@echo "ANDROID_HOME: $(ANDROID_HOME)"
	@echo "NDK_HOME:     $(NDK_HOME)"
	@echo "JAVA_HOME:    $(JAVA_HOME)"
	@test -d "$(ANDROID_HOME)" || (echo "ANDROID_HOME not found — install Android SDK" && exit 1)
	@test -d "$(NDK_HOME)"     || (echo "NDK not found — run: sdkmanager 'ndk;$(NDK_VERSION)'" && exit 1)
	@test -d "$(JAVA_HOME)"    || (echo "JAVA_HOME not found — install JDK 17" && exit 1)
	@java -version 2>&1 | head -1
	@echo "Rust targets:"
	@rustup target list --installed | grep -E "android|apple-ios" || echo "  (none — run make setup)"
	@echo "── All checks passed ──"

# ─── Utilities ───────────────────────────────────────────────────
.PHONY: clean typecheck lint

clean:
	cargo clean --manifest-path src-tauri/Cargo.toml
	rm -rf dist
	rm -rf src-tauri/gen/android/app/build
	rm -rf src-tauri/gen/apple/build

typecheck:
	pnpm exec tsc --noEmit

lint:
	pnpm exec eslint .

# ─── Help ────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo "Otaku Build Targets"
	@echo ""
	@echo "Desktop:"
	@echo "  make dev              Run desktop dev server"
	@echo "  make build            Build desktop release"
	@echo ""
	@echo "Android:"
	@echo "  make android          Build release APK (aarch64)"
	@echo "  make android-debug    Build debug APK (faster)"
	@echo "  make android-dev      Run on connected device"
	@echo "  make android-init     Regenerate Android project"
	@echo "  make android-install  Install release APK via adb"
	@echo ""
	@echo "iOS:"
	@echo "  make ios              Build iOS release (IPA)"
	@echo "  make ios-debug        Build iOS debug"
	@echo "  make ios-dev          Run in iOS simulator"
	@echo "  make ios-init         Regenerate iOS project"
	@echo ""
	@echo "Other:"
	@echo "  make setup            Install all build prerequisites"
	@echo "  make setup-check      Verify build environment"
	@echo "  make clean            Remove build artifacts"
	@echo "  make typecheck        Run TypeScript type checker"
	@echo "  make lint             Run ESLint"
