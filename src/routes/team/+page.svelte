<script lang="ts">
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
let { data } = $props();
</script>

<WorkspaceShell title="Team" count={data.people.length} user={data.user} role={data.role}>
  <div class="people-list">
    {#each data.people as person}<article class="person-row" id={person.id}>
        <div class="avatar" aria-hidden="true">
          {
            person.name
            .split(" ")
            .map((part: string) => part[0])
            .join("")
          }
        </div>
        <div class="person-identity">
          <h2>{person.name}</h2>
          <p>{person.title}</p>
        </div>
        <div class="person-focus">
          <span class="section-label">Current focus</span><p>{person.focus}</p>
        </div><a href={"mailto:" + person.email}>{person.email}</a>
      </article>{:else}<div class="empty-state">
        <h2>No teammates found</h2>
        <p>This workspace has no people assigned yet.</p>
      </div>{/each}
  </div>
</WorkspaceShell>
