## Add camera flip (front/back) on Live monitoring

Let users switch between the rear and front camera while monitoring, without losing the detection session.

### Changes

1. **`src/hooks/useCamera.ts`**
   - Track current `facingMode` (`"environment"` | `"user"`) in state, default `"environment"`.
   - Update `start()` to accept an optional facing mode and use the current state value when none is passed.
   - Add a `flip()` method: stops the active stream, toggles facing mode, and restarts `getUserMedia` with the new mode. Preserves `videoRef` binding so the detection session keeps reading frames from the same `<video>` element.
   - Return `facing` and `flip` from the hook.

2. **`src/components/live/CameraView.tsx`**
   - Add a small flip button (icon-only, `ghost`/`glass` variant) in the top-right corner of the video frame, only shown when `active`.
   - Uses `SwitchCamera` icon from `lucide-react`.
   - Mirrors the video horizontally (`scale-x-[-1]`) when `facing === "user"` so the front-camera preview looks natural.
   - Accept `facing` and `onFlip` props.

3. **`src/pages/Live.tsx`**
   - Pull `facing` and `flip` from `useCamera()` and pass them to `CameraView`.

### Out of scope
- No changes to detection logic, snapshot capture, or Supabase. The detection engine keeps reading from the same video element; only the underlying MediaStream is swapped.
- No persisted preference — defaults to rear camera each session.
