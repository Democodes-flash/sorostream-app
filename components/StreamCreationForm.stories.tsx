import type { Meta, StoryObj } from "@storybook/react";
import StreamCreationForm from "@/components/StreamCreationForm";
import { TxStage } from "@/components/TransactionStepper";

/**
 * **StreamCreationForm** is a self-contained, router-free version of the
 * `/stream/new` wizard. It assembles the same sub-components used by the
 * real page (`RecipientAutocomplete`, `DurationPicker`, `FlowRatePreview`,
 * `FeeEstimationPanel`, `StreamCostCalculator`, etc.) but removes the
 * Next.js router and Soroban SDK calls so each step can be developed and
 * reviewed in isolation.
 *
 * ### 4-step wizard
 * | Step | What the user does |
 * |------|--------------------|
 * | 1. Recipient | Enter / select a Stellar public key |
 * | 2. Amount & Duration | Set token, amount, duration, scheduling |
 * | 3. Preview | Review flow rate, costs, net received |
 * | 4. Confirm | Final review + optional memo → sign |
 *
 * ### Storybook tips
 * - Use the **Controls** panel to jump to any step via `initialStep`.
 * - Use the **Actions** panel to see `onSubmit` / `onCancel` callbacks.
 */
const meta: Meta<typeof StreamCreationForm> = {
  title: "UI/StreamCreationForm",
  component: StreamCreationForm,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    initialStep: {
      control: "select",
      options: ["recipient", "amount", "preview", "confirm"],
      description: "Which wizard step to start on.",
    },
    defaultToken: {
      control: "select",
      options: ["XLM", "USDC", "AQUA", "yXLM"],
      description: "Pre-selected token.",
    },
    submitting: {
      control: "boolean",
      description: "Show the transaction progress overlay.",
    },
    txStage: {
      control: "select",
      options: Object.values(TxStage),
      description: "Transaction stage shown when `submitting` is true.",
      if: { arg: "submitting", truthy: true },
    },
  },
  args: {
    onSubmit: (data) => console.log("onSubmit", data),
    onCancel: () => console.log("onCancel"),
  },
};

export default meta;

type Story = StoryObj<typeof StreamCreationForm>;

// ── Step 1: Recipient ─────────────────────────────────────────────────────

/**
 * The first step of the wizard — the user enters or selects a Stellar
 * public key for the stream recipient.
 */
export const StepRecipient: Story = {
  name: "Step 1 — Recipient",
  args: {
    initialStep: "recipient",
  },
};

/**
 * Step 1 pre-filled with a recipient address (e.g. arriving from a
 * clone action or a deep-link URL param).
 */
export const StepRecipientPrefilled: Story = {
  name: "Step 1 — Recipient (pre-filled)",
  args: {
    initialStep: "recipient",
    defaultRecipient:
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
  },
};

// ── Step 2: Amount & Duration ─────────────────────────────────────────────

/**
 * Step 2 — the user sets the token, total amount, and duration.
 * The flow rate preview, fee estimation, and scheduling toggle are all visible.
 */
export const StepAmount: Story = {
  name: "Step 2 — Amount & Duration",
  args: {
    initialStep: "amount",
    defaultRecipient:
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
  },
};

/**
 * Step 2 pre-filled with a valid amount and duration so the live
 * `FlowRatePreview` and `FeeEstimationPanel` sub-components are active.
 */
export const StepAmountPrefilled: Story = {
  name: "Step 2 — Amount & Duration (pre-filled)",
  args: {
    initialStep: "amount",
    defaultRecipient:
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
    defaultAmount: "100",
    defaultDuration: 30 * 86400, // 30 days
    defaultToken: "XLM",
  },
};

/**
 * Step 2 with USDC pre-selected — verifies the token selector and that
 * downstream components receive the correct token symbol.
 */
export const StepAmountUsdc: Story = {
  name: "Step 2 — USDC token",
  args: {
    initialStep: "amount",
    defaultRecipient:
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
    defaultAmount: "500",
    defaultDuration: 7 * 86400, // 7 days
    defaultToken: "USDC",
  },
};

// ── Step 3: Preview ───────────────────────────────────────────────────────

/**
 * Step 3 — the summary review before the final confirmation.
 * Shows the stream summary card, `StreamCostCalculator`, and
 * `NetReceivedDisplay` when amount and duration are both set.
 */
export const StepPreview: Story = {
  name: "Step 3 — Preview",
  args: {
    initialStep: "preview",
    defaultRecipient:
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
    defaultAmount: "100",
    defaultDuration: 30 * 86400,
    defaultToken: "XLM",
  },
};

/**
 * Step 3 with a large deposit — verifies formatting of large flow-rate
 * values and that cost breakdown figures look correct.
 */
export const StepPreviewLargeDeposit: Story = {
  name: "Step 3 — Preview (large deposit)",
  args: {
    initialStep: "preview",
    defaultRecipient:
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
    defaultAmount: "50000",
    defaultDuration: 365 * 86400, // 1 year
    defaultToken: "USDC",
  },
};

// ── Step 4: Confirm ───────────────────────────────────────────────────────

/**
 * Step 4 — the final confirmation step with an optional memo field.
 * Clicking "Create Stream" calls `onSubmit` (logged in the Actions panel).
 */
export const StepConfirm: Story = {
  name: "Step 4 — Confirm",
  args: {
    initialStep: "confirm",
    defaultRecipient:
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
    defaultAmount: "100",
    defaultDuration: 30 * 86400,
    defaultToken: "XLM",
  },
};

// ── Transaction states ────────────────────────────────────────────────────

/**
 * Transaction overlay — **Building** stage.
 * Shown immediately after the user clicks "Create Stream" while the
 * SDK assembles the transaction envelope.
 */
export const TxBuilding: Story = {
  name: "Transaction — Building",
  args: {
    submitting: true,
    txStage: TxStage.Building,
  },
};

/**
 * Transaction overlay — **Signing** stage.
 * The wallet extension (Freighter) has been invoked and is waiting for
 * the user to approve the transaction.
 */
export const TxSigning: Story = {
  name: "Transaction — Signing",
  args: {
    submitting: true,
    txStage: TxStage.Signing,
  },
};

/**
 * Transaction overlay — **Submitting** stage.
 * The signed transaction envelope is being broadcast to the Stellar network.
 */
export const TxSubmitting: Story = {
  name: "Transaction — Submitting",
  args: {
    submitting: true,
    txStage: TxStage.Submitting,
  },
};

/**
 * Transaction overlay — **Confirming** stage.
 * Waiting for the Soroban RPC to confirm the transaction is included in a ledger.
 */
export const TxConfirming: Story = {
  name: "Transaction — Confirming",
  args: {
    submitting: true,
    txStage: TxStage.Confirming,
  },
};

/**
 * Transaction overlay — **Done** stage.
 * Stream created successfully — the success illustration and stream ID are shown.
 */
export const TxDone: Story = {
  name: "Transaction — Done ✓",
  args: {
    submitting: true,
    txStage: TxStage.Done,
  },
};

/**
 * Transaction overlay — **Error** state.
 * The on-chain call failed (e.g. insufficient balance, network timeout).
 * An error message and "Back to Form" button are surfaced.
 */
export const TxError: Story = {
  name: "Transaction — Error",
  args: {
    submitting: true,
    txStage: TxStage.Confirming,
    txError:
      "Transaction failed: insufficient balance. Top up your wallet and try again.",
  },
};
