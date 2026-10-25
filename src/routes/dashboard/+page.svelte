<script lang="ts">
import IncidentRows from "#lib/IncidentRows.svelte";
import { absoluteUtc, shortUtc } from "#lib/format.js";
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
let { data } = $props();
</script>

<WorkspaceShell title="Overview" user={data.user} role={data.role}>
  <section class="briefing">
    <div>
      <span class="section-label">Today's focus</span><h2>Follow the Northstar delivery delay.</h2>
      <p>
        INC-104 is still under investigation. Review the timeline before adding your next finding.
      </p><a class="button" href="/incidents/INC-104">Open incident</a>
    </div>
    <div class="briefing-meta">
      <div><strong>{data.activeCount}</strong><span>Active incidents</span></div>
      <div><strong>{data.atRiskCount}</strong><span>Projects at risk</span></div>
    </div>
  </section>
  <div class="section-heading">
    <h2>Incident queue</h2>
    <div class="section-actions">
      <span class="time-context">All times UTC</span><a href="/incidents">View all incidents</a>
    </div>
  </div>
  <IncidentRows incidents={data.incidents} userName={data.user.name} />
  <div class="overview-lower">
    <section class="panel">
      <div class="section-heading">
        <h2>Recent activity</h2><a href="/incidents/INC-104">Full timeline</a>
      </div>
      {#each data.recentActivity as activity}<div class="activity-line">
          <span class="activity-dot"></span><div>
            <strong>{activity.author}</strong><p>{activity.body}</p><small><time
                datetime={activity.createdAt}
                title={absoluteUtc(activity.createdAt)}
              >{shortUtc(activity.createdAt)}</time></small>
          </div>
        </div>{:else}<p>No updates yet.</p>{/each}
    </section>
    <section class="panel">
      <div class="section-heading"><h2>Working together</h2><a href="/team">Team directory</a></div>
      <p>
        Response lead Priya Shah is coordinating the Northstar investigation. Leave findings on the
        incident so the handoff stays traceable.
      </p><a href="/projects/northstar">View Northstar API</a>
    </section>
  </div>
</WorkspaceShell>
