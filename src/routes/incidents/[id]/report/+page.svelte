<script lang="ts">
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
let { data } = $props();
</script>
<WorkspaceShell
  title="Response lead report"
  summary={`${data.incident.id} · Restricted review`}
  user={data.user}
  role={data.role}
>
  <div class="breadcrumbs">
    <a href={"/incidents/" + data.incident.id}>Incident {data.incident.id}</a><span>/</span><span
    >Report</span>
  </div>
  <section class="panel report-panel">
    <span class="status">Response leads only</span><h2>
      {data.incident.title}
    </h2>
    <p>{data.report}</p>
  </section>
</WorkspaceShell>
