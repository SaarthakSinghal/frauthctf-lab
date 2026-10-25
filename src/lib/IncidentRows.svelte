<script lang="ts">
import { absoluteUtc, relativeUtc } from "#lib/format.js";
import StatusMark from "#lib/StatusMark.svelte";
import type { Incident } from "#lib/server/workspace.js";
let { incidents, userName }: { incidents: Incident[]; userName?: string } = $props();
const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("");
</script>

{#if incidents.length}
  <div class="table-scroll">
    <table class="data-table incident-table">
      <thead>
        <tr>
          <th>Incident</th>
          <th>State</th>
          <th>Severity</th>
          <th>Project</th>
          <th>Owner</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {#each incidents as incident}
          <tr class:muted-row={incident.status === "Resolved"}>
            <td class="incident-cell">
              <span class="record-id">{incident.id}</span><a
                class="row-primary-link"
                href={"/incidents/" + incident.id}
              >{incident.title}</a><span class="row-chevron" aria-hidden="true">›</span>
            </td>
            <td><StatusMark kind="state" value={incident.status} /></td>
            <td><StatusMark kind="severity" value={incident.severity} /></td>
            <td>
              <a class="row-secondary-link" href={"/projects/" + incident.projectId}>{
                incident.projectName
              }</a>
            </td>
            <td>
              <span class="owner-cell"><span class="owner-avatar" aria-hidden="true">{
                  initials(incident.owner)
                }</span><span>{incident.owner}{#if userName === incident.owner}
                    <span class="muted-copy">(you)</span>{/if}</span></span>
            </td>
            <td>
              <time datetime={incident.updatedAt} title={absoluteUtc(incident.updatedAt)}>{
                relativeUtc(incident.updatedAt)
              }</time>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <div class="empty-state">
    <h2>No incidents found</h2>
    <p>Try another view, or check back when an incident is added.</p>
  </div>
{/if}
