"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ImageOff, Maximize2, Minimize2, Search } from "lucide-react"

export interface RowBox {
  top: number
  bottom: number
}

interface RowCropProps {
  src: string
  /** Intrinsic width / height of the scanned image. Null when it could not be read. */
  aspect: number | null
  box: RowBox | null
  /** Used in the alt text so the crop is described, not just decorative. */
  label: string
}

/**
 * Shows the strip of the uploaded trip card that a single extracted row came
 * from, so the owner can check the container number and date against the actual
 * handwriting without hunting for the row on the full photo.
 *
 * Three views, no modal (the project has no Dialog primitive, and a hand-rolled
 * one would need its own focus trap):
 *  - fit     : the row band at container width. Every column visible at once.
 *  - magnify : the same band enlarged to a legible height, scrolled sideways.
 *              Needed on 40-row cards, where a band is only ~2% of the photo
 *              and comes out around 15px tall at fit width.
 *  - expand  : the whole card with this row outlined, for context.
 *
 * Rendering is pure CSS — the image is loaded once by the browser and each row
 * reframes it, so a 40-row card costs one image request, not forty crops.
 */
export function RowCrop({ src, aspect, box, label }: RowCropProps) {
  // With no usable band there is nothing honest to show. Defaulting to the whole
  // card would look like a crop and quietly invite the owner to "verify" a row
  // against the wrong handwriting, which is worse than showing nothing.
  const [mode, setMode] = useState<"fit" | "magnify" | "expand">(
    aspect === null ? "magnify" : "fit",
  )
  const [failed, setFailed] = useState(false)

  if (!box) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOff className="size-3.5 shrink-0" aria-hidden />
        No position on the card for this row — check it against the photo manually.
      </p>
    )
  }

  if (failed) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOff className="size-3.5 shrink-0" aria-hidden />
        Card image unavailable.
      </p>
    )
  }

  const bandHeight = box.bottom - box.top
  const alt = `Trip card row for ${label}`
  // translateY percentages resolve against the image's own height, so the same
  // expression frames the band correctly at any magnification.
  const bandShift = `translateY(${-box.top * 100}%)`
  const MAGNIFIED_STRIP_PX = 72

  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-hidden rounded-md border border-border bg-muted">
        {mode === "expand" ? (
          <div className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="block w-full" onError={() => setFailed(true)} />
            <div
              className="pointer-events-none absolute inset-x-0 border-y-2 border-primary bg-primary/10"
              style={{ top: `${box.top * 100}%`, height: `${bandHeight * 100}%` }}
              aria-hidden
            />
          </div>
        ) : mode === "fit" && aspect !== null ? (
          <div
            className="relative w-full overflow-hidden"
            // Height of the band once the full image is drawn at container
            // width: bandHeight x (imageHeight / imageWidth), as a ratio of width.
            style={{ paddingTop: `${(bandHeight * 100) / aspect}%` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="absolute left-0 top-0 w-full"
              style={{ transform: bandShift }}
              onError={() => setFailed(true)}
            />
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-hidden" style={{ height: MAGNIFIED_STRIP_PX }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="block w-auto max-w-none"
              // Scale the whole image up until the band alone fills the strip.
              style={{ height: MAGNIFIED_STRIP_PX / bandHeight, transform: bandShift }}
              onError={() => setFailed(true)}
            />
          </div>
        )}
      </div>
      <div className="flex gap-1">
        {aspect !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-pressed={mode === "magnify"}
            onClick={() => setMode(mode === "magnify" ? "fit" : "magnify")}
          >
            <Search className="size-3.5" aria-hidden />
            {mode === "magnify" ? "Fit row" : "Magnify"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-pressed={mode === "expand"}
          onClick={() => setMode(mode === "expand" ? (aspect === null ? "magnify" : "fit") : "expand")}
        >
          {mode === "expand" ? (
            <>
              <Minimize2 className="size-3.5" aria-hidden />
              Hide full card
            </>
          ) : (
            <>
              <Maximize2 className="size-3.5" aria-hidden />
              Full card
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
