import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { WelcomeText } from "../../components/WelcomeText";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";

// The server's own limits, mirrored so the fields can count down rather
// than let a save fail (internal/chat/spaces.go).
const DESCRIPTION_MAX = 200;
const WELCOME_MAX = 4000;

// The two things a space says about itself: the one line an invite shows
// a stranger, and the greeting a member reads on arrival. Both need
// manage_space, which the page is already gated on. They share one Save
// because two textareas with a button each is a fussy card.
export function AboutSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(space.description);
  const [welcome, setWelcome] = useState(space.welcome);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Another admin's edit arrives as SpaceUpdated; adopt it while this
  // card is untouched.
  useEffect(() => setDescription(space.description), [space.description]);
  useEffect(() => setWelcome(space.welcome), [space.welcome]);

  const changed =
    description !== space.description || welcome !== space.welcome;
  const save = async () => {
    setError(null);
    try {
      await chatClient.updateSpace({
        spaceId: space.id,
        description:
          description === space.description ? undefined : description,
        welcome: welcome === space.welcome ? undefined : welcome,
      });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className="card about-section">
      <h3>About</h3>
      <label>
        <span className="about-label">
          Description
          <span className="muted small">
            {description.length} / {DESCRIPTION_MAX}
          </span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          placeholder="Neighbours between 4th and 7th."
        />
      </label>
      <p className="hint">
        One line, shown under the space name and to anyone holding an invite
        link. Plain text.
      </p>

      <label>
        <span className="about-label">
          Welcome
          <span className="about-label-actions">
            <span className="muted small">
              {welcome.length} / {WELCOME_MAX}
            </span>
            <button
              type="button"
              className="chip"
              onClick={() => setPreview((p) => !p)}
              disabled={welcome.trim() === ""}
            >
              {preview ? "Write" : "Preview"}
            </button>
          </span>
        </span>
        {preview ? (
          <div className="about-preview">
            <WelcomeText text={welcome} />
          </div>
        ) : (
          <textarea
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
            maxLength={WELCOME_MAX}
            rows={8}
            placeholder={
              "**#tools** is the lending library.\n- Say hi in #general"
            }
          />
        )}
      </label>
      <p className="hint">
        Members see this when they first arrive, and any time after that from
        About this space. Takes the same Markdown a message does — bold,
        italics, lists, quotes and code, but no headings.
      </p>

      <div className="setting-actions">
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={!changed}
        >
          Save changes
        </button>
        {saved && <span className="hint">Saved.</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
