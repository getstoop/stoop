import { describe, expect, it } from "vitest";
import { profileEdits } from "./profile";

const me = {
  displayName: "Ada",
  username: "ada",
  pronouns: "she/her",
  bio: "",
};

describe("profileEdits", () => {
  it("is null when nothing differs, spaces around the names aside", () => {
    expect(
      profileEdits(me, { ...me, displayName: " Ada ", username: "ada " }),
    ).toBeNull();
  });

  it("counts spaces in the pronouns and bio, which go as typed", () => {
    expect(profileEdits(me, { ...me, bio: " " })?.bio).toBe(" ");
    expect(profileEdits(me, { ...me, pronouns: "she/her " })?.pronouns).toBe(
      "she/her ",
    );
  });

  it("counts a display name of only spaces as a change", () => {
    expect(profileEdits(me, { ...me, displayName: "  " })?.displayName).toBe(
      "",
    );
  });

  it("always sends the display name and only the rest that changed", () => {
    expect(profileEdits(me, { ...me, bio: "Reads a lot" })).toEqual({
      displayName: "Ada",
      username: undefined,
      pronouns: undefined,
      bio: "Reads a lot",
    });
  });

  it("sends an emptied field, which clears it", () => {
    expect(profileEdits(me, { ...me, pronouns: "" })?.pronouns).toBe("");
  });

  it("sends trimmed names", () => {
    expect(
      profileEdits(me, { ...me, displayName: " Ada L ", username: " ada2 " }),
    ).toMatchObject({
      displayName: "Ada L",
      username: "ada2",
    });
  });
});
