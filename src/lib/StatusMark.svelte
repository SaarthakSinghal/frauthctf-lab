<script lang="ts">
let { kind, value }: { kind: "state" | "severity" | "health"; value: string } = $props();
const symbol = $derived(
  kind === "state"
    ? value === "Investigating"
      ? "●"
      : value === "Monitoring"
        ? "◎"
        : "✓"
    : kind === "severity"
      ? value === "High"
        ? "▲"
        : value === "Medium"
          ? "◆"
          : "○"
      : value === "At risk"
        ? "▲"
        : "✓",
);
</script>

<span
  class:state={kind === "state"}
  class:severity-mark={kind === "severity"}
  class:health={kind === "health"}
  class:investigating={value === "Investigating"}
  class:monitoring={value === "Monitoring"}
  class:resolved={value === "Resolved"}
  class:high={value === "High"}
  class:medium={value === "Medium"}
  class:low={value === "Low"}
  class:at-risk={value === "At risk"}
  class:on-track={value === "On track"}
  class="meaning-label"
><span aria-hidden="true">{symbol}</span>{value}</span>
