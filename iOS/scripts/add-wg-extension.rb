#!/usr/bin/env ruby
# Idempotently reshape iOS/ConceptsOS/ConceptsOS.xcodeproj so that:
#
#   1. The project depends on the WireGuardKit Swift package
#      (https://git.zx2c4.com/wireguard-apple), pinned to a tag we
#      trust.
#   2. There is a new `ConceptsOSWGTunnel` PBXNativeTarget of type
#      `com.apple.product-type.app-extension`, containing the source
#      + Info.plist + entitlements + a Run Script phase that runs
#      `make` inside the WireGuardKitGo checkout (to build the Go
#      bridge that WireGuardKit links against).
#   3. Both the main `ConceptsOS` target AND the extension target link
#      `WireGuardKit`.
#   4. The main target embeds the extension via a
#      PBXCopyFilesBuildPhase (destination = PlugIns).
#   5. Both targets get the shared entitlements files pointed at the
#      right paths.
#
# Ruby is required because the pbxproj format is impractical to hand
# edit for this scale of change. Uses the pure-ruby xcodeproj gem.
#
# Rerunning is safe: any object we would add is looked up by name
# first and skipped if present.

require "xcodeproj"
require "pathname"

ROOT       = Pathname.new(File.expand_path("..", __dir__)) # -> iOS/
PROJ_PATH  = ROOT.join("ConceptsOS", "ConceptsOS.xcodeproj")
project    = Xcodeproj::Project.open(PROJ_PATH.to_s)

APP_TARGET_NAME       = "ConceptsOS"
EXT_TARGET_NAME       = "ConceptsOSWGTunnel"
EXT_BUNDLE_ID         = "ai.humata.ConceptsOS.WGTunnel"
APP_BUNDLE_ID         = "ai.humata.ConceptsOS"
APP_GROUP             = "group.ai.humata.ConceptsOS"
TEAM_ID               = "2U53525V55"
# We use our own fork of the WireGuard iOS/macOS Swift package instead
# of pulling directly from git.zx2c4.com. Reasons:
#   - Upstream's Package.swift declares swift-tools-version:5.3 but uses
#     .iOS(.v15), which was introduced in 5.5. Xcode 26 refuses to load
#     the manifest as a result. Our fork only bumps the header.
#   - git.zx2c4.com's HTTP-only clone URL is refused by GitHub's SPM
#     resolver behind proxies.
# Pinned to a specific commit for reproducibility. Bump when the
# upstream project itself needs to move.
WG_PACKAGE_URL         = "https://github.com/Humata-ai/wireguard-apple"
WG_PACKAGE_REQUIREMENT = { kind: "revision", revision: "f47e603240ed3256456cc91f81c14675e0bc29fd" }

app_target = project.targets.find { |t| t.name == APP_TARGET_NAME } or
  abort "no #{APP_TARGET_NAME} target found"

# --- 1. Swift Package Manager: WireGuardKit -----------------------------------

pkg_ref = project.root_object.package_references.find { |r| r.repositoryURL == WG_PACKAGE_URL }
unless pkg_ref
  pkg_ref = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
  pkg_ref.repositoryURL = WG_PACKAGE_URL
  pkg_ref.requirement   = WG_PACKAGE_REQUIREMENT
  project.root_object.package_references << pkg_ref
  puts "+ added SPM package #{WG_PACKAGE_URL}"
end

def ensure_package_product(project, target, package_ref, product_name)
  target.package_product_dependencies ||= []
  existing = target.package_product_dependencies.find { |d| d.product_name == product_name }
  return existing if existing
  dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  dep.package = package_ref
  dep.product_name = product_name
  target.package_product_dependencies << dep

  fw_phase = target.frameworks_build_phase
  bf = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  bf.product_ref = dep
  fw_phase.files << bf
  puts "+ linked #{product_name} into #{target.name}"
  dep
end

# --- 2. Extension target ------------------------------------------------------

ext_target = project.targets.find { |t| t.name == EXT_TARGET_NAME }
unless ext_target
  ext_target = project.new_target(
    :app_extension,
    EXT_TARGET_NAME,
    :ios,
    "16.0",
  )
  puts "+ created target #{EXT_TARGET_NAME}"
end
ext_target.product_type = "com.apple.product-type.app-extension"

# 2a. Group + files
ext_group = project.main_group[EXT_TARGET_NAME] ||
  project.main_group.new_group(EXT_TARGET_NAME, EXT_TARGET_NAME)

{
  "PacketTunnelProvider.swift"        => :swift,
  "Info.plist"                        => :plist,
  "#{EXT_TARGET_NAME}.entitlements"   => :plist,
}.each do |fname, kind|
  ref = ext_group.files.find { |f| f.path == fname }
  next if ref
  ref = ext_group.new_reference(fname)
  case kind
  when :swift
    ref.last_known_file_type = "sourcecode.swift"
    ext_target.source_build_phase.add_file_reference(ref)
  when :plist
    ref.last_known_file_type = "text.plist.xml"
  end
end

# --- 3. Link WireGuardKit into both targets -----------------------------------

# The Xcodeproj gem's new_target(:app_extension, ...) helpfully but
# unhelpfully adds an SDK-scoped Foundation.framework reference with a
# hardcoded SDK version in its path. Strip it so builds don't break when
# the SDK version bumps. Foundation is implicitly linked anyway.
ext_target.frameworks_build_phase.files.dup.each do |bf|
  ref = bf.file_ref
  if ref && ref.path.to_s.include?(".sdk/System/Library/Frameworks/Foundation.framework")
    ext_target.frameworks_build_phase.remove_build_file(bf)
    ref.remove_from_project
  end
end

ensure_package_product(project, app_target, pkg_ref, "WireGuardKit")
ensure_package_product(project, ext_target, pkg_ref, "WireGuardKit")

# --- 4. Embed extension into main app ----------------------------------------

embed_phase = app_target.copy_files_build_phases.find { |p| p.name == "Embed App Extensions" }
unless embed_phase
  embed_phase = app_target.new_copy_files_build_phase("Embed App Extensions")
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
  puts "+ added Embed App Extensions phase"
end
ext_product = ext_target.product_reference
unless embed_phase.files_references.include?(ext_product)
  bf = embed_phase.add_file_reference(ext_product)
  bf.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
  puts "+ embedded #{EXT_TARGET_NAME}.appex"
end

# Target dependency so app builds after extension.
unless app_target.dependencies.any? { |d| d.target == ext_target }
  app_target.add_dependency(ext_target)
end

# --- 5. wireguard-go-bridge build phase --------------------------------------

wg_go_phase_name = "Build wireguard-go-bridge"
unless ext_target.shell_script_build_phases.any? { |p| p.name == wg_go_phase_name }
  phase = ext_target.new_shell_script_build_phase(wg_go_phase_name)
  phase.shell_path = "/bin/sh"
  phase.shell_script = <<~SH
    set -e
    # WireGuardKit itself is a pure Swift wrapper; the actual crypto/data
    # plane is a Go binary shipped as a static lib (libwg-go.a). SwiftPM
    # can't run `go build` for us, so we do it here.
    #
    # Requires `go` on PATH.
    export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/local/go/bin:$PATH"
    WGGO_DIR="${BUILD_DIR%Build/*}SourcePackages/checkouts/wireguard-apple/Sources/WireGuardKitGo"
    if [ ! -d "$WGGO_DIR" ]; then
      echo "warning: WireGuardKitGo checkout not found at $WGGO_DIR; skipping" >&2
      exit 0
    fi
    cd "$WGGO_DIR"
    make
  SH
  # Make sure it runs BEFORE the compile-sources phase so the linker
  # can find libwg-go.a.
  ext_target.build_phases.delete(phase)
  ext_target.build_phases.unshift(phase)
  puts "+ added wireguard-go-bridge build phase"
end

# Library search path for libwg-go.a produced above.
libwg_search = "$(BUILD_DIR)/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)"

# --- 6. Build settings on the extension target -------------------------------

ext_target.build_configurations.each do |cfg|
  s = cfg.build_settings
  s["PRODUCT_BUNDLE_IDENTIFIER"] = EXT_BUNDLE_ID
  s["PRODUCT_NAME"]              = "$(TARGET_NAME)"
  s["INFOPLIST_FILE"]            = "#{EXT_TARGET_NAME}/Info.plist"
  s["CODE_SIGN_ENTITLEMENTS"]    = "#{EXT_TARGET_NAME}/#{EXT_TARGET_NAME}.entitlements"
  s["CODE_SIGN_STYLE"]           = "Automatic"
  s["DEVELOPMENT_TEAM"]          = TEAM_ID
  s["IPHONEOS_DEPLOYMENT_TARGET"] = "16.0"
  s["SWIFT_VERSION"]             = "5.0"
  s["TARGETED_DEVICE_FAMILY"]    = "1,2"
  s["GENERATE_INFOPLIST_FILE"]   = "NO"
  s["ENABLE_BITCODE"]            = "NO"
  s["MARKETING_VERSION"]         = "1.1"
  s["CURRENT_PROJECT_VERSION"]   = "2"
  s["SKIP_INSTALL"]              = "YES"
  s["MACH_O_TYPE"]               = "mh_execute"
  existing_search = Array(s["LIBRARY_SEARCH_PATHS"])
  s["LIBRARY_SEARCH_PATHS"]      = (["$(inherited)", libwg_search] + existing_search).uniq
  s["OTHER_LDFLAGS"]             = Array(s["OTHER_LDFLAGS"]).empty? ? ["$(inherited)"] : Array(s["OTHER_LDFLAGS"])
end

# Also patch main app for entitlements + libwg-go search path so its
# link phase can find WireGuardKit's transitive libwg-go link.
app_target.build_configurations.each do |cfg|
  s = cfg.build_settings
  existing_search = Array(s["LIBRARY_SEARCH_PATHS"])
  s["LIBRARY_SEARCH_PATHS"]      = (["$(inherited)", libwg_search] + existing_search).uniq
end

# --- 7. Cleanup: remove retired SetupTunnelView.swift ------------------------

setup_ref = project.files.find { |f| f.path == "SetupTunnelView.swift" }
if setup_ref
  setup_ref.build_files.each do |bf|
    bf.referrers.each do |ref|
      if ref.respond_to?(:files) && ref.files.include?(bf)
        ref.remove_reference(bf)
      end
    end
  end
  setup_ref.remove_from_project
  puts "- removed SetupTunnelView.swift"
end

# --- 8. Add newly-created source files to the app target ---------------------

app_views_group = project.main_group.recursive_children.find { |g| g.is_a?(Xcodeproj::Project::Object::PBXGroup) && g.path == "Views" }
if app_views_group && !app_views_group.files.any? { |f| f.path == "InstallTunnelView.swift" }
  ref = app_views_group.new_reference("InstallTunnelView.swift")
  ref.last_known_file_type = "sourcecode.swift"
  app_target.source_build_phase.add_file_reference(ref)
  puts "+ added InstallTunnelView.swift to app target"
end

app_wg_group = project.main_group.recursive_children.find { |g| g.is_a?(Xcodeproj::Project::Object::PBXGroup) && g.path == "WireGuard" }
if app_wg_group && !app_wg_group.files.any? { |f| f.path == "TunnelManager.swift" }
  ref = app_wg_group.new_reference("TunnelManager.swift")
  ref.last_known_file_type = "sourcecode.swift"
  app_target.source_build_phase.add_file_reference(ref)
  puts "+ added TunnelManager.swift to app target"
end

project.save
puts "wrote #{PROJ_PATH}"
