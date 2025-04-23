# Native Audio Capture Modules

This directory contains the source code and build configurations for platform-specific native Node.js addons responsible for capturing system audio output (loopback).

## Phase 1: Foundation, Deep Research & Requirements Definition

### 1. Build Environment Setup

*   **Consistency:** Ensure consistent Node.js/npm/yarn versions across the team.
*   **Prerequisites:** Verify installation of Python, `node-gyp`, and platform-specific C++ compilers (Xcode Command Line Tools, Visual Studio Build Tools with C++ workload, `gcc`/`make`).
*   **Rebuild Tool:** `@electron/rebuild` installed as a dev dependency.
*   **Build Files:** Basic `binding.gyp` files created for each platform (`macos`, `windows`, `linux`) with initial configurations.
*   **Validation:** Perform initial builds using `npm install` followed by `npx @electron/rebuild` (or platform-specific rebuilds like `npx @electron/rebuild -f -w native-modules/macos`) to validate the toolchain.

### 2. API Research & Strategy

*   **macOS:**
    *   **API:** CoreAudio (`AudioUnit`, `AUGraph`).
    *   **Strategy:** Requires a virtual audio device (e.g., BlackHole, Loopback, Soundflower) for reliable loopback capture.
    *   **Implementation:** Enumerate audio devices to find the virtual device, then capture from it using CoreAudio APIs.
    *   **Permissions:** Requires macOS TCC permissions: Microphone access (`Privacy - Microphone Usage Description` in `Info.plist`) and potentially Screen Recording access (`Privacy - Screen Recording Usage Description`), even though the screen isn't directly captured, system audio capture sometimes falls under this category.
    *   **External Dependency:** BlackHole (or similar) installation required by the end-user or potentially bundled/prompted by the application.
*   **Windows:**
    *   **API:** WASAPI (Windows Audio Session API).
    *   **Strategy:** Utilize WASAPI loopback capture (`AUDCLNT_STREAMFLAGS_LOOPBACK`).
    *   **Implementation:** Requires COM initialization (`CoInitializeEx`). Use `IMMDeviceEnumerator` to get the default audio endpoint (render), then `IAudioClient` to initialize the stream in loopback mode, and `IAudioCaptureClient` to read audio data.
    *   **Permissions:** Generally does not require special user permissions beyond standard application execution.
*   **Linux:**
    *   **API:** PulseAudio (`libpulse`).
    *   **Strategy:** Capture from the *monitor source* of the default audio output device (sink).
    *   **Implementation:** Use `libpulse` (or `libpulse-simple`) to connect to the PulseAudio server, identify the default sink, find its monitor source, create a recording stream (`pa_stream`) attached to the monitor source, and manage the PulseAudio main loop (`pa_mainloop`) for asynchronous data retrieval.
    *   **Permissions:** Usually works without special permissions if PulseAudio is running as the user.
    *   **Fallback:** If PulseAudio is not available, ALSA loopback (`snd_aloop` module) could be an alternative, but requires kernel module loading and configuration, significantly increasing complexity. The primary target is PulseAudio.

### 3. Audio Format

*   **Format:** PCM Float 32 (planar or interleaved, TBD based on API/processing needs)
*   **Sample Rate:** 48000 Hz (aligns well with many systems/APIs)
*   **Channels:** Mono (sufficient for voice transcription/analysis)
*   **Requirement:** Native modules *must* output audio data in this format. If the native API provides a different format (e.g., Int16), the native module must handle the conversion to Float32 Mono @ 48kHz.

### 4. Data Transfer Mechanism (Native -> Node.js)

*   **Method:** N-API `ThreadSafeFunction`.
*   **Process:** The native audio capture thread (managed by CoreAudio/WASAPI/PulseAudio) will acquire audio data chunks.
*   **Data Structure:** Audio data will be packaged into `ArrayBuffer` instances.
*   **Buffer Size:** Approximately 1024-4096 samples per chunk (e.g., ~21-85ms @ 48kHz). Needs tuning.
*   **Delivery:** The native thread will call the `ThreadSafeFunction` to pass the `ArrayBuffer` to the JavaScript main thread via an event/callback.

### 5. Error Handling Strategy

*   **Categories:**
    *   `PERMISSION_ERROR`: User denied necessary permissions (esp. macOS Microphone).
    *   `DEVICE_NOT_FOUND`: Required device (e.g., BlackHole on macOS, default output on Win/Linux) is unavailable.
    *   `STREAM_ERROR`: Issues during stream initialization or data capture (e.g., device disconnected, format negotiation failed).
    *   `MISSING_DEPENDENCY`: External requirements unmet (e.g., PulseAudio server not running, BlackHole not installed).
    *   `INTERNAL_ERROR`: Unexpected errors within the native module.
*   **Propagation:**
    *   Native code uses specific return codes or error objects.
    *   N-API layer translates these into JavaScript Errors with distinct `code` properties (e.g., `err.code = 'PERMISSION_ERROR'`) and descriptive messages.
    *   Consider a dedicated error callback/event from the native module alongside the data callback/event.

## Next Steps (Phase 2)

*   Implement basic N-API structure for each module.
*   Implement platform-specific audio device enumeration.
*   Implement basic audio stream initialization (without data capture yet).
*   Establish `ThreadSafeFunction` communication channel. 