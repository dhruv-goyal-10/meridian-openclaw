import type { Transform } from "../transform"
import { openCodeTransforms } from "./opencode"
import { crushTransforms } from "./crush"
import { droidTransforms } from "./droid"
import { piTransforms } from "./pi"
import { forgeCodeTransforms } from "./forgecode"
import { passthroughTransforms } from "./passthrough"
import { openClawTransforms } from "./openclaw"

const ADAPTER_TRANSFORMS: Record<string, readonly Transform[]> = {
  opencode: openCodeTransforms,
  crush: crushTransforms,
  droid: droidTransforms,
  pi: piTransforms,
  forgecode: forgeCodeTransforms,
  passthrough: passthroughTransforms,
  openclaw: openClawTransforms,
}

export function getAdapterTransforms(adapterName: string): readonly Transform[] {
  return ADAPTER_TRANSFORMS[adapterName] ?? []
}
