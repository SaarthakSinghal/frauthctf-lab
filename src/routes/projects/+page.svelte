<script lang="ts">
import StatusMark from "#lib/StatusMark.svelte";
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
let { data } = $props();
</script>

<WorkspaceShell title="Projects" count={data.projects.length} user={data.user} role={data.role}>
  <div class="project-list">
    {#each data.projects as project}<article class="project-row">
        <div class="project-row-main">
          <div class="project-row-head">
            <h2><a href={"/projects/" + project.id}>{project.name}</a></h2><StatusMark
              kind="health"
              value={project.status}
            />
          </div>
          <p>
            {project.summary.replace("after Monday's deploy", "after the Oct 19, 2026 deployment")}
          </p><a href="/incidents">{project.openIncidents} open {
              project.openIncidents === 1 ? "incident" : "incidents"
            }</a>
        </div>
        <div class="project-owner"><span>Owner</span><strong>{project.owner}</strong></div>
      </article>{:else}<div class="empty-state">
        <h2>No projects found</h2>
        <p>Projects will appear here after they are added to the workspace.</p>
      </div>{/each}
  </div>
</WorkspaceShell>
