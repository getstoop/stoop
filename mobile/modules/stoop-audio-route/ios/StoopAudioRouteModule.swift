import AVFoundation
import AVKit
import ExpoModulesCore
import UIKit

// Where the phone sends its sound now, word of each change, and the
// system's picker of outputs: what a call's Output control shows and
// opens (src/call/livekit.ts). It reads the shared audio session and
// changes nothing on it; the session itself is LiveKit's to set, and
// what is picked in the picker is the system's to apply.
public class StoopAudioRouteModule: Module {
  private var observer: NSObjectProtocol?
  // The system's picker view, made at the first showPicker and kept.
  private var picker: AVRoutePickerView?

  public func definition() -> ModuleDefinition {
    Name("StoopAudioRoute")

    Events("onRouteChange")

    // The session's current outputs, each as a kind and the system's
    // name for it ("Speaker", the headphones' own name).
    Function("currentOutputs") { () -> [[String: String]] in
      AVAudioSession.sharedInstance().currentRoute.outputs.map { port in
        ["kind": Self.kind(of: port.portType), "name": port.portName]
      }
    }

    // Presents the system's picker of outputs, and says whether it
    // could. Always on the main queue: it is UIKit from end to end.
    AsyncFunction("showPicker") { () -> Bool in
      self.showPicker()
    }.runOnQueue(.main)

    // The session is watched only while something listens. The event
    // says only that the route changed, whatever the reason: the listener
    // reads the outputs again.
    OnStartObserving("onRouteChange") {
      guard self.observer == nil else { return }
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        self?.sendEvent("onRouteChange", [:])
      }
    }

    OnStopObserving("onRouteChange") {
      self.stopObserving()
    }

    OnDestroy {
      self.stopObserving()
      let picker = self.picker
      self.picker = nil
      DispatchQueue.main.async { picker?.removeFromSuperview() }
    }
  }

  // iOS shows its picker of outputs only from an AVRoutePickerView: there
  // is no call that presents it. So one such view is kept in the app's
  // key window, where nobody sees or touches it, and its own button is
  // pressed for the app's control. The view is in a window and the press
  // is made on the main queue, as a finger's would be; LiveKit's own
  // showAudioRoutePicker presses the button of a view that is in no
  // window, from whatever thread it is called on, which UIKit promises
  // nothing for.
  //
  // The simulator presents no picker at all, also for a finger on a
  // visible AVRoutePickerView, so this is tried on a phone.
  //
  // Finding the button among the view's subviews is the one thing here
  // iOS does not promise. A view of the picker's own drawn over the
  // control would not need it, but the control would then be the
  // system's: its own glyph, its own name for a screen reader, no press
  // the app hears of. If a later iOS has no button there, this returns
  // false and nothing is shown.
  private func showPicker() -> Bool {
    guard let window = Self.keyWindow() else { return false }
    let view = picker ?? AVRoutePickerView()
    picker = view
    // At the middle of the window's foot, near the control that asked:
    // where the system shows the picker as a popover (an iPad), this is
    // what it points at.
    view.frame = CGRect(x: window.bounds.midX, y: window.bounds.maxY - 120, width: 1, height: 1)
    if view.window !== window {
      view.removeFromSuperview()
      view.alpha = 0
      view.isUserInteractionEnabled = false
      view.accessibilityElementsHidden = true
      window.addSubview(view)
    }
    guard let button = view.subviews.compactMap({ $0 as? UIButton }).first else { return false }
    button.sendActions(for: .touchUpInside)
    return true
  }

  // The window in front, of the scene in front.
  private static func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let front = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    return front?.keyWindow ?? front?.windows.first
  }

  private func stopObserving() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
  }

  // The phone's own two outputs, headphones on a wire (the headphone
  // jack or an adapter's, USB, line out), anything over Bluetooth, and
  // the rest: AirPlay, a car, HDMI and whatever iOS adds later.
  private static func kind(of port: AVAudioSession.Port) -> String {
    switch port {
    case .builtInSpeaker: return "speaker"
    case .builtInReceiver: return "earpiece"
    case .headphones, .usbAudio, .lineOut: return "headphones"
    case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: return "bluetooth"
    default: return "other"
    }
  }
}
