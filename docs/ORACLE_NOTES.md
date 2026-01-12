# Oracle Free Tier Notes (archived)

These are notes from earlier experiments with Oracle Free Tier. The setup proved unreliable for continuous deployment and development, and is kept here for reference only.

Key points:
- Oracle Free Tier VMs were slow and unstable for Docker builds.
- Swap helped in some cases but overall the experience cost too much time.
- If you want to try Oracle, follow the steps below at your own risk.

## Steps tried (summary)

1. Create swapfile to avoid OOM problems.
2. Attempt to install Docker (often failed or hung).
3. Pull images from registry and run container.

Detailed commands and logs were removed from the main README and are preserved here for archival purposes.

---

_This file was generated automatically to remove Oracle-specific instructions from the main README._
