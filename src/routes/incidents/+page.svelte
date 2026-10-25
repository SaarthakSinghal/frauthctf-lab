<script lang="ts">
import IncidentRows from "#lib/IncidentRows.svelte";
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
let { data } = $props();
let view = $state<"Open" | "Resolved" | "All">("Open");
let mine = $state(false);
const openCount = $derived(
  data.incidents.filter((incident) => incident.status !== "Resolved").length,
);
const resolvedCount = $derived(data.incidents.length - openCount);
const visible = $derived(
  data.incidents
    .filter(
      (incident) =>
        view === "All" ||
        (view === "Open" ? incident.status !== "Resolved" : incident.status === "Resolved"),
    )
    .filter((incident) => !mine || incident.owner === data.user.name)
    .toSorted(
      (first, second) =>
        Number(first.status === "Resolved") - Number(second.status === "Resolved") ||
        second.updatedAt.localeCompare(first.updatedAt),
    ),
);
</script>

<WorkspaceShell title="Incidents" count={data.incidents.length} user={data.user} role={data.role}>
  <div class="list-toolbar">
    <div class="segmented-control" role="group" aria-label="Incident view">
      <button type="button" aria-pressed={view === "Open"} onclick={() => (view = "Open")}>
        Open <span>{openCount}</span>
      </button>
      <button type="button" aria-pressed={view === "Resolved"} onclick={() => (view = "Resolved")}>
        Resolved <span>{resolvedCount}</span>
      </button>
      <button type="button" aria-pressed={view === "All"} onclick={() => (view = "All")}>
        All <span>{data.incidents.length}</span>
      </button>
    </div>
    <div class="section-actions">
      <span class="time-context">All times UTC</span><button
        class="mine-toggle"
        type="button"
        aria-pressed={mine}
        onclick={() => (mine = !mine)}
      >
        Mine
      </button>
    </div>
  </div>
  <IncidentRows incidents={visible} userName={data.user.name} />
</WorkspaceShell>
