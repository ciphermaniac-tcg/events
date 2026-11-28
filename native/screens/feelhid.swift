// Real input and window facts for the Mac feel audit (feel-mac.py), never
// merged. Every time printed is epoch milliseconds.
// Usage: feelhid trust
//        feelhid win <pid>                       id x y w h of its largest window
//        feelhid waitwin <pid> <timeout ms>      epoch when it first shows one
//        feelhid click <x> <y> [right]
//        feelhid dblclick <x> <y>
//        feelhid scroll <x> <y> <dy> <count> <interval ms>
//        feelhid drag <x1> <y1> <x2> <y2> <steps> <interval ms>
//        feelhid key <keycode> [cmd] [shift] [ctrl] [alt]

import ApplicationServices
import CoreGraphics
import Foundation

func now() -> String { String(format: "%.1f", Date().timeIntervalSince1970 * 1000) }
func pause(_ ms: Double) { usleep(useconds_t(ms * 1000)) }

func largestWindow(_ pid: Int32) -> (Int, CGRect)? {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    let list = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
    var best: (Int, CGRect)?
    for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
        guard let b = w[kCGWindowBounds as String] as? [String: Double], let id = w[kCGWindowNumber as String] as? Int else { continue }
        let rect = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
        if rect.width * rect.height > (best?.1.width ?? 0) * (best?.1.height ?? 0) { best = (id, rect) }
    }
    return best
}

func post(_ type: CGEventType, _ at: CGPoint, _ button: CGMouseButton = .left) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: button)?.post(tap: .cghidEventTap)
}

let args = CommandLine.arguments
let num = { (i: Int) -> Double in Double(args[i]) ?? 0 }
switch args.count > 1 ? args[1] : "" {
case "trust":
    print("ax \(AXIsProcessTrusted()) post \(CGPreflightPostEventAccess()) screen \(CGPreflightScreenCaptureAccess())")
case "win":
    if let found = largestWindow(Int32(args[2]) ?? 0) {
        let (id, r) = found; print(id, Int(r.minX), Int(r.minY), Int(r.width), Int(r.height)) }
case "waitwin":
    let deadline = Date().addingTimeInterval(num(3) / 1000)
    while Date() < deadline {
        if let found = largestWindow(Int32(args[2]) ?? 0) {
            let (id, r) = found
            print(now(), id, Int(r.minX), Int(r.minY), Int(r.width), Int(r.height))
            exit(0)
        }
        pause(4)
    }
    exit(1)
case "click":
    let at = CGPoint(x: num(2), y: num(3))
    let right = args.count > 4 && args[4] == "right"
    post(.mouseMoved, at)
    pause(30)
    print(now())
    post(right ? .rightMouseDown : .leftMouseDown, at, right ? .right : .left)
    pause(40)
    post(right ? .rightMouseUp : .leftMouseUp, at, right ? .right : .left)
case "dblclick":
    let at = CGPoint(x: num(2), y: num(3))
    post(.mouseMoved, at)
    pause(30)
    print(now())
    for count in 1...2 {
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: .left)
            event?.setIntegerValueField(.mouseEventClickState, value: Int64(count))
            event?.post(tap: .cghidEventTap)
            pause(25)
        }
    }
case "scroll":
    let at = CGPoint(x: num(2), y: num(3))
    post(.mouseMoved, at)
    pause(50)
    print(now())
    for _ in 0..<Int(num(5)) {
        CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(num(4)), wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
        pause(num(6))
    }
    print(now())
case "drag":
    let from = CGPoint(x: num(2), y: num(3))
    let to = CGPoint(x: num(4), y: num(5))
    let steps = max(1, Int(num(6)))
    post(.mouseMoved, from)
    pause(60)
    print(now())
    post(.leftMouseDown, from)
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        post(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
        pause(num(7))
    }
    post(.leftMouseUp, to)
    print(now())
case "key":
    let code = CGKeyCode(num(2))
    var flags: CGEventFlags = []
    for f in args.dropFirst(3) {
        switch f {
        case "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "ctrl": flags.insert(.maskControl)
        case "alt": flags.insert(.maskAlternate)
        default: break
        }
    }
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    down?.flags = flags
    up?.flags = flags
    print(now())
    down?.post(tap: .cghidEventTap)
    pause(30)
    up?.post(tap: .cghidEventTap)
default:
    FileHandle.standardError.write("unknown command\n".data(using: .utf8)!)
    exit(2)
}
