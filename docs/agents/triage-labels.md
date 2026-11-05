# Triage Labels

Triage tooling refers to five roles. This file maps each role to the label string this repo's issue tracker actually uses.

| Role             | Label in our tracker | Meaning                                  |
| ---------------- | -------------------- | ---------------------------------------- |
| `needs-triage`   | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`     | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`| `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`| `ready-for-human`    | Requires human implementation            |
| `wontfix`        | `wontfix`            | Will not be actioned                     |

When a workflow or prompt names a role (for example, "apply the AFK-ready triage label"), apply the matching label string from the table.

Change the "Label in our tracker" column if the repo's vocabulary changes.
