<script lang="ts">
import { authClient } from "#lib/client.js";
import WorkspaceShell from "#lib/WorkspaceShell.svelte";
import { enhance } from "$app/forms";
import QRCode from "qrcode";
let { data, form } = $props();
let password = $state("");
let code = $state("");
let secret = $state("");
let qrImage = $state("");
let backupCodes = $state<string[]>([]);
let message = $state("");
let busy = $state(false);
let complete = $state(false);
let qrQuestion = $state<HTMLDetailsElement>();
let codeQuestion = $state<HTMLDetailsElement>();
let managementAction = $state<"disable" | "replace" | null>(null);
let replacementCodes = $state<string[]>([]);
let replacementMessage = $state("");
let newCode = $state("");
let replacementURI = $derived(form?.replacementURI ?? data.replacementURI);
let replacementImage = $state("");
$effect(() => {
  if (!replacementURI) {
    replacementImage = "";
    return;
  }
  QRCode.toDataURL(replacementURI, {
    width: 224,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#17223A", light: "#FFFFFFFF" },
  }).then((image) => (replacementImage = image));
});
function showQuestion(question?: HTMLDetailsElement) {
  if (!question) return;
  question.open = true;
  question.scrollIntoView({ block: "nearest", behavior: "instant" });
  question.querySelector("summary")?.focus();
}
async function enroll(event: SubmitEvent) {
  event.preventDefault();
  busy = true;
  message = "";
  try {
    const { data: enrollment, error } = await authClient.twoFactor.enable({
      password,
    });
    if (error || !enrollment || enrollment.method !== "totp") {
      message = "Unable to start setup. Check your password.";
      return;
    }
    qrImage = await QRCode.toDataURL(enrollment.totpURI, {
      width: 224,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#17223A", light: "#FFFFFFFF" },
    });
    secret = new URL(enrollment.totpURI).searchParams.get("secret") ?? "";
    backupCodes = enrollment.backupCodes;
    password = "";
  } catch {
    message = "Unable to prepare setup. Please try again.";
  } finally {
    busy = false;
  }
}
async function confirm(event: SubmitEvent) {
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
    complete = true;
    secret = "";
    qrImage = "";
    code = "";
  } catch {
    message = "Unable to connect. Please try again.";
  } finally {
    busy = false;
  }
}
</script>
{#if replacementCodes.length}
  <section class="panel replacement-complete" role="status">
    <span class="section-label">Authenticator</span>
    <h1>Authenticator replaced</h1>
    <p>Save these new recovery codes now. They will not be shown again. All sessions ended.</p>
    <div class="codes">
      {#each replacementCodes as recoveryCode}<code>{recoveryCode}</code>{/each}
    </div>
    <a href="/login" class="button">Return to sign in</a>
  </section>
{:else}
  <WorkspaceShell
    title="Profile"
    user={data.user}
    role={data.role}
  >
    <div class="profile-layout">
      {#if data.setupRequired}<p class="profile-notice" role="status">
          A response lead needs an authenticator before opening restricted reports. Set it up here,
          then return to the report.
        </p>{/if}
      {#if data.replacementRequired}<p class="profile-notice" role="status">
          Finish or cancel authenticator replacement before opening restricted reports.
        </p>{/if}
      <section class="panel profile-section">
        <span class="section-label">Workspace identity</span>
        <h2>Your account</h2>
        <dl class="profile-facts">
          <div>
            <dt>Name</dt>
            <dd>{data.user.name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{data.user.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{data.role === "lead" ? "Response lead" : "Analyst"}</dd>
          </div>
        </dl>
      </section>
      <section class="panel profile-section">
        <span class="section-label">Sign-in</span>
        <h2>Password set</h2>
        <p>
          Your password is set and is never displayed here. To regain access, use the reset link on
          the sign-in page.
        </p>
      </section>
      <section class="panel security-panel profile-section" id="authenticator">
        <div class="profile-section-head">
          <h2>Authenticator app</h2><span class="factor-state">{
            complete || data.twoFactorEnabled ? "On" : data.enrollmentPending ? "Setup pending" : "Off"
          }</span>
        </div>
        {#if data.twoFactorEnabled && !complete}
          <p>A code is required when you sign in on a new session.</p><p>
            Recovery codes are single-use backups for when you lose your phone. Keep them offline.
          </p>
          {#if replacementURI}
            <div class="mfa-management">
              <h3>Connect your new authenticator</h3>
              <p>
                Your old authenticator remains active until you confirm a code from the new one.
                This setup expires after ten minutes.
              </p>
              {#if replacementImage}<div class="qr-wrap">
                  <img
                    src={replacementImage}
                    alt="Cirque replacement authenticator QR code"
                    width="224"
                    height="224"
                  />
                </div>{/if}
              <details>
                <summary>Use a manual setup key instead</summary><code
                  class="secret"
                  data-testid="replacement-secret"
                >{new URL(replacementURI).searchParams.get("secret")}</code>
              </details>
              <form
                method="POST"
                action="?/confirmReplacement"
                use:enhance={() =>
                async ({ result }) => {
                  if (result.type === "success") {
                    replacementCodes = (result.data?.recoveryCodes as string[] | undefined) ?? [];
                    newCode = "";
                    replacementMessage = "";
                  } else if (result.type === "failure") {
                    replacementMessage = String(
                      result.data?.message ?? "Unable to confirm replacement. Try again.",
                    );
                  }
                }}
              >
                <label>Code from new authenticator<input
                    name="code"
                    autocomplete="one-time-code"
                    inputmode="numeric"
                    pattern={"[0-9]{6}"}
                    maxlength="6"
                    bind:value={newCode}
                    required
                  /></label>
                <button>Confirm replacement</button>
              </form>
              <form method="POST" action="?/cancelReplacement">
                <button class="quiet-button">Cancel replacement</button>
              </form>
            </div>
          {:else if form?.proof && form?.action}
            <div class="mfa-management">
              <h3>
                {form.action === "disable" ? "Confirm disable" : "Replace your authenticator"}
              </h3>
              <p>
                {
                  form.action === "disable"
                  ? "Disabling removes your authenticator and recovery codes and signs out every session. A response lead loses restricted report access until setup is complete again."
                  : "Your old authenticator stays active until the new one is confirmed. Completing replacement ends every session and replaces your recovery codes."
                }
              </p>
              <form
                method="POST"
                action={form.action === "disable" ? "?/disableMfa" : "?/beginReplacement"}
              >
                <input type="hidden" name="proof" value={form.proof} />
                <button>
                  {
                    form.action === "disable" ? "Disable authenticator and sign out" : "Start replacement"
                  }
                </button>
              </form>
              <a href="/profile#authenticator" class="text-link">Cancel</a>
            </div>
          {:else}
            <div class="mfa-management">
              <h3>Manage your authenticator</h3>
              <p>
                Confirm your current password and a fresh code from your authenticator or an unused
                recovery code.
              </p>
              {#if managementAction}
                <form method="POST" action="?/proveMfa">
                  <input type="hidden" name="action" value={managementAction} />
                  <label>Current password<input
                      type="password"
                      name="password"
                      autocomplete="current-password"
                      required
                    /></label>
                  <label>Current authenticator or recovery code<input
                      name="code"
                      autocomplete="one-time-code"
                      required
                    /></label>
                  <button>
                    Verify to {managementAction === "disable" ? "disable" : "replace"}
                  </button>
                </form>
                <button
                  type="button"
                  class="quiet-button"
                  onclick={() => (managementAction = null)}
                >
                  Cancel
                </button>
              {:else}
                <div class="mfa-management-actions">
                  <button type="button" onclick={() => (managementAction = "replace")}>
                    Replace authenticator
                  </button>
                  <button
                    type="button"
                    class="quiet-button"
                    onclick={() => (managementAction = "disable")}
                  >
                    Disable authenticator
                  </button>
                </div>
              {/if}
            </div>
          {/if}
          {#if form?.message || replacementMessage}<p role="alert" class="error">
              {form?.message ?? replacementMessage}
            </p>{/if}
        {:else if complete}
          <p>
            Save these one-time recovery codes in a private location. They will not be shown again.
          </p><div class="codes">
            {#each backupCodes as backup}<code>{backup}</code>{/each}
          </div><a href="/dashboard" class="button">Return to overview</a>
        {:else if secret}
          <p>
            Scan this code with your authenticator app. If you cannot scan it, enter the manual key
            below. Setup remains incomplete until you confirm a six-digit code.
          </p>
          <div class="setup-help">
            <span>Scan the setup code</span><button
              type="button"
              class="inline-help"
              onclick={() => showQuestion(qrQuestion)}
            >
              What is this?
            </button>
          </div>
          <div class="qr-wrap">
            <img
              src={qrImage}
              alt="Cirque authenticator setup QR code"
              width="224"
              height="224"
            />
          </div>
          <details>
            <summary>Use a manual setup key instead</summary><code
              class="secret"
              data-testid="totp-secret"
            >{secret}</code><p>
              Choose time-based codes, six digits, with a 30-second period.
            </p>
          </details>
          <form onsubmit={confirm}>
            <label>Authentication code<input
                autocomplete="one-time-code"
                inputmode="numeric"
                pattern={"[0-9]{6}"}
                maxlength="6"
                bind:value={code}
                required
              /></label><button
              type="button"
              class="inline-help"
              onclick={() => showQuestion(codeQuestion)}
            >
              What is this?
            </button>
            <button disabled={busy}>
              {busy ? "Confirming…" : "Confirm authenticator"}
            </button>
          </form>
        {:else}
          <p>
            {
              data.enrollmentPending
              ? "Setup was not confirmed. Enter your password to start again with a new QR code."
              : "Confirm your password before connecting an authenticator app."
            }
          </p><form onsubmit={enroll}>
            <label>Password<input
                type="password"
                autocomplete="current-password"
                bind:value={password}
                required
              /></label><button disabled={busy}>
              {busy ? "Preparing…" : "Continue setup"}
            </button>
          </form>
        {/if}
        {#if message}<p role="alert" class="error">{message}</p>{/if}
        <div class="auth-questions">
          <h3>Common questions</h3>
          <details>
            <summary>Why is it called two-factor?</summary>
            <p>
              Signing in checks two different things: something you know (your password) and
              something you have (your phone's authenticator app). Once enabled, a stolen password
              alone isn't enough to get in.
            </p>
          </details>
          <details bind:this={qrQuestion}>
            <summary>What is the QR code, and is it safe to scan?</summary>
            <p>
              It carries your private setup key and account name. Scan only a code you opened
              yourself in Cirque, using your authenticator app. Never share it: anyone with the key
              can generate your codes.
            </p>
          </details>
          <details bind:this={codeQuestion}>
            <summary>What is the six-digit code?</summary>
            <p>
              It is a short-lived code your app calculates from the setup key and current time. It
              stops working after it expires. Recovery codes are different: single-use backups.
            </p>
          </details>
          <details>
            <summary>It works offline, so how do my phone and Cirque stay in sync?</summary>
            <p>
              They do not exchange codes. Your phone and Cirque each hold the same setup key and
              calculate a code independently. When you submit a code, Cirque checks it against its
              result, so your phone's clock needs to be accurate.
            </p>
          </details>
        </div>
      </section>
      <p class="profile-future">
        Changing your password isn't available here yet.
      </p>
    </div>
  </WorkspaceShell>
{/if}
