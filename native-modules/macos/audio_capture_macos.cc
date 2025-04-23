#include <napi.h>
#include <iostream> // For placeholder logging
#include <vector>
#include <string>
#include <atomic>
#include <thread> // Include for ThreadSafeFunction context
#include <CoreAudio/CoreAudio.h>
#include <AudioUnit/AudioUnit.h>
#include <AudioToolbox/AudioToolbox.h> // Include for ASBD

// --- Global State (Use with caution in production; consider a class) ---
std::atomic<bool> g_isCapturing(false);
AudioUnit g_audioUnit = nullptr;
AudioDeviceID g_targetDeviceID = kAudioDeviceUnknown;
Napi::ThreadSafeFunction g_tsf = nullptr; // ThreadSafeFunction instance
// -----------------------------------------------------------------------

// Structure to pass audio data to the main thread
struct AudioData {
    std::vector<float> data; // Using vector for easier memory management
};

// Helper function to convert CFStringRef to std::string
std::string ConvertCFString(CFStringRef cfStr) {
    if (cfStr == nullptr) {
        return "";
    }
    CFIndex length = CFStringGetLength(cfStr);
    CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    std::vector<char> buffer(maxSize);
    if (CFStringGetCString(cfStr, buffer.data(), maxSize, kCFStringEncodingUTF8)) {
        return std::string(buffer.data());
    }
    return "";
}

// Helper function to find AudioDeviceID from UID string
OSStatus GetAudioDeviceIDFromUID(const std::string& uid, AudioDeviceID& deviceID) {
    deviceID = kAudioDeviceUnknown;
    OSStatus status;
    UInt32 dataSize = 0;

    // Get size of devices array
    AudioObjectPropertyAddress devicesPropertyAddress = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devicesPropertyAddress, 0, nullptr, &dataSize);
    if (status != noErr || dataSize == 0) return status;

    // Get device list
    UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
    std::vector<AudioDeviceID> deviceIDs(deviceCount);
    status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &devicesPropertyAddress, 0, nullptr, &dataSize, deviceIDs.data());
    if (status != noErr) return status;

    // Iterate and find the matching UID
    for (UInt32 i = 0; i < deviceCount; ++i) {
        CFStringRef deviceUIDRef = nullptr;
        dataSize = sizeof(CFStringRef);
        AudioObjectPropertyAddress uidPropertyAddress = {
            kAudioDevicePropertyDeviceUID,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        status = AudioObjectGetPropertyData(deviceIDs[i], &uidPropertyAddress, 0, nullptr, &dataSize, &deviceUIDRef);
        
        if (status == noErr && deviceUIDRef != nullptr) {
            std::string currentUID = ConvertCFString(deviceUIDRef);
            CFRelease(deviceUIDRef);
            if (currentUID == uid) {
                deviceID = deviceIDs[i];
                return noErr; // Found it
            }
        } else {
            // Handle potential error getting UID, maybe log it
            if(deviceUIDRef) CFRelease(deviceUIDRef);
        }
    }

    return kAudioHardwareBadDeviceError; // Indicate device not found
}

// Function to list audio devices using CoreAudio
Napi::Value ListDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array deviceList = Napi::Array::New(env);
    UInt32 dataSize = 0;
    OSStatus status;

    // 1. Get the size of the property data for the devices array
    AudioObjectPropertyAddress devicesPropertyAddress = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,      // Use Global scope for hardware properties
        kAudioObjectPropertyElementMain   // Use Main element (formerly Master)
    };

    status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devicesPropertyAddress, 0, nullptr, &dataSize);
    if (status != noErr || dataSize == 0) {
        Napi::Error::New(env, "Error getting size of device list: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // 2. Get the actual device list
    UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
    std::vector<AudioDeviceID> deviceIDs(deviceCount);
    status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &devicesPropertyAddress, 0, nullptr, &dataSize, deviceIDs.data());
    if (status != noErr) {
        Napi::Error::New(env, "Error getting device list: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // 3. Iterate through devices and get their info (UID and Name)
    uint32_t currentDeviceIndex = 0;
    for (UInt32 i = 0; i < deviceCount; ++i) {
        AudioDeviceID currentDeviceID = deviceIDs[i];
        CFStringRef deviceNameRef = nullptr;
        CFStringRef deviceUIDRef = nullptr;
        dataSize = sizeof(CFStringRef);

        // Get device name
        AudioObjectPropertyAddress namePropertyAddress = {
            kAudioDevicePropertyDeviceNameCFString,
            kAudioObjectPropertyScopeGlobal, // Changed scope to Global as Name is often global
            kAudioObjectPropertyElementMain
        };
        status = AudioObjectGetPropertyData(currentDeviceID, &namePropertyAddress, 0, nullptr, &dataSize, &deviceNameRef);
        if (status != noErr || deviceNameRef == nullptr) {
            std::cerr << "[audio_capture_macos] Error getting name for device ID: " << currentDeviceID << ", status: " << status << std::endl;
            continue; // Skip device if name cannot be retrieved
        }

        // Get device UID
        AudioObjectPropertyAddress uidPropertyAddress = {
            kAudioDevicePropertyDeviceUID,
            kAudioObjectPropertyScopeGlobal, // Changed scope to Global for UID
            kAudioObjectPropertyElementMain
        };
        status = AudioObjectGetPropertyData(currentDeviceID, &uidPropertyAddress, 0, nullptr, &dataSize, &deviceUIDRef);
        if (status != noErr || deviceUIDRef == nullptr) {
             std::cerr << "[audio_capture_macos] Error getting UID for device ID: " << currentDeviceID << ", status: " << status << std::endl;
            CFRelease(deviceNameRef); // Release name string if UID fails
            continue; // Skip device if UID cannot be retrieved
        }

        // Convert CFStrings to std::string
        std::string deviceName = ConvertCFString(deviceNameRef);
        std::string deviceUID = ConvertCFString(deviceUIDRef);

        // Release the CFStringRefs
        CFRelease(deviceNameRef);
        CFRelease(deviceUIDRef);

        // Create N-API object for the device
        Napi::Object deviceObj = Napi::Object::New(env);
        deviceObj.Set("id", Napi::String::New(env, deviceUID));
        deviceObj.Set("name", Napi::String::New(env, deviceName));
        deviceList.Set(currentDeviceIndex++, deviceObj);
    }

    return deviceList;
}

// Helper function to allocate an AudioBufferList for interleaved data
AudioBufferList* AllocateAudioBufferList(UInt32 numChannels, UInt32 totalDataByteSize) {
    // For interleaved, we allocate ONE buffer structure
    AudioBufferList* bufferList = (AudioBufferList*)malloc(sizeof(AudioBufferList)); // Only space for 1 buffer needed in struct
    if (!bufferList) return nullptr;

    bufferList->mNumberBuffers = 1; // Only one buffer for interleaved
    bufferList->mBuffers[0].mNumberChannels = numChannels; // Number of channels IN the buffer
    bufferList->mBuffers[0].mDataByteSize = totalDataByteSize; // Total size for all channels
    bufferList->mBuffers[0].mData = malloc(totalDataByteSize);
    if (!bufferList->mBuffers[0].mData) {
        free(bufferList); // Cleanup bufferList struct if data allocation fails
        return nullptr;
    }
    
    return bufferList;
}

// Helper function to deallocate an AudioBufferList
void DeallocateAudioBufferList(AudioBufferList* bufferList) {
    if (!bufferList) return;
    for (UInt32 i = 0; i < bufferList->mNumberBuffers; ++i) {
        if (bufferList->mBuffers[i].mData) {
            free(bufferList->mBuffers[i].mData);
        }
    }
    free(bufferList);
}

// --- Render Callback --- 
OSStatus AudioInputCallback(void *inRefCon, 
                            AudioUnitRenderActionFlags *ioActionFlags, 
                            const AudioTimeStamp *inTimeStamp, 
                            UInt32 inBusNumber, 
                            UInt32 inNumberFrames, 
                            AudioBufferList *ioData_SystemProvided) { // System buffer is likely null

    // std::cout << "AudioInputCallback called for bus " << inBusNumber << " frames: " << inNumberFrames << std::endl;

    if (inBusNumber != 1) { 
        // std::cerr << "AudioInputCallback: Exit - Unexpected bus number: " << inBusNumber << std::endl; // Can be noisy
        return noErr; // Only process input bus
    }
    if (!g_isCapturing || g_tsf == nullptr) {
        // std::cerr << "AudioInputCallback: Exit - Not capturing or TSF is null." << std::endl; // Can be noisy
        return noErr;
    }

    // --- Log the number of frames expected --- 
    // std::cout << "AudioInputCallback: Expected frames (inNumberFrames): " << inNumberFrames << std::endl;
    // ----------------------------------------

    // --- Allocate our own buffer list (for Interleaved Int16 Stereo) --- 
    UInt32 numChannels = 2; // Stereo
    UInt32 bytesPerSample = 2; // Int16
    UInt32 bytesPerFrame = numChannels * bytesPerSample; // 2 * 2 = 4
    UInt32 totalDataByteSize = inNumberFrames * bytesPerFrame; // Total size needed

    AudioBufferList* localBufferList = AllocateAudioBufferList(numChannels, totalDataByteSize);
    if (!localBufferList) {
        std::cerr << "AudioInputCallback: Failed to allocate local buffer list." << std::endl;
        return -1; // Indicate an error
    }
    // ----------------------------------- 

    // --- Log buffer details before rendering --- 
    // std::cout << "AudioInputCallback: Pre-Render Check. localBufferList->mNumberBuffers: " 
    //           << localBufferList->mNumberBuffers << std::endl;
    // if (localBufferList->mNumberBuffers > 0) { // Check if buffer exists
    //     std::cout << "  Buffer[0]: mNumberChannels=" << localBufferList->mBuffers[0].mNumberChannels
    //               << ", mDataByteSize=" << localBufferList->mBuffers[0].mDataByteSize
    //               << ", mData pointer=" << (localBufferList->mBuffers[0].mData ? "Valid" : "NULL") 
    //               << std::endl;
    // }
    // ----------------------------------------

    // --- Render into our local buffer --- 
    AudioUnit audioUnit = (AudioUnit)inRefCon;
    OSStatus status = AudioUnitRender(audioUnit,         // Unit instance
                                      ioActionFlags,    // Flags from callback
                                      inTimeStamp,      // Timestamp from callback
                                      1, // <-- Render FROM input bus (Bus 1) again
                                      inNumberFrames,   // Number of frames to render
                                      localBufferList); // Render INTO our local buffer
    // ----------------------------------- 

    if (status != noErr) {
        std::cerr << "AudioInputCallback: AudioUnitRender failed with status: " << status << std::endl;
        DeallocateAudioBufferList(localBufferList); // Clean up our allocated buffer
        return status; // Propagate the error
    }
    
    // --- Process data from localBufferList (Interleaved Int16) --- 
    if (localBufferList->mNumberBuffers != 1 || !localBufferList->mBuffers[0].mData) {
         std::cerr << "AudioInputCallback: Post-Render Error - Expected 1 buffer with valid data." << std::endl;
         DeallocateAudioBufferList(localBufferList);
         return -1; // Error
    }
    if (localBufferList->mBuffers[0].mDataByteSize < totalDataByteSize) {
         std::cerr << "AudioInputCallback: Post-Render Error - Rendered data size (" 
                   << localBufferList->mBuffers[0].mDataByteSize 
                   << ") less than expected (" << totalDataByteSize << ")." << std::endl;
         DeallocateAudioBufferList(localBufferList);
         return -1; // Error
    }

    int16_t* interleavedSamples = (int16_t*)localBufferList->mBuffers[0].mData;
    AudioData* dataToSend = new AudioData();
    try {
      dataToSend->data.resize(inNumberFrames); // Resize for mono float data
      
      // De-interleave, convert Int16 to Float32, mix to mono
      for (UInt32 i = 0; i < inNumberFrames; ++i) {
          float leftSample = (float)interleavedSamples[i * 2] / 32768.0f;
          float rightSample = (float)interleavedSamples[i * 2 + 1] / 32768.0f;
          dataToSend->data[i] = (leftSample + rightSample) * 0.5f;
      }
    } catch (const std::bad_alloc& e) {
        std::cerr << "AudioInputCallback: Failed to allocate memory for mono buffer: " << e.what() << std::endl;
        delete dataToSend;
        DeallocateAudioBufferList(localBufferList);
        return -1; // Indicate error
    }
    // -----------------------------------------------------------------

    // --- Send data via ThreadSafeFunction --- 
    napi_status tsf_status = g_tsf.NonBlockingCall(dataToSend, [](Napi::Env env, Napi::Function jsCallback, AudioData* data) {
        if (env != nullptr && data != nullptr) { 
            // std::cout << "TSF Lambda: Entered. Data ptr: Valid, Data size: " 
            //           << (data ? std::to_string(data->data.size()) : "N/A") << std::endl;
            try {
                // std::cout << "TSF Lambda: BEFORE ArrayBuffer::New" << std::endl;
                size_t bufferByteLength = data->data.size() * sizeof(float);
                Napi::ArrayBuffer arrayBuffer = Napi::ArrayBuffer::New(env, bufferByteLength);
                memcpy(arrayBuffer.Data(), data->data.data(), bufferByteLength);
                // std::cout << "TSF Lambda: AFTER ArrayBuffer::New (with memcpy)" << std::endl;

                // std::cout << "TSF Lambda: BEFORE jsCallback.Call" << std::endl;
                jsCallback.Call({arrayBuffer});
                // std::cout << "TSF Lambda: AFTER jsCallback.Call" << std::endl;
            } catch (const Napi::Error& e) {
                std::cerr << "TSF Lambda: Napi::Error caught: Message='" << e.Message() << "'" << std::endl;
            } catch (const std::exception& e) {
                 std::cerr << "TSF Lambda: std::exception caught: What='" << e.what() << "'" << std::endl;
            } catch (...) {
                 std::cerr << "TSF Lambda: Unknown exception caught." << std::endl;
            }
            // Delete data AFTER the try-catch block
            // std::cout << "TSF Lambda: Deleting data." << std::endl;
            delete data;
            // std::cout << "TSF Lambda: Finished." << std::endl;
        } else {
             std::cerr << "TSF Lambda: Invoked with null env or data." << std::endl;
             if(data) delete data; 
        }
    });

    if (tsf_status != napi_ok) {
        std::cerr << "AudioInputCallback: g_tsf.NonBlockingCall failed! Status: " << tsf_status << std::endl;
        delete dataToSend; // Clean up if the call failed immediately
    }
    // ------------------------------------

    // --- Cleanup locally allocated buffer --- 
    DeallocateAudioBufferList(localBufferList);
    // ------------------------------------

    return noErr;
}

// Function to start capture
Napi::Value StartCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Check arguments: deviceUID (string), callback (function)
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected arguments: deviceUID (string), dataCallback (function)").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string targetUID = info[0].As<Napi::String>().Utf8Value();
    Napi::Function jsDataCallback = info[1].As<Napi::Function>(); // Get the JS callback

    if (g_isCapturing) {
        Napi::Error::New(env, "Capture is already in progress.").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (g_tsf != nullptr) {
         Napi::Error::New(env, "ThreadSafeFunction seems to already exist. Stop capture first.").ThrowAsJavaScriptException();
        return env.Null();
    }

    OSStatus status;

    // 1. Find the target device ID
    status = GetAudioDeviceIDFromUID(targetUID, g_targetDeviceID);
    if (status != noErr || g_targetDeviceID == kAudioDeviceUnknown) {
        Napi::Error::New(env, "Target audio device not found or error getting ID: " + targetUID).ThrowAsJavaScriptException();
        return env.Null();
    }
    std::cout << "[audio_capture_macos] Found target device ID: " << g_targetDeviceID << std::endl;

    // --- CoreAudio Setup ---
    AudioComponentDescription desc = {};
    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_HALOutput; // Use HAL Output for device access
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    desc.componentFlags = 0;
    desc.componentFlagsMask = 0;

    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (comp == nullptr) {
        Napi::Error::New(env, "Failed to find HAL Output AudioComponent").ThrowAsJavaScriptException();
        return env.Null();
    }

    status = AudioComponentInstanceNew(comp, &g_audioUnit);
    if (status != noErr || g_audioUnit == nullptr) {
        Napi::Error::New(env, "Failed to create AudioUnit instance: " + std::to_string(status)).ThrowAsJavaScriptException();
        g_audioUnit = nullptr; // Ensure it's null on failure
        return env.Null();
    }

    // Enable input (bus 1), disable output (bus 0)
    UInt32 enableIO = 1; // Enable
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_EnableIO,
                                  kAudioUnitScope_Input, 1, // Input scope, bus 1
                                  &enableIO, sizeof(enableIO));
    if (status != noErr) {
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        Napi::Error::New(env, "Failed to enable AudioUnit input: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }

    UInt32 disableIO = 0; // Disable
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_EnableIO,
                                  kAudioUnitScope_Output, 0, // Output scope, bus 0
                                  &disableIO, sizeof(disableIO));
    if (status != noErr) { 
        // Don't necessarily fail here, might still work, but log it
        std::cerr << "[audio_capture_macos] Warning: Failed to disable AudioUnit output: " << status << std::endl;
    }

    // Set the target device
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_CurrentDevice,
                                  kAudioUnitScope_Global, 0, // Global scope for device setting
                                  &g_targetDeviceID, sizeof(g_targetDeviceID));
    if (status != noErr) {
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        Napi::Error::New(env, "Failed to set current device on AudioUnit: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Define desired audio format (Float32, 48kHz, Stereo, Non-Interleaved)
    AudioStreamBasicDescription desiredFormat = {};
    desiredFormat.mSampleRate = 48000.0;
    desiredFormat.mFormatID = kAudioFormatLinearPCM;
    desiredFormat.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked; // Signed Int, Interleaved
    desiredFormat.mChannelsPerFrame = 2; // Stereo
    desiredFormat.mBitsPerChannel = 16; // 16-bit Integer
    desiredFormat.mBytesPerFrame = desiredFormat.mChannelsPerFrame * (desiredFormat.mBitsPerChannel / 8); // 2 * (16 / 8) = 4
    desiredFormat.mBytesPerPacket = desiredFormat.mBytesPerFrame; // For uncompressed LPCM, packet = frame
    desiredFormat.mFramesPerPacket = 1; // For uncompressed LPCM

    // Set the format on the output scope of the input bus
    status = AudioUnitSetProperty(g_audioUnit, kAudioUnitProperty_StreamFormat,
                                  kAudioUnitScope_Output, 1, // Output scope, bus 1 (input bus)
                                  &desiredFormat, sizeof(desiredFormat));
    if (status != noErr) {
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        Napi::Error::New(env, "Failed to set stream format on AudioUnit: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // ---> Add this section to verify the format <-----
    AudioStreamBasicDescription actualFormat = {};
    UInt32 formatSize = sizeof(actualFormat);
    status = AudioUnitGetProperty(g_audioUnit, kAudioUnitProperty_StreamFormat, 
                                  kAudioUnitScope_Output, 1,
                                  &actualFormat, &formatSize);
    if (status == noErr) {
        std::cout << "[audio_capture_macos] Verified stream format: " 
                  << " SampleRate: " << actualFormat.mSampleRate
                  << " Channels: " << actualFormat.mChannelsPerFrame
                  << " Bits/Ch: " << actualFormat.mBitsPerChannel
                  << " Bytes/Frame: " << actualFormat.mBytesPerFrame
                  << " FormatID: " << (char*)&actualFormat.mFormatID
                  << " Flags: " << actualFormat.mFormatFlags << std::endl;
    } else {
         std::cerr << "[audio_capture_macos] Warning: Could not get stream format after setting: " << status << std::endl;
    }

    // ---> Add this section to explicitly enable buffer allocation <-----
    // UInt32 shouldAllocate = 1; // True
    // status = AudioUnitSetProperty(g_audioUnit, kAudioUnitProperty_ShouldAllocateBuffer,
    //                               kAudioUnitScope_Input, 1, // Input Scope, Bus 1
    //                               &shouldAllocate, sizeof(shouldAllocate));
    // if (status != noErr) {
    //     // Log this as a warning, might not be fatal depending on the unit
    //     std::cerr << "[audio_capture_macos] Warning: Failed to set ShouldAllocateBuffer property: " << status << std::endl;
    // }
    // ---------------------------------------------------------------

    // Set the input callback
    AURenderCallbackStruct callbackStruct;
    callbackStruct.inputProc = AudioInputCallback;
    callbackStruct.inputProcRefCon = g_audioUnit; // Pass AU instance to callback
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_SetInputCallback,
                                  kAudioUnitScope_Global, 0, // Global scope for input callback
                                  &callbackStruct, sizeof(callbackStruct));
    if (status != noErr) {
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        Napi::Error::New(env, "Failed to set input callback on AudioUnit: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Initialize the Audio Unit
    status = AudioUnitInitialize(g_audioUnit);
    if (status != noErr) {
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        Napi::Error::New(env, "Failed to initialize AudioUnit: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // --- Setup ThreadSafeFunction ---
    g_tsf = Napi::ThreadSafeFunction::New(
        env,                           // Environment
        jsDataCallback,                // JS function to call
        "AudioCaptureCallback",        // Resource name
        0,                             // Max queue size (0 = unlimited)
        1,                             // Initial thread count (audio thread)
        [](Napi::Env) {                // Finalizer function (optional)
            // Called when thread count reaches 0
            std::cout << "ThreadSafeFunction finalized." << std::endl;
        });
    if (g_tsf == nullptr) {
        // Cleanup CoreAudio if TSF creation fails
        AudioUnitUninitialize(g_audioUnit);
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        Napi::Error::New(env, "Failed to create ThreadSafeFunction").ThrowAsJavaScriptException();
        return env.Null();
    }
    // Acquire TSF initially - decremented automatically on thread exit or manual Release()
    g_tsf.Acquire(); 
    // -----------------------------

    // --- Start Audio Unit ---
    status = AudioOutputUnitStart(g_audioUnit);
    if (status != noErr) {
        // Cleanup if start fails
        g_tsf.Release(); // Release TSF since audio unit failed
        g_tsf = nullptr; 
        AudioUnitUninitialize(g_audioUnit);
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        Napi::Error::New(env, "Failed to start AudioUnit: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }
    // -----------------------

    std::cout << "[audio_capture_macos] CoreAudio setup complete and AudioUnit started." << std::endl;
    g_isCapturing = true; 

    return Napi::Boolean::New(env, true); // Indicate success
}

// Function to stop capture
Napi::Value StopCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::cout << "[audio_capture_macos] StopCapture called" << std::endl;
    
    if (!g_isCapturing) {
        std::cout << "[audio_capture_macos] Capture not currently running." << std::endl;
        // Ensure TSF is null if we weren't capturing
        if (g_tsf != nullptr) {
             std::cerr << "[audio_capture_macos] Warning: StopCapture called when not capturing, but TSF existed. Releasing." << std::endl;
            g_tsf.Release(); 
            g_tsf = nullptr;
        }
        return Napi::Boolean::New(env, true); 
    }

    // --- Teardown CoreAudio (if AU exists) ---
    if (g_audioUnit != nullptr) {
        OSStatus status;
        status = AudioOutputUnitStop(g_audioUnit);
        if (status != noErr) { std::cerr << "[audio_capture_macos] Error stopping AudioUnit: " << status << std::endl; }
        status = AudioUnitUninitialize(g_audioUnit);
        if (status != noErr) { std::cerr << "[audio_capture_macos] Error uninitializing AudioUnit: " << status << std::endl; }
        AURenderCallbackStruct callbackStruct = { .inputProc = nullptr, .inputProcRefCon = nullptr }; 
        AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0, &callbackStruct, sizeof(callbackStruct));
        status = AudioComponentInstanceDispose(g_audioUnit);
        if (status != noErr) { std::cerr << "[audio_capture_macos] Error disposing AudioUnit: " << status << std::endl; }
        g_audioUnit = nullptr;
        std::cout << "[audio_capture_macos] CoreAudio teardown complete." << std::endl;
    } else {
         std::cout << "[audio_capture_macos] AudioUnit was already null during stop." << std::endl;
    }
    // -----------------------------------------
    
    // --- Release ThreadSafeFunction ---
    if (g_tsf != nullptr) {
        napi_status status = g_tsf.Release(); // Decrement thread count, triggers finalizer when 0
         if (status != napi_ok) {
            std::cerr << "[audio_capture_macos] Error releasing ThreadSafeFunction: " << status << std::endl;
         }
        g_tsf = nullptr; // Clear the global reference
    } else {
        std::cout << "[audio_capture_macos] ThreadSafeFunction was already null during stop." << std::endl;
    }
    // --------------------------------

    // Reset state
    g_targetDeviceID = kAudioDeviceUnknown;
    g_isCapturing = false;
    
    return Napi::Boolean::New(env, true); // Indicate success
}

// Initialize the N-API module, exporting functions
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "listDevices"), Napi::Function::New(env, ListDevices));
    exports.Set(Napi::String::New(env, "startCapture"), Napi::Function::New(env, StartCapture));
    exports.Set(Napi::String::New(env, "stopCapture"), Napi::Function::New(env, StopCapture));
    return exports;
}

// Register the module with Node.js
NODE_API_MODULE(audio_capture_macos, Init) 