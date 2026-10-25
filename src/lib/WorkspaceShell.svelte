<script lang="ts">
import { authClient } from "#lib/client.js";
import { page } from "$app/state";
import { tick } from "svelte";
import type { Snippet } from "svelte";

let {
  title,
  user,
  role,
  count,
  breadcrumb,
  children,
}: {
  title: string;
  summary?: string;
  user: { name: string; email: string };
  role: string;
  count?: number;
  breadcrumb?: { href: string; label: string; current: string };
  children: Snippet;
} = $props();
let message = $state("");
let menuOpen = $state(false);
let navOpen = $state(false);
let trigger = $state<HTMLButtonElement>();
let menu = $state<HTMLDivElement>();
const navigation = [
  { href: "/dashboard", label: "Overview" },
  { href: "/incidents", label: "Incidents" },
  { href: "/projects", label: "Projects" },
  { href: "/team", label: "Team" },
];
const firstName = $derived(user.name.split(" ")[0]);
const initials = $derived(
  user.name
    .split(" ")
    .map((part) => part[0])
    .join(""),
);
const roleLabel = $derived(role === "lead" ? "Response lead" : "Analyst");
const shell = $derived(page.data.shell);

async function logout() {
  menuOpen = false;
  const { error } = await authClient.signOut();
  if (error) {
    message = "Unable to sign out. Please try again.";
    return;
  }
  window.location.href = "/login";
}

async function toggleMenu() {
  menuOpen = !menuOpen;
  if (menuOpen) {
    await tick();
    menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }
}

function closeMenu(returnFocus = false) {
  menuOpen = false;
  if (returnFocus) trigger?.focus();
}

function onMenuKeydown(event: KeyboardEvent) {
  if (!menu) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
    return;
  }
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const current = items.indexOf(document.activeElement as HTMLElement);
  let next = current;
  if (event.key === "ArrowDown") next = (current + 1) % items.length;
  else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return;
  event.preventDefault();
  items[next]?.focus();
}

function onWindowClick(event: MouseEvent) {
  if (
    menuOpen &&
    !menu?.contains(event.target as Node) &&
    !trigger?.contains(event.target as Node)
  ) {
    closeMenu();
  }
}
</script>

<svelte:window
  onclick={onWindowClick}
  onkeydown={(event) => {
    if (event.key === "Escape" && navOpen) navOpen = false;
  }}
/>

<div class="workspace-layout">
  <div class="header-controls">
    <span class="environment-pill">Local workspace</span>
    <button
      class="account-trigger"
      type="button"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label={`Account menu for ${user.name}`}
      onclick={toggleMenu}
      bind:this={trigger}
    >
      <span class="account-avatar" aria-hidden="true">{initials}</span><span
        class="account-first-name"
      >{firstName}</span><span aria-hidden="true" class="chevron">⌄</span>
    </button>
    {#if menuOpen}
      <div
        class="account-menu"
        role="menu"
        tabindex="-1"
        aria-label="Account"
        bind:this={menu}
        onkeydown={onMenuKeydown}
      >
        <div class="account-menu-identity">
          <strong>{user.name}</strong><span>{roleLabel}</span><small>{user.email}</small>
        </div>
        <a role="menuitem" href="/profile">Your profile</a>
        <a
          role="menuitem"
          href="/profile#authenticator"
          class="menu-factor-link"
          aria-label={`Authenticator: ${shell?.authenticatorEnabled ? "On" : "Off"}`}
        ><span>Authenticator</span><span class="menu-factor-state">{
            shell?.authenticatorEnabled ? "On" : "Off"
          }</span></a>
        <div class="account-menu-divider" role="separator"></div>
        <button role="menuitem" type="button" class="account-signout" onclick={logout}>
          Sign out
        </button>
      </div>
    {/if}
  </div>
  <button
    class="mobile-nav-trigger"
    type="button"
    aria-expanded={navOpen}
    aria-controls="workspace-sidebar"
    onclick={() => (navOpen = !navOpen)}
  >
    Menu
  </button>
  {#if navOpen}<button
      class="nav-scrim"
      type="button"
      aria-label="Close navigation"
      onclick={() => (navOpen = false)}
    >
    </button>{/if}
  <aside
    class:open={navOpen}
    class="sidebar"
    id="workspace-sidebar"
    aria-label="Workspace navigation"
  >
    <nav class="workspace-nav" aria-label="Primary">
      {#each navigation as item}
        <a
          href={item.href}
          onclick={() => (navOpen = false)}
          aria-current={page.url.pathname === item.href ||
          (item.href !== "/dashboard" && page.url.pathname.startsWith(item.href + "/"))
            ? "page"
            : undefined}
        >
          <span>{item.label}</span>{#if item.label === "Incidents"}<span
              class="nav-count"
              aria-label={`${shell?.openIncidents ?? 0} open incidents`}
            >{shell?.openIncidents ?? 0}</span>{/if}
        </a>
      {/each}
    </nav>
  </aside>
  <div class="workspace-main" id="main-content">
    <div class="content-container">
      {#if breadcrumb}<nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href={breadcrumb.href}>{breadcrumb.label}</a><span aria-hidden="true">/</span><span>{
            breadcrumb.current
          }</span>
        </nav>{/if}
      <div class="page-heading">
        <h1>{title}{#if count !== undefined}<span class="page-count">{count}</span>{/if}</h1>
      </div>
      {#if message}<p role="alert" class="error">{message}</p>{/if}
      {@render children()}
    </div>
  </div>
</div>
