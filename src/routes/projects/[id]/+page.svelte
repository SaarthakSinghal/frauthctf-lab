<script lang="ts">
import IncidentRows from "#lib/IncidentRows.svelte";
import { absoluteUtc, shortUtc } from "#lib/format.js";
import StatusMark from "#lib/StatusMark.svelte";
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
let { data } = $props();
</script>
<WorkspaceShell
  title={data.project.name}
  breadcrumb={{ href: "/projects", label: "Projects", current: data.project.name }}
  user={data.user}
  role={data.role}
>
  <p>
    {data.project.summary.replace("after Monday's deploy", "after the Oct 19, 2026 deployment")}
  </p>
  <section class="panel project-detail">
    <div>
      <span class="section-label">Current state</span><h2>
        <StatusMark kind="health" value={data.project.status} />
      </h2>
    </div>
    <div>
      <span class="section-label">Project owner</span><h2>
        {data.project.owner}
      </h2>
    </div>
    <div>
      <span class="section-label">Last updated</span><h2>
        <time datetime={data.project.updatedAt} title={absoluteUtc(data.project.updatedAt)}>{
          shortUtc(data.project.updatedAt)
        }</time>
      </h2>
    </div>
  </section>
  <div class="section-heading">
    <div>
      <h2>Related incidents</h2>
      <span class="time-context">All times UTC</span>
    </div>
  </div>
  <IncidentRows incidents={data.incidents} userName={data.user.name} />
</WorkspaceShell>
