import { describe, expect, it } from "vitest";
import { androidName, androidOutput, androidOutputs, type OutputKind, outputName, ownOutput } from "./output";

describe("a call's outputs", () => {
  it("names an output by its kind, or by the system's name for what is not the phone's or on a wire", () => {
    expect(outputName({ kind: "speaker", name: "" })).toBe("Speaker");
    expect(outputName({ kind: "earpiece", name: "Receiver" })).toBe("Phone");
    expect(outputName({ kind: "headphones", name: "Headphones" })).toBe("Headphones");
    expect(outputName({ kind: "bluetooth", name: "" })).toBe("Bluetooth");
    expect(outputName({ kind: "bluetooth", name: "Theo's Headset" })).toBe("Theo's Headset");
    expect(outputName({ kind: "other", name: "Living Room" })).toBe("Living Room");
    expect(outputName({ kind: "other", name: "" })).toBe("Other");
  });

  it("reads Android's outputs as kinds, in the list's order, and names them back", () => {
    expect(androidOutputs(["bluetooth", "headset", "speaker", "earpiece"])).toEqual([
      "speaker",
      "earpiece",
      "headphones",
      "bluetooth",
    ]);
    expect(androidOutputs(["speaker", "something new"])).toEqual(["speaker"]);
    expect(androidOutputs([])).toEqual([]);
    expect(androidName("headphones")).toBe("headset");
    expect(androidName("earpiece")).toBe("earpiece");
    expect(androidName("other")).toBeUndefined();
  });

  it("starts Android's sound on a headset when there is one, else on the loudspeaker", () => {
    const fresh: Parameters<typeof androidOutput>[1] = { outputs: [], output: "speaker", own: "speaker" };
    expect(androidOutput(["speaker", "earpiece"], fresh)).toBe("speaker");
    expect(androidOutput(["speaker", "earpiece", "headphones"], fresh)).toBe("headphones");
    expect(androidOutput(["speaker", "earpiece", "headphones", "bluetooth"], fresh)).toBe("bluetooth");
    expect(androidOutput([], fresh)).toBe("speaker");
  });

  it("gives Android's sound to a headset that connects, also after a pick by hand", () => {
    const phone: OutputKind[] = ["speaker", "earpiece"];
    expect(androidOutput([...phone, "bluetooth"], { outputs: phone, output: "earpiece", own: "earpiece" })).toBe(
      "bluetooth",
    );
    // The loudspeaker was picked over the headphones, and then Bluetooth connects.
    expect(
      androidOutput([...phone, "headphones", "bluetooth"], {
        outputs: [...phone, "headphones"],
        output: "speaker",
        own: "speaker",
      }),
    ).toBe("bluetooth");
  });

  it("leaves Android's sound where it is while nothing new connects", () => {
    const all: OutputKind[] = ["speaker", "earpiece", "headphones"];
    // The loudspeaker picked over headphones that stay connected.
    expect(androidOutput(all, { outputs: all, output: "speaker", own: "speaker" })).toBe("speaker");
    expect(androidOutput(all, { outputs: all, output: "headphones", own: "earpiece" })).toBe("headphones");
    // Another output going changes nothing for the one in use.
    expect(androidOutput(["speaker", "earpiece"], { outputs: all, output: "earpiece", own: "earpiece" })).toBe("earpiece");
  });

  it("returns Android's sound to the phone's own output chosen last when its headset goes", () => {
    const phone: OutputKind[] = ["speaker", "earpiece"];
    const was = { outputs: [...phone, "bluetooth"] as OutputKind[], output: "bluetooth" as const };
    expect(androidOutput(phone, { ...was, own: "speaker" })).toBe("speaker");
    expect(androidOutput(phone, { ...was, own: "earpiece" })).toBe("earpiece");
    // Another headset still there has it first.
    expect(
      androidOutput([...phone, "headphones"], {
        outputs: [...phone, "headphones", "bluetooth"],
        output: "bluetooth",
        own: "earpiece",
      }),
    ).toBe("headphones");
  });

  it("knows the phone's own two outputs from the rest", () => {
    expect(ownOutput("speaker")).toBe(true);
    expect(ownOutput("earpiece")).toBe(true);
    expect(ownOutput("headphones")).toBe(false);
    expect(ownOutput("bluetooth")).toBe(false);
    expect(ownOutput("other")).toBe(false);
  });
});
