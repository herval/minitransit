# Local rendering and payload comparison

These performance changes were tested locally against a recorded regional feed containing 892 vehicles. This work did not deploy or modify the Fly app.

## Browser timings

Isolated WebKit on the same Mac, with a 1440 × 900 desktop viewport. Times are approximate milliseconds; the browser timer has limited precision. The baseline performed full geometry and label updates on each redraw. The optimized camera batches input, reuses geometry during gestures, and commits lane geometry after zoom settles.

| View | Label pass before | Label pass after | Zoom redraw before | Final geometry redraw after |
| --- | ---: | ---: | ---: | ---: |
| BART | 173 ms | 0–1 ms | 363 ms | 1 ms |
| Muni | 177 ms | 0–1 ms | 381 ms | 2 ms |
| AC Transit | 232 ms | 0–1 ms | 528 ms | 13 ms |

Warm pan/zoom updates took approximately 0–1 ms in the final desktop sample. The 390 × 844 phone layout passed the same functional checks, with final geometry redraws of 2 ms for BART, 2 ms for Muni and 23 ms for AC Transit. This is a phone-sized viewport on a Mac, not a physical phone measurement.

The regional rail/ferry scene went from roughly 30,125 SVG elements to about 1,500. Paths are grouped by route: 26 in the rail/ferry overview, 7 in Muni and 123 in AC Transit, instead of 8,059 individual segment elements loaded for every view. Stop and vehicle elements are reconciled by viewport; bus markers use a screen-space density limit. Every stop remains searchable and can be selected or revealed with zoom.

The viewport cache is invalidated by a ResizeObserver, including the initial stylesheet layout. Startup sizing was checked against the actual SVG rectangle in both viewports.

The timings measure JavaScript/DOM update and layout work in an isolated offscreen WebKit view. They do not establish an on-screen frame-rate guarantee or measure GPU painting on other hardware.

## Payload and correctness

Measured with the same recorded full snapshot, serialized as UTF-8 JSON:

| Response | Before | After |
| --- | ---: | ---: |
| Decoded JSON | 14,991,621 bytes | 744,180 bytes |
| Gzip | 951,537 bytes | 80,747 bytes |

Decoded JSON is 95% smaller. HTTP 304 responses avoid resending an unchanged map snapshot, while `X-Server-Time` still advances source-age checks. Train stop lists and station departures load only after selection, using the existing server-side regional cache.

The compact response was compared with the full response for every vehicle at six time offsets, including source expiry: 5,352 comparisons, with no vehicle-position or delay differences. All 32 automated checks passed, including active-route geometry, source expiry, conditional requests and lazy detail endpoints.

To repeat the payload and equivalence comparison with a saved full `getRegionalSnapshot()` response:

```sh
node scripts/benchmark-map-data.mjs /path/to/full-snapshot.json
```

Local browser checks covered all seven network views, isolated active-network SVG elements, lazy train/platform/departure details, keyboard focus in upcoming stops, optional buses, label/pause/night controls, unchanged-data responses, stale location/delay/gap clearing, and camera timings. No additional 511 requests were used for these recorded-data checks.
