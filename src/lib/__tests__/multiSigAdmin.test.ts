import { describe, it, expect, beforeEach } from "vitest";
import {
  proposeAdminAction,
  approveAdminAction,
  executeAdminAction,
  getAdminProposal,
  getAdminProposals,
  getProposalEvents,
  cleanupExpiredProposals,
  getAdminSigners,
  addAdminSigner,
  removeAdminSigner,
  type AdminAction,
} from "../sorostream";

const MOCK_ADMIN_1 = "GDZST3XVCDTUJ76ZAV2HA72KYXM4DCKWRFDADMHRCWWXHJVZOM7Z2VJR";
const MOCK_ADMIN_2 = "GB7VSUXWJZQRFNVQRH4SVPZPEVKD5LTQE5JMQVTXCUVJMHPPZCFDVKDA";
const MOCK_ADMIN_3 = "GBAXMYFXDQX527U3A3C35TQFKXJ7BVRWVYKSVVQN2T2NRVQFNWTZVFPJ";
const MOCK_NON_ADMIN = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB7UKWWKXOA7DWEY45BN2ZQ";

describe("Multi-Signature Admin Operations (Issue #658)", () => {
  beforeEach(() => {
    // Clear proposals before each test
    cleanupExpiredProposals();
  });

  describe("Admin Signer Management", () => {
    it("should get the list of admin signers", () => {
      const signers = getAdminSigners();
      expect(signers).toBeDefined();
      expect(signers.length).toBeGreaterThan(0);
      expect(signers).toContain(MOCK_ADMIN_1);
      expect(signers).toContain(MOCK_ADMIN_2);
      expect(signers).toContain(MOCK_ADMIN_3);
    });

    it("should add a new admin signer", () => {
      const newAdmin = "GNEW6RNUZNZAKR27H7YTNHCW3YUL5UVZLH4UYAYNJ3L3PQXGVBVXXP7H";
      const signersBefore = getAdminSigners().length;
      const result = addAdminSigner(newAdmin);

      expect(result.success).toBe(true);
      expect(getAdminSigners().length).toBe(signersBefore + 1);
      expect(getAdminSigners()).toContain(newAdmin);
    });

    it("should reject duplicate admin signer", () => {
      const result = addAdminSigner(MOCK_ADMIN_1);
      expect(result.success).toBe(false);
      expect(result.message).toContain("already exists");
    });

    it("should remove an admin signer", () => {
      const signersBefore = getAdminSigners().length;
      const result = removeAdminSigner(MOCK_ADMIN_3);

      expect(result.success).toBe(true);
      expect(getAdminSigners().length).toBe(signersBefore - 1);
      expect(getAdminSigners()).not.toContain(MOCK_ADMIN_3);
    });

    it("should prevent removing signer if threshold would be violated", () => {
      // Remove first admin
      removeAdminSigner(MOCK_ADMIN_3);
      // Try to remove second admin (would violate 2-of-2 threshold)
      const result = removeAdminSigner(MOCK_ADMIN_2);

      expect(result.success).toBe(false);
      expect(result.message).toContain("minimum threshold");
    });
  });

  describe("Admin Action Proposal", () => {
    it("should create a pause proposal", () => {
      const result = proposeAdminAction("pause", {}, MOCK_ADMIN_1);

      expect(result.proposalId).toBeTruthy();
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should create a set_fee proposal with parameters", () => {
      const result = proposeAdminAction("set_fee", { basisPoints: 75 }, MOCK_ADMIN_1);

      expect(result.proposalId).toBeTruthy();
      const proposal = getAdminProposal(result.proposalId);
      expect(proposal).toBeDefined();
      expect(proposal?.params.basisPoints).toBe(75);
    });

    it("should create a add_issuer proposal", () => {
      const result = proposeAdminAction("add_issuer", { issuer: "GNEW123" }, MOCK_ADMIN_1);

      expect(result.proposalId).toBeTruthy();
      const proposal = getAdminProposal(result.proposalId);
      expect(proposal?.action).toBe("add_issuer");
    });

    it("should set initial status to pending", () => {
      const result = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposal = getAdminProposal(result.proposalId);

      expect(proposal?.status).toBe("pending");
    });

    it("should initialize empty approvals", () => {
      const result = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposal = getAdminProposal(result.proposalId);

      expect(proposal?.approvals.size).toBe(0);
    });

    it("should set expiration to 7 days from now", () => {
      const now = Date.now();
      const result = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposal = getAdminProposal(result.proposalId);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      expect(proposal?.expiresAt).toBeGreaterThan(now + sevenDaysMs - 1000);
      expect(proposal?.expiresAt).toBeLessThan(now + sevenDaysMs + 1000);
    });
  });

  describe("Admin Action Approval", () => {
    it("should approve an admin action", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const approval = approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);

      expect(approval.success).toBe(true);
      expect(approval.message).toContain("Approval recorded");
    });

    it("should reject approval from non-admin", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const approval = approveAdminAction(proposal.proposalId, MOCK_NON_ADMIN);

      expect(approval.success).toBe(false);
      expect(approval.message).toContain("not an authorized admin signer");
    });

    it("should reject duplicate approvals", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      const secondApproval = approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);

      expect(secondApproval.success).toBe(false);
      expect(secondApproval.message).toContain("already approved");
    });

    it("should reach threshold with 2 approvals (2-of-3 multisig)", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const approval1 = approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      const approval2 = approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);

      expect(approval1.thresholdReached).toBe(false);
      expect(approval2.thresholdReached).toBe(true);

      const finalProposal = getAdminProposal(proposal.proposalId);
      expect(finalProposal?.status).toBe("approved");
    });

    it("should reject approval for non-existent proposal", () => {
      const approval = approveAdminAction("non-existent", MOCK_ADMIN_2);

      expect(approval.success).toBe(false);
      expect(approval.message).toContain("Proposal not found");
    });

    it("should reject approval for already executed proposal", async () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);
      await executeAdminAction(proposal.proposalId, MOCK_ADMIN_1);

      const approval = approveAdminAction(proposal.proposalId, MOCK_ADMIN_1);

      expect(approval.success).toBe(false);
      expect(approval.message).toContain("cannot approve");
    });

    it("should reject approval for expired proposal", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposalObj = getAdminProposal(proposal.proposalId);

      if (proposalObj) {
        // Manually expire the proposal
        (proposalObj as any).expiresAt = Date.now() - 1000;
      }

      const approval = approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);

      expect(approval.success).toBe(false);
      expect(approval.message).toContain("expired");
    });
  });

  describe("Admin Action Execution", () => {
    it("should execute an approved action", async () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);

      const execution = await executeAdminAction(proposal.proposalId, MOCK_ADMIN_1);

      expect(execution.success).toBe(true);
      expect(execution.txHash).toBeTruthy();
    });

    it("should reject execution from non-admin", async () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);

      const execution = await executeAdminAction(proposal.proposalId, MOCK_NON_ADMIN);

      expect(execution.success).toBe(false);
      expect(execution.message).toContain("not an authorized admin signer");
    });

    it("should reject execution of non-approved proposal", async () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      // Only one approval, threshold not reached

      const execution = await executeAdminAction(proposal.proposalId, MOCK_ADMIN_1);

      expect(execution.success).toBe(false);
      expect(execution.message).toContain("must be approved");
    });

    it("should execute set_fee action", async () => {
      const proposal = proposeAdminAction("set_fee", { basisPoints: 100 }, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);

      const execution = await executeAdminAction(proposal.proposalId, MOCK_ADMIN_1);

      expect(execution.success).toBe(true);
    });

    it("should update proposal status to executed", async () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);
      await executeAdminAction(proposal.proposalId, MOCK_ADMIN_1);

      const finalProposal = getAdminProposal(proposal.proposalId);
      expect(finalProposal?.status).toBe("executed");
    });
  });

  describe("Proposal Queries", () => {
    it("should retrieve all proposals", () => {
      proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      proposeAdminAction("set_fee", { basisPoints: 75 }, MOCK_ADMIN_1);

      const proposals = getAdminProposals();
      expect(proposals.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter proposals by status", () => {
      const proposal1 = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposal2 = proposeAdminAction("set_fee", { basisPoints: 75 }, MOCK_ADMIN_1);

      approveAdminAction(proposal1.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal1.proposalId, MOCK_ADMIN_3);

      const pendingProposals = getAdminProposals("pending");
      const approvedProposals = getAdminProposals("approved");

      expect(pendingProposals.some((p) => p.id === proposal2.proposalId)).toBe(true);
      expect(approvedProposals.some((p) => p.id === proposal1.proposalId)).toBe(true);
    });

    it("should retrieve proposal details", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const retrieved = getAdminProposal(proposal.proposalId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(proposal.proposalId);
      expect(retrieved?.action).toBe("pause");
      expect(retrieved?.status).toBe("pending");
    });

    it("should return null for non-existent proposal", () => {
      const retrieved = getAdminProposal("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("Proposal Events", () => {
    it("should emit proposal event", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const events = getProposalEvents(proposal.proposalId);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].eventType).toBe("proposed");
      expect(events[0].actionId).toBe(proposal.proposalId);
    });

    it("should emit approval events", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);

      const events = getProposalEvents(proposal.proposalId);
      const approvalEvents = events.filter((e) => e.eventType === "approved");

      expect(approvalEvents.length).toBe(2);
    });

    it("should emit execution event", async () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);
      await executeAdminAction(proposal.proposalId, MOCK_ADMIN_1);

      const events = getProposalEvents(proposal.proposalId);
      const executionEvents = events.filter((e) => e.eventType === "executed");

      expect(executionEvents.length).toBe(1);
    });

    it("should retrieve all events across proposals", () => {
      proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      proposeAdminAction("set_fee", { basisPoints: 75 }, MOCK_ADMIN_1);

      const allEvents = getProposalEvents();
      expect(allEvents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Proposal Cleanup", () => {
    it("should clean up expired proposals", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposalObj = getAdminProposal(proposal.proposalId);

      if (proposalObj) {
        // Manually expire the proposal
        (proposalObj as any).expiresAt = Date.now() - 1000;
      }

      const cleaned = cleanupExpiredProposals();

      expect(cleaned).toBeGreaterThan(0);
      const expiredProposal = getAdminProposal(proposal.proposalId);
      expect(expiredProposal?.status).toBe("expired");
    });

    it("should emit expiration events", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposalObj = getAdminProposal(proposal.proposalId);

      if (proposalObj) {
        (proposalObj as any).expiresAt = Date.now() - 1000;
      }

      cleanupExpiredProposals();
      const events = getProposalEvents(proposal.proposalId);
      const expiredEvents = events.filter((e) => e.eventType === "expired");

      expect(expiredEvents.length).toBe(1);
    });
  });

  describe("Complex Multisig Workflows", () => {
    it("should handle multiple concurrent proposals", () => {
      const proposal1 = proposeAdminAction("pause", {}, MOCK_ADMIN_1);
      const proposal2 = proposeAdminAction("set_fee", { basisPoints: 100 }, MOCK_ADMIN_1);
      const proposal3 = proposeAdminAction("add_issuer", { issuer: "GNEW123" }, MOCK_ADMIN_1);

      const allProposals = getAdminProposals();
      expect(allProposals.length).toBeGreaterThanOrEqual(3);
    });

    it("should handle partial approvals correctly", () => {
      const proposal = proposeAdminAction("pause", {}, MOCK_ADMIN_1);

      // First approval
      const approval1 = approveAdminAction(proposal.proposalId, MOCK_ADMIN_2);
      expect(approval1.thresholdReached).toBe(false);

      // Second approval reaches threshold
      const approval2 = approveAdminAction(proposal.proposalId, MOCK_ADMIN_3);
      expect(approval2.thresholdReached).toBe(true);
    });
  });
});
