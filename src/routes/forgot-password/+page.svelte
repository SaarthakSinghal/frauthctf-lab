<script lang="ts">
import { enhance } from "$app/forms";
let { form } = $props();
</script>
<section class="auth-card centered reset-card">
  <span class="section-label">Account access</span>
  <h1>Reset your password</h1>
  {#if form?.submitted}
    <p role="status">
      If that address belongs to a Cirque account and mail is available, a reset link is on its way.
      Check your inbox, or contact your workspace administrator if it does not arrive.
    </p>
    <a href="/login" class="text-link">Return to sign in</a>
  {:else}
    <p>
      Enter your workspace email. We will send a one-use link if the account exists.
    </p>
    <form method="POST" use:enhance>
      <label>Email<input
          type="email"
          name="email"
          autocomplete="email"
          required
          maxlength="254"
        /></label>
      {#if form?.invalid}<p role="alert" class="error">
          Enter a valid email address.
        </p>{/if}
      {#if form?.limited}<p role="alert" class="error">
          Too many requests. Try again in 15 minutes.
        </p>{/if}
      <button>Send reset link</button>
    </form>
    <a href="/login" class="text-link">Back to sign in</a>
  {/if}
</section>
