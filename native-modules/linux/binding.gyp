{
  "targets": [
    {
      "target_name": "audio_capture_linux",
      "sources": [ "dummy.cc" ],
      "conditions": [
        ["OS=='linux'", {
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "dependencies": [],
          "link_settings": {
            "libraries": [ "-lpulse", "-lpulse-simple" ] 
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