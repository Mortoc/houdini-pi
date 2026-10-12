import { describe, expect, it } from "vitest";
import { actionLinks, isQuestion } from "../extensions/answers.js";

describe("action links", () => {
  it("finds every well-formed houdini:// link once, decoded", () => {
    const md = [
      "1. Select [the wire](houdini://select?path=/obj/geo1/wire1) and open [radius](houdini://parm?path=/obj/geo1/wire1/radius).",
      "2. Go to [geo1](houdini://network?path=/obj/geo1), open the [parameters](houdini://pane?type=Parm), read [help](houdini://help?page=/nodes/sop/polyextrude).",
      "Again: [wire](houdini://select?path=/obj/geo1/wire1). Bad: houdini://dance?path=/x houdini://select?type=/x",
    ].join("\n");
    expect(actionLinks(md)).toEqual([
      { kind: "select", value: "/obj/geo1/wire1", href: "houdini://select?path=/obj/geo1/wire1" },
      { kind: "parm", value: "/obj/geo1/wire1/radius", href: "houdini://parm?path=/obj/geo1/wire1/radius" },
      { kind: "network", value: "/obj/geo1", href: "houdini://network?path=/obj/geo1" },
      { kind: "pane", value: "Parm", href: "houdini://pane?type=Parm" },
      { kind: "help", value: "/nodes/sop/polyextrude", href: "houdini://help?page=/nodes/sop/polyextrude" },
    ]);
  });
});

describe("isQuestion", () => {
  it("recognises questions and leaves requests alone", () => {
    for (const q of ["How do I make the wires thinner?", "what does sdfblend do", "Why is my copnet black", "explain /obj/geo1", "Can you tell me which node to use?"]) {
      expect(isQuestion(q), q).toBe(true);
    }
    for (const r of ["Make the wires thinner", "create a box in /obj", "add an env light and scale it to 2"]) {
      expect(isQuestion(r), r).toBe(false);
    }
  });
});
