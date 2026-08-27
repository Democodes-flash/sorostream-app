import { describe, it, expect, beforeEach } from "vitest";
import {
  generateChallenge,
  isChallengeValid,
  issueCredentialWithProof,
  getCredentialStatus,
  cleanupExpiredChallenges,
  type Challenge,
  type CredentialProofRequest,
} from "../sorostream";

describe("Credential Proof System (Issue #659)", () => {
  beforeEach(() => {
    // Clean up any existing challenges/credentials before each test
    cleanupExpiredChallenges();
  });

  describe("Challenge Generation", () => {
    it("should generate a valid challenge with unique ID", () => {
      const challenge = generateChallenge();

      expect(challenge).toBeDefined();
      expect(challenge.id).toBeTruthy();
      expect(challenge.challenge).toBeTruthy();
      expect(challenge.createdAt).toBeGreaterThan(0);
      expect(challenge.expiresAt).toBeGreaterThan(challenge.createdAt);
      expect(challenge.used).toBe(false);
    });

    it("should generate challenges with different IDs", () => {
      const challenge1 = generateChallenge();
      const challenge2 = generateChallenge();

      expect(challenge1.id).not.toBe(challenge2.id);
      expect(challenge1.challenge).not.toBe(challenge2.challenge);
    });

    it("should set 5-minute expiry time", () => {
      const challenge = generateChallenge();
      const expiryMs = challenge.expiresAt - challenge.createdAt;

      // Should be approximately 5 minutes (300000 ms), allow small variance
      expect(expiryMs).toBeGreaterThan(299000);
      expect(expiryMs).toBeLessThan(301000);
    });
  });

  describe("Challenge Validation", () => {
    it("should validate an active challenge", () => {
      const challenge = generateChallenge();
      expect(isChallengeValid(challenge.id)).toBe(true);
    });

    it("should reject non-existent challenge", () => {
      expect(isChallengeValid("non-existent-id")).toBe(false);
    });

    it("should reject expired challenge", () => {
      const challenge = generateChallenge();
      // Manually set expiry to past
      const challengeObj = challenge as Challenge;
      challengeObj.expiresAt = Date.now() - 1000;

      expect(isChallengeValid(challenge.id)).toBe(false);
    });

    it("should reject used challenge", () => {
      const challenge = generateChallenge();
      // Manually mark as used
      const challengeObj = challenge as Challenge;
      challengeObj.used = true;

      expect(isChallengeValid(challenge.id)).toBe(false);
    });
  });

  describe("Credential Issuance with Proof", () => {
    it("should issue credential with valid Ed25519 signature", async () => {
      const challenge = generateChallenge();
      const mockPublicKey = Buffer.alloc(32).toString("hex");
      const mockSignature = Buffer.alloc(64).toString("hex");

      const proofRequest: CredentialProofRequest = {
        challenge: challenge.challenge,
        signature: mockSignature,
        publicKey: mockPublicKey,
        signatureType: "Ed25519",
      };

      const response = await issueCredentialWithProof(challenge.id, proofRequest);

      expect(response.isValid).toBe(true);
      expect(response.credentialId).toBeTruthy();
      expect(response.txHash).toBeTruthy();
      expect(response.error).toBeUndefined();
    });

    it("should issue credential with valid secp256k1 signature", async () => {
      const challenge = generateChallenge();
      const mockPublicKey = Buffer.alloc(65).toString("hex");
      const mockSignature = Buffer.alloc(64).toString("hex");

      const proofRequest: CredentialProofRequest = {
        challenge: challenge.challenge,
        signature: mockSignature,
        publicKey: mockPublicKey,
        signatureType: "secp256k1",
      };

      const response = await issueCredentialWithProof(challenge.id, proofRequest);

      expect(response.isValid).toBe(true);
      expect(response.credentialId).toBeTruthy();
      expect(response.txHash).toBeTruthy();
    });

    it("should reject invalid signature", async () => {
      const challenge = generateChallenge();
      const proofRequest: CredentialProofRequest = {
        challenge: challenge.challenge,
        signature: "invalid", // Too short
        publicKey: Buffer.alloc(32).toString("hex"),
        signatureType: "Ed25519",
      };

      const response = await issueCredentialWithProof(challenge.id, proofRequest);

      expect(response.isValid).toBe(false);
      expect(response.error).toContain("Invalid signature");
    });

    it("should reject expired challenge", async () => {
      const challenge = generateChallenge();
      const challengeObj = challenge as Challenge;
      challengeObj.expiresAt = Date.now() - 1000; // Expired

      const proofRequest: CredentialProofRequest = {
        challenge: challenge.challenge,
        signature: Buffer.alloc(64).toString("hex"),
        publicKey: Buffer.alloc(32).toString("hex"),
        signatureType: "Ed25519",
      };

      const response = await issueCredentialWithProof(challenge.id, proofRequest);

      expect(response.isValid).toBe(false);
      expect(response.error).toContain("Challenge invalid");
    });

    it("should mark challenge as used after credential issuance", async () => {
      const challenge = generateChallenge();
      const mockPublicKey = Buffer.alloc(32).toString("hex");
      const mockSignature = Buffer.alloc(64).toString("hex");

      const proofRequest: CredentialProofRequest = {
        challenge: challenge.challenge,
        signature: mockSignature,
        publicKey: mockPublicKey,
        signatureType: "Ed25519",
      };

      await issueCredentialWithProof(challenge.id, proofRequest);

      // Challenge should now be marked as used
      expect(isChallengeValid(challenge.id)).toBe(false);
    });

    it("should reject unsupported signature type", async () => {
      const challenge = generateChallenge();
      const proofRequest = {
        challenge: challenge.challenge,
        signature: Buffer.alloc(64).toString("hex"),
        publicKey: Buffer.alloc(32).toString("hex"),
        signatureType: "RSA", // Unsupported
      } as CredentialProofRequest;

      const response = await issueCredentialWithProof(challenge.id, proofRequest);

      expect(response.isValid).toBe(false);
      expect(response.error).toContain("Unsupported signature type");
    });
  });

  describe("Credential Status", () => {
    it("should return valid status for issued credential", async () => {
      const challenge = generateChallenge();
      const mockPublicKey = Buffer.alloc(32).toString("hex");
      const mockSignature = Buffer.alloc(64).toString("hex");

      const proofRequest: CredentialProofRequest = {
        challenge: challenge.challenge,
        signature: mockSignature,
        publicKey: mockPublicKey,
        signatureType: "Ed25519",
      };

      const issueResponse = await issueCredentialWithProof(challenge.id, proofRequest);
      expect(issueResponse.credentialId).toBeDefined();

      const statusResponse = getCredentialStatus(issueResponse.credentialId!);
      expect(statusResponse.isValid).toBe(true);
      expect(statusResponse.issuedAt).toBeGreaterThan(0);
    });

    it("should return invalid status for non-existent credential", () => {
      const statusResponse = getCredentialStatus("non-existent");
      expect(statusResponse.isValid).toBe(false);
      expect(statusResponse.issuedAt).toBeUndefined();
    });
  });

  describe("Challenge Cleanup", () => {
    it("should clean up expired challenges", () => {
      const challenge1 = generateChallenge();
      const challenge2 = generateChallenge();

      // Manually expire one challenge
      const challengeObj1 = challenge1 as Challenge;
      challengeObj1.expiresAt = Date.now() - 1000;

      const cleaned = cleanupExpiredChallenges();

      expect(cleaned).toBeGreaterThan(0);
      expect(isChallengeValid(challenge1.id)).toBe(false);
      expect(isChallengeValid(challenge2.id)).toBe(true);
    });
  });
});
