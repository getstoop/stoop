import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { LinkPreviewSchema } from "../gen/stoop/chat/v1/message_pb";
import { previewShape, previewSite, shownPreviews } from "./linkPreviews";
import { serverOrigins } from "./shareLinks";

const preview = (
  fields: Parameters<typeof create<typeof LinkPreviewSchema>>[1],
) => create(LinkPreviewSchema, fields);

describe("shownPreviews", () => {
  const origins = serverOrigins(
    "http://localhost:8091",
    "https://chat.example.org/",
  );

  it("keeps the message's order and leaves out links to its own messages", () => {
    const site = preview({ url: "https://example.com/a", title: "A" });
    const other = preview({ url: "https://example.net/b", title: "B" });
    const here = preview({
      url: "http://localhost:8091/s/spc/c/chn?m=msg",
      title: "Stoop",
    });
    const public_ = preview({
      url: "https://chat.example.org/s/spc/c/chn?t=root",
      title: "Stoop",
    });
    expect(shownPreviews([site, here, other, public_], origins)).toEqual([
      site,
      other,
    ]);
  });

  it("keeps a link to this server that isn't a message", () => {
    const channel = preview({
      url: "http://localhost:8091/s/spc/c/chn",
      title: "Stoop",
    });
    expect(shownPreviews([channel], origins)).toEqual([channel]);
  });
});

describe("serverOrigins", () => {
  it("adds the public address's origin, when it parses", () => {
    expect(
      serverOrigins("http://10.0.0.2:8091", "https://chat.example.org/x"),
    ).toEqual(["http://10.0.0.2:8091", "https://chat.example.org"]);
    expect(serverOrigins("http://10.0.0.2:8091", "")).toEqual([
      "http://10.0.0.2:8091",
    ]);
    expect(serverOrigins("http://10.0.0.2:8091", "not a url")).toEqual([
      "http://10.0.0.2:8091",
    ]);
  });
});

describe("previewShape", () => {
  it("is image-only with an image and no title", () => {
    expect(
      previewShape(
        preview({ imageFileId: "f", imageWidth: 10, imageHeight: 10 }),
      ).imageOnly,
    ).toBe(true);
    expect(
      previewShape(preview({ title: "T", imageFileId: "f" })).imageOnly,
    ).toBe(false);
    expect(previewShape(preview({ description: "only words" })).imageOnly).toBe(
      false,
    );
  });

  it("is landscape from 1.3 times wider than tall", () => {
    expect(
      previewShape(preview({ imageWidth: 130, imageHeight: 100 })).landscape,
    ).toBe(true);
    expect(
      previewShape(preview({ imageWidth: 129, imageHeight: 100 })).landscape,
    ).toBe(false);
  });
});

describe("previewSite", () => {
  it("is the site's name, else the host without www.", () => {
    expect(
      previewSite(
        preview({ url: "https://www.example.com/a", siteName: "Example" }),
      ),
    ).toBe("Example");
    expect(
      previewSite(preview({ url: "https://www.example.com:8443/a" })),
    ).toBe("example.com:8443");
    expect(previewSite(preview({ url: "nonsense" }))).toBe("");
  });
});
