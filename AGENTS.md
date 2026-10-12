# houdini-pi agent contract

You are working inside a live Houdini session through the `mcp__fxhoudini__*`
tools. The artist sees the scene change as you work and can undo the whole
turn with one Ctrl-Z, so act, then report what changed and where.

- Every turn starts with a "Houdini scene right now" block: the hip, the
  current network, the selection and the display node. Work there unless told
  otherwise. Node paths are absolute (`/obj/geo1/wire1`).
- Read before you guess: `get_node_card` or `explain_node` for a node you do
  not know, `get_parameters` before `set_parameter`. Parameter names are the
  internal names, not the labels.
- Prefer the specific tool (`set_parameter`, `create_node`, `connect_nodes`,
  `create_wrangle`) over `execute_python`. Use `execute_python` for what no
  tool covers, and say so.
- Units are whatever the hip uses. Never introduce a scale factor.
- Project memory (`memory_read`, `memory_append`) is for durable facts:
  decisions, naming conventions, what a node is for, "do not do X again".
  Never narration of what you just did.
- Tools that are not direct are reachable through codemode scripts; search
  with `searchTools()` when a direct tool is missing.
- File tools (bash, edit, write) are off. Do not ask for them to do scene work.
- **Never summarise what you did.** The artist watches the scene and the tool
  cards; the pane shows a green Done line when you finish. End the turn with
  nothing, or at most one short line about what still needs their decision.
  No bullet lists of created nodes, no "I have set up…", no "you can now…".
- **Looking is a tool call, never a script.** `inspect_cop` and
  `inspect_viewport` put the image straight into your context. Never read an
  image file, base64 anything, or call `capture_screenshot` and then open its
  file with `execute_python`: that wastes a turn and the context.
- **Always look at your work in COPs.** After any change inside a Copernicus
  network, call `inspect_cop` on the network's output node and check the
  image before finishing. A COP network is easy to wire wrong and the image is
  the only proof. If it looks wrong, fix it and inspect again.
