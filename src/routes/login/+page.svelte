<script lang="ts">
import { authClient } from "#lib/client.js";
import { page } from "$app/state";
let email = $state("");
let password = $state("");
let message = $state("");
let busy = $state(false);
async function login(event: SubmitEvent) {
  event.preventDefault();
  busy = true;
  message = "";
  try {
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error || !data) {
      message = "Unable to sign in. Check your details and try again.";
      return;
    }
    window.location.href =
      "twoFactorRedirect" in data && data.twoFactorRedirect ? "/verify" : "/dashboard";
  } catch {
    message = "Unable to connect. Please try again.";
  } finally {
    busy = false;
  }
}
</script>
<div class="auth-grid">
  <section class="intro">
    <span class="section-label">Incident operations, in one place</span><h1>
      Stay close to what matters.
    </h1>
    <p>
      Cirque brings incidents, projects, and response teams into one clear workspace.
    </p>
    <div class="intro-record">
      <span class="intro-marker"></span><div>
        <strong>Make the next handoff count.</strong><p>
          Review the timeline. Share the finding. Keep work moving.
        </p>
      </div>
    </div>
  </section>
  <section class="auth-card">
    <span class="section-label">Welcome back</span><h2>Sign in to Cirque</h2>
    <p>Use your workspace credentials to continue.</p>
    {#if page.url.searchParams.get("mfa") === "disabled"}<p role="status">
        Authenticator disabled. All sessions were signed out. Sign in again to continue.
      </p>{/if}
    <form onsubmit={login}>
      <label>Email<input
          type="email"
          autocomplete="username"
          bind:value={email}
          required
        /></label><label>Password<input
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
        /></label>{#if message}<p role="alert" class="error">{message}</p>{/if}
      <button disabled={busy}>{busy ? "Signing in…" : "Continue"}</button>
    </form>
    <a href="/forgot-password" class="text-link">Forgot password?</a>
    <p class="fine">
      Your session is protected with two-factor authentication when enabled.
    </p>
  </section>
</div>
