<script lang="ts">
import { authClient } from "#lib/client.js";
let code = $state("");
let backupCode = $state("");
let useBackup = $state(false);
let message = $state("");
let busy = $state(false);
async function verify(event: SubmitEvent) {
  event.preventDefault();
  busy = true;
  message = "";
  try {
    const { error } = await authClient.twoFactor.verifyTotp({
      code,
      trustDevice: false,
    });
    if (error) {
      message = "That code could not be verified. Try a fresh code.";
      return;
    }
    window.location.href = "/dashboard";
  } catch {
    message = "Unable to connect. Please try again.";
  } finally {
    busy = false;
  }
}
async function recover(event: SubmitEvent) {
  event.preventDefault();
  busy = true;
  message = "";
  try {
    const { error } = await authClient.twoFactor.verifyBackupCode({
      code: backupCode,
      trustDevice: false,
    });
    if (error) {
      message = "That recovery code could not be verified.";
      return;
    }
    backupCode = "";
    window.location.href = "/dashboard";
  } catch {
    message = "Unable to connect. Please try again.";
  } finally {
    busy = false;
  }
}
</script>
<section class="auth-card centered">
  <span class="section-label">Two-factor authentication</span><h1>
    Verify it's you
  </h1>
  <p>
    {
      useBackup
      ? "Use one of the recovery codes saved during setup. Each code works only once."
      : "Enter the six-digit code from your authenticator app to open your workspace."
    }
  </p>
  {#if useBackup}<form onsubmit={recover}>
      <label>Recovery code<input
          autocomplete="off"
          bind:value={backupCode}
          required
        /></label>{#if message}<p role="alert" class="error">{message}</p>{/if}
      <button disabled={busy}>
        {busy ? "Verifying…" : "Use recovery code"}
      </button>
    </form>{:else}<form onsubmit={verify}>
      <label>Authentication code<input
          autocomplete="one-time-code"
          inputmode="numeric"
          pattern={"[0-9]{6}"}
          maxlength="6"
          bind:value={code}
          required
        /></label>{#if message}<p role="alert" class="error">{message}</p>{/if}
      <button disabled={busy}>
        {busy ? "Verifying…" : "Verify and continue"}
      </button>
    </form>{/if}
  <button
    type="button"
    class="switch-method"
    onclick={() => {
      useBackup = !useBackup;
      message = "";
    }}
  >
    {useBackup ? "Use authenticator app" : "Use a recovery code"}
  </button><a class="text-link" href="/login">Back to sign in</a>
</section>
