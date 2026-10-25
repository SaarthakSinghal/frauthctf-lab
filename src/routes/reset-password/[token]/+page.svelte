<script lang="ts">
import { enhance } from "$app/forms";
let { data, form } = $props();
</script>
<section class="auth-card centered reset-card">
  <span class="section-label">Account access</span>
  {#if form?.complete}
    <h1>Password updated</h1>
    <p>
      Your other sessions are signed out. Sign in with your new password; your authenticator is
      still required if enabled.
    </p>
    <a href="/login" class="button">Return to sign in</a>
  {:else if !data.valid || form?.invalid}
    <h1>Link unavailable</h1>
    <p>
      This reset link has expired or has already been used. Request a new one to continue.
    </p>
    <a href="/forgot-password" class="button">Request another link</a>
  {:else}
    <h1>Choose a new password</h1>
    <p>
      Use at least 12 characters. This link works once and expires 20 minutes after it was sent.
    </p>
    <form method="POST" use:enhance>
      <label>New password<input
          type="password"
          name="password"
          autocomplete="new-password"
          minlength="12"
          required
        /></label>
      <label>Confirm new password<input
          type="password"
          name="confirmation"
          autocomplete="new-password"
          minlength="12"
          required
        /></label>
      {#if form?.mismatch}<p role="alert" class="error">
          Passwords must match and contain at least 12 characters.
        </p>{/if}
      {#if form?.limited}<p role="alert" class="error">
          Too many attempts. Try again in 15 minutes.
        </p>{/if}
      <button>Update password</button>
    </form>
  {/if}
</section>
