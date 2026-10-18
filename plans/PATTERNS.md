# Engineering Patterns

## Pattern: Centralized History Store with Functional Mutators
- **Problem:** Complex multi-panel studio UIs need undo/redo across diverse actions (layer edit, delete, add, reorder, scene properties) without duplicating state management.
- **Solution:** A centralized store emitting named events with a bounded history stack (50 snapshots) using `structuredClone`. Mutations produce descriptive toast labels ("Undone: Edit size of title layer").
- **Example:** `store.commit(actionName, nextSceneState, description)`
- **Gotchas:** When committing rapid changes (like playhead scrubbing or color drag), distinguish between continuous transient updates (no history push) and committed transactions.

## Pattern: RequestAnimationFrame Throttled PostMessage
- **Problem:** Scrubbing timeline at 60fps or high frequency mousemove can flood iframe message queue, causing sluggishness or layout thrashing.
- **Solution:** Use `requestAnimationFrame` flag to coalesce multiple seek updates into a single postMessage dispatch per display frame.
