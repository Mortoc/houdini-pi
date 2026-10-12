# Answers and tutorials: `present_answer` with `houdini://` action links

Date: 2026-10-13
Status: approved

## Problem

A question to the agent ("how do I…", "why does…") today ends like an action
turn: tool cards, a green Done, and whatever prose the model felt like
writing. The artist wants a clean answer, and for a how-to, steps with buttons
that point at the right node, parameter, network or pane.

## Design

- **One tool, `present_answer({ markdown })`**, is the only way prose reaches
  the pane as an answer. The pane renders the Markdown. Free text the model
  writes outside the tool is collapsed under "unformatted reply" when the turn
  has an answer, so narration cannot leak in.
- **Action links** inside the Markdown render as buttons. Fixed vocabulary:

  | link | does |
  |---|---|
  | `houdini://select?path=/obj/geo1` | select the node; linked panes follow |
  | `houdini://parm?path=/obj/geo1/wire1/radius` | select the node, point the parameter pane at it, name the parameter in the status line |
  | `houdini://network?path=/obj/geo1` | network editor goes to that network |
  | `houdini://pane?type=Parm` | open or raise that pane tab type (`hou.paneTabType` name) |
  | `houdini://help?page=/nodes/sop/polyextrude` | Houdini's help browser on that page |

- **Validation**: when the tool runs, every `select`, `parm` and `network`
  path is checked against the scene. Missing ones are rendered disabled with
  the reason, never as a dead button.
- **Enforcement**: the extension classifies the user's message as a question
  (interrogative opener or trailing `?`). If such a turn settles without a
  `present_answer` call, pi is told once to continue and answer through the
  tool, the same mechanism as the COP check.
- **CLI**: the tool exists there too; the links print as text.

## Non-goals

- Flashing a single parameter: HOM has no API for it. The button selects the
  node, points the parameter pane at it and names the parameter.
- Arbitrary scripts behind buttons. The vocabulary is fixed.
