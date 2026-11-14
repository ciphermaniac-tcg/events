// Prints the CoreGraphics window id of a process's largest on-screen window,
// or nothing while it shows none. `screencapture -l <id>` takes that window.
// Usage: window <pid>

import CoreGraphics
import Foundation

guard CommandLine.arguments.count > 1, let pid = Int32(CommandLine.arguments[1]) else {
    exit(2)
}

func area(_ window: [String: Any]) -> Double {
    guard let bounds = window[kCGWindowBounds as String] as? [String: Double] else {
        return 0
    }
    return (bounds["Width"] ?? 0) * (bounds["Height"] ?? 0)
}

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windows = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? [])
    .filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid }
    .filter { ($0[kCGWindowLayer as String] as? Int) == 0 }

if let largest = windows.max(by: { area($0) < area($1) }),
   let id = largest[kCGWindowNumber as String] as? Int {
    print(id)
}
