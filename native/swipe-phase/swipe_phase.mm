// Reports the phase of trackpad scroll gestures (fingers down, moving, lifted)
// to JavaScript. Web pages only see wheel deltas, so they can't tell holding
// still from letting go; AppKit can. Chrome and Safari rely on the same signal
// for swipe-to-navigate.
#import <AppKit/AppKit.h>
#include <node_api.h>

namespace {

napi_threadsafe_function callback = nullptr;
id monitor = nil;

struct ScrollPhase {
  int phase;          // NSEventPhase of the fingers
  int momentumPhase;  // NSEventPhase of the inertia after they lift
  double deltaX;
  double deltaY;
};

void SetNumber(napi_env env, napi_value object, const char* key, double value) {
  napi_value number;
  napi_create_double(env, value, &number);
  napi_set_named_property(env, object, key, number);
}

void CallJs(napi_env env, napi_value js_callback, void*, void* data) {
  auto* event = static_cast<ScrollPhase*>(data);
  if (env != nullptr && js_callback != nullptr) {
    napi_value object;
    napi_create_object(env, &object);
    SetNumber(env, object, "phase", event->phase);
    SetNumber(env, object, "momentumPhase", event->momentumPhase);
    SetNumber(env, object, "deltaX", event->deltaX);
    SetNumber(env, object, "deltaY", event->deltaY);
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, js_callback, 1, &object, nullptr);
  }
  delete event;
}

napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1 || callback != nullptr) return nullptr;

  napi_value name;
  napi_create_string_utf8(env, "kitty-swipe-phase", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, argv[0], nullptr, name, 0, 1, nullptr, nullptr, nullptr, CallJs, &callback);
  napi_unref_threadsafe_function(env, callback);  // don't keep the app alive

  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
                                                  handler:^NSEvent*(NSEvent* event) {
    // Only trackpad / Magic Mouse gestures have phases; classic wheels don't.
    if (event.hasPreciseScrollingDeltas &&
        (event.phase != NSEventPhaseNone || event.momentumPhase != NSEventPhaseNone)) {
      auto* data = new ScrollPhase{static_cast<int>(event.phase), static_cast<int>(event.momentumPhase),
                                   event.scrollingDeltaX, event.scrollingDeltaY};
      if (napi_call_threadsafe_function(callback, data, napi_tsfn_nonblocking) != napi_ok) delete data;
    }
    return event;  // observe only: the page still gets its scroll
  }];
  return nullptr;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value start;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, nullptr, &start);
  napi_set_named_property(env, exports, "start", start);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
