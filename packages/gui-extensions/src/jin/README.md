# Jin GUI extension

Jin's surface inside the OpenCode desktop and web app. See the
[full Jin guide](../../../../JIN.md) for the user workflow, architecture model,
approval contract, and security notes.

The extension contributes a pinned `Architecture` side-panel tab and an
`Open Jin architecture` command. It reads the server plugin's `jin` RPC:

- `Review` mode shows project status, validation, post-apply drift, the
  proposal queue, version selection, the structural diff, one-click
  approval/rejection, and applied history. Approval applies the architecture
  immediately; either decision sends a synthetic message that resumes the
  agent.
- `Architecture` mode renders the current or proposed L0/L1 snapshot as a
  layered vertical graph. Entity cards include fields and methods inline, and
  the selected entity's full inspector sits to the right of the graph.
- A successful `jin_validate` opens the panel automatically and selects the
  pending proposal. The pending proposal keeps an amber approval card and a
  header badge.

The server owns proposal mutations and the approval gate. The panel only sends
RPC requests, and an approval decision is signed and bound to the reviewed
target hash by the server.

The graph fixture is available in Storybook as
`Extensions / Jin / Architecture Graph Story`.
