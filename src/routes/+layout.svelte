<script lang="ts">
import "../style.css";
let { children } = $props();
</script>
<svelte:head><title>Cirque · Operations workspace</title><meta
    name="description"
    content="Incident and project operations for a connected team."
  /><link
    rel="icon"
    href="/cirque-mark.svg"
    type="image/svg+xml"
  /></svelte:head>
<header class="site-header">
  <a href="/dashboard" class="brand"><img
      src="/cirque-mark.svg"
      width="34"
      height="34"
      alt=""
    /> <span>cirque</span></a>
</header>
<main>{@render children()}</main>
