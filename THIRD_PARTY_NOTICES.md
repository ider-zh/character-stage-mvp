# Third-party notices

This project includes npm dependencies pinned in package-lock.json. Their upstream licenses apply.

- React and React DOM: MIT, Meta Platforms, Inc. and affiliates, https://github.com/facebook/react
- PixiJS: MIT, PixiJS contributors, https://github.com/pixijs/pixijs
- ws: MIT, Einar Otto Stangvik and contributors, https://github.com/websockets/ws
- sharp: Apache-2.0, Lovell Fuller and contributors; bundled libvips and image codecs retain their respective licenses, https://github.com/lovell/sharp
- MediaPipe Tasks Vision 0.10.32: Apache-2.0, Google LLC, https://github.com/google-ai-edge/mediapipe
- MediaPipe Face Landmarker model bundle: downloaded from Google's official model hosting, fixed float16 version 1. Upstream terms/model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker and https://github.com/google-ai-edge/mediapipe

The public/mediapipe/wasm/*.mjs files are local copies of MediaPipe's WASM loader with `export default ModuleFactory;` appended for a Vite module Worker. Original copyright/license comments are retained. The original loaders are retained beside them. Apache 2.0 text is included in licenses/Apache-2.0.txt.

The three seed characters are original programmatic SVG artwork authored for this project in server/seeds.ts. They are not AI outputs or third-party character assets.
