// The three ways to keep someone away, side by side — two of them are
// space powers on this page, the third is personal and lives on cards.
export function ModerationLegend() {
  return (
    <aside className="card">
      <h3>Kick, ban, or block?</h3>
      <dl className="legend">
        <dt>Kick</dt>
        <dd>
          Removes them from this space right now. Nothing stops them coming back
          with an invite link.
        </dd>
        <dt>Ban</dt>
        <dd>
          Removes them and refuses every invite link to this space until you
          unban them. You can also ban someone who has already left. Bans are
          per space.
        </dd>
        <dt>Block</dt>
        <dd>
          Not a space setting, and the one thing that is on a profile card.
          Anyone can block a person: no direct messages either way, and no
          mention or reply alerts from them, everywhere on this server. Undo it
          from your profile page.
        </dd>
      </dl>
    </aside>
  );
}
