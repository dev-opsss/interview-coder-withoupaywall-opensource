{
  "targets": [
    {
      "target_name": "audio_capture_windows",
      "sources": [ "dummy.cc" ],
      "conditions": [
        ['OS=="win"', {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1, # /EHsc
              "RuntimeLibrary": 2 # /MD - Multi-threaded DLL
            }
          },
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "dependencies": [],
          "link_settings": {
            "libraries": [ "-lOle32.lib", "-lAudioclient.lib" ] # Add necessary WASAPI libs
          }
        }]
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include_dir\")"
      ],
      "defines": [ "NAPI_VERSION=8" ], 
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
      # No Xcode settings needed for Windows
    }
  ]
} 