import AVFoundation
import ExpoModulesCore

// Where the phone sends its sound now, and word of each change: what a
// call needs to know that headphones have the sound (src/call/livekit.ts).
// It reads the shared audio session and changes nothing on it; the
// session itself is LiveKit's to set.
public class StoopAudioRouteModule: Module {
  private var observer: NSObjectProtocol?

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
    }
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
