// Thin browser/bundler entry to the renderer built from the pinned official
// checkout. This file contains no local rendering implementation.
export {
  SlideCanvas,
  SlideElement,
  SlideRendererProvider,
  useSlideContext,
  useOptionalSlideContext,
  HighlightOverlay,
  SpotlightOverlay,
  LaserOverlay,
  ZoomWrapper
} from "../../third_party/openmaic/packages/@openmaic/renderer/dist/index.js";
