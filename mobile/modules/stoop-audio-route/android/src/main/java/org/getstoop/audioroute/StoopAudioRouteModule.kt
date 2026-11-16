package org.getstoop.audioroute

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Word of an output coming or going (a headset plugged in, Bluetooth
// headphones connecting): what a call needs to put its sound in the right
// place without asking over and over (src/call/livekit.ts). It says only
// that something changed. Which outputs there are now is LiveKit's to
// say, and nothing here reads a device's name or address, so it needs no
// permission.
class StoopAudioRouteModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var watching = false

  private val callback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = changed(added)

    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = changed(removed)
  }

  // Microphones come and go too; only outputs are news. The event is
  // posted to the main thread's queue rather than sent from here: LiveKit
  // keeps its own list of outputs from a callback of its own on that
  // thread, the system queues every callback for a change before any
  // runs, in no promised order, and the listener reads LiveKit's list. So
  // the event leaves after LiveKit has heard of the same change.
  private fun changed(devices: Array<out AudioDeviceInfo>) {
    if (devices.none { it.isSink }) return
    main.post { if (watching) sendEvent("onRouteChange", emptyMap<String, Any>()) }
  }

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  // The system calls back once on registering, with every device there
  // is, so a listener hears of the outputs as it starts as well.
  private fun start() {
    if (watching) return
    val manager = audioManager ?: return
    watching = true
    manager.registerAudioDeviceCallback(callback, main)
  }

  private fun stop() {
    if (!watching) return
    watching = false
    audioManager?.unregisterAudioDeviceCallback(callback)
  }

  override fun definition() = ModuleDefinition {
    Name("StoopAudioRoute")

    Events("onRouteChange")

    // The system is listened to only while something listens here.
    OnStartObserving("onRouteChange") { start() }
    OnStopObserving("onRouteChange") { stop() }
    OnDestroy { stop() }
  }
}
