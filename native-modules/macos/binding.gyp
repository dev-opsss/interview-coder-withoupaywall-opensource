{
  "targets": [
    {
      "target_name": "audio_capture_macos",
      "sources": [ "audio_capture_macos.cc" ],
      "conditions": [
        ['OS=="mac"', {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "SDKROOT": "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
          },
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "dependencies": [],
          "link_settings": {
            "libraries": [], # No specific libraries needed for base setup
            "frameworks": [ "CoreAudio.framework", "AudioToolbox.framework" ] # Add CoreAudio frameworks
          }
        }]
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include_dir\")"
      ],
      "defines": [ "NAPI_VERSION=8" ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
    }
  ]
} 