<script lang="ts">
import { enhance } from "$app/forms";
import { absoluteUtc, shortUtc } from "#lib/format.js";
import StatusMark from "#lib/StatusMark.svelte";
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
let { data, form } = $props();
let note = $state("");
let pending = $state(false);
const ownerId = $derived(data.incident.owner.split(" ")[0].toLowerCase());
function submitShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && note.trim().length >= 8) {
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }
}
</script>

<WorkspaceShell
  title={data.incident.title}
  user={data.user}
  role={data.role}
  breadcrumb={{ href: "/incidents", label: "Incidents", current: data.incident.id }}
>
  <div class="incident-meta">
    <StatusMark kind="state" value={data.incident.status} /><StatusMark
      kind="severity"
      value={data.incident.severity}
    /><a href={"/projects/" + data.incident.projectId}>{data.incident.projectName}</a><a
      href={"/team#" + ownerId}
    >{data.incident.owner}</a><time
      datetime={data.incident.updatedAt}
      title={absoluteUtc(data.incident.updatedAt)}
    >{shortUtc(data.incident.updatedAt)}</time><span class="time-context">All times UTC</span>
  </div>
  <div class="detail-grid">
    <div class="detail-primary">
      <section class="panel incident-summary">
        <h2>Situation</h2>
        <p>{data.incident.summary}</p>
      </section>
      <section class="panel note-panel">
        <form
          method="POST"
          use:enhance={() => {
            pending = true;
            return async ({ update, result }) => {
              await update();
              pending = false;
              if (result.type === "success") note = "";
            };
          }}
        >
          <label for="note">Note</label><textarea
            id="note"
            name="note"
            minlength="8"
            maxlength="1000"
            rows="4"
            placeholder="Share an observation or handoff"
            bind:value={note}
            onkeydown={submitShortcut}
            required
          ></textarea>
          <div class="note-actions">
            <span class="form-hint"
            >8–1,000 characters · Ctrl/Cmd+Enter to
              save</span><button disabled={pending || note.trim().length < 8}>
              {pending ? "Saving…" : "Save note"}
            </button>
          </div>
          {#if form?.message}<p role="alert" class="error">{form.message}</p>{/if}
          {#if form?.saved}<p role="status" class="success-message">Note saved</p>{/if}
        </form>
      </section>
      <section class="panel timeline">
        <div class="section-heading">
          <h2>Timeline</h2>
        </div>
        {#each data.timeline as item, index}<div
            class:just-saved={Boolean(form?.saved) && index === 0}
            class="timeline-item"
          >
            <span class="timeline-marker"></span><div class="timeline-content">
              <div class="timeline-head">
                <strong>{item.author}</strong><time
                  datetime={item.createdAt}
                  title={absoluteUtc(item.createdAt)}
                >{shortUtc(item.createdAt)}</time>
              </div>
              <p>{item.body}</p><small class="event-kind">{
                item.kind === "note"
                ? "Note"
                : item.kind === "opened"
                  ? "Opened"
                  : item.kind === "resolved"
                    ? "Resolved"
                    : "Update"
              }</small>
            </div>
          </div>{:else}<p>No activity recorded.</p>{/each}
      </section>
    </div>
    <div class="detail-side">
      <section class="panel details-panel">
        <h2>Details</h2>
        <dl class="facts">
          <div>
            <dt>Project</dt>
            <dd>
              <a href={"/projects/" + data.incident.projectId}>{data.incident.projectName}</a>
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd><a href={"/team#" + ownerId}>{data.incident.owner}</a></dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>
              <time
                datetime={data.incident.updatedAt}
                title={absoluteUtc(data.incident.updatedAt)}
              >{shortUtc(data.incident.updatedAt)}</time>
            </dd>
          </div>
        </dl>
      </section>
      {#if data.incident.id === "INC-104"}<section class="panel impact-row">
          <svg
            class="lock-symbol"
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M7 10V7a5 5 0 0 1 10 0v3" />
            <rect x="5" y="10" width="14" height="11" rx="2" />
          </svg>
          <div>
            <h2>Impact report</h2>
            <p>Response lead only</p>
            {#if data.role === "lead"}<a href={"/incidents/" + data.incident.id + "/report"}
              >Open impact report</a>{:else}<a href="/team#priya">Ask Priya Shah</a>{/if}
          </div>
        </section>{/if}
    </div>
  </div>
</WorkspaceShell>
