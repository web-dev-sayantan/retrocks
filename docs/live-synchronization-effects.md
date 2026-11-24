# Live synchronization effects

This audit covers the Board and Room boundaries in issue #95. The production effect count for these boundaries remains nine.

- **Board route snapshot.** The controller feeds changes in the route snapshot into the authoritative store. This lets live batches and HTTP mutation responses share the existing version and identity checks while optimistic changes remain layered on top.
- **Board stream lifetime.** The authoritative Board ID controls connection setup and cleanup. A deleted Board releases its connection without waiting for the route owner to unmount.
- **Board reconnect key.** A successful in-place Co-Facilitator claim changes access without changing the Board ID. The key reconnects the stream so future messages use the new permissions.
- **Board live ingestion.** The live session owns the source identity. Its subscription feeds snapshots, versioned mutation batches, and deletion through the controller. A replacement would need to preserve event ordering, gap recovery, and cleanup across source changes.
- **Room route snapshot.** The mounted controller accepts updated route and claim views through the same snapshot application path as live state. That path checks identity, version, and equal-version reopening.
- **Room stream lifetime.** The controller follows joined, open, available state. Cleanup clears presence and releases the connection on close, loss of access, or unmount.
- **Recent Boards and Recent Rooms.** Both effects persist the visible controller state after initialization, optimistic changes, rejection, and authoritative updates. The Board effect also removes unavailable entries. Writing only from mutation handlers would miss route and live ingress.
- **Board Co-Facilitator claim.** The Board ID owns the initial fragment exchange, later hash changes, and cleanup. Attempt and pathname checks guard asynchronous completion. The Room claim already uses its route owner for setup and cleanup, with versioned successful claims and latest-attempt errors.
