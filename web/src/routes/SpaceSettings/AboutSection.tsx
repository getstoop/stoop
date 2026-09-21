import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { chatClient } from "../../api/clients";
import { Field } from "../../components/Field";
import { controlAttrs } from "../../components/fieldControl";
import { WelcomeText } from "../../components/WelcomeText";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";

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
  const form = useFieldErrors(["description", "welcome"]);
  const [saved, setSaved] = useState(false);
  // Another admin's edit arrives as SpaceUpdated; adopt it while this
  // card is untouched.
  useEffect(() => setDescription(space.description), [space.description]);
  useEffect(() => setWelcome(space.welcome), [space.welcome]);

  const changed =
    description !== space.description || welcome !== space.welcome;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    form.begin();
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
      form.fail(err);
    }
  };

  return (
    <form className="card about-section" ref={form.formRef} onSubmit={save}>
      <h3>About</h3>
      <Field
        label="Description"
        counter={`${description.length} / ${DESCRIPTION_MAX}`}
        hint="One line, shown under the space name and to anyone holding an invite link. Plain text."
        error={form.errors.description}
      >
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          placeholder="Neighbours between 4th and 7th."
        />
      </Field>
      <Field
        label="Welcome"
        counter={
          <>
            {welcome.length} / {WELCOME_MAX}
            <button
              type="button"
              className="chip"
              onClick={() => setPreview((p) => !p)}
              disabled={welcome.trim() === ""}
            >
              {preview ? "Write" : "Preview"}
            </button>
          </>
        }
        hint="Members see this when they first arrive, and any time after that from About this space. Takes the same Markdown a message does — bold, italics, lists, quotes and code, but no headings."
        error={form.errors.welcome}
      >
        {(control) =>
          preview ? (
            <div className="about-preview">
              <WelcomeText text={welcome} />
            </div>
          ) : (
            <textarea
              {...controlAttrs(control)}
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              maxLength={WELCOME_MAX}
              rows={8}
              placeholder={
                "**#tools** is the lending library.\n- Say hi in #general"
              }
            />
          )
        }
      </Field>
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <div className="setting-actions">
        <button type="submit" className="primary" disabled={!changed}>
          Save changes
        </button>
        {saved && <span className="hint">Saved.</span>}
      </div>
    </form>
  );
}
