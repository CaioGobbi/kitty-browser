{
  "targets": [
    {
      "target_name": "swipe_phase",
      "sources": ["swipe_phase.mm"],
      "defines": ["NAPI_VERSION=8"],
      "xcode_settings": {
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "OTHER_CPLUSPLUSFLAGS": ["-std=c++17"]
      },
      "link_settings": { "libraries": ["-framework AppKit"] }
    }
  ]
}
