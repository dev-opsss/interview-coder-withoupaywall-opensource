#include <napi.h>
#include <node_api.h>
#include <cstring>
#include <cmath>
#include <memory>
#include <vector>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <CoreAudio/CoreAudio.h>
#include <AudioUnit/AudioUnit.h>
#include <Foundation/Foundation.h>
#include <AVFoundation/AVFoundation.h>
#include <CoreMedia/CoreMedia.h>
#include <ScreenCaptureKit/ScreenCaptureKit.h>
#include <iostream>

using namespace Napi;
using namespace std;

// Audio data structure
struct AudioData {
    float* data;
    size_t length;
    double timestamp;

    AudioData(float* d, size_t len, double ts) : data(d), length(len), timestamp(ts) {}
    ~AudioData() { 
        delete[] data;
        data = nullptr;
    }
};

// Global state
static std::mutex g_mutex;
static std::condition_variable g_cv;
static std::queue<AudioData*> g_queue; // Queue to hold audio data

// Function to check if there is pending data in the queue
bool HasData() {
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        return !g_queue.empty();
    } catch (const std::exception& e) {
        std::cerr << "[audio_capture_macos] Error in HasData: " << e.what() << std::endl;
        return false;
    }
}

// Add globals
static ThreadSafeFunction g_tsfn;
static bool g_tsfn_initialized = false;
static bool g_isCapturing = false;

// Audio format globals
static UInt32 g_numChannels = 2; // Default to stereo
static UInt32 g_bytesPerSample = sizeof(Float32); // Default to 32-bit float

// Debug flags
std::atomic<bool> g_generateTestTone(false); // When true, generate test tone if silence detected
double g_testToneFrequency = 440.0; // 440 Hz (A4 note)
double g_testTonePhase = 0.0; // Current phase of the sine wave

// Global state (Use with caution in production; consider a class)
// std::atomic<bool> g_isCapturing(false); // REMOVED - duplicate
AudioUnit g_audioUnit = nullptr;
AudioComponent g_audioComponent = nullptr;
static AudioDeviceID g_targetDeviceID = kAudioDeviceUnknown;

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

// --- MOVED DEFINITIONS EARLIER --- 
struct AudioDeviceInfo {
    string id;
    string name;
};

// Internal function to list audio devices
vector<AudioDeviceInfo> ListDevicesInternal() {
    vector<AudioDeviceInfo> devices;
    UInt32 dataSize = 0;
    OSStatus status;

    // Get size of devices array
    AudioObjectPropertyAddress devicesPropertyAddress = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };

    status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devicesPropertyAddress, 0, nullptr, &dataSize);
    if (status != noErr || dataSize == 0) {
        return devices;
    }

    // Get device list
    UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
    vector<AudioDeviceID> deviceIDs(deviceCount);
    status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &devicesPropertyAddress, 0, nullptr, &dataSize, deviceIDs.data());
    if (status != noErr) {
        return devices;
    }

    // Get device info for each device
    for (UInt32 i = 0; i < deviceCount; ++i) {
        AudioDeviceInfo deviceInfo;
        
        // Get device UID
        CFStringRef deviceUIDRef = nullptr;
        dataSize = sizeof(CFStringRef);
        AudioObjectPropertyAddress uidPropertyAddress = {
            kAudioDevicePropertyDeviceUID,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        status = AudioObjectGetPropertyData(deviceIDs[i], &uidPropertyAddress, 0, nullptr, &dataSize, &deviceUIDRef);
        if (status == noErr && deviceUIDRef != nullptr) {
            deviceInfo.id = ConvertCFString(deviceUIDRef);
            CFRelease(deviceUIDRef);
        }

        // Get device name
        CFStringRef deviceNameRef = nullptr;
        dataSize = sizeof(CFStringRef);
        AudioObjectPropertyAddress namePropertyAddress = {
            kAudioDevicePropertyDeviceNameCFString,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        status = AudioObjectGetPropertyData(deviceIDs[i], &namePropertyAddress, 0, nullptr, &dataSize, &deviceNameRef);
        if (status == noErr && deviceNameRef != nullptr) {
            deviceInfo.name = ConvertCFString(deviceNameRef);
            CFRelease(deviceNameRef);
        }

        if (!deviceInfo.id.empty() && !deviceInfo.name.empty()) {
            devices.push_back(deviceInfo);
        }
    }

    return devices;
}
// --- END MOVED DEFINITIONS ---

// Function to list audio devices using CoreAudio (Public API)
Napi::Value ListDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array deviceList = Napi::Array::New(env);
    vector<AudioDeviceInfo> devices = ListDevicesInternal(); // Now uses the internal function

    uint32_t currentDeviceIndex = 0;
    for(const auto& device : devices) {
        Napi::Object deviceObj = Napi::Object::New(env);
        deviceObj.Set("id", Napi::String::New(env, device.id));
        deviceObj.Set("name", Napi::String::New(env, device.name));
        deviceList.Set(currentDeviceIndex++, deviceObj);
    }
    return deviceList;
}

// Utility function to allocate an AudioBufferList
static AudioBufferList* AllocateAudioBufferList(UInt32 numChannels, UInt32 size) {
    AudioBufferList* bufferList = static_cast<AudioBufferList*>(
        malloc(sizeof(AudioBufferList) + (numChannels - 1) * sizeof(AudioBuffer)));
    
    if (bufferList == nullptr) {
        return nullptr;
    }
    
    bufferList->mNumberBuffers = numChannels;
    for (UInt32 i = 0; i < numChannels; ++i) {
        bufferList->mBuffers[i].mNumberChannels = 1;
        bufferList->mBuffers[i].mDataByteSize = size;
        bufferList->mBuffers[i].mData = malloc(size);
        
        if (bufferList->mBuffers[i].mData == nullptr) {
            // Failed to allocate memory for a buffer, free everything and return nullptr
            for (UInt32 j = 0; j < i; ++j) {
                free(bufferList->mBuffers[j].mData);
            }
            free(bufferList);
            return nullptr;
        }
    }
    
    return bufferList;
}

// Utility function to deallocate an AudioBufferList
static void DeallocateAudioBufferList(AudioBufferList* bufferList) {
    if (bufferList == nullptr) {
        return;
    }
    
    for (UInt32 i = 0; i < bufferList->mNumberBuffers; ++i) {
        if (bufferList->mBuffers[i].mData != nullptr) {
            free(bufferList->mBuffers[i].mData);
        }
    }
    
    free(bufferList);
}

// Audio input callback function
static OSStatus audioInputCallback(void *inRefCon,
                                 AudioUnitRenderActionFlags *ioActionFlags,
                                 const AudioTimeStamp *inTimeStamp,
                                 UInt32 inBusNumber,
                                 UInt32 inNumberFrames,
                                 AudioBufferList *ioData) {
    // Skip if we're not capturing
    if (!g_isCapturing) {
        return noErr;
    }
    
    AudioUnit audioUnit = (AudioUnit)inRefCon;
    if (!audioUnit) {
        std::cerr << "[audio_capture_macos] Callback: No audio unit provided" << std::endl;
        return noErr;
    }
    
    // Get the audio format details
    AudioStreamBasicDescription asbd;
    UInt32 size = sizeof(asbd);
    OSStatus status = AudioUnitGetProperty(audioUnit,
                                         kAudioUnitProperty_StreamFormat,
                                         kAudioUnitScope_Output,
                                         1,
                                         &asbd,
                                         &size);
    
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to get audio format: " << status << std::endl;
        return status;
    }
    
    // Create a buffer list for the audio data
    AudioBufferList bufferList;
    bufferList.mNumberBuffers = 1;
    bufferList.mBuffers[0].mNumberChannels = asbd.mChannelsPerFrame;
    bufferList.mBuffers[0].mDataByteSize = inNumberFrames * asbd.mBytesPerFrame;
    bufferList.mBuffers[0].mData = malloc(bufferList.mBuffers[0].mDataByteSize);
    
    if (!bufferList.mBuffers[0].mData) {
        std::cout << "[audio_capture_macos] Failed to allocate buffer memory" << std::endl;
        return noErr;
    }
    
    // Render the audio data
    status = AudioUnitRender(audioUnit,
                            ioActionFlags,
                            inTimeStamp,
                            inBusNumber,
                            inNumberFrames,
                            &bufferList);
    
    bool audioRenderFailed = false;
    if (status != noErr) {
        std::cout << "[audio_capture_macos] AudioUnitRender failed: " << status << std::endl;
        audioRenderFailed = true;
    }
    
    // Process samples
    float *samples = (float *)bufferList.mBuffers[0].mData;
    bool allZeros = true;
    
    // Check for silence
    if (!audioRenderFailed) {
        for (UInt32 i = 0; i < inNumberFrames * asbd.mChannelsPerFrame; i++) {
            if (fabs(samples[i]) > 0.001f) {
                allZeros = false;
                break;
            }
        }
    }
    
    // Generate test tone if needed
    if (g_generateTestTone && (allZeros || audioRenderFailed)) {
        std::cout << "[audio_capture_macos] Generating test tone" << std::endl;
        float amplitude = 0.3f;
        const double twoPi = 2.0 * M_PI;
        double phaseIncrement = twoPi * g_testToneFrequency / asbd.mSampleRate;
        
        for (UInt32 i = 0; i < inNumberFrames; i++) {
            float value = amplitude * sinf(g_testTonePhase);
            for (UInt32 ch = 0; ch < asbd.mChannelsPerFrame; ch++) {
                samples[i * asbd.mChannelsPerFrame + ch] = value;
            }
            g_testTonePhase += phaseIncrement;
            if (g_testTonePhase >= twoPi) {
                g_testTonePhase -= twoPi;
            }
        }
    } else if (audioRenderFailed) {
        // Fill with zeros if render failed
        memset(bufferList.mBuffers[0].mData, 0, bufferList.mBuffers[0].mDataByteSize);
    }
    
    // Create the data buffer
    const UInt32 numSamples = inNumberFrames * asbd.mChannelsPerFrame;
    float* audioDataBuffer = new (std::nothrow) float[numSamples];
    
    if (!audioDataBuffer) {
        free(bufferList.mBuffers[0].mData);
        return noErr;
    }
    
    // Copy the data
    memcpy(audioDataBuffer, bufferList.mBuffers[0].mData, bufferList.mBuffers[0].mDataByteSize);
    
    // Free the temporary buffer
    free(bufferList.mBuffers[0].mData);
    
    // Get timestamp
    double timestamp = inTimeStamp->mHostTime / (double)AudioGetHostClockFrequency();
    
    // Create AudioData structure
    AudioData* audioData = new (std::nothrow) AudioData(audioDataBuffer, numSamples, timestamp);
    
    if (!audioData) {
        delete[] audioDataBuffer;
        return noErr;
    }
    
    // Add the audio data to the queue
    {
        try {
            std::lock_guard<std::mutex> lock(g_mutex);
            g_queue.push(audioData);
        } catch (const std::exception& e) {
            std::cerr << "[audio_capture_macos] Error adding data to queue: " << e.what() << std::endl;
        }
    }
    
    // Send the data through ThreadSafeFunction if it's initialized
    if (g_tsfn_initialized) {
        // Define a simple callback that receives just the data
        auto callback = [](Napi::Env env, Function jsCallback, AudioData* data) {
            HandleScope scope(env);
            
            try {
                // Create JS objects
                Object obj = Object::New(env);
                Napi::Float32Array array = Napi::Float32Array::New(env, data->length);
                memcpy(array.Data(), data->data, data->length * sizeof(float));
                
                // Set properties
                obj.Set("data", array);
                obj.Set("length", Number::New(env, static_cast<double>(data->length)));
                obj.Set("timestamp", Number::New(env, data->timestamp));
                
                // Call the JS callback
                jsCallback.Call({obj});
            }
            catch (const std::exception& e) {
                // Log error but don't throw to main thread
                std::cerr << "[audio_capture_macos] Error in callback: " << e.what() << std::endl;
            }
            
            // Cleanup
            {
                try {
                    std::lock_guard<std::mutex> lock(g_mutex);
                    // Remove from queue if it's still there
                    if (!g_queue.empty() && g_queue.front() == data) {
                        g_queue.pop();
                    }
                } catch (const std::exception& e) {
                    std::cerr << "[audio_capture_macos] Error removing data from queue: " << e.what() << std::endl;
                }
            }
            
            // Clean up
            delete data;
        };
        
        // Use non-blocking call to avoid audio thread delays
        auto status = g_tsfn.NonBlockingCall(audioData, callback);
        if (status != napi_ok) {
            // Clean up if call fails
            delete audioData;
            std::cerr << "[audio_capture_macos] Failed to queue audio data" << std::endl;
        }
    } else {
        // Clean up if TSFN not initialized
        delete audioData;
    }
    
    return noErr;
}

// Function to get the default input device ID
static OSStatus GetDefaultInputDeviceID(AudioDeviceID &outDeviceID) {
    AudioObjectPropertyAddress propertyAddress = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    
    UInt32 propertySize = sizeof(AudioDeviceID);
    OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &propertyAddress, 
                                               0, NULL, &propertySize, &outDeviceID);
    
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to get default input device: " << status << std::endl;
        outDeviceID = kAudioDeviceUnknown;
    } else {
        std::cout << "[audio_capture_macos] Found default input device ID: " << outDeviceID << std::endl;
    }
    
    return status;
}

// Function to find BlackHole device
static OSStatus FindBlackHoleDeviceID(AudioDeviceID &outDeviceID) {
    // Start with no device found
    outDeviceID = kAudioDeviceUnknown;
    
    // Get the number of audio devices in the system
    AudioObjectPropertyAddress propertyAddress = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    
    UInt32 propertySize = 0;
    OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &propertyAddress, 
                                                  0, NULL, &propertySize);
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to get device list size: " << status << std::endl;
        return status;
    }
    
    // Calculate the number of devices
    int deviceCount = propertySize / sizeof(AudioDeviceID);
    if (deviceCount == 0) {
        std::cerr << "[audio_capture_macos] No audio devices found" << std::endl;
        return -1;
    }
    
    // Allocate an array of AudioDeviceIDs
    AudioDeviceID *deviceList = new AudioDeviceID[deviceCount];
    if (!deviceList) {
        std::cerr << "[audio_capture_macos] Failed to allocate memory for device list" << std::endl;
        return -1;
    }
    
    // Get the array of AudioDeviceIDs
    status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &propertyAddress, 
                                      0, NULL, &propertySize, deviceList);
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to get device list: " << status << std::endl;
        delete[] deviceList;
        return status;
    }
    
    // Iterate through the devices looking for BlackHole
    for (int i = 0; i < deviceCount; i++) {
        // Get the device name
        AudioObjectPropertyAddress nameAddress = {
            kAudioObjectPropertyName,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        
        CFStringRef deviceName = NULL;
        propertySize = sizeof(CFStringRef);
        status = AudioObjectGetPropertyData(deviceList[i], &nameAddress, 
                                          0, NULL, &propertySize, &deviceName);
        
        if (status == noErr && deviceName) {
            // Convert CFString to C string
            char deviceNameBuffer[256];
            if (CFStringGetCString(deviceName, deviceNameBuffer, sizeof(deviceNameBuffer), kCFStringEncodingUTF8)) {
                std::string devName = deviceNameBuffer;
                
                // Check if this is BlackHole and it has input streams
                if (devName.find("BlackHole") != std::string::npos || 
                    devName.find("Blackhole") != std::string::npos) {
                    
                    // Check if device has input streams
                    AudioObjectPropertyAddress streamsAddress = {
                        kAudioDevicePropertyStreams,
                        kAudioDevicePropertyScopeInput,
                        kAudioObjectPropertyElementMain
                    };
                    
                    UInt32 streamSize = 0;
                    status = AudioObjectGetPropertyDataSize(deviceList[i], &streamsAddress, 
                                                          0, NULL, &streamSize);
                    if (status == noErr && streamSize > 0) {
                        std::cout << "[audio_capture_macos] Found BlackHole device: " << deviceNameBuffer 
                                  << " (ID: " << deviceList[i] << ")" << std::endl;
                        outDeviceID = deviceList[i];
                        CFRelease(deviceName);
                        delete[] deviceList;
                        return noErr;
                    }
                }
            }
            
            CFRelease(deviceName);
        }
    }
    
    // Cleanup
    delete[] deviceList;
    
    std::cout << "[audio_capture_macos] BlackHole device not found" << std::endl;
    return noErr;  // Not finding BlackHole is not an error, we'll fall back to default
}

// Function to create and configure the audio unit
static OSStatus CreateAndConfigureAudioUnit() {
    OSStatus status;
    
    // 1. Find Target Device (Prefer BlackHole, fallback to default input)
    status = FindBlackHoleDeviceID(g_targetDeviceID);
    if (status != noErr || g_targetDeviceID == kAudioDeviceUnknown) {
        std::cerr << "[audio_capture_macos] Could not find BlackHole, falling back to default input device." << std::endl;
        status = GetDefaultInputDeviceID(g_targetDeviceID);
        if (status != noErr || g_targetDeviceID == kAudioDeviceUnknown) {
            std::cerr << "[audio_capture_macos] Failed to find a suitable audio input device." << std::endl;
            return status;
        }
    }
    
    // 2. Create Audio Unit (HAL Output Unit)
    AudioComponentDescription desc = {};
    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    g_audioComponent = AudioComponentFindNext(nullptr, &desc);
    if (!g_audioComponent) {
        std::cerr << "[audio_capture_macos] Failed to find HAL Output audio component" << std::endl;
        return -1;
    }
    status = AudioComponentInstanceNew(g_audioComponent, &g_audioUnit);
    if (status != noErr || !g_audioUnit) {
        std::cerr << "[audio_capture_macos] Failed to create audio unit instance" << std::endl;
        g_audioUnit = nullptr;
        return status;
    }
    
    // 3. Configure Audio Unit Properties
    // Important Debug Message
    std::cout << "[audio_capture_macos] Created audio unit instance, now configuring." << std::endl;
    std::cout << "[audio_capture_macos] Using device ID: " << g_targetDeviceID << std::endl;
    
    // Enable input on the AUHAL (bus 1 is input)
    UInt32 enableIO = 1;
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_EnableIO, 
                                  kAudioUnitScope_Input, 1, &enableIO, sizeof(enableIO));
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to enable audio unit input: " << status << std::endl;
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        return status;
    }
    
    // When test tone is enabled, we should also enable output
    if (g_generateTestTone) {
        // Enable output on the AUHAL (bus 0 is output) for test tone monitoring
        enableIO = 0; // CHANGED from 1 to 0 to disable output
        std::cout << "[audio_capture_macos] Test tone is enabled, but output is disabled for stability." << std::endl;
    } else {
        // Disable output when not using test tone
        enableIO = 0;
        std::cout << "[audio_capture_macos] Test tone is disabled, disabling audio unit output." << std::endl;
    }
    
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_EnableIO, 
                                  kAudioUnitScope_Output, 0, &enableIO, sizeof(enableIO));
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to configure audio unit output: " << status << std::endl;
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        return status;
    }
    
    // Set the current device
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_CurrentDevice, 
                                  kAudioUnitScope_Global, 0, &g_targetDeviceID, sizeof(g_targetDeviceID));
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to set audio device on unit: " << status << std::endl;
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        return status;
    }
    
    // 4. Set Stream Format (Match callback expectations: Stereo Float32)
    // TODO: Make this configurable or detect from device
    AudioStreamBasicDescription streamFormat = {};
    streamFormat.mSampleRate       = 48000.0; // CHANGED to 48kHz
    streamFormat.mFormatID         = kAudioFormatLinearPCM;
    streamFormat.mFormatFlags      = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    streamFormat.mChannelsPerFrame = 2; // Stereo
    streamFormat.mBitsPerChannel   = sizeof(Float32) * 8;
    streamFormat.mBytesPerFrame    = streamFormat.mChannelsPerFrame * sizeof(Float32);
    streamFormat.mBytesPerPacket   = streamFormat.mBytesPerFrame;
    streamFormat.mFramesPerPacket  = 1;
    
    std::cout << "[audio_capture_macos] Setting stream format: " << streamFormat.mSampleRate << " Hz, " 
              << streamFormat.mChannelsPerFrame << " channels, " 
              << streamFormat.mBitsPerChannel << " bits" << std::endl;
    
    status = AudioUnitSetProperty(g_audioUnit, kAudioUnitProperty_StreamFormat, 
                                  kAudioUnitScope_Output, 1, &streamFormat, sizeof(streamFormat));
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to set stream format: " << status << std::endl;
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        return status;
    }
    
    // 5. Set Input Callback
    AURenderCallbackStruct callbackStruct = {};
    callbackStruct.inputProc = audioInputCallback;
    callbackStruct.inputProcRefCon = g_audioUnit;  // Pass the AudioUnit as the reference context
    status = AudioUnitSetProperty(g_audioUnit, kAudioOutputUnitProperty_SetInputCallback, 
                                  kAudioUnitScope_Global, 0, &callbackStruct, sizeof(callbackStruct));
    if (status != noErr) {
        std::cerr << "[audio_capture_macos] Failed to set input callback: " << status << std::endl;
        AudioComponentInstanceDispose(g_audioUnit);
        g_audioUnit = nullptr;
        return status;
    }
    
    // Set output callback if test tone is enabled
    if (g_generateTestTone) {
        std::cout << "[audio_capture_macos] Setting up output callback for test tone." << std::endl;
        // Set the render callback for output (same callback for simplicity)
        status = AudioUnitSetProperty(g_audioUnit, kAudioUnitProperty_SetRenderCallback, 
                                    kAudioUnitScope_Input, 0, &callbackStruct, sizeof(callbackStruct));
        if (status != noErr) {
            std::cerr << "[audio_capture_macos] Warning: Failed to set output callback: " << status << std::endl;
            // Non-fatal, continue
        }
    }
    
    return noErr;
}

// Function to start capture
Napi::Value StartCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // We need at least a callback function
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Function expected as first argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Check if we're already capturing
    if (g_isCapturing) {
        Napi::Error::New(env, "Already capturing audio").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Get the callback function
    Napi::Function callback = info[0].As<Napi::Function>();
    
    // Check if we should generate test tone
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();
        if (options.Has("generateTestTone") && options.Get("generateTestTone").IsBoolean()) {
            g_generateTestTone = options.Get("generateTestTone").As<Napi::Boolean>();
        }
        if (options.Has("testToneFrequency") && options.Get("testToneFrequency").IsNumber()) {
            g_testToneFrequency = options.Get("testToneFrequency").As<Napi::Number>().FloatValue();
        }
    }
    
    // Create ThreadSafeFunction for audio data callback
    // This allows us to call JS from the audio thread
    g_tsfn = Napi::ThreadSafeFunction::New(
        env,                               // Environment
        callback,                          // JS callback
        "Audio Capture Callback",          // Resource name
        0,                                 // Max queue size (0 = unlimited)
        1,                                 // Initial thread count
        [](Napi::Env) {                    // Finalizer
            std::cout << "[audio_capture_macos] ThreadSafeFunction finalized" << std::endl;
        }
    );
    g_tsfn_initialized = true;
    
    // Create and configure the audio unit if not done yet
    OSStatus status = CreateAndConfigureAudioUnit();
    if (status != noErr) {
        g_tsfn.Release(); // Release TSFN on error
        g_tsfn_initialized = false;
        Napi::Error::New(env, "Failed to create audio unit").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Start the audio unit
    status = AudioUnitInitialize(g_audioUnit);
    if (status != noErr) {
        std::cout << "[audio_capture_macos] AudioUnitInitialize failed: " << status << std::endl;
        g_tsfn.Release(); // Release TSFN on error
        g_tsfn_initialized = false;
        Napi::Error::New(env, "Failed to initialize audio unit").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    status = AudioOutputUnitStart(g_audioUnit);
    if (status != noErr) {
        std::cout << "[audio_capture_macos] AudioOutputUnitStart failed: " << status << std::endl;
        AudioUnitUninitialize(g_audioUnit);
        g_tsfn.Release(); // Release TSFN on error
        g_tsfn_initialized = false;
        Napi::Error::New(env, "Failed to start audio unit").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    g_isCapturing = true;
    return Napi::Boolean::New(env, true);
}

// Function to stop capture
Napi::Value StopCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_isCapturing) {
        std::cout << "[audio_capture_macos] StopCapture called but not capturing." << std::endl;
        return env.Undefined();
    }

    std::cout << "[audio_capture_macos] Starting cleanup process..." << std::endl;
    g_isCapturing = false; // Signal callback to stop processing new data
    
    // Release the ThreadSafeFunction first
    if (g_tsfn_initialized) {
        std::cout << "[audio_capture_macos] Releasing ThreadSafeFunction..." << std::endl;
        g_tsfn.Release();
        g_tsfn = ThreadSafeFunction(); // Reset to empty state
        g_tsfn_initialized = false;
        std::cout << "[audio_capture_macos] ThreadSafeFunction released." << std::endl;
    } else {
        std::cout << "[audio_capture_macos] ThreadSafeFunction not initialized or already released." << std::endl;
    }
    
    // Clean up any data left in the queue
    {
        try {
            std::lock_guard<std::mutex> lock(g_mutex);
            std::cout << "[audio_capture_macos] Cleanup: Clearing audio data queue with " << g_queue.size() << " items" << std::endl;
            while (!g_queue.empty()) {
                AudioData* data = g_queue.front();
                g_queue.pop();
                delete data;
            }
            std::cout << "[audio_capture_macos] Cleanup: Audio data queue cleared" << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "[audio_capture_macos] Error during queue cleanup: " << e.what() << std::endl;
        }
    }
    
    // Teardown Audio Unit
    if (g_audioUnit != nullptr) {
        std::cout << "[audio_capture_macos] Starting AudioUnit teardown..." << std::endl;
        
        // Stop the audio unit
        OSStatus status = AudioOutputUnitStop(g_audioUnit);
        if (status != noErr) {
            std::cerr << "[audio_capture_macos] Error stopping AudioUnit: " << status << std::endl;
        }
        
        // Uninitialize
        status = AudioUnitUninitialize(g_audioUnit);
        if (status != noErr) {
            std::cerr << "[audio_capture_macos] Error uninitializing AudioUnit: " << status << std::endl;
        }
        
        // Dispose the audio unit
        status = AudioComponentInstanceDispose(g_audioUnit);
        if (status != noErr) {
            std::cerr << "[audio_capture_macos] Error disposing AudioUnit: " << status << std::endl;
        }
        
        g_audioUnit = nullptr;
        g_targetDeviceID = kAudioDeviceUnknown;
        std::cout << "[audio_capture_macos] AudioUnit teardown complete." << std::endl;
    }

    std::cout << "[audio_capture_macos] Cleanup process completed." << std::endl;
    return env.Undefined();
}

// Function to enable/disable test tone generation
Napi::Value EnableTestTone(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Check arguments: enable (boolean), optional frequency (number)
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Expected arguments: enable (boolean), [frequency (number)]").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    bool enable = info[0].As<Napi::Boolean>().Value();
    bool previous = g_generateTestTone;
    g_generateTestTone = enable;
    
    // Set frequency if provided
    if (info.Length() > 1 && info[1].IsNumber()) {
        double frequency = info[1].As<Napi::Number>().DoubleValue();
        if (frequency > 20.0 && frequency < 20000.0) { // Keep in audible range
            g_testToneFrequency = frequency;
        }
    }
    
    std::cout << "[audio_capture_macos] Test tone " << (enable ? "enabled" : "disabled");
    if (enable) {
        std::cout << " at " << g_testToneFrequency << " Hz";
    }
    std::cout << " (was " << (previous ? "enabled" : "disabled") << ")" << std::endl;
    
    // Important: If we're already capturing, these settings won't take effect until restart
    if (g_isCapturing && previous != enable) {
        std::cout << "[audio_capture_macos] ⚠️ Note: Already capturing. Stop and restart capture for test tone changes to take effect." << std::endl;
    }
    
    return Napi::Boolean::New(env, enable);
}

// Test various formats on a device to diagnose property errors
Napi::Value TestDeviceFormats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected device ID string").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string deviceUID = info[0].As<Napi::String>().Utf8Value();
    AudioDeviceID deviceID = kAudioDeviceUnknown;
    OSStatus status = GetAudioDeviceIDFromUID(deviceUID, deviceID);
    
    if (status != noErr || deviceID == kAudioDeviceUnknown) {
        Napi::Error::New(env, "Device not found: " + deviceUID).ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::cout << "Testing formats for device ID: " << deviceID << std::endl;
    
    // Create result array
    Napi::Array results = Napi::Array::New(env);
    uint32_t resultIndex = 0;
    
    // Test various configurations
    struct FormatConfig {
        std::string name;
        Float64 sampleRate;
        UInt32 formatFlags;
        UInt32 bitsPerChannel;
        UInt32 channelsPerFrame;
    };
    
    // Define test formats
    std::vector<FormatConfig> testFormats = {
        {"48kHz Stereo 16-bit Int", 48000.0, kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, 16, 2},
        {"48kHz Stereo 32-bit Float", 48000.0, kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, 32, 2},
        {"44.1kHz Stereo 16-bit Int", 44100.0, kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, 16, 2},
        {"44.1kHz Mono 16-bit Int", 44100.0, kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, 16, 1},
        {"48kHz Mono 16-bit Int", 48000.0, kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, 16, 1}
    };
    
    // Create temporary AudioUnit for testing
    AudioUnit audioUnit = nullptr;
    AudioComponentDescription desc = {};
    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    
    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (comp == nullptr) {
        Napi::Error::New(env, "Failed to find HAL Output AudioComponent").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    status = AudioComponentInstanceNew(comp, &audioUnit);
    if (status != noErr || audioUnit == nullptr) {
        Napi::Error::New(env, "Failed to create AudioUnit instance: " + std::to_string(status)).ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Test each format
    for (const auto& format : testFormats) {
        std::cout << "Testing format: " << format.name << std::endl;
        Napi::Object result = Napi::Object::New(env);
        result.Set("format", format.name);
        result.Set("success", false);
        
        // Step 1: Try to enable input
        UInt32 enableIO = 1;
        status = AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_EnableIO,
                                    kAudioUnitScope_Input, 1, // Input scope, bus 1
                                    &enableIO, sizeof(enableIO));
        if (status != noErr) {
            std::cout << "Failed to enable input: " << status << std::endl;
            result.Set("error", "Failed to enable input");
            result.Set("errorCode", status);
            results.Set(resultIndex++, result);
            continue;
        }
        
        // Step 2: Try to disable output
        enableIO = 0;
        status = AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_EnableIO,
                                    kAudioUnitScope_Output, 0, // Output scope, bus 0
                                    &enableIO, sizeof(enableIO));
        if (status != noErr) {
            std::cout << "Warning: Failed to disable output: " << status << std::endl;
            // Not a fatal error, continue
        }
        
        // Step 3: Set the device
        status = AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_CurrentDevice,
                                    kAudioUnitScope_Global, 0, // Global scope
                                    &deviceID, sizeof(deviceID));
        if (status != noErr) {
            std::cout << "Failed to set device: " << status << std::endl;
            result.Set("error", "Failed to set device");
            result.Set("errorCode", status);
            results.Set(resultIndex++, result);
            continue;
        }
        
        // Step 4: Set the stream format
        AudioStreamBasicDescription asbd = {};
        asbd.mSampleRate = format.sampleRate;
        asbd.mFormatID = kAudioFormatLinearPCM;
        asbd.mFormatFlags = format.formatFlags;
        asbd.mChannelsPerFrame = format.channelsPerFrame;
        asbd.mBitsPerChannel = format.bitsPerChannel;
        asbd.mBytesPerFrame = (format.bitsPerChannel / 8) * format.channelsPerFrame;
        asbd.mBytesPerPacket = asbd.mBytesPerFrame;
        asbd.mFramesPerPacket = 1;
        
        status = AudioUnitSetProperty(audioUnit, kAudioUnitProperty_StreamFormat,
                                    kAudioUnitScope_Output, 1, // Output scope of input bus
                                    &asbd, sizeof(asbd));
        if (status != noErr) {
            std::cout << "Failed to set stream format: " << status << std::endl;
            result.Set("error", "Failed to set stream format");
            result.Set("errorCode", status);
            results.Set(resultIndex++, result);
            continue;
        }
        
        // All steps succeeded
        result.Set("success", true);
        results.Set(resultIndex++, result);
    }
    
    // Clean up
    if (audioUnit) {
        AudioComponentInstanceDispose(audioUnit);
    }
    
    return results;
}

// Check for BlackHole and print a nice message for the log (Uses ListDevicesInternal)
void CheckForBlackHole() {
  // Just log info about BlackHole availability - doesn't change functionality
  bool foundBlackHole = false;
  
  const auto devices = ListDevicesInternal(); // Should be defined now
  for (const auto& device : devices) {
    // Check both name and ID for BlackHole
    if (device.name.find("BlackHole") != std::string::npos || 
        device.id.find("BlackHole") != std::string::npos) {
      std::cout << "[audio_capture_macos] ✅ BlackHole virtual audio device detected: " 
                << device.name << " (" << device.id << ")" << std::endl;
      foundBlackHole = true;
      break;
    }
  }
  
  if (!foundBlackHole) {
    std::cout << "[audio_capture_macos] ⚠️ BlackHole virtual audio device not detected." << std::endl;
    std::cout << "[audio_capture_macos] 💡 For reliable system audio capture, install BlackHole:" << std::endl;
    std::cout << "[audio_capture_macos]    Run: node native-modules/macos/install-blackhole.js" << std::endl;
  }
}

// Function to check if the audio queue has data
Napi::Value HasPendingData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, HasData());
}

// Initialize the N-API module, exporting functions
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Ensure all global state is initialized
    g_isCapturing = false;
    g_audioUnit = nullptr;
    g_targetDeviceID = kAudioDeviceUnknown;
    
    exports.Set(Napi::String::New(env, "listDevices"), Napi::Function::New(env, ListDevices));
    exports.Set(Napi::String::New(env, "startCapture"), Napi::Function::New(env, StartCapture));
    exports.Set(Napi::String::New(env, "stopCapture"), Napi::Function::New(env, StopCapture));
    exports.Set(Napi::String::New(env, "enableTestTone"), Napi::Function::New(env, EnableTestTone));
    exports.Set(Napi::String::New(env, "testDeviceFormats"), Napi::Function::New(env, TestDeviceFormats));
    exports.Set(Napi::String::New(env, "hasPendingData"), Napi::Function::New(env, HasPendingData));
    
    // Check for BlackHole at module load time
    CheckForBlackHole();
    
    // Register cleanup function
    napi_add_env_cleanup_hook(env, [](void* arg) {
        std::cout << "[audio_capture_macos] Module cleanup hook called" << std::endl;
        if (g_isCapturing) {
            std::cout << "[audio_capture_macos] Force stopping capture during cleanup" << std::endl;
            g_isCapturing = false;
            
            // Release ThreadSafeFunction first
            if (g_tsfn_initialized) {
                std::cout << "[audio_capture_macos] Force releasing ThreadSafeFunction during cleanup" << std::endl;
                g_tsfn.Release();
                g_tsfn = ThreadSafeFunction(); // Reset to empty state
                g_tsfn_initialized = false;
            }
            
            // Clean up audio unit
            if (g_audioUnit) {
                AudioOutputUnitStop(g_audioUnit);
                AudioUnitUninitialize(g_audioUnit);
                AudioComponentInstanceDispose(g_audioUnit);
                g_audioUnit = nullptr;
            }
        }
        
        // Clean up any data left in the queue
        {
            try {
                std::lock_guard<std::mutex> lock(g_mutex);
                std::cout << "[audio_capture_macos] Cleanup: Clearing audio data queue with " << g_queue.size() << " items" << std::endl;
                while (!g_queue.empty()) {
                    AudioData* data = g_queue.front();
                    g_queue.pop();
                    delete data;
                }
                std::cout << "[audio_capture_macos] Cleanup: Audio data queue cleared" << std::endl;
            } catch (const std::exception& e) {
                std::cerr << "[audio_capture_macos] Error during queue cleanup: " << e.what() << std::endl;
            }
        }
    }, nullptr);
    
    return exports;
}

// Register the module with Node.js
NODE_API_MODULE(audio_capture_macos, Init) 


